/**
 * Basis Trading Backtest Engine
 *
 * Supports two strategies:
 * 1. Spot vs Perp: Long spot + Short perp (or vice versa)
 * 2. Perp vs Perp: Long perp on Exchange A + Short perp on Exchange B (3x leverage)
 *
 * Includes realistic fee modeling (taker/maker) and bid-ask spread costs.
 */

import type { FundingRateEntry } from "./exchanges/types";

export type StrategyType = "spot_vs_perp" | "perp_vs_perp";

// Fee model for each exchange
export interface FeeModel {
  takerFeeBps: number;   // in basis points (e.g., 3.5 = 0.035%)
  makerFeeBps: number;   // in basis points
  avgSpreadBps: number;  // average bid-ask spread in basis points
}

// Exchange fee presets (realistic values)
export const EXCHANGE_FEES: Record<string, FeeModel> = {
  hyperliquid: { takerFeeBps: 3.5, makerFeeBps: 1.0, avgSpreadBps: 2.0 },
  lighter:     { takerFeeBps: 2.0, makerFeeBps: 0.0, avgSpreadBps: 3.0 },
  aster:       { takerFeeBps: 4.0, makerFeeBps: 1.0, avgSpreadBps: 5.0 },
  extended:    { takerFeeBps: 2.0, makerFeeBps: 0.0, avgSpreadBps: 4.0 },
  paradex:     { takerFeeBps: 5.0, makerFeeBps: 2.0, avgSpreadBps: 3.0 },
  nado:        { takerFeeBps: 4.0, makerFeeBps: 1.0, avgSpreadBps: 4.0 },
  gmx:         { takerFeeBps: 5.0, makerFeeBps: 0.0, avgSpreadBps: 3.0 },
  binance:     { takerFeeBps: 4.0, makerFeeBps: 1.0, avgSpreadBps: 1.0 },
  uniswap:     { takerFeeBps: 5.0, makerFeeBps: 5.0, avgSpreadBps: 5.0 },
};

export interface BacktestConfig {
  initialCapital: number;
  strategy: StrategyType;
  fundingThreshold: number;
  maxSpreadBps: number;        // max funding rate spread to enter
  perpLeverage: number;        // leverage for spot_vs_perp perp leg
  perpLeverageA: number;       // leverage for perp_vs_perp leg A
  perpLeverageB: number;       // leverage for perp_vs_perp leg B
  maxPositionSize: number;
  venueA: string;
  venueB: string;
  feeA: FeeModel;
  feeB: FeeModel;
  useMakerFees: boolean;       // use maker fees instead of taker
  exitOnNegativeFunding: boolean;  // close position when funding turns negative
}

export interface Trade {
  entryTime: Date;
  exitTime?: Date;
  direction: "long_a_short_b" | "short_a_long_b";
  size: number;
  notionalA: number;
  notionalB: number;
  leverageA: number;
  leverageB: number;
  fundingCollected: number;
  fundingPaid: number;
  feesPaid: number;
  entryCostBps: number;
  exitCostBps: number;
  pnl: number;
  entryFundingRateA: number;
  entryFundingRateB: number;
  exitFundingRateA?: number;
  exitFundingRateB?: number;
  spreadBps: number;
  status: "open" | "closed";
}

export interface BacktestResult {
  trades: Trade[];
  totalPnl: number;
  totalFees: number;
  totalFundingCollected: number;
  totalFundingPaid: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  annualizedReturn: number;
  avgFundingRateA: number;
  avgFundingRateB: number;
  avgSpreadBps: number;
  skippedDueToSpread: number;
}

interface AlignedData {
  timestamp: number;
  fundingRateA: number;
  fundingRateB: number;
  spreadBps: number;
}

function alignFundingData(
  ratesA: FundingRateEntry[],
  ratesB: FundingRateEntry[]
): AlignedData[] {
  const mapB = new Map<number, number>();
  for (const r of ratesB) {
    const key = Math.floor(r.timestamp / 1000 / 3600) * 3600;
    mapB.set(key, r.fundingRate);
  }

  const aligned: AlignedData[] = [];
  for (const rA of ratesA) {
    const key = Math.floor(rA.timestamp / 1000 / 3600) * 3600;
    const rateB = mapB.get(key);
    if (rateB !== undefined) {
      const spreadBps = Math.abs(rA.fundingRate - rateB) * 10000;
      aligned.push({
        timestamp: rA.timestamp,
        fundingRateA: rA.fundingRate,
        fundingRateB: rateB,
        spreadBps,
      });
    }
  }
  return aligned;
}

// Calculate the cost of entering/exiting a position in basis points
function calcEntryExitCostBps(
  fee: FeeModel,
  useMaker: boolean,
  leverage: number
): number {
  const tradingFee = useMaker ? fee.makerFeeBps : fee.takerFeeBps;
  // Spread cost: you cross half the spread on entry, half on exit
  const spreadCost = fee.avgSpreadBps / 2;
  // Total round-trip cost per leg (entry + exit)
  const roundTripCost = (tradingFee * 2 + spreadCost) * 2;
  // Leverage amplifies fees relative to capital
  return roundTripCost * leverage;
}

function getConfig(config: Partial<BacktestConfig>): BacktestConfig {
  const isPerpVsPerp = config.strategy === "perp_vs_perp";

  return {
    initialCapital: config.initialCapital ?? 50000,
    strategy: config.strategy ?? "spot_vs_perp",
    fundingThreshold: config.fundingThreshold ?? 0.00001,
    maxSpreadBps: config.maxSpreadBps ?? 100,
    perpLeverage: config.perpLeverage ?? 2,
    perpLeverageA: isPerpVsPerp ? (config.perpLeverageA ?? 3) : (config.perpLeverage ?? 2),
    perpLeverageB: isPerpVsPerp ? (config.perpLeverageB ?? 3) : (config.perpLeverage ?? 2),
    maxPositionSize: config.maxPositionSize ?? 25000,
    venueA: config.venueA ?? "hyperliquid",
    venueB: config.venueB ?? "binance",
    feeA: config.feeA ?? EXCHANGE_FEES[config.venueA ?? "hyperliquid"] ?? EXCHANGE_FEES.hyperliquid,
    feeB: config.feeB ?? EXCHANGE_FEES[config.venueB ?? "binance"] ?? EXCHANGE_FEES.binance,
    useMakerFees: config.useMakerFees ?? false,
    exitOnNegativeFunding: config.exitOnNegativeFunding ?? false,
  };
}

export function runBacktest(
  ratesA: FundingRateEntry[],
  ratesB: FundingRateEntry[],
  config: Partial<BacktestConfig> = {}
): BacktestResult {
  const cfg = getConfig(config);
  const data = alignFundingData(ratesA, ratesB);

  // Pre-calculate fee costs per hour (approximate - in reality fees are per trade)
  const leverageA = cfg.perpLeverageA;
  const leverageB = cfg.perpLeverageB;

  const trades: Trade[] = [];
  let capital = cfg.initialCapital;
  let openTrade: Trade | null = null;
  let cumulativePnl = 0;
  const pnlHistory: number[] = [0];
  let skippedDueToSpread = 0;
  let totalFees = 0;

  for (let i = 1; i < data.length; i++) {
    const cur = data[i];
    const prev = data[i - 1];

    // Update open trade PnL
    if (openTrade) {
      // Funding differential PnL (leveraged notional)
      const notionalA = openTrade.notionalA;
      const notionalB = openTrade.notionalB;
      let fundingDiff: number;

      if (openTrade.direction === "long_a_short_b") {
        // Collect funding from A (long), pay funding on B (short)
        fundingDiff = notionalA * cur.fundingRateA - notionalB * cur.fundingRateB;
      } else {
        // Collect funding from B (long), pay funding on A (short)
        fundingDiff = notionalB * cur.fundingRateB - notionalA * cur.fundingRateA;
      }

      openTrade.fundingCollected += Math.max(fundingDiff, 0);
      openTrade.fundingPaid += Math.abs(Math.min(fundingDiff, 0));
      openTrade.pnl += fundingDiff;
    }

    // Entry logic
    if (!openTrade) {
      const fundingDiff = cur.fundingRateA - cur.fundingRateB;
      const absDiff = Math.abs(fundingDiff);

      if (absDiff < cfg.fundingThreshold) continue;
      if (cur.spreadBps > cfg.maxSpreadBps) {
        skippedDueToSpread++;
        continue;
      }

      // Position sizing
      const notionalPerSide = Math.min(capital * 0.5, cfg.maxPositionSize);
      const notionalA = notionalPerSide * leverageA;
      const notionalB = notionalPerSide * leverageB;

      let direction: "long_a_short_b" | "short_a_long_b";

      if (fundingDiff > cfg.fundingThreshold) {
        direction = "long_a_short_b";
      } else if (fundingDiff < -cfg.fundingThreshold) {
        direction = "short_a_long_b";
      } else {
        continue;
      }

      // Calculate entry fees
      const feeAEntryBps = (cfg.useMakerFees ? cfg.feeA.makerFeeBps : cfg.feeA.takerFeeBps);
      const feeBEntryBps = (cfg.useMakerFees ? cfg.feeB.makerFeeBps : cfg.feeB.takerFeeBps);
      const spreadEntryCost = (cfg.feeA.avgSpreadBps + cfg.feeB.avgSpreadBps) / 2;
      const totalEntryCostBps = feeAEntryBps + feeBEntryBps + spreadEntryCost;
      const entryFee = (notionalA * feeAEntryBps + notionalB * feeBEntryBps) / 10000;
      const entrySpreadCost = (notionalA * cfg.feeA.avgSpreadBps + notionalB * cfg.feeB.avgSpreadBps) / 2 / 10000;
      const totalEntryCost = entryFee + entrySpreadCost;

      openTrade = {
        entryTime: new Date(cur.timestamp),
        direction,
        size: notionalPerSide,
        notionalA,
        notionalB,
        leverageA,
        leverageB,
        fundingCollected: 0,
        fundingPaid: 0,
        feesPaid: totalEntryCost,
        entryCostBps: totalEntryCostBps,
        exitCostBps: 0,
        pnl: -totalEntryCost,
        entryFundingRateA: cur.fundingRateA,
        entryFundingRateB: cur.fundingRateB,
        spreadBps: cur.spreadBps,
        status: "open",
      };
      totalFees += totalEntryCost;
    }

    // Exit logic: close when spread narrows or when funding turns negative
    if (openTrade) {
      const fundingDiff = Math.abs(cur.fundingRateA - cur.fundingRateB);

      // Check if we should exit
      let shouldExit = false;

      // Exit 1: spread narrows below threshold
      if (fundingDiff < cfg.fundingThreshold * 0.5) {
        shouldExit = true;
      }

      // Exit 2: funding turns negative for our position
      if (cfg.exitOnNegativeFunding && !shouldExit) {
        let currentFundingDiff: number;
        if (openTrade.direction === "long_a_short_b") {
          currentFundingDiff = cur.fundingRateA - cur.fundingRateB;
        } else {
          currentFundingDiff = cur.fundingRateB - cur.fundingRateA;
        }
        // Exit if our position would lose money from funding this hour
        if (currentFundingDiff < 0) {
          shouldExit = true;
        }
      }

      if (shouldExit) {
        // Calculate exit fees
        const feeAExitBps = (cfg.useMakerFees ? cfg.feeA.makerFeeBps : cfg.feeA.takerFeeBps);
        const feeBExitBps = (cfg.useMakerFees ? cfg.feeB.makerFeeBps : cfg.feeB.takerFeeBps);
        const spreadExitCost = (cfg.feeA.avgSpreadBps + cfg.feeB.avgSpreadBps) / 2;
        const totalExitCostBps = feeAExitBps + feeBExitBps + spreadExitCost;
        const exitFee = (openTrade.notionalA * feeAExitBps + openTrade.notionalB * feeBExitBps) / 10000;
        const exitSpreadCost = (openTrade.notionalA * cfg.feeA.avgSpreadBps + openTrade.notionalB * cfg.feeB.avgSpreadBps) / 2 / 10000;
        const totalExitCost = exitFee + exitSpreadCost;

        openTrade.exitTime = new Date(cur.timestamp);
        openTrade.exitFundingRateA = cur.fundingRateA;
        openTrade.exitFundingRateB = cur.fundingRateB;
        openTrade.exitCostBps = totalExitCostBps;
        openTrade.feesPaid += totalExitCost;
        openTrade.pnl -= totalExitCost;
        openTrade.status = "closed";
        totalFees += totalExitCost;

        capital += openTrade.pnl;
        trades.push(openTrade);
        openTrade = null;
        pnlHistory.push(cumulativePnl + (trades[trades.length - 1]?.pnl ?? 0));
      }
    }

    if (!openTrade) {
      cumulativePnl = trades.reduce((sum, t) => sum + t.pnl, 0);
      pnlHistory.push(cumulativePnl);
    }
  }

  // Close remaining open trade
  if (openTrade && data.length > 0) {
    const last = data[data.length - 1];
    const feeAExitBps = (cfg.useMakerFees ? cfg.feeA.makerFeeBps : cfg.feeA.takerFeeBps);
    const feeBExitBps = (cfg.useMakerFees ? cfg.feeB.makerFeeBps : cfg.feeB.takerFeeBps);
    const exitFee = (openTrade.notionalA * feeAExitBps + openTrade.notionalB * feeBExitBps) / 10000;
    const exitSpreadCost = (openTrade.notionalA * cfg.feeA.avgSpreadBps + openTrade.notionalB * cfg.feeB.avgSpreadBps) / 2 / 10000;
    const totalExitCost = exitFee + exitSpreadCost;

    openTrade.exitTime = new Date(last.timestamp);
    openTrade.exitFundingRateA = last.fundingRateA;
    openTrade.exitFundingRateB = last.fundingRateB;
    openTrade.feesPaid += totalExitCost;
    openTrade.pnl -= totalExitCost;
    openTrade.status = "closed";
    totalFees += totalExitCost;

    capital += openTrade.pnl;
    trades.push(openTrade);
    pnlHistory.push(trades.reduce((sum, t) => sum + t.pnl, 0));
  }

  // Stats
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalFundingCollected = trades.reduce((s, t) => s + t.fundingCollected, 0);
  const totalFundingPaid = trades.reduce((s, t) => s + t.fundingPaid, 0);
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const totalTrades = trades.length;

  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const pnl of pnlHistory) {
    if (pnl > peak) peak = pnl;
    const dd = peak - pnl;
    const ddPct = dd / cfg.initialCapital;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  const returns = [];
  for (let i = 1; i < pnlHistory.length; i++) {
    returns.push((pnlHistory[i] - pnlHistory[i - 1]) / cfg.initialCapital);
  }
  const avg = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const std = Math.sqrt(returns.reduce((s, r) => s + (r - avg) ** 2, 0) / (returns.length || 1)) || 1;
  const sharpeRatio = (avg / std) * Math.sqrt(365 * 24);

  const totalDays = data.length / 24;
  const annualizedReturn = totalDays > 0
    ? Math.pow(1 + totalPnl / cfg.initialCapital, 365 / totalDays) - 1
    : 0;

  const avgFundingRateA = data.reduce((s, d) => s + d.fundingRateA, 0) / (data.length || 1);
  const avgFundingRateB = data.reduce((s, d) => s + d.fundingRateB, 0) / (data.length || 1);
  const avgSpreadBps = data.reduce((s, d) => s + d.spreadBps, 0) / (data.length || 1);

  return {
    trades,
    totalPnl,
    totalFees,
    totalFundingCollected,
    totalFundingPaid,
    winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
    totalTrades,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    annualizedReturn,
    avgFundingRateA,
    avgFundingRateB,
    avgSpreadBps,
    skippedDueToSpread,
  };
}
