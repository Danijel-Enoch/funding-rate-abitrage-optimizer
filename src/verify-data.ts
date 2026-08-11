#!/usr/bin/env bun
/**
 * Data integrity report.
 *
 * Pulls every series the backtests depend on and checks it against the rules in
 * data-integrity.ts: real provenance, non-constant, in the requested window,
 * sufficient coverage, no bad ticks. Prints what passes, what is rejected, and
 * why — so the venue list used by `bun run compare` is a consequence of measured
 * data quality rather than a hand-maintained guess.
 *
 * Usage:
 *   bun run verify-data                    # BTC/ETH/SOL over 365d
 *   bun run verify-data BTC --days 180
 */

import { deribit, hyperliquid, aster, paradex, lighter, lighterSpot } from "./exchanges/index";
import {
  validateFundingSeries, validatePriceSeries, printReport,
  type SeriesMeta, type ValidationReport, type Window,
} from "./data-integrity";
import { getSmile } from "./backtest-options";
import type { PerpExchange } from "./exchanges/types";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

interface VenueSpec {
  id: string;
  ex: PerpExchange & {
    fetchPrices?: (c: string, s: number, e: number) => Promise<Array<{ timestamp: number; price: number }>>;
  };
  fundingMeta: Omit<SeriesMeta, "source">;
  priceMeta?: Omit<SeriesMeta, "source">;
}

const VENUES: VenueSpec[] = [
  {
    id: "deribit",
    ex: deribit,
    fundingMeta: {
      endpoint: "/public/get_funding_rate_history",
      field: "interest_1h",
      provenance: "observed",
    },
    priceMeta: {
      endpoint: "/public/get_tradingview_chart_data",
      field: "close",
      provenance: "observed",
    },
  },
  {
    id: "hyperliquid",
    ex: hyperliquid,
    fundingMeta: { endpoint: "POST /info fundingHistory", field: "fundingRate", provenance: "observed" },
    priceMeta: { endpoint: "POST /info candleSnapshot", field: "c", provenance: "observed" },
  },
  {
    id: "aster",
    ex: aster,
    fundingMeta: { endpoint: "/fapi/v3/fundingRate", field: "fundingRate", provenance: "observed" },
    priceMeta: { endpoint: "/fapi/v1/klines", field: "close", provenance: "observed" },
  },
  {
    id: "paradex",
    ex: paradex,
    fundingMeta: {
      endpoint: "/v1/funding/data",
      field: "funding_rate_8h",
      provenance: "synthetic",
      caveat: "endpoint ignores start/end timestamps and only walks back hours from now",
    },
    priceMeta: { endpoint: "/v1/markets/klines", field: "close", provenance: "observed" },
  },
  {
    id: "lighter",
    ex: lighter,
    fundingMeta: {
      endpoint: "/api/v1/funding-rates",
      field: "rate",
      provenance: "synthetic",
      caveat: "no funding history endpoint (403); only a current reading exists",
    },
  },
];

function parseArgs(argv: string[]) {
  const coins: string[] = [];
  let days = 365;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") days = parseInt(argv[++i]);
    else if (!argv[i].startsWith("--")) coins.push(argv[i].toUpperCase());
  }
  return { coins: coins.length ? coins : ["BTC", "ETH", "SOL"], days };
}

async function main() {
  const { coins, days } = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const window: Window = { start: now - days * 86400000, end: now };

  console.log(`\n${C.bold}Data integrity report${C.reset}`);
  console.log(`${C.dim}window: ${days}d · coins: ${coins.join(", ")}${C.reset}`);
  console.log(`${C.dim}a series must be observed over the requested window, vary, and cover ≥90% of it${C.reset}`);

  const usable: Record<string, { funding: string[]; prices: string[] }> = {};

  for (const coin of coins) {
    console.log(`\n${C.bold}${C.cyan}══ ${coin} ══${C.reset}`);
    const reports: ValidationReport[] = [];
    usable[coin] = { funding: [], prices: [] };

    for (const v of VENUES) {
      const rates = await v.ex.fetchFundingRates(coin, window.start, window.end).catch(() => []);
      const fr = validateFundingSeries(
        `${v.id} funding`, rates, { source: v.id, ...v.fundingMeta }, window
      );
      reports.push(fr);
      if (fr.ok) usable[coin].funding.push(v.id);

      if (v.priceMeta && typeof v.ex.fetchPrices === "function") {
        const prices = await v.ex.fetchPrices(coin, window.start, window.end).catch(() => []);
        const pr = validatePriceSeries(
          `${v.id} price`, prices, { source: v.id, ...v.priceMeta }, window
        );
        reports.push(pr);
        if (pr.ok) usable[coin].prices.push(v.id);
      }
    }

    // Spot leg
    const spot = await lighterSpot.fetchPrices(`${coin}USDT`, window.start, window.end).catch(() => []);
    const sr = validatePriceSeries(
      "lighter-spot price", spot,
      { source: "lighter-spot", endpoint: "/api/v1/candlesticks", field: "close", provenance: "observed" },
      window
    );
    reports.push(sr);
    if (sr.ok) usable[coin].prices.push("lighter-spot");

    // Implied vol (options strategies only)
    const dvol = await deribit.fetchDvol(coin, window.start, window.end).catch(() => []);
    const dr = validatePriceSeries(
      "deribit DVOL", dvol.map((d) => ({ timestamp: d.timestamp, price: d.close })),
      { source: "deribit", endpoint: "/public/get_volatility_index_data", field: "close", provenance: "observed" },
      window
    );
    if (dvol.length === 0) {
      console.log(`  ${C.dim}(no DVOL published for ${coin} — no options market)${C.reset}`);
    } else {
      reports.push(dr);
    }

    printReport(reports);
  }

  // Smile provenance
  console.log(`\n${C.bold}Volatility smile (iron fly wings)${C.reset}`);
  for (const coin of coins) {
    const s = getSmile(coin);
    if (!s) {
      console.log(`  ${coin.padEnd(6)}${C.yellow}none fitted — iron fly will not run${C.reset}`);
    } else {
      const age = ((Date.now() - s.observedAt) / 86400000).toFixed(1);
      console.log(
        `  ${coin.padEnd(6)}skew=${s.skew.toFixed(4)} curvature=${s.curvature.toFixed(4)} ` +
        `rmse=${s.rmse.toFixed(3)} · ${s.points} strikes · fitted ${age}d ago`
      );
      console.log(`        ${C.dim}point-in-time snapshot applied across history — refit with: bun run fit-smile${C.reset}`);
    }
  }

  console.log(`\n${C.bold}Usable for backtesting${C.reset}`);
  for (const coin of coins) {
    const u = usable[coin];
    console.log(`  ${coin.padEnd(6)}funding: ${u.funding.length ? u.funding.join(", ") : C.red + "none" + C.reset}`);
    console.log(`        prices:  ${u.prices.length ? u.prices.join(", ") : C.red + "none" + C.reset}`);
  }

  console.log(`\n${C.dim}A venue needs both a funding series and a price series to be used in a`);
  console.log(`pair backtest. Nothing is substituted when one is missing — the pair is`);
  console.log(`skipped and reported by \`bun run compare\`.${C.reset}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
