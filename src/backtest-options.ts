/**
 * Perp vs Options backtest engine
 *
 * Strategy: sell an ATM straddle on the options venue (Deribit / Paradex) and
 * delta-hedge it with the perp on the same venue. This is the options analogue
 * of a funding carry trade — instead of harvesting the perp/spot funding spread,
 * it harvests the variance risk premium (implied vol sold above realized vol),
 * while the perp hedge leg still accrues real funding.
 *
 * P&L is decomposed hourly into four terms:
 *   1. Theta/gamma:  0.5 · Γ$ · (σ_impl² · dt − r²)   — short vol earns the
 *                    implied variance and pays the realized variance.
 *   2. Vega:         −Vega$ · Δσ_impl                 — mark-to-market on IV moves.
 *   3. Funding:      −hedgeNotional · fundingRate     — the perp leg's carry.
 *   4. Costs:        option fees, perp hedge fees, IV bid-ask, perp spread.
 *
 * Data sources (all real, all publicly retrievable for a full year):
 *   - σ_impl : Deribit DVOL, the VIX-style 30-day implied vol index. DVOL² is the
 *              fair strike of a 30-day variance swap, which is exactly the implied
 *              leg being sold here.
 *   - r      : hourly log returns of the perp mark.
 *   - funding: hourly perp funding.
 *
 * Known simplification: DVOL is a constant-maturity 30-day index, while the
 * straddle held has a decaying tenor. The position is therefore rolled at
 * `rollAtDaysRemaining` so its tenor stays in a band where DVOL is a good proxy,
 * rather than being held into the last days where the short-dated smile diverges.
 */

import type { FundingRateEntry } from "./exchanges/types";
import type { DvolEntry } from "./exchanges/deribit";
import { straddleGreeks, YEAR_MS } from "./options";

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
  // Paradex: options 1bp of premium-based notional, capped 12.5%; perp taker ~3bps.
  // Wider IV spread reflects thinner books than Deribit.
  paradex: { optionFeeBps: 1.0, optionFeeCapPctPremium: 0.125, ivHalfSpreadVolPts: 2.5, perpFeeBps: 3.0, perpHalfSpreadBps: 1.5 },
};

export interface OptionsBacktestConfig {
  initialCapital: number;
  coin: string;
  venue: string;
  /** Straddle tenor at inception, in days. 30 matches the DVOL index tenor. */
  tenorDays: number;
  /** Roll the position once it has this many days left. */
  rollAtDaysRemaining: number;
  /** Straddle notional as a multiple of capital (margin utilisation). */
  notionalLeverage: number;
  /** Rehedge when |portfolio delta| exceeds this fraction of straddle notional. */
  deltaBand: number;
  /** Close the position if unrealised loss exceeds this fraction of capital. */
  stopLossPct: number;
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
  /** Funding earned/paid on the perp delta hedge — the "perp" side of perp vs options. */
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
  /** Fraction of hours the perp hedge was net long (pays funding when rates are positive). */
  hedgeLongFraction: number;
}

export function defaultOptionsConfig(partial: Partial<OptionsBacktestConfig> = {}): OptionsBacktestConfig {
  const venue = partial.venue ?? "deribit";
  return {
    initialCapital: partial.initialCapital ?? 50000,
    coin: partial.coin ?? "BTC",
    venue,
    tenorDays: partial.tenorDays ?? 30,
    rollAtDaysRemaining: partial.rollAtDaysRemaining ?? 15,
    notionalLeverage: partial.notionalLeverage ?? 2.0,
    deltaBand: partial.deltaBand ?? 0.05,
    stopLossPct: partial.stopLossPct ?? 0.5,
    fees: partial.fees ?? OPTIONS_FEES[venue] ?? OPTIONS_FEES.deribit,
  };
}

interface HourlyRow {
  timestamp: number;
  price: number;
  iv: number;          // annualized decimal
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
  // De-duplicate hours
  return rows.filter((r, i) => i === 0 || r.timestamp !== rows[i - 1].timestamp);
}

/** Live state of the short straddle plus its perp delta hedge. */
interface OpenPosition {
  entryTime: number;
  strike: number;
  expiry: number;
  entryIv: number;
  contracts: number;
  straddleNotional: number;
  hedgeUnits: number;       // signed perp position in coins (+ = long)
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
  const empty = emptyResult();
  if (rows.length < 48) return empty;

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

  // Open position state
  let open: OpenPosition | null = null;

  const fees = cfg.fees;

  /** Deribit-style option fee: bps of underlying, capped at a % of premium. */
  const optionLegFee = (underlyingNotional: number, premium: number) => {
    const raw = (underlyingNotional * fees.optionFeeBps) / 10000;
    return Math.min(raw, premium * fees.optionFeeCapPctPremium);
  };

  const openPosition = (i: number) => {
    const row = rows[i];
    const S = row.price;
    const straddleNotional = cfg.initialCapital * cfg.notionalLeverage;
    const contracts = straddleNotional / S;
    const K = S; // ATM
    const expiry = row.timestamp + cfg.tenorDays * 86400000;
    const T = cfg.tenorDays / 365;

    // Selling vol: we lift the bid, i.e. we sell at IV minus the half-spread
    const entryIv = Math.max(row.iv - fees.ivHalfSpreadVolPts / 100, 0.01);

    const g = straddleGreeks(S, K, T, entryIv);
    const premium = g.price * contracts;

    // Two legs (call + put), each charged on underlying notional and capped on its own premium
    const entryFee = 2 * optionLegFee(straddleNotional, premium / 2);

    // Initial delta hedge: short straddle delta is -(straddle delta), hedge is the negative of that
    const hedgeUnits = g.delta * contracts;
    const hedgeFee =
      (Math.abs(hedgeUnits) * S * (fees.perpFeeBps + fees.perpHalfSpreadBps)) / 10000;

    totalFees += entryFee + hedgeFee;

    open = {
      entryTime: row.timestamp,
      strike: K,
      expiry,
      entryIv,
      contracts,
      straddleNotional,
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

    // Buying back vol: we pay the offer, i.e. IV plus the half-spread
    const exitIv = row.iv + fees.ivHalfSpreadVolPts / 100;
    const g = straddleGreeks(S, open.strike, T, exitIv);
    const premium = Math.max(g.price * open.contracts, 0);

    const exitFee = 2 * optionLegFee(open.straddleNotional, premium / 2);
    const hedgeExitFee =
      (Math.abs(open.hedgeUnits) * S * (fees.perpFeeBps + fees.perpHalfSpreadBps)) / 10000;

    open.fees += exitFee + hedgeExitFee;
    totalFees += exitFee + hedgeExitFee;

    // Realized vol over the life of the trade, for reporting
    const window = rows.slice(open.entryPriceIdx, i + 1).map((r) => r.price);
    let sumSq = 0;
    for (let k = 1; k < window.length; k++) {
      const lr = Math.log(window[k] / window[k - 1]);
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

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const row = rows[i];

    ivSum += row.iv;
    const logRet = Math.log(row.price / prev.price);
    rvSumSq += logRet * logRet;
    rvCount++;

    if (!open) {
      // Need enough runway left in the data to hold a position
      if (rows[rows.length - 1].timestamp - row.timestamp > cfg.tenorDays * 86400000 * 0.25) {
        openPosition(i);
      }
      pnlHistory.push(realizedPnl);
      timestamps.push(row.timestamp);
      continue;
    }

    // Alias so narrowing holds across the closure calls below
    const pos: OpenPosition = open;

    const S = row.price;
    const T = Math.max((pos.expiry - row.timestamp) / YEAR_MS, 1 / 365 / 24);
    const g = straddleGreeks(S, pos.strike, T, row.iv);

    // 1. Theta/gamma: short vol collects implied variance, pays realized variance
    const dollarGamma = g.gamma * S * S * pos.contracts;
    const thetaGammaStep = 0.5 * dollarGamma * (row.iv * row.iv * dt - logRet * logRet);
    pos.thetaGamma += thetaGammaStep;

    // 2. Vega: short vega loses when implied vol rises
    const vegaStep = -g.vega * pos.contracts * (row.iv - prev.iv);
    pos.vega += vegaStep;

    // 3. Funding on the perp delta hedge. Long perp pays when funding is positive.
    const hedgeNotional = pos.hedgeUnits * S;
    pos.funding += -hedgeNotional * row.fundingRate;

    if (pos.hedgeUnits !== 0) {
      hedgedHours++;
      if (pos.hedgeUnits > 0) hedgeLongHours++;
    }

    // 4. Rehedge when the portfolio delta drifts outside the band
    const targetHedge = g.delta * pos.contracts;
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

    // Stop out on a margin-threatening loss
    if (unrealized < -cfg.stopLossPct * cfg.initialCapital) {
      closePosition(i, true);
      continue;
    }

    // Roll when the tenor decays past the roll point
    const daysRemaining = (pos.expiry - row.timestamp) / 86400000;
    if (daysRemaining <= cfg.rollAtDaysRemaining) {
      closePosition(i, false);
      if (rows[rows.length - 1].timestamp - row.timestamp > cfg.tenorDays * 86400000 * 0.25) {
        openPosition(i);
      }
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
  const elapsedMs = rows[rows.length - 1].timestamp - rows[0].timestamp;
  const elapsedDays = elapsedMs / 86400000;
  const periodsPerYear = returns.length > 0 ? (returns.length * 365) / Math.max(elapsedDays, 1e-9) : 0;
  const sharpeRatio = (avgRet / std) * Math.sqrt(periodsPerYear);

  const totalPnl = realizedPnl;
  const annualizedReturn =
    elapsedDays > 0 ? Math.pow(1 + totalPnl / cfg.initialCapital, 365 / elapsedDays) - 1 : 0;

  const avgImpliedVol = ivSum / (rvCount || 1);
  const avgRealizedVol = Math.sqrt((rvSumSq / (rvCount || 1)) * 365 * 24);

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
  };
}

function emptyResult(): OptionsBacktestResult {
  return {
    trades: [], totalPnl: 0, totalFees: 0, totalThetaGammaPnl: 0, totalVegaPnl: 0,
    totalFundingPnl: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    sharpeRatio: 0, annualizedReturn: 0, avgImpliedVol: 0, avgRealizedVol: 0,
    avgVrpVolPts: 0, totalRehedges: 0, stopOuts: 0, pnlHistory: [], timestamps: [],
    hedgeLongFraction: 0,
  };
}
