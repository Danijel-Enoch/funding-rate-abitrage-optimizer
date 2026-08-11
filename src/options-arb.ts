#!/usr/bin/env bun
/**
 * Live perp vs options conversion arbitrage scanner — Deribit and Paradex.
 *
 * Put-call parity gives the forward the options market is pricing:
 *     F = K + (C - P)
 * A long put + short call at K is a synthetic short forward at F. Pair it with a
 * long perp and the difference (F - perp) is locked in at expiry, because both
 * legs settle against the same index. What is left is the funding carried on the
 * perp leg over the tenor — which is exactly why this sits alongside the funding
 * strategies rather than apart from them.
 *
 * Unlike the historical comparison in compare-strategies.ts, this runs live:
 * option chains are available from both venues right now, but neither publishes
 * a year of historical chains, so this structure can only be scanned forward.
 *
 * Usage:
 *   bun run options-arb                 # BTC + ETH, both venues
 *   bun run options-arb BTC
 *   bun run options-arb --min-apr 5     # only show >5% net APR
 */

import { deribit, paradexOptions } from "./exchanges/index";
import { extractSyntheticForwards, findConversionArbs, blackScholes, YEAR_MS, type ConversionArb } from "./options";
import { EXCHANGE_FEES } from "./backtest";
import { OPTIONS_FEES } from "./backtest-options";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m",
};

interface Args { coins: string[]; minApr: number }

function parseArgs(argv: string[]): Args {
  const coins: string[] = [];
  let minApr = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--min-apr") minApr = parseFloat(argv[++i]) / 100;
    else if (!argv[i].startsWith("--")) coins.push(argv[i].toUpperCase());
  }
  return { coins: coins.length ? coins : ["BTC", "ETH"], minApr };
}

/**
 * Round-trip cost of the structure: two option legs (each charged on underlying
 * notional, capped at a share of premium) plus the perp leg, entry and exit.
 */
function roundTripCostBps(venue: string): number {
  const opt = OPTIONS_FEES[venue] ?? OPTIONS_FEES.deribit;
  const perp = EXCHANGE_FEES[venue] ?? EXCHANGE_FEES.deribit;
  const optionLegs = 2 * opt.optionFeeBps * 2;                       // 2 legs, in and out
  const perpLegs = 2 * (perp.takerFeeBps + perp.avgSpreadBps / 2);   // in and out
  return optionLegs + perpLegs;
}

async function scanDeribit(coin: string): Promise<ConversionArb[]> {
  const [chain, funding] = await Promise.all([
    deribit.fetchOptionChain(coin),
    deribit.fetchFundingRates(coin, Date.now() - 8 * 3600 * 1000, Date.now()),
  ]);
  if (!chain.length) return [];

  const forwards = extractSyntheticForwards(chain);
  const perpPrice = chain[0].underlyingPrice;

  // Deribit accrues hourly; average the last few hours for a stable read
  const recent = funding.slice(-8);
  const hourlyRate = recent.length
    ? recent.reduce((s, r) => s + r.fundingRate, 0) / recent.length
    : 0;

  return findConversionArbs(forwards, perpPrice, hourlyRate, 1, roundTripCostBps("deribit"));
}

async function scanParadex(coin: string): Promise<ConversionArb[]> {
  const [chain, perp] = await Promise.all([
    paradexOptions.fetchOptionChain(coin),
    paradexOptions.fetchPerpMark(coin),
  ]);
  if (!chain.length || !perp) return [];

  const forwards = extractSyntheticForwards(chain);
  // Paradex quotes an 8h funding rate
  return findConversionArbs(forwards, perp.markPrice, perp.fundingRate, 8, roundTripCostBps("paradex"));
}

function printArbs(coin: string, venue: string, arbs: ConversionArb[], minApr: number) {
  const shown = arbs.filter((a) => a.netApr >= minApr);
  console.log(`\n${C.bold}${coin} — ${venue}${C.reset}`);
  if (!shown.length) {
    console.log(`  ${C.dim}no expiries above the ${(minApr * 100).toFixed(1)}% net APR threshold${C.reset}`);
    return;
  }

  console.log(
    `  ${"Expiry".padEnd(12)}${"Days".padStart(6)}${"Strike".padStart(10)}` +
    `${"Perp".padStart(11)}${"Opt fwd".padStart(11)}${"Basis".padStart(10)}` +
    `${"Gross APR".padStart(11)}${"Funding".padStart(10)}${"Net APR".padStart(10)}  Direction`
  );

  for (const a of shown.slice(0, 10)) {
    const days = a.tYears * 365;
    const netColor = a.netApr >= 0 ? C.green : C.red;
    const dir = a.direction === "long_perp_short_synthetic" ? "long perp / short synth" : "short perp / long synth";
    console.log(
      `  ${new Date(a.expiry).toISOString().slice(0, 10).padEnd(12)}` +
      `${days.toFixed(1).padStart(6)}${a.strike.toLocaleString("en-US").padStart(10)}` +
      `${a.perpPrice.toFixed(1).padStart(11)}${a.optionForward.toFixed(1).padStart(11)}` +
      `${(a.basisBps.toFixed(1) + "bp").padStart(10)}` +
      `${((a.grossApr * 100).toFixed(2) + "%").padStart(11)}` +
      `${((a.expectedFundingApr * 100).toFixed(2) + "%").padStart(10)}` +
      `${netColor}${((a.netApr * 100).toFixed(2) + "%").padStart(10)}${C.reset}  ${C.dim}${dir}${C.reset}`
    );
  }
}

/** A strike/expiry quoted on both venues, with the IV difference between them. */
interface CrossVenueIv {
  coin: string;
  expiry: number;
  strike: number;
  type: "C" | "P";
  deribitIv: number;
  paradexIv: number;
  /** Positive = Deribit richer, so sell Deribit and buy Paradex. */
  ivSpreadVolPts: number;
  vegaPerContract: number;
}

/**
 * Options vs options, across venues.
 *
 * The same contract quoted on two books rarely carries the same implied vol.
 * Selling the richer one against the cheaper one is delta-neutral once the
 * residual delta is hedged, and unlike the single-venue structures it does not
 * depend on realized vol at all — it only needs the spread to converge.
 *
 * This is live-only: neither venue publishes historical chains, so it cannot be
 * backtested the way the single-venue short-vol strategies can.
 */
async function scanCrossVenueIv(coin: string): Promise<CrossVenueIv[]> {
  const [der, par] = await Promise.all([
    deribit.fetchOptionChain(coin),
    paradexOptions.fetchOptionChain(coin),
  ]);
  if (!der.length || !par.length) return [];

  const key = (q: { expiry: number; strike: number; type: string }) =>
    `${q.expiry}:${q.strike}:${q.type}`;

  const parMap = new Map(par.filter((q) => q.markIv > 0).map((q) => [key(q), q]));
  const now = Date.now();
  const out: CrossVenueIv[] = [];

  for (const d of der) {
    if (d.markIv <= 0 || d.expiry <= now) continue;
    const p = parMap.get(key(d));
    if (!p) continue;

    const T = (d.expiry - now) / YEAR_MS;
    const g = blackScholes(d.underlyingPrice, d.strike, T, d.markIv, d.type);

    // Deep wings carry huge apparent IV gaps because both venues are quoting a
    // model there, not a tradable market. Restrict to strikes with real delta.
    const absDelta = Math.abs(g.delta);
    if (absDelta < 0.10 || absDelta > 0.90) continue;

    out.push({
      coin,
      expiry: d.expiry,
      strike: d.strike,
      type: d.type,
      deribitIv: d.markIv,
      paradexIv: p.markIv,
      ivSpreadVolPts: (d.markIv - p.markIv) * 100,
      vegaPerContract: g.vega,
    });
  }

  return out.sort((a, b) => Math.abs(b.ivSpreadVolPts) - Math.abs(a.ivSpreadVolPts));
}

function printCrossVenue(coin: string, rows: CrossVenueIv[]) {
  console.log(`\n${C.bold}${coin} — Options vs Options (Deribit vs Paradex, same strike & expiry)${C.reset}`);
  if (!rows.length) {
    console.log(`  ${C.dim}no strikes quoted on both venues${C.reset}`);
    return;
  }

  const matched = rows.length;
  const mean = rows.reduce((s, r) => s + r.ivSpreadVolPts, 0) / matched;
  console.log(`  ${C.dim}${matched} contracts quoted on both · mean Deribit − Paradex IV = ${mean.toFixed(2)} vol pts${C.reset}`);
  console.log(
    `  ${"Expiry".padEnd(12)}${"Strike".padStart(10)}${"Type".padStart(6)}` +
    `${"Deribit IV".padStart(12)}${"Paradex IV".padStart(12)}${"Spread".padStart(11)}   Trade`
  );

  for (const r of rows.slice(0, 10)) {
    const sellDeribit = r.ivSpreadVolPts > 0;
    console.log(
      `  ${new Date(r.expiry).toISOString().slice(0, 10).padEnd(12)}` +
      `${r.strike.toLocaleString("en-US").padStart(10)}${r.type.padStart(6)}` +
      `${((r.deribitIv * 100).toFixed(1) + "%").padStart(12)}` +
      `${((r.paradexIv * 100).toFixed(1) + "%").padStart(12)}` +
      `${(r.ivSpreadVolPts.toFixed(2) + "v").padStart(11)}   ` +
      `${C.dim}${sellDeribit ? "sell Deribit / buy Paradex" : "sell Paradex / buy Deribit"}${C.reset}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n${C.bold}Perp vs Options — live conversion arbitrage${C.reset}`);
  console.log(`${C.dim}Synthetic forward from put-call parity vs the perp mark, net of funding and round-trip fees${C.reset}`);

  for (const coin of args.coins) {
    const [der, par] = await Promise.all([
      scanDeribit(coin).catch(() => [] as ConversionArb[]),
      scanParadex(coin).catch(() => [] as ConversionArb[]),
    ]);

    printArbs(coin, "Deribit", der, args.minApr);
    printArbs(coin, "Paradex", par, args.minApr);

    const cross = await scanCrossVenueIv(coin).catch(() => [] as CrossVenueIv[]);
    printCrossVenue(coin, cross);

    // Cross-venue: the same structure priced differently on the two books
    if (der.length && par.length) {
      const best = [...der, ...par].sort((a, b) => b.netApr - a.netApr)[0];
      console.log(
        `  ${C.cyan}best ${coin} structure: ${best.venue} ${new Date(best.expiry).toISOString().slice(0, 10)} ` +
        `@ ${(best.netApr * 100).toFixed(2)}% net APR${C.reset}`
      );
    }
  }

  console.log(
    `\n${C.dim}Near-dated expiries usually show large apparent edge — that is the option` +
    `\nbid-ask, not alpha. Weight the longer tenors, where the quote is tighter` +
    `\nrelative to the tenor and the annualization is less sensitive.${C.reset}\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
