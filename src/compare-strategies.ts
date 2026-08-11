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
  runOptionsBacktest, buildHourlyGrid, OPTIONS_FEES, smileProvenance, getSmile,
  type OptionsBacktestResult,
} from "./backtest-options";
import { resampleFundingHourly, annualizedFunding, alignEntryToPrevailingFunding } from "./funding-normalize";
import { deribit, hyperliquid, aster, lighterSpot } from "./exchanges/index";
import type { FundingRateEntry, PerpExchange } from "./exchanges/types";
import type { DvolEntry } from "./exchanges/deribit";
import {
  validateFundingSeries, validatePriceSeries, type SeriesMeta, type ValidationReport, type Window,
} from "./data-integrity";

const CACHE_DIR = join(import.meta.dir, "..", ".cache");

// ── Venue set ──
// Only venues that actually serve real, varying funding history from the public
// API. Anything that fabricates or flat-lines a series is excluded below, since
// a constant "rate" backtests as a straight line and manufactures a Sharpe in
// the hundreds.
const PERP_VENUES: Array<{
  id: string; ex: PerpExchange;
  funding: Omit<SeriesMeta, "source">;
  price: Omit<SeriesMeta, "source">;
}> = [
  {
    id: "deribit", ex: deribit,
    funding: { endpoint: "/public/get_funding_rate_history", field: "interest_1h", provenance: "observed" },
    price: { endpoint: "/public/get_tradingview_chart_data", field: "close", provenance: "observed" },
  },
  {
    id: "hyperliquid", ex: hyperliquid,
    funding: { endpoint: "POST /info fundingHistory", field: "fundingRate", provenance: "observed" },
    price: { endpoint: "POST /info candleSnapshot", field: "c", provenance: "observed" },
  },
  {
    id: "aster", ex: aster,
    funding: { endpoint: "/fapi/v3/fundingRate", field: "fundingRate", provenance: "observed" },
    price: { endpoint: "/fapi/v1/klines", field: "close", provenance: "observed" },
  },
];

/** Venues deliberately kept out of historical runs, with the reason shown to the user. */
const EXCLUDED_FROM_HISTORY: Array<{ id: string; reason: string }> = [
  { id: "lighter", reason: "no funding history endpoint (403); adapter now returns nothing rather than replicating the current rate" },
  { id: "paradex", reason: "funding endpoint ignores start/end timestamps — perps excluded, options still scanned live" },
  { id: "binance / bybit / okx / mexc", reason: "endpoints unreachable from this network (empty responses)" },
];

const SPOT_VENUE = { id: "lighter-spot", ex: lighterSpot };
/**
 * Venues whose options can actually be backtested: Deribit alone, because it is
 * the only one publishing a historical implied-vol series (DVOL). Paradex has a
 * live chain and is scanned by `bun run options-arb`, but has no vol history.
 */
const BACKTESTABLE_OPTIONS_VENUES = ["deribit"];

// ── CLI ──
interface Args {
  coins: string[];
  /** Lookback windows in days, each run separately (e.g. 90, 180, 365). */
  periods: number[];
  capital: number;
  leverage: number;
  /** Position notional as a multiple of capital, applied to all three strategies. */
  notional: number;
  useCache: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const coins: string[] = [];
  let periods = [90, 180, 365];
  let capital = 50000, leverage = 3, notional = 1, useCache = true, json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") periods = argv[++i].split(",").map((d) => parseInt(d.trim())).filter((d) => d > 0);
    else if (a === "--capital") capital = parseFloat(argv[++i]);
    else if (a === "--leverage") leverage = parseFloat(argv[++i]);
    else if (a === "--notional") notional = parseFloat(argv[++i]);
    else if (a === "--no-cache") useCache = false;
    else if (a === "--json") json = true;
    else if (!a.startsWith("--")) coins.push(a.toUpperCase());
  }

  return {
    coins: coins.length ? coins : ["BTC", "ETH", "SOL"],
    periods: periods.length ? periods : [365],
    capital, leverage, notional, useCache, json,
  };
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
/** Raw series as fetched, with its provenance, before any window is applied. */
interface RawSeries<T> {
  data: T[];
  meta: SeriesMeta;
}

/** Everything fetched for a coin at the longest window, unvalidated. */
interface CoinFetch {
  coin: string;
  funding: Map<string, RawSeries<FundingRateEntry>>;
  prices: Map<string, RawSeries<{ timestamp: number; price: number }>>;
  spot: RawSeries<{ timestamp: number; price: number }>;
  dvol: RawSeries<DvolEntry>;
}

interface CoinData {
  coin: string;
  /** Validation outcome for every series pulled, passing or not. */
  reports: ValidationReport[];
  funding: Map<string, FundingRateEntry[]>;   // hourly-normalized, by venue
  prices: Map<string, Array<{ timestamp: number; price: number }>>;
  spotPrices: Array<{ timestamp: number; price: number }>;
  dvol: DvolEntry[];
}

/**
 * Validates every raw series against a specific window and returns only what
 * passes. Validation is per-window on purpose: a venue that retains 208 days of
 * price history is legitimately usable over 90 and 180 days and legitimately
 * unusable over 365. Validating once at the longest window would throw away
 * good data for the shorter ones.
 */
function sliceCoinData(fetched: CoinFetch, days: number): CoinData {
  const end = Date.now();
  const start = end - days * 86400000;
  const window: Window = { start, end };
  const after = <T extends { timestamp: number }>(xs: T[]) => xs.filter((x) => x.timestamp >= start);

  const reports: ValidationReport[] = [];
  const funding = new Map<string, FundingRateEntry[]>();
  const prices = new Map<string, Array<{ timestamp: number; price: number }>>();

  for (const [venue, raw] of fetched.funding) {
    const sliced = after(raw.data);
    const r = validateFundingSeries(`${venue} funding`, sliced, raw.meta, window);
    reports.push(r);
    // Hourly resampling is a documented transform of validated observations
    if (r.ok) funding.set(venue, resampleFundingHourly(sliced));
  }

  for (const [venue, raw] of fetched.prices) {
    const sliced = after(raw.data);
    const r = validatePriceSeries(`${venue} price`, sliced, raw.meta, window);
    reports.push(r);
    if (r.ok) prices.set(venue, sliced);
  }

  const slicedSpot = after(fetched.spot.data);
  const spotReport = validatePriceSeries("lighter-spot price", slicedSpot, fetched.spot.meta, window);
  reports.push(spotReport);

  const slicedDvol = after(fetched.dvol.data);
  let dvol: DvolEntry[] = [];
  if (slicedDvol.length > 0) {
    const r = validatePriceSeries(
      "deribit DVOL", slicedDvol.map((d) => ({ timestamp: d.timestamp, price: d.close })),
      fetched.dvol.meta, window
    );
    reports.push(r);
    if (r.ok) dvol = slicedDvol;
  }

  return {
    coin: fetched.coin,
    reports,
    funding,
    prices,
    spotPrices: spotReport.ok ? slicedSpot : [],
    dvol,
  };
}

/** Fetches every series once, at the longest window. No validation here. */
async function loadCoinData(coin: string, days: number, useCache: boolean): Promise<CoinFetch> {
  const now = Date.now();
  const start = now - days * 86400000;
  const tag = `${coin}-${days}d`;

  const funding = new Map<string, RawSeries<FundingRateEntry>>();
  const prices = new Map<string, RawSeries<{ timestamp: number; price: number }>>();

  for (const v of PERP_VENUES) {
    const raw = await cached(`funding-${v.id}-${tag}`, useCache, () =>
      v.ex.fetchFundingRates(coin, start, now).catch(() => [])
    );
    funding.set(v.id, { data: raw, meta: { source: v.id, ...v.funding } });

    const anyEx = v.ex as PerpExchange & {
      fetchPrices?: (c: string, s: number, e: number) => Promise<Array<{ timestamp: number; price: number }>>;
    };
    if (typeof anyEx.fetchPrices === "function") {
      const px = await cached(`price-${v.id}-${tag}`, useCache, () =>
        anyEx.fetchPrices!(coin, start, now).catch(() => [])
      );
      prices.set(v.id, { data: px, meta: { source: v.id, ...v.price } });
    }
  }

  const spot = await cached(`spot-${SPOT_VENUE.id}-${tag}`, useCache, () =>
    SPOT_VENUE.ex.fetchPrices(`${coin}USDT`, start, now).catch(() => [])
  );
  const dvol = await cached(`dvol-${tag}`, useCache, () =>
    deribit.fetchDvol(coin, start, now).catch(() => [])
  );

  return {
    coin,
    funding,
    prices,
    spot: {
      data: spot,
      meta: { source: SPOT_VENUE.id, endpoint: "/api/v1/candlesticks", field: "close", provenance: "observed" },
    },
    dvol: {
      data: dvol,
      meta: { source: "deribit", endpoint: "/public/get_volatility_index_data", field: "close", provenance: "observed" },
    },
  };
}

// ── Strategy runs ──
interface StrategyRun {
  coin: string;
  strategy: "perp_vs_perp" | "spot_vs_perp" | "perp_vs_options" | "options_vs_options";
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
  coin: string, strategy: StrategyRun["strategy"], label: string,
  r: OptionsBacktestResult, note?: string
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

function runPerpVsPerp(
  data: CoinData, capital: number, notionalMult: number, skipped: string[] = []
): StrategyRun[] {
  const runs: StrategyRun[] = [];
  const venues = [...data.funding.keys()];

  for (const a of venues) {
    for (const b of venues) {
      if (a === b) continue;
      // Entry direction must come from the prevailing regime, not one noisy bar
      const { ratesA, ratesB } = alignEntryToPrevailingFunding(
        data.funding.get(a)!, data.funding.get(b)!
      );
      // No substitution: if a venue publishes no price history we cannot measure
      // the basis between the two venues. Falling back to a shared spot series
      // would report an inter-venue price spread of exactly zero — inventing the
      // absence of the very risk this strategy carries.
      const priceA = data.prices.get(a);
      const priceB = data.prices.get(b);
      if (!priceA?.length || !priceB?.length) {
        skipped.push(`${a} / ${b}: no observed price history for ${!priceA?.length ? a : b}`);
        continue;
      }

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

function runSpotVsPerp(
  data: CoinData, capital: number, notionalMult: number, skipped: string[] = []
): StrategyRun[] {
  const runs: StrategyRun[] = [];

  for (const [venue, rawB] of data.funding) {
    // Spot leg pays no funding
    const rawA = rawB.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
    const { ratesA, ratesB } = alignEntryToPrevailingFunding(rawA, rawB);
    const priceB = data.prices.get(venue);
    if (!priceB?.length || !data.spotPrices.length) {
      skipped.push(`spot / ${venue}: no observed price history for ${!priceB?.length ? venue : "spot"}`);
      continue;
    }

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

/**
 * Both options structures share the same engine and the same hourly grid; they
 * differ only in the legs traded.
 *
 *   perp_vs_options     short ATM straddle, delta-hedged with the perp
 *   options_vs_options  iron fly — the same short straddle with a long OTM
 *                       strangle bought against it, capping the tail
 *
 * Coins without an options market (SOL has none on either venue) return nothing.
 */
function runOptionsStrategies(
  data: CoinData, capital: number, notionalMult: number
): StrategyRun[] {
  const runs: StrategyRun[] = [];
  const funding = data.funding.get("deribit");
  const prices = data.prices.get("deribit");
  if (!funding?.length || !prices?.length || !data.dvol.length) return runs;

  const grid = buildHourlyGrid(prices, data.dvol, funding);
  if (grid.length < 48) return runs;

  // Deribit only. Paradex publishes no historical implied vol, so a "Paradex"
  // backtest could only be Deribit's IV and funding wearing Paradex's fee
  // schedule. That hybrid previously topped the results table while describing
  // no market that ever existed.
  for (const venue of BACKTESTABLE_OPTIONS_VENUES) {
    const straddle = runOptionsBacktest(grid, {
      initialCapital: capital, coin: data.coin, venue,
      structure: "short_straddle", notionalLeverage: notionalMult,
      fees: OPTIONS_FEES[venue],
    });
    if (straddle.totalTrades > 0) {
      runs.push(optionsToRun(data.coin, "perp_vs_options", `short straddle @ ${venue}`, straddle));
    }

    // Wing width is swept: narrow wings cap more tail but cost more premium
    let bestFly: { r: OptionsBacktestResult; w: number } | null = null;
    for (const w of [0.75, 1.0, 1.25, 1.5, 2.0]) {
      const r = runOptionsBacktest(grid, {
        initialCapital: capital, coin: data.coin, venue,
        structure: "iron_fly", wingWidth: w, notionalLeverage: notionalMult,
        fees: OPTIONS_FEES[venue],
      });
      if (r.totalTrades === 0) continue;
      if (!bestFly || r.annualizedReturn > bestFly.r.annualizedReturn) bestFly = { r, w };
    }
    if (bestFly) {
      runs.push(optionsToRun(data.coin, "options_vs_options", `iron fly @ ${venue}`, bestFly.r,
        `${bestFly.w}σ wings · ${smileProvenance(data.coin)}`));
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

// ── Cross-period summary ──

const STRATEGY_NAMES: Record<string, string> = {
  perp_vs_perp: "Perp vs Perp",
  spot_vs_perp: "Perp vs Spot",
  perp_vs_options: "Perp vs Options",
  options_vs_options: "Options vs Options",
};
const STRATEGY_ORDER: StrategyRun["strategy"][] = [
  "perp_vs_perp", "spot_vs_perp", "perp_vs_options", "options_vs_options",
];

interface PeriodResult { days: number; runs: StrategyRun[] }

/** Best run for a coin+strategy in a period, or null if it had no data. */
function bestOf(runs: StrategyRun[], coin: string, strategy: string): StrategyRun | null {
  const pool = runs.filter((r) => r.coin === coin && r.strategy === strategy);
  if (!pool.length) return null;
  return pool.reduce((a, b) => (b.apy > a.apy ? b : a));
}

function printMatrix(results: PeriodResult[], coins: string[], capital: number) {
  console.log(`\n${C.bold}${"═".repeat(100)}${C.reset}`);
  console.log(`${C.bold}SUMMARY — best APY per strategy, by lookback window${C.reset}`);
  console.log(`${C.bold}${"═".repeat(100)}${C.reset}`);

  const head = results.map((r) => `${r.days}d`.padStart(11)).join("");
  console.log(`  ${"Coin".padEnd(6)}${"Strategy".padEnd(21)}${head}   ${"MaxDD (1y)".padStart(11)}`);

  for (const coin of coins) {
    let printedAny = false;
    for (const strategy of STRATEGY_ORDER) {
      const cells = results.map((pr) => bestOf(pr.runs, coin, strategy));
      if (cells.every((c) => c === null)) continue;
      printedAny = true;

      const row = cells
        .map((c) => (c ? colorNum(c.apy, pct(c.apy).padStart(11)) : `${C.dim}${"n/a".padStart(11)}${C.reset}`))
        .join("");
      const longest = cells[cells.length - 1];
      const dd = longest ? pct(longest.maxDdPct).padStart(11) : "".padStart(11);

      console.log(`  ${coin.padEnd(6)}${STRATEGY_NAMES[strategy].padEnd(21)}${row}   ${dd}`);
    }
    if (printedAny) console.log("");
  }

  // Monthly view — what the user actually asked about
  console.log(`${C.bold}Same numbers as monthly compounded return on $${capital.toLocaleString("en-US")}:${C.reset}`);
  console.log(`  ${"Coin".padEnd(6)}${"Strategy".padEnd(21)}${results.map((r) => `${r.days}d`.padStart(11)).join("")}`);
  for (const coin of coins) {
    for (const strategy of STRATEGY_ORDER) {
      const cells = results.map((pr) => bestOf(pr.runs, coin, strategy));
      if (cells.every((c) => c === null)) continue;
      const row = cells
        .map((c) => {
          if (!c) return `${C.dim}${"n/a".padStart(11)}${C.reset}`;
          const monthly = Math.pow(1 + c.apy, 1 / 12) - 1;
          return colorNum(monthly, `${(monthly * 100).toFixed(2)}%`.padStart(11));
        })
        .join("");
      console.log(`  ${coin.padEnd(6)}${STRATEGY_NAMES[strategy].padEnd(21)}${row}`);
    }
  }
}

/**
 * Minimum tradable notional per venue, in USD, from the venues' own contract
 * specs. Deribit options are the binding constraint for a small account: the
 * minimum order is 0.1 BTC or 1 ETH, so a few hundred dollars of capital cannot
 * open the position at all regardless of what the backtest says it returns.
 */
const MIN_NOTIONAL_USD: Record<string, number> = {
  "deribit-option-BTC": 6400,   // 0.1 BTC min_trade_amount
  "deribit-option-ETH": 1900,   // 1 ETH min_trade_amount
  "paradex-option": 20,
  "deribit-perp": 10,
  "paradex-perp": 10,
  perp: 10,
  spot: 10,
};

/** Smallest notional a strategy needs, given the coin and venue in its label. */
function minNotionalFor(strategy: string, coin: string, label: string): number {
  const isOptions = strategy === "perp_vs_options" || strategy === "options_vs_options";
  if (!isOptions) return MIN_NOTIONAL_USD.perp;
  if (label.includes("paradex")) return MIN_NOTIONAL_USD["paradex-option"];
  return MIN_NOTIONAL_USD[`deribit-option-${coin}`] ?? MIN_NOTIONAL_USD["deribit-option-ETH"];
}

function printExecutability(runs: StrategyRun[], capital: number, notionalMult: number) {
  const notional = capital * notionalMult;
  console.log(`\n${C.bold}EXECUTABILITY at $${capital.toLocaleString("en-US")} capital (${notionalMult}x = $${notional.toLocaleString("en-US")} notional)${C.reset}`);
  console.log(`  ${"Coin".padEnd(6)}${"Strategy".padEnd(21)}${"Venue".padEnd(28)}${"Min notional".padStart(13)}   Status`);

  const seen = new Set<string>();
  for (const strategy of STRATEGY_ORDER) {
    for (const r of runs.filter((x) => x.strategy === strategy).sort((a, b) => b.apy - a.apy)) {
      const k = `${r.coin}:${r.strategy}:${r.label}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const min = minNotionalFor(r.strategy, r.coin, r.label);
      const ok = notional >= min;
      console.log(
        `  ${r.coin.padEnd(6)}${STRATEGY_NAMES[r.strategy].padEnd(21)}${r.label.slice(0, 27).padEnd(28)}` +
        `${("$" + min.toLocaleString("en-US")).padStart(13)}   ` +
        (ok ? `${C.green}tradeable${C.reset}` : `${C.red}below venue minimum — cannot open${C.reset}`)
      );
    }
  }
}

/** How much notional leverage a strategy would need to hit a monthly target. */
function printTargetAnalysis(results: PeriodResult[], coins: string[], capital: number, notionalMult: number) {
  const TARGET_MONTHLY = 0.10;
  const targetApy = Math.pow(1 + TARGET_MONTHLY, 12) - 1;

  console.log(`\n${C.bold}${"═".repeat(100)}${C.reset}`);
  console.log(`${C.bold}TARGET CHECK — 10% per month (= ${pct(targetApy)} APY compounded)${C.reset}`);
  console.log(`${C.bold}${"═".repeat(100)}${C.reset}`);

  const longest = results[results.length - 1];
  console.log(`  ${"Coin".padEnd(6)}${"Strategy".padEnd(21)}${"APY @" + notionalMult + "x".padStart(10)}` +
    `${"Needed x".padStart(10)}${"Implied MaxDD".padStart(15)}   Verdict`);

  const rows: Array<{ label: string; needed: number; impliedDd: number }> = [];

  for (const coin of coins) {
    for (const strategy of STRATEGY_ORDER) {
      const best = bestOf(longest.runs, coin, strategy);
      if (!best) continue;

      // Returns scale roughly linearly in notional; so does drawdown.
      const needed = best.apy > 0 ? (targetApy / best.apy) * notionalMult : Infinity;
      const impliedDd = best.maxDdPct * (needed / notionalMult);

      let verdict: string;
      if (!isFinite(needed)) verdict = `${C.red}loses money — no leverage fixes it${C.reset}`;
      else if (impliedDd >= 1) verdict = `${C.red}account wiped by the drawdown${C.reset}`;
      else if (needed > 10) verdict = `${C.red}beyond any venue's margin limits${C.reset}`;
      else verdict = `${C.yellow}possible but ${pct(impliedDd)} drawdown${C.reset}`;

      console.log(`  ${coin.padEnd(6)}${STRATEGY_NAMES[strategy].padEnd(21)}` +
        `${pct(best.apy).padStart(10)}${(isFinite(needed) ? needed.toFixed(1) + "x" : "—").padStart(10)}` +
        `${(isFinite(impliedDd) ? pct(impliedDd) : "—").padStart(15)}   ${verdict}`);

      if (isFinite(needed)) rows.push({ label: `${coin} ${STRATEGY_NAMES[strategy]}`, needed, impliedDd });
    }
  }

  const feasible = rows.filter((r) => r.needed <= 10 && r.impliedDd < 1).sort((a, b) => a.needed - b.needed);
  console.log(`\n  ${C.bold}Closest any strategy gets:${C.reset}`);
  if (!feasible.length) {
    console.log(`  ${C.red}None. No delta-neutral structure here reaches 10%/month within survivable leverage.${C.reset}`);
  } else {
    for (const f of feasible.slice(0, 3)) {
      console.log(`    ${f.label} — ${f.needed.toFixed(1)}x notional, ${pct(f.impliedDd)} expected max drawdown`);
    }
  }
}

// ── Main ──
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxDays = Math.max(...args.periods);
  const sortedPeriods = [...args.periods].sort((a, b) => a - b);

  console.log(`\n${C.bold}Perp vs Perp • Perp vs Spot • Perp vs Options • Options vs Options${C.reset}`);
  console.log(`${C.dim}Windows: ${sortedPeriods.map((d) => d + "d").join(", ")} · $${args.capital.toLocaleString("en-US")} capital · notional = ${args.notional}x capital on every strategy${C.reset}`);
  console.log(`${C.dim}Perp venues: ${PERP_VENUES.map((v) => v.id).join(", ")} · spot: ${SPOT_VENUE.id} · options: ${BACKTESTABLE_OPTIONS_VENUES.join(", ") + " (Paradex: live scan only, no vol history)"}${C.reset}`);
  console.log(`${C.dim}Excluded from historical runs:${C.reset}`);
  for (const e of EXCLUDED_FROM_HISTORY) {
    console.log(`${C.dim}  · ${e.id} — ${e.reason}${C.reset}`);
  }

  // Fetch once at the longest window; each window validates its own slice
  const loaded = new Map<string, CoinFetch>();
  for (const coin of args.coins) {
    console.log(`\n${C.yellow}Fetching ${coin} (${maxDays}d)...${C.reset}`);
    loaded.set(coin, await loadCoinData(coin, maxDays, args.useCache));
  }

  const results: PeriodResult[] = [];
  const optionsDetail: Array<{ coin: string; days: number; result: OptionsBacktestResult }> = [];

  for (const days of sortedPeriods) {
    const runs: StrategyRun[] = [];
    console.log(`\n${C.bold}${C.cyan}${"━".repeat(100)}${C.reset}`);
    console.log(`${C.bold}${C.cyan}  ${days}-DAY WINDOW${C.reset}`);
    console.log(`${C.bold}${C.cyan}${"━".repeat(100)}${C.reset}`);

    for (const [coin, full] of loaded) {
      const data = sliceCoinData(full, days);

      console.log(`\n${C.bold}${C.cyan}══ ${coin} · ${days}d ══${C.reset}`);
      for (const r of data.reports.filter((x) => !x.ok)) {
        const why = r.issues.filter((i) => i.severity === "fatal").map((i) => i.message).join("; ");
        console.log(`${C.red}  rejected ${r.label}${C.reset} ${C.dim}— ${why}${C.reset}`);
      }
      const covered = [...data.funding.entries()]
        .map(([v, r]) => `${v} ${(annualizedFunding(r) * 100).toFixed(1)}%`)
        .join(", ");
      console.log(`${C.dim}  accepted funding: ${covered || "none"}${C.reset}`);
      console.log(`${C.dim}  accepted prices: ${[...data.prices.keys()].join(", ") || "none"}${data.spotPrices.length ? ", spot" : ""} · DVOL: ${data.dvol.length || "none"}${C.reset}`);

      if (data.funding.size === 0) {
        console.log(`${C.red}  no validated funding data — nothing to run${C.reset}`);
        continue;
      }

      const skipped: string[] = [];
      const pvp = runPerpVsPerp(data, args.capital, args.notional, skipped).sort((a, b) => b.apy - a.apy);
      const svp = runSpotVsPerp(data, args.capital, args.notional, skipped).sort((a, b) => b.apy - a.apy);
      const opt = runOptionsStrategies(data, args.capital, args.notional).sort((a, b) => b.apy - a.apy);

      printRunTable(`Perp vs Perp (funding differential)`, pvp, 3);
      printRunTable(`Perp vs Spot (cash and carry)`, svp, 3);
      if (skipped.length) {
        console.log(`\n${C.dim}  skipped for missing observed data:${C.reset}`);
        for (const sk of [...new Set(skipped)]) console.log(`${C.dim}    · ${sk}${C.reset}`);
      }

      if (opt.length) {
        printRunTable(`Options structures (delta-hedged short vol)`, opt, 4);
      } else {
        console.log(`\n${C.bold}Options structures${C.reset}\n  ${C.dim}no options market for ${coin} on Deribit or Paradex${C.reset}`);
      }

      // P&L decomposition on the longest window only, to keep output readable
      if (days === maxDays) {
        const funding = data.funding.get("deribit");
        const prices = data.prices.get("deribit");
        if (funding?.length && prices?.length && data.dvol.length) {
          const grid = buildHourlyGrid(prices, data.dvol, funding);
          const detail = runOptionsBacktest(grid, {
            initialCapital: args.capital, coin, venue: "deribit",
            structure: "short_straddle", notionalLeverage: args.notional,
          });
          if (detail.totalTrades > 0) {
            printOptionsDetail(coin, detail);
            optionsDetail.push({ coin, days, result: detail });
          }
        }
      }

      runs.push(...pvp, ...svp, ...opt);
    }
    results.push({ days, runs });
  }

  const allRuns = results.flatMap((r) => r.runs);
  if (!allRuns.length) {
    console.log(`\n${C.red}No strategies produced results.${C.reset}`);
    return;
  }

  const coins = [...loaded.keys()];
  printMatrix(results, coins, args.capital);
  printVerdict(results[results.length - 1].runs, args.capital);
  printExecutability(results[results.length - 1].runs, args.capital, args.notional);
  printTargetAnalysis(results, coins, args.capital, args.notional);

  console.log(`\n${C.dim}Notes:`);
  console.log(`  · Funding streams are resampled to a common hourly grid, so 8h and hourly venues compare.`);
  console.log(`  · Options use Deribit DVOL as the ATM implied leg and real hourly funding on the hedge.`);
  console.log(`  · Iron fly wing vols come from a fixed smile fitted to a live Deribit chain; its`);
  console.log(`    absolute numbers are smile-dependent, the short straddle's are not.`);
  console.log(`  · SOL has no options on Deribit or Paradex, so only the perp strategies run for it.`);
  console.log(`  · Every series is validated before use (bun run verify-data). Nothing is`);
  console.log(`    substituted when data is missing — the pair is skipped and listed above.${C.reset}`);

  if (args.json) {
    const out = join(CACHE_DIR, "compare-results.json");
    writeFileSync(out, JSON.stringify({ args, results, optionsDetail }, null, 2));
    console.log(`\n${C.dim}Wrote ${out}${C.reset}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
