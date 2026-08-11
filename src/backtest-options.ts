/**
 * Options backtest engine — perp_vs_options and options_vs_options
 *
 * Both strategies are delta-neutral short-volatility structures built from the
 * same leg machinery:
 *
 *   short_straddle (perp_vs_options)
 *     Sell an ATM call + ATM put, delta-hedge with the perp. Harvests the full
 *     variance risk premium with uncapped tails.
 *
 *   iron_fly (options_vs_options)
 *     Sell the ATM straddle and buy an OTM strangle against it. The long wings
 *     cap the tail at the cost of part of the premium — an options-vs-options
 *     structure whose P&L is the spread between ATM and wing volatility.
 *
 * P&L is accumulated hourly, per leg, at that leg's own implied vol:
 *   1. Theta/gamma:  qty · 0.5 · Γ · S² · (r² − σ_leg² · dt)
 *   2. Vega:         qty · Vega · Δσ_leg
 *   3. Funding:      −hedgeNotional · fundingRate   (the perp delta hedge)
 *   4. Costs:        per-leg option fees, perp hedge fees, IV and perp spreads
 *
 * Data (all real, all publicly retrievable for a full year):
 *   - σ_atm  : Deribit DVOL, the VIX-style 30-day implied vol index. DVOL² is
 *              the fair strike of a 30-day variance swap.
 *   - r      : hourly log returns of the perp mark.
 *   - funding: hourly perp funding.
 *
 * Assumption to be aware of: DVOL gives the ATM level only. Wing vols come from
 * a smile fitted to a live Deribit chain by `bun run fit-smile` and held constant
 * in shape while its level scales with DVOL. No smile is hardcoded — without a
 * fitted one, iron_fly refuses to run. That dependency is only material for
 * iron_fly, whose edge *is* the ATM-to-wing spread, and every iron_fly result
 * carries the smile's observation date. short_straddle prices at ATM vol alone
 * and does not depend on it at all.
 */

import type { FundingRateEntry } from "./exchanges/types";
import type { DvolEntry } from "./exchanges/deribit";
import { readFileSync } from "fs";
import { join } from "path";
import { blackScholes, YEAR_MS } from "./options";

export type OptionStructure = "short_straddle" | "iron_fly";

/**
 * Volatility smile as a ratio to ATM vol, quadratic in standardized moneyness
 * m = ln(K/F) / (σ_atm · √T):
 *
 *     σ(m) / σ_atm = 1 + skew · m + curvature · m²
 *
 * Fitted to live Deribit 30-day chains: both coins show the usual put skew
 * (downside vol rich) with an upside smile. Refit with `bun run fit-smile`.
 */
export interface SmileParams {
  skew: number;
  curvature: number;
}

/**
 * Smiles are loaded from data/smile.json, produced by `bun run fit-smile` from a
 * live Deribit chain. There are deliberately no hardcoded defaults: if no smile
 * has been fitted, iron_fly cannot be priced and the caller is told so, rather
 * than silently pricing wings off invented numbers.
 */
export interface LoadedSmile extends SmileParams {
  observedAt: number;
  rmse: number;
  points: number;
  source: string;
}

let smileCache: Record<string, LoadedSmile> | null = null;

function loadSmiles(): Record<string, LoadedSmile> {
  if (smileCache) return smileCache;
  try {
    const path = join(import.meta.dir, "..", "data", "smile.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    smileCache = file.coins ?? {};
  } catch {
    smileCache = {};
  }
  return smileCache!;
}

/** Fitted smile for a coin, or null if none has been observed. */
export function getSmile(coin: string): LoadedSmile | null {
  return loadSmiles()[coin] ?? null;
}

/** Human-readable provenance for a smile, to attach to any result using it. */
export function smileProvenance(coin: string): string {
  const s = getSmile(coin);
  if (!s) return "no fitted smile";
  const date = new Date(s.observedAt).toISOString().slice(0, 10);
  return `smile fitted ${date} from ${s.points} live Deribit strikes (rmse ${s.rmse.toFixed(3)})`;
}

/** Vol multiplier vs ATM at standardized moneyness m. Floored to stay positive. */
export function smileRatio(m: number, p: SmileParams): number {
  return Math.max(1 + p.skew * m + p.curvature * m * m, 0.25);
}

export interface OptionsFeeModel {
  /** Option trading fee as bps of *underlying* notional (Deribit: 3bps per leg). */
  optionFeeBps: number;
  /** Fee cap as a fraction of the option premium (Deribit: 12.5%). */
  optionFeeCapPctPremium: number;
  /** Half-spread paid on option entry/exit, in vol points (e.g. 1.5 = 1.5 vol pts). */
  ivHalfSpreadVolPts: number;
  /** Perp hedge taker fee in bps. */
  perpFeeBps: number;
  /** Perp half-spread in bps. */
  perpHalfSpreadBps: number;
}

export const OPTIONS_FEES: Record<string, OptionsFeeModel> = {
  // Deribit: options 0.03% of underlying capped at 12.5% of premium; perp taker 0.05%
  deribit: { optionFeeBps: 3.0, optionFeeCapPctPremium: 0.125, ivHalfSpreadVolPts: 1.0, perpFeeBps: 5.0, perpHalfSpreadBps: 0.5 },
  // Paradex: options 1bp, capped 12.5%; perp taker ~3bps. Wider IV spread
  // reflects thinner books than Deribit.
  paradex: { optionFeeBps: 1.0, optionFeeCapPctPremium: 0.125, ivHalfSpreadVolPts: 2.5, perpFeeBps: 3.0, perpHalfSpreadBps: 1.5 },
};

export interface OptionsBacktestConfig {
  initialCapital: number;
  coin: string;
  venue: string;
  structure: OptionStructure;
  /** Straddle tenor at inception, in days. 30 matches the DVOL index tenor. */
  tenorDays: number;
  /** Roll the position once it has this many days left. */
  rollAtDaysRemaining: number;
  /** ATM straddle notional as a multiple of capital. */
  notionalLeverage: number;
  /** Wing distance for iron_fly, in standardized moneyness (1.0 ≈ a 1σ move). */
  wingWidth: number;
  /** Rehedge when |portfolio delta| exceeds this fraction of straddle notional. */
  deltaBand: number;
  /** Close the position if unrealised loss exceeds this fraction of capital. */
  stopLossPct: number;
  /** Null when no smile has been fitted; iron_fly then refuses to run. */
  smile: SmileParams | null;
  fees: OptionsFeeModel;
}

export interface OptionsTrade {
  entryTime: number;
  exitTime: number;
  strike: number;
  expiry: number;
  entryIv: number;
  exitIv: number;
  realizedVol: number;
  straddleNotional: number;
  contracts: number;
  thetaGammaPnl: number;
  vegaPnl: number;
  fundingPnl: number;
  feesPaid: number;
  rehedgeCount: number;
  pnl: number;
  stoppedOut: boolean;
}

export interface OptionsBacktestResult {
  trades: OptionsTrade[];
  totalPnl: number;
  totalFees: number;
  /** Sum of the implied-variance (theta) minus realized-variance (gamma) term. */
  totalThetaGammaPnl: number;
  totalVegaPnl: number;
  /** Funding earned/paid on the perp delta hedge. */
  totalFundingPnl: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  annualizedReturn: number;
  avgImpliedVol: number;
  avgRealizedVol: number;
  /** Average variance risk premium in vol points (implied − realized). */
  avgVrpVolPts: number;
  totalRehedges: number;
  stopOuts: number;
  pnlHistory: number[];
  timestamps: number[];
  /** Fraction of hours the perp hedge was net long. */
  hedgeLongFraction: number;
  /** Worst single-trade loss, as a fraction of capital — the tail the wings cap. */
  worstTradePct: number;
}

export function defaultOptionsConfig(partial: Partial<OptionsBacktestConfig> = {}): OptionsBacktestConfig {
  const venue = partial.venue ?? "deribit";
  const coin = partial.coin ?? "BTC";
  return {
    initialCapital: partial.initialCapital ?? 50000,
    coin,
    venue,
    structure: partial.structure ?? "short_straddle",
    tenorDays: partial.tenorDays ?? 30,
    rollAtDaysRemaining: partial.rollAtDaysRemaining ?? 15,
    notionalLeverage: partial.notionalLeverage ?? 2.0,
    wingWidth: partial.wingWidth ?? 1.0,
    deltaBand: partial.deltaBand ?? 0.05,
    stopLossPct: partial.stopLossPct ?? 0.5,
    smile: partial.smile ?? getSmile(coin),
    fees: partial.fees ?? OPTIONS_FEES[venue] ?? OPTIONS_FEES.deribit,
  };
}

interface HourlyRow {
  timestamp: number;
  price: number;
  iv: number;          // annualized decimal, ATM
  fundingRate: number; // per hour
}

/**
 * Joins price / DVOL / funding onto a single hourly grid. Only hours present in
 * all three series are kept, so every P&L term is driven by real observations.
 */
export function buildHourlyGrid(
  prices: Array<{ timestamp: number; price: number }>,
  dvol: DvolEntry[],
  funding: FundingRateEntry[]
): HourlyRow[] {
  const hourKey = (ts: number) => Math.floor(ts / 3600000) * 3600000;

  const ivMap = new Map<number, number>();
  for (const d of dvol) ivMap.set(hourKey(d.timestamp), d.close / 100);

  const fundMap = new Map<number, number>();
  for (const f of funding) fundMap.set(hourKey(f.timestamp), f.fundingRate);

  const rows: HourlyRow[] = [];
  for (const p of prices) {
    const k = hourKey(p.timestamp);
    const iv = ivMap.get(k);
    const fr = fundMap.get(k);
    if (iv === undefined || fr === undefined) continue;
    if (!(p.price > 0) || !(iv > 0)) continue;
    rows.push({ timestamp: k, price: p.price, iv, fundingRate: fr });
  }

  rows.sort((a, b) => a.timestamp - b.timestamp);
  return rows.filter((r, i) => i === 0 || r.timestamp !== rows[i - 1].timestamp);
}

/** One option leg. qty is signed: positive long, negative short, in contracts. */
interface Leg {
  type: "C" | "P";
  strike: number;
  qty: number;
  /** Standardized moneyness fixed at entry; sets this leg's vol via the smile. */
  m: number;
}

/** Live state of the option structure plus its perp delta hedge. */
interface OpenPosition {
  entryTime: number;
  strike: number;          // ATM strike, for reporting
  expiry: number;
  entryIv: number;
  contracts: number;
  straddleNotional: number;
  legs: Leg[];
  hedgeUnits: number;      // signed perp position in coins (+ = long)
  thetaGamma: number;
  vega: number;
  funding: number;
  fees: number;
  rehedges: number;
  entryPriceIdx: number;
}

export function runOptionsBacktest(
  rows: HourlyRow[],
  config: Partial<OptionsBacktestConfig> = {}
): OptionsBacktestResult {
  const cfg = defaultOptionsConfig(config);
  if (rows.length < 48) return emptyResult();

  // The short straddle is priced entirely at ATM vol, so it needs no smile.
  // iron_fly prices wings and cannot be run without an observed one.
  if (cfg.structure === "iron_fly" && !cfg.smile) return emptyResult();

  const dt = 1 / (365 * 24); // one hour in years
  const trades: OptionsTrade[] = [];
  const pnlHistory: number[] = [];
  const timestamps: number[] = [];

  let realizedPnl = 0;
  let totalFees = 0;
  let totalRehedges = 0;
  let stopOuts = 0;
  let hedgeLongHours = 0;
  let hedgedHours = 0;

  let open: OpenPosition | null = null;
  const fees = cfg.fees;

  const legIv = (atmIv: number, m: number) =>
    m === 0 || !cfg.smile ? atmIv : Math.max(atmIv * smileRatio(m, cfg.smile), 0.01);

  /** Deribit-style option fee: bps of underlying, capped at a % of premium. */
  const optionLegFee = (underlyingNotional: number, premium: number) =>
    Math.min((underlyingNotional * fees.optionFeeBps) / 10000, Math.abs(premium) * fees.optionFeeCapPctPremium);

  /** Total entry/exit cost of trading the whole structure once. */
  const structureFee = (legs: Leg[], S: number, T: number, atmIv: number) => {
    let total = 0;
    for (const leg of legs) {
      const iv = legIv(atmIv, leg.m);
      const g = blackScholes(S, leg.strike, T, iv, leg.type);
      total += optionLegFee(Math.abs(leg.qty) * S, g.price * Math.abs(leg.qty));
    }
    return total;
  };

  const buildLegs = (S: number, T: number, atmIv: number, n: number): Leg[] => {
    const legs: Leg[] = [
      { type: "C", strike: S, qty: -n, m: 0 },
      { type: "P", strike: S, qty: -n, m: 0 },
    ];
    if (cfg.structure === "iron_fly") {
      // Wings placed at ±wingWidth standard deviations of the move to expiry
      const sd = atmIv * Math.sqrt(T);
      const w = cfg.wingWidth;
      legs.push({ type: "C", strike: S * Math.exp(w * sd), qty: n, m: w });
      legs.push({ type: "P", strike: S * Math.exp(-w * sd), qty: n, m: -w });
    }
    return legs;
  };

  const openPosition = (i: number) => {
    const row = rows[i];
    const S = row.price;
    const straddleNotional = cfg.initialCapital * cfg.notionalLeverage;
    const contracts = straddleNotional / S;
    const expiry = row.timestamp + cfg.tenorDays * 86400000;
    const T = cfg.tenorDays / 365;

    // We sell the ATM straddle at the bid and buy any wings at the offer
    const entryIv = Math.max(row.iv - fees.ivHalfSpreadVolPts / 100, 0.01);
    const legs = buildLegs(S, T, entryIv, contracts);

    const entryFee = structureFee(legs, S, T, entryIv);

    // Delta-neutralise: perp position offsets the option delta
    let optDelta = 0;
    for (const leg of legs) {
      optDelta += leg.qty * blackScholes(S, leg.strike, T, legIv(entryIv, leg.m), leg.type).delta;
    }
    const hedgeUnits = -optDelta;
    const hedgeFee = (Math.abs(hedgeUnits) * S * (fees.perpFeeBps + fees.perpHalfSpreadBps)) / 10000;

    totalFees += entryFee + hedgeFee;

    open = {
      entryTime: row.timestamp,
      strike: S,
      expiry,
      entryIv,
      contracts,
      straddleNotional,
      legs,
      hedgeUnits,
      thetaGamma: 0,
      vega: 0,
      funding: 0,
      fees: entryFee + hedgeFee,
      rehedges: 0,
      entryPriceIdx: i,
    };
  };

  const closePosition = (i: number, stopped: boolean) => {
    if (!open) return;
    const row = rows[i];
    const S = row.price;
    const T = Math.max((open.expiry - row.timestamp) / YEAR_MS, 0);

    // Buying the structure back: pay the offer on the shorts
    const exitIv = row.iv + fees.ivHalfSpreadVolPts / 100;
    const exitFee = structureFee(open.legs, S, T, exitIv);
    const hedgeExitFee = (Math.abs(open.hedgeUnits) * S * (fees.perpFeeBps + fees.perpHalfSpreadBps)) / 10000;

    open.fees += exitFee + hedgeExitFee;
    totalFees += exitFee + hedgeExitFee;

    // Realized vol over the life of the trade, for reporting
    const window = rows.slice(open.entryPriceIdx, i + 1);
    let sumSq = 0;
    for (let k = 1; k < window.length; k++) {
      const lr = Math.log(window[k].price / window[k - 1].price);
      sumSq += lr * lr;
    }
    const rv = window.length > 1 ? Math.sqrt((sumSq / (window.length - 1)) * 365 * 24) : 0;

    const pnl = open.thetaGamma + open.vega + open.funding - open.fees;
    realizedPnl += pnl;
    if (stopped) stopOuts++;

    trades.push({
      entryTime: open.entryTime,
      exitTime: row.timestamp,
      strike: open.strike,
      expiry: open.expiry,
      entryIv: open.entryIv,
      exitIv,
      realizedVol: rv,
      straddleNotional: open.straddleNotional,
      contracts: open.contracts,
      thetaGammaPnl: open.thetaGamma,
      vegaPnl: open.vega,
      fundingPnl: open.funding,
      feesPaid: open.fees,
      rehedgeCount: open.rehedges,
      pnl,
      stoppedOut: stopped,
    });

    totalRehedges += open.rehedges;
    open = null;
  };

  let ivSum = 0;
  let rvSumSq = 0;
  let rvCount = 0;

  const hasRunway = (ts: number) =>
    rows[rows.length - 1].timestamp - ts > cfg.tenorDays * 86400000 * 0.25;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const row = rows[i];

    ivSum += row.iv;
    const logRet = Math.log(row.price / prev.price);
    rvSumSq += logRet * logRet;
    rvCount++;

    if (!open) {
      if (hasRunway(row.timestamp)) openPosition(i);
      pnlHistory.push(realizedPnl);
      timestamps.push(row.timestamp);
      continue;
    }

    // Alias so narrowing holds across the closure calls below
    const pos: OpenPosition = open;

    const S = row.price;
    const T = Math.max((pos.expiry - row.timestamp) / YEAR_MS, 1 / 365 / 24);

    let optDelta = 0;
    for (const leg of pos.legs) {
      const ivNow = legIv(row.iv, leg.m);
      const ivPrev = legIv(prev.iv, leg.m);
      const g = blackScholes(S, leg.strike, T, ivNow, leg.type);

      optDelta += leg.qty * g.delta;

      // 1. Theta/gamma — long gamma pays for realized variance, short collects implied
      pos.thetaGamma += leg.qty * 0.5 * g.gamma * S * S * (logRet * logRet - ivNow * ivNow * dt);

      // 2. Vega — long vega gains when implied vol rises
      pos.vega += leg.qty * g.vega * (ivNow - ivPrev);
    }

    // 3. Funding on the perp delta hedge. Long perp pays when funding is positive.
    pos.funding += -(pos.hedgeUnits * S) * row.fundingRate;

    if (pos.hedgeUnits !== 0) {
      hedgedHours++;
      if (pos.hedgeUnits > 0) hedgeLongHours++;
    }

    // 4. Rehedge when the portfolio delta drifts outside the band
    const targetHedge = -optDelta;
    const driftNotional = Math.abs(targetHedge - pos.hedgeUnits) * S;
    if (driftNotional > cfg.deltaBand * pos.straddleNotional) {
      const cost = (driftNotional * (fees.perpFeeBps + fees.perpHalfSpreadBps)) / 10000;
      pos.fees += cost;
      totalFees += cost;
      pos.hedgeUnits = targetHedge;
      pos.rehedges++;
    }

    const unrealized = pos.thetaGamma + pos.vega + pos.funding - pos.fees;
    pnlHistory.push(realizedPnl + unrealized);
    timestamps.push(row.timestamp);

    if (unrealized < -cfg.stopLossPct * cfg.initialCapital) {
      closePosition(i, true);
      continue;
    }

    const daysRemaining = (pos.expiry - row.timestamp) / 86400000;
    if (daysRemaining <= cfg.rollAtDaysRemaining) {
      closePosition(i, false);
      if (hasRunway(row.timestamp)) openPosition(i);
    }
  }

  if (open) closePosition(rows.length - 1, false);
  if (pnlHistory.length) pnlHistory[pnlHistory.length - 1] = realizedPnl;

  // ── Metrics ──
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const p of pnlHistory) {
    if (p > peak) peak = p;
    const dd = peak - p;
    if (dd > maxDrawdown) maxDrawdown = dd;
    const ddPct = dd / cfg.initialCapital;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  const returns: number[] = [];
  for (let i = 1; i < pnlHistory.length; i++) {
    returns.push((pnlHistory[i] - pnlHistory[i - 1]) / cfg.initialCapital);
  }
  const avgRet = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const std =
    Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (returns.length || 1)) || 1e-12;

  // Annualize using actual elapsed time, not the sample count
  const elapsedDays = (rows[rows.length - 1].timestamp - rows[0].timestamp) / 86400000;
  const periodsPerYear = returns.length > 0 ? (returns.length * 365) / Math.max(elapsedDays, 1e-9) : 0;
  const sharpeRatio = (avgRet / std) * Math.sqrt(periodsPerYear);

  const totalPnl = realizedPnl;
  const annualizedReturn =
    elapsedDays > 0 ? Math.pow(1 + totalPnl / cfg.initialCapital, 365 / elapsedDays) - 1 : 0;

  const avgImpliedVol = ivSum / (rvCount || 1);
  const avgRealizedVol = Math.sqrt((rvSumSq / (rvCount || 1)) * 365 * 24);
  const worstTrade = trades.reduce((w, t) => Math.min(w, t.pnl), 0);

  return {
    trades,
    totalPnl,
    totalFees,
    totalThetaGammaPnl: trades.reduce((s, t) => s + t.thetaGammaPnl, 0),
    totalVegaPnl: trades.reduce((s, t) => s + t.vegaPnl, 0),
    totalFundingPnl: trades.reduce((s, t) => s + t.fundingPnl, 0),
    winRate: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : 0,
    totalTrades: trades.length,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    annualizedReturn,
    avgImpliedVol,
    avgRealizedVol,
    avgVrpVolPts: (avgImpliedVol - avgRealizedVol) * 100,
    totalRehedges,
    stopOuts,
    pnlHistory,
    timestamps,
    hedgeLongFraction: hedgedHours ? hedgeLongHours / hedgedHours : 0,
    worstTradePct: worstTrade / cfg.initialCapital,
  };
}

function emptyResult(): OptionsBacktestResult {
  return {
    trades: [], totalPnl: 0, totalFees: 0, totalThetaGammaPnl: 0, totalVegaPnl: 0,
    totalFundingPnl: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    sharpeRatio: 0, annualizedReturn: 0, avgImpliedVol: 0, avgRealizedVol: 0,
    avgVrpVolPts: 0, totalRehedges: 0, stopOuts: 0, pnlHistory: [], timestamps: [],
    hedgeLongFraction: 0, worstTradePct: 0,
  };
}
