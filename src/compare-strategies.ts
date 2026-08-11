#!/usr/bin/env bun
/**
 * Perp vs Perp  •  Perp vs Spot  •  Perp vs Options
 *
 * One-year head-to-head backtest of the three delta-neutral carry structures on
 * BTC and ETH, run across every venue with real retrievable history.
 *
 *   perp_vs_perp    long perp on the venue paying funding, short perp on the
 *                   venue receiving it. Harvests the funding differential.
 *   spot_vs_perp    long spot, short perp (cash-and-carry). Harvests the perp's
 *                   own funding.
 *   perp_vs_options short an ATM straddle, delta-hedge with the perp. Harvests
 *                   the variance risk premium; the hedge leg still pays/earns
 *                   funding. Only Deribit and Paradex have options books.
 *
 * Usage:
 *   bun run compare                          # BTC + ETH, 365d, $50k
 *   bun run compare BTC --days 365
 *   bun run compare BTC ETH --capital 100000 --leverage 3
 *   bun run compare --no-cache
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  runBacktest, EXCHANGE_FEES, type BacktestConfig, type BacktestResult,
} from "./backtest";
import {
  runOptionsBacktest, buildHourlyGrid, OPTIONS_FEES, type OptionsBacktestResult,
} from "./backtest-options";
import { resampleFundingHourly, annualizedFunding } from "./funding-normalize";
import { deribit, hyperliquid, aster, lighterSpot } from "./exchanges/index";
import type { FundingRateEntry, PerpExchange } from "./exchanges/types";
import type { DvolEntry } from "./exchanges/deribit";

const CACHE_DIR = join(import.meta.dir, "..", ".cache");

// ── Venue set ──
// Only venues that actually serve real, varying funding history from the public
// API. Anything that fabricates or flat-lines a series is excluded below, since
// a constant "rate" backtests as a straight line and manufactures a Sharpe in
// the hundreds.
const PERP_VENUES: Array<{ id: string; ex: PerpExchange }> = [
  { id: "deribit", ex: deribit },
  { id: "hyperliquid", ex: hyperliquid },
  { id: "aster", ex: aster },
];

/** Venues deliberately kept out of historical runs, with the reason shown to the user. */
const EXCLUDED_FROM_HISTORY: Array<{ id: string; reason: string }> = [
  { id: "lighter", reason: "funding history API returns 403; adapter replicates the current rate across the window (constant series)" },
  { id: "paradex", reason: "public funding endpoint ignores start/end timestamps and only walks back hours" },
  { id: "binance / bybit / okx / mexc", reason: "endpoints unreachable from this network (empty responses)" },
];

/**
 * Guards against a venue whose adapter fabricates history. A funding series with
 * almost no distinct values cannot be real over a year.
 */
function isDegenerateSeries(rates: FundingRateEntry[]): boolean {
  if (rates.length < 24) return true;
  const distinct = new Set(rates.map((r) => r.fundingRate.toFixed(12)));
  return distinct.size <= Math.max(2, rates.length / 500);
}

const SPOT_VENUE = { id: "lighter-spot", ex: lighterSpot };
const OPTIONS_VENUES = ["deribit", "paradex"];

// ── CLI ──
interface Args {
  coins: string[];
  days: number;
  capital: number;
  leverage: number;
  /** Position notional as a multiple of capital, applied to all three strategies. */
  notional: number;
  useCache: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const coins: string[] = [];
  let days = 365, capital = 50000, leverage = 3, notional = 1, useCache = true, json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") days = parseInt(argv[++i]);
    else if (a === "--capital") capital = parseFloat(argv[++i]);
    else if (a === "--leverage") leverage = parseFloat(argv[++i]);
    else if (a === "--notional") notional = parseFloat(argv[++i]);
    else if (a === "--no-cache") useCache = false;
    else if (a === "--json") json = true;
    else if (!a.startsWith("--")) coins.push(a.toUpperCase());
  }

  return { coins: coins.length ? coins : ["BTC", "ETH"], days, capital, leverage, notional, useCache, json };
}

// ── Disk cache (API pulls are slow and rate-limited) ──
function cached<T>(key: string, useCache: boolean, fetcher: () => Promise<T>): Promise<T> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${key}.json`);

  if (useCache && existsSync(path)) {
    try {
      return Promise.resolve(JSON.parse(readFileSync(path, "utf8")) as T);
    } catch { /* fall through and refetch */ }
  }

  return fetcher().then((data) => {
    try { writeFileSync(path, JSON.stringify(data)); } catch { /* cache is best-effort */ }
    return data;
  });
}

// ── Data bundle ──
interface CoinData {
  coin: string;
  funding: Map<string, FundingRateEntry[]>;   // hourly-normalized, by venue
  prices: Map<string, Array<{ timestamp: number; price: number }>>;
  spotPrices: Array<{ timestamp: number; price: number }>;
  dvol: DvolEntry[];
}

async function loadCoinData(coin: string, days: number, useCache: boolean): Promise<CoinData> {
  const now = Date.now();
  const start = now - days * 86400000;
  const tag = `${coin}-${days}d`;

  const funding = new Map<string, FundingRateEntry[]>();
  const prices = new Map<string, Array<{ timestamp: number; price: number }>>();

  for (const { id, ex } of PERP_VENUES) {
    const raw = await cached(`funding-${id}-${tag}`, useCache, () =>
      ex.fetchFundingRates(coin, start, now).catch(() => [])
    );
    if (raw.length > 24 && !isDegenerateSeries(raw)) {
      // Normalize every venue onto the same hourly grid so an 8h venue can be
      // compared against an hourly one without dropping points or scaling carry.
      funding.set(id, resampleFundingHourly(raw));
    } else if (raw.length > 24) {
      console.log(`${C.red}  ! ${id}: funding series has no variation — excluded as synthetic${C.reset}`);
    }

    const anyEx = ex as PerpExchange & {
      fetchPrices?: (c: string, s: number, e: number) => Promise<Array<{ timestamp: number; price: number }>>;
    };
    if (typeof anyEx.fetchPrices === "function") {
      const px = await cached(`price-${id}-${tag}`, useCache, () =>
        anyEx.fetchPrices!(coin, start, now).catch(() => [])
      );
      if (px.length > 24) prices.set(id, px);
    }
  }

  const spotPrices = await cached(`spot-${SPOT_VENUE.id}-${tag}`, useCache, () =>
    SPOT_VENUE.ex.fetchPrices(`${coin}USDT`, start, now).catch(() => [])
  );

  const dvol = await cached(`dvol-${tag}`, useCache, () =>
    deribit.fetchDvol(coin, start, now).catch(() => [])
  );

  return { coin, funding, prices, spotPrices, dvol };
}

// ── Strategy runs ──
interface StrategyRun {
  coin: string;
  strategy: "perp_vs_perp" | "spot_vs_perp" | "perp_vs_options";
  label: string;
  apy: number;
  sharpe: number;
  maxDdPct: number;
  totalPnl: number;
  fees: number;
  trades: number;
  winRate: number;
  /** Return per unit of drawdown — the practical ranking metric for carry books. */
  calmar: number;
  note?: string;
}

function toRun(
  coin: string,
  strategy: StrategyRun["strategy"],
  label: string,
  r: BacktestResult,
  note?: string
): StrategyRun {
  return {
    coin, strategy, label,
    apy: r.annualizedReturn,
    sharpe: r.sharpeRatio,
    maxDdPct: r.maxDrawdownPct,
    totalPnl: r.totalPnl,
    fees: r.totalFees,
    trades: r.totalTrades,
    winRate: r.winRate,
    calmar: r.maxDrawdownPct > 1e-6 ? r.annualizedReturn / r.maxDrawdownPct : r.annualizedReturn * 100,
    note,
  };
}

function optionsToRun(
  coin: string, label: string, r: OptionsBacktestResult, note?: string
): StrategyRun {
  return {
    coin, strategy: "perp_vs_options", label,
    apy: r.annualizedReturn,
    sharpe: r.sharpeRatio,
    maxDdPct: r.maxDrawdownPct,
    totalPnl: r.totalPnl,
    fees: r.totalFees,
    trades: r.totalTrades,
    winRate: r.winRate,
    calmar: r.maxDrawdownPct > 1e-6 ? r.annualizedReturn / r.maxDrawdownPct : r.annualizedReturn * 100,
    note,
  };
}

/**
 * Entry thresholds on the hourly funding differential, swept per venue pair.
 *
 * A round trip at 3x leverage costs roughly 20bps of notional while an hourly
 * funding differential is on the order of 1e-5, so a position has to be held for
 * hundreds of hours to clear its own costs. Too low a threshold churns the book
 * and the whole P&L becomes fees; too high and it never trades. Rather than
 * hand-pick one, every pair is run across the grid and the best is reported.
 */
// 0 = always-on: enter once and hold the carry for the whole period, which is
// how a cash-and-carry book is actually run and the natural benchmark here.
const THRESHOLD_GRID = [0, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001];

/** Taker (crossing) vs maker (resting) execution — the dominant cost assumption. */
const FEE_MODES = [false, true];

/**
 * The engine sizes each leg as min(capital/2, maxPositionSize) x leverage, and
 * for anything other than perp_vs_perp it *discards* perpLeverageA/B and uses
 * `perpLeverage` for both legs (see getConfig in backtest.ts). So to pin the
 * notional at `notionalMult` x capital across every strategy, all three leverage
 * fields have to be set to 2 x notionalMult.
 *
 * Equalising notional matters: without it the funding strategies run at 1x while
 * the options strategy runs at its own default, and the comparison is meaningless.
 */
function baseConfig(capital: number, notionalMult: number): Partial<BacktestConfig> {
  const lev = 2 * notionalMult;
  return {
    initialCapital: capital,
    maxSpreadBps: 500,
    maxPositionSize: capital * 0.5,
    maxPriceSpreadBps: 200,
    exitOnNegativeFunding: false,
    perpLeverage: lev,
    perpLeverageA: lev,
    perpLeverageB: lev,
  };
}

/** Runs the grid and returns the best result plus a label describing the winner. */
function sweep(
  build: (threshold: number, useMaker: boolean) => BacktestResult
): { best: BacktestResult; params: string } | null {
  let best: BacktestResult | null = null;
  let params = "";

  for (const threshold of THRESHOLD_GRID) {
    for (const useMaker of FEE_MODES) {
      const r = build(threshold, useMaker);
      if (r.totalTrades === 0) continue;
      if (!best || r.annualizedReturn > best.annualizedReturn) {
        best = r;
        params = threshold === 0
          ? `always-on, ${useMaker ? "maker" : "taker"}`
          : `${(threshold * 24 * 365 * 100).toFixed(0)}% APR gate, ${useMaker ? "maker" : "taker"}`;
      }
    }
  }
  return best ? { best, params } : null;
}

function runPerpVsPerp(data: CoinData, capital: number, notionalMult: number): StrategyRun[] {
  const runs: StrategyRun[] = [];
  const venues = [...data.funding.keys()];

  for (const a of venues) {
    for (const b of venues) {
      if (a === b) continue;
      const ratesA = data.funding.get(a)!;
      const ratesB = data.funding.get(b)!;
      const priceA = data.prices.get(a) ?? data.spotPrices;
      const priceB = data.prices.get(b) ?? data.spotPrices;

      const swept = sweep((fundingThreshold, useMakerFees) =>
        runBacktest(ratesA, ratesB, {
          ...baseConfig(capital, notionalMult),
          fundingThreshold, useMakerFees,
          strategy: "perp_vs_perp",
          venueA: a, venueB: b,
          feeA: EXCHANGE_FEES[a], feeB: EXCHANGE_FEES[b],
          priceData: priceA, priceDataA: priceA, priceDataB: priceB,
          coin: data.coin,
        })
      );

      if (swept) runs.push(toRun(data.coin, "perp_vs_perp", `${a} / ${b}`, swept.best, swept.params));
    }
  }
  return runs;
}

function runSpotVsPerp(data: CoinData, capital: number, notionalMult: number): StrategyRun[] {
  const runs: StrategyRun[] = [];

  for (const [venue, ratesB] of data.funding) {
    // Spot leg pays no funding
    const ratesA = ratesB.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
    const priceB = data.prices.get(venue) ?? data.spotPrices;

    const swept = sweep((fundingThreshold, useMakerFees) =>
      runBacktest(ratesA, ratesB, {
        ...baseConfig(capital, notionalMult),
        fundingThreshold, useMakerFees,
        strategy: "spot_vs_perp",
        venueA: SPOT_VENUE.id, venueB: venue,
        feeA: EXCHANGE_FEES[SPOT_VENUE.id] ?? EXCHANGE_FEES["lighter-spot"],
        feeB: EXCHANGE_FEES[venue],
        priceData: data.spotPrices, priceDataA: data.spotPrices, priceDataB: priceB,
        coin: data.coin,
      })
    );

    if (swept) runs.push(toRun(data.coin, "spot_vs_perp", `spot / ${venue}`, swept.best, swept.params));
  }
  return runs;
}

function runPerpVsOptions(data: CoinData, capital: number, notionalMult: number): StrategyRun[] {
  const runs: StrategyRun[] = [];
  const funding = data.funding.get("deribit");
  const prices = data.prices.get("deribit");
  if (!funding?.length || !prices?.length || !data.dvol.length) return runs;

  const grid = buildHourlyGrid(prices, data.dvol, funding);
  if (grid.length < 48) return runs;

  for (const venue of OPTIONS_VENUES) {
    const result = runOptionsBacktest(grid, {
      initialCapital: capital,
      coin: data.coin,
      venue,
      notionalLeverage: notionalMult,
      fees: OPTIONS_FEES[venue],
    });
    if (result.totalTrades > 0) {
      const note = venue === "paradex"
        ? "Paradex fee model applied to Deribit IV/funding (no Paradex vol history)"
        : undefined;
      runs.push(optionsToRun(data.coin, `short straddle @ ${venue}`, result, note));
    }
  }
  return runs;
}

// ── Output ──
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m",
};

const colorNum = (x: number, s: string) => `${x >= 0 ? C.green : C.red}${s}${C.reset}`;

function printRunTable(title: string, runs: StrategyRun[], limit = 6) {
  if (!runs.length) {
    console.log(`\n${C.bold}${title}${C.reset}\n  ${C.dim}no results${C.reset}`);
    return;
  }
  console.log(`\n${C.bold}${title}${C.reset}`);
  console.log(
    `  ${"Venue pair".padEnd(30)}${"APY".padStart(9)}${"Sharpe".padStart(9)}` +
    `${"MaxDD".padStart(9)}${"Calmar".padStart(9)}${"Net PnL".padStart(12)}${"Fees".padStart(11)}${"Trades".padStart(8)}`
  );
  for (const r of runs.slice(0, limit)) {
    console.log(
      `  ${r.label.padEnd(30)}${colorNum(r.apy, pct(r.apy).padStart(9))}` +
      `${r.sharpe.toFixed(2).padStart(9)}${pct(r.maxDdPct).padStart(9)}` +
      `${r.calmar.toFixed(2).padStart(9)}${colorNum(r.totalPnl, usd(r.totalPnl).padStart(12))}` +
      `${usd(r.fees).padStart(11)}${String(r.trades).padStart(8)}`
    );
    if (r.note) console.log(`  ${C.dim}↳ ${r.note}${C.reset}`);
  }
}

function printVerdict(all: StrategyRun[], capital: number) {
  const strategies: StrategyRun["strategy"][] = ["perp_vs_perp", "spot_vs_perp", "perp_vs_options"];
  const names: Record<string, string> = {
    perp_vs_perp: "Perp vs Perp",
    spot_vs_perp: "Perp vs Spot",
    perp_vs_options: "Perp vs Options",
  };

  console.log(`\n${C.bold}${"═".repeat(96)}${C.reset}`);
  console.log(`${C.bold}VERDICT — best configuration per strategy${C.reset}`);
  console.log(`${C.bold}${"═".repeat(96)}${C.reset}`);
  console.log(
    `  ${"Strategy".padEnd(18)}${"Coin".padEnd(6)}${"Best venue".padEnd(30)}` +
    `${"APY".padStart(9)}${"Sharpe".padStart(9)}${"MaxDD".padStart(9)}${"Calmar".padStart(9)}`
  );

  const winners: StrategyRun[] = [];
  for (const coin of [...new Set(all.map((r) => r.coin))]) {
    for (const s of strategies) {
      const pool = all.filter((r) => r.coin === coin && r.strategy === s);
      if (!pool.length) continue;
      const best = pool.reduce((a, b) => (b.apy > a.apy ? b : a));
      winners.push(best);
      console.log(
        `  ${names[s].padEnd(18)}${coin.padEnd(6)}${best.label.padEnd(30)}` +
        `${colorNum(best.apy, pct(best.apy).padStart(9))}${best.sharpe.toFixed(2).padStart(9)}` +
        `${pct(best.maxDdPct).padStart(9)}${best.calmar.toFixed(2).padStart(9)}`
      );
    }
  }

  const byApy = [...winners].sort((a, b) => b.apy - a.apy)[0];
  const bySharpe = [...winners].sort((a, b) => b.sharpe - a.sharpe)[0];
  const byCalmar = [...winners].sort((a, b) => b.calmar - a.calmar)[0];

  console.log(`\n${C.bold}On $${capital.toLocaleString("en-US")} of capital:${C.reset}`);
  if (byApy) console.log(`  Highest return      ${C.cyan}${names[byApy.strategy]}${C.reset} — ${byApy.coin} ${byApy.label} at ${pct(byApy.apy)} APY`);
  if (bySharpe) console.log(`  Best risk-adjusted  ${C.cyan}${names[bySharpe.strategy]}${C.reset} — ${bySharpe.coin} ${bySharpe.label} at Sharpe ${bySharpe.sharpe.toFixed(2)}`);
  if (byCalmar) console.log(`  Best return/DD      ${C.cyan}${names[byCalmar.strategy]}${C.reset} — ${byCalmar.coin} ${byCalmar.label} at Calmar ${byCalmar.calmar.toFixed(2)}`);

  console.log(`  ${C.yellow}Caveat:${C.reset} the funding strategies post Sharpe in the tens because a funding`);
  console.log(`  stream is near-deterministic in this model — no execution slippage, no venue`);
  console.log(`  or stablecoin risk, and a hedge that never slips. Those Sharpes are a property`);
  console.log(`  of the model, not a tradable edge. Compare on APY and max drawdown instead.`);
}

function printOptionsDetail(coin: string, r: OptionsBacktestResult) {
  console.log(`\n${C.bold}Perp vs Options — P&L decomposition (${coin}, Deribit)${C.reset}`);
  console.log(`  Implied vol (avg)      ${(r.avgImpliedVol * 100).toFixed(1)}%`);
  console.log(`  Realized vol (avg)     ${(r.avgRealizedVol * 100).toFixed(1)}%`);
  console.log(`  Variance risk premium  ${colorNum(r.avgVrpVolPts, r.avgVrpVolPts.toFixed(2) + " vol pts")}`);
  console.log(`  ${C.dim}${"─".repeat(60)}${C.reset}`);
  console.log(`  Theta − gamma          ${colorNum(r.totalThetaGammaPnl, usd(r.totalThetaGammaPnl))}   ${C.dim}implied variance sold, realized variance paid${C.reset}`);
  console.log(`  Vega (IV drift)        ${colorNum(r.totalVegaPnl, usd(r.totalVegaPnl))}   ${C.dim}mark-to-market on the vol level${C.reset}`);
  console.log(`  Funding on hedge       ${colorNum(r.totalFundingPnl, usd(r.totalFundingPnl))}   ${C.dim}the perp leg (${(r.hedgeLongFraction * 100).toFixed(0)}% of hours net long)${C.reset}`);
  console.log(`  Fees                   ${C.red}${usd(-r.totalFees)}${C.reset}   ${C.dim}${r.totalRehedges} delta rehedges + ${r.totalTrades} option rolls${C.reset}`);
  console.log(`  ${C.dim}${"─".repeat(60)}${C.reset}`);
  console.log(`  ${C.bold}Net${C.reset}                    ${colorNum(r.totalPnl, usd(r.totalPnl))}   ${C.dim}${r.stopOuts} stop-outs${C.reset}`);
}

// ── Main ──
async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n${C.bold}Perp vs Perp  •  Perp vs Spot  •  Perp vs Options${C.reset}`);
  console.log(`${C.dim}${args.days}-day backtest · $${args.capital.toLocaleString("en-US")} capital · position notional = ${args.notional}x capital on all three strategies${C.reset}`);
  console.log(`${C.dim}Perp venues: ${PERP_VENUES.map((v) => v.id).join(", ")} · spot: ${SPOT_VENUE.id} · options: ${OPTIONS_VENUES.join(", ")}${C.reset}`);
  console.log(`${C.dim}Excluded from historical runs:${C.reset}`);
  for (const e of EXCLUDED_FROM_HISTORY) {
    console.log(`${C.dim}  · ${e.id} — ${e.reason}${C.reset}`);
  }

  const all: StrategyRun[] = [];
  const optionsDetail: Array<{ coin: string; result: OptionsBacktestResult }> = [];

  for (const coin of args.coins) {
    console.log(`\n${C.yellow}Loading ${coin}...${C.reset}`);
    const data = await loadCoinData(coin, args.days, args.useCache);

    const covered = [...data.funding.entries()]
      .map(([v, r]) => `${v} (${(annualizedFunding(r) * 100).toFixed(1)}% avg funding APR)`)
      .join(", ");
    console.log(`${C.dim}  funding: ${covered || "none"}${C.reset}`);
    console.log(`${C.dim}  spot prices: ${data.spotPrices.length} pts · DVOL: ${data.dvol.length} pts${C.reset}`);

    if (data.funding.size === 0) {
      console.log(`${C.red}  no funding data for ${coin}, skipping${C.reset}`);
      continue;
    }

    console.log(`\n${C.bold}${C.cyan}══ ${coin} ══${C.reset}`);

    const pvp = runPerpVsPerp(data, args.capital, args.notional).sort((a, b) => b.apy - a.apy);
    const svp = runSpotVsPerp(data, args.capital, args.notional).sort((a, b) => b.apy - a.apy);
    const pvo = runPerpVsOptions(data, args.capital, args.notional).sort((a, b) => b.apy - a.apy);

    printRunTable(`${coin} — Perp vs Perp (funding differential)`, pvp);
    printRunTable(`${coin} — Perp vs Spot (cash and carry)`, svp);
    printRunTable(`${coin} — Perp vs Options (short vol, delta-hedged)`, pvo);

    // Re-run the Deribit options case to surface its P&L decomposition
    const funding = data.funding.get("deribit");
    const prices = data.prices.get("deribit");
    if (funding?.length && prices?.length && data.dvol.length) {
      const grid = buildHourlyGrid(prices, data.dvol, funding);
      const detail = runOptionsBacktest(grid, {
        initialCapital: args.capital, coin, venue: "deribit",
        notionalLeverage: args.notional,
      });
      if (detail.totalTrades > 0) {
        printOptionsDetail(coin, detail);
        optionsDetail.push({ coin, result: detail });
      }
    }

    all.push(...pvp, ...svp, ...pvo);
  }

  if (!all.length) {
    console.log(`\n${C.red}No strategies produced results.${C.reset}`);
    return;
  }

  printVerdict(all, args.capital);

  console.log(`\n${C.dim}Notes:`);
  console.log(`  · Funding streams are resampled to a common hourly grid, so 8h venues and`);
  console.log(`    hourly venues are compared on the same basis.`);
  console.log(`  · Perp vs Options uses Deribit DVOL as the implied leg (DVOL² is the fair`);
  console.log(`    strike of a 30d variance swap) and real hourly funding on the delta hedge.`);
  console.log(`  · Paradex serves live option chains and 1y of prices, but its public funding`);
  console.log(`    endpoint ignores time filters, so it cannot be backtested historically.${C.reset}`);

  if (args.json) {
    const out = join(CACHE_DIR, "compare-results.json");
    writeFileSync(out, JSON.stringify({ args, runs: all, optionsDetail }, null, 2));
    console.log(`\n${C.dim}Wrote ${out}${C.reset}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
