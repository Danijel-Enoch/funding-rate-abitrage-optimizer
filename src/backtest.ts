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
  hyperliquid:   { takerFeeBps: 3.5, makerFeeBps: 1.0, avgSpreadBps: 2.0 },
  lighter:       { takerFeeBps: 2.0, makerFeeBps: 0.0, avgSpreadBps: 3.0 },
  aster:         { takerFeeBps: 4.0, makerFeeBps: 1.0, avgSpreadBps: 5.0 },
  extended:      { takerFeeBps: 2.0, makerFeeBps: 0.0, avgSpreadBps: 4.0 },
  paradex:       { takerFeeBps: 5.0, makerFeeBps: 2.0, avgSpreadBps: 3.0 },
  nado:          { takerFeeBps: 4.0, makerFeeBps: 1.0, avgSpreadBps: 4.0 },
  gmx:           { takerFeeBps: 5.0, makerFeeBps: 0.0, avgSpreadBps: 3.0 },
  "binance-perp":{ takerFeeBps: 4.0, makerFeeBps: 2.0, avgSpreadBps: 1.0 },
  bybit:         { takerFeeBps: 5.5, makerFeeBps: 2.0, avgSpreadBps: 1.5 },
  okx:           { takerFeeBps: 5.0, makerFeeBps: 2.0, avgSpreadBps: 1.5 },
  mexc:          { takerFeeBps: 4.0, makerFeeBps: 0.0, avgSpreadBps: 2.0 },
  binance:       { takerFeeBps: 10.0, makerFeeBps: 10.0, avgSpreadBps: 1.0 },
  uniswap:       { takerFeeBps: 5.0, makerFeeBps: 5.0, avgSpreadBps: 5.0 },
  "bybit-spot":  { takerFeeBps: 10.0, makerFeeBps: 10.0, avgSpreadBps: 1.5 },
  "okx-spot":    { takerFeeBps: 10.0, makerFeeBps: 8.0, avgSpreadBps: 1.5 },
  "mexc-spot":   { takerFeeBps: 10.0, makerFeeBps: 10.0, avgSpreadBps: 2.0 },
};

export interface FlipConfig {
  enabled: boolean;             // enable position flipping
  flipThresholdHours: number;   // hours of negative funding before considering flip
  minGainMultiple: number;      // only flip if expected gain > flip cost × this
  flipCooldownHours: number;    // min hours between flips (prevent flip-flopping)
}

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
  flip: FlipConfig;            // position flipping config
  priceData: Array<{ timestamp: number; price: number }>; // hourly price data for liquidation checks
  maintenanceMarginBps: number; // maintenance margin in bps (e.g., 500 = 5%)
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
  flipCount: number;            // number of times this position was flipped
  negativeFundingHours: number; // cumulative hours of negative funding during trade
  expectedBreakevenHours: number; // from entry spread + fees (what we expected)
  actualBreakevenHours: number;   // when PnL actually crossed 0 (-1 = never)
  entryPriceA: number;           // price at entry for leg A
  entryPriceB: number;           // price at entry for leg B
  liquidated: boolean;           // was this trade liquidated?
  liquidatedAt?: Date;           // when liquidation happened
  liquidatedLeg?: "A" | "B";    // which leg was liquidated
  liquidationLoss: number;       // PnL lost due to liquidation (on top of normal exit)
}

export interface LiquidationEvent {
  timestamp: number;
  leg: "A" | "B";              // which leg got liquidated
  entryPrice: number;           // price when position was opened
  liquidationPrice: number;     // price that triggered liquidation
  priceMove: number;            // % price move that caused it
  leverage: number;             // leverage on the liquidated leg
  notional: number;             // notional size of liquidated leg
  loss: number;                 // estimated loss from liquidation
  strategy: string;             // which combo this happened on
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
  totalFlips: number;           // total number of flips executed
  flipCostPaid: number;         // total fees paid from flipping
  avgNegativeFundingHours: number; // avg hours of negative funding per trade
  breakevenHours: number;       // hours from start until cumulative PnL >= 0
  breakevenTimestamp: number;   // timestamp when breakeven was reached (0 = never)
  pnlHistory: number[];         // cumulative PnL at each data point
  timestamps: number[];         // timestamps aligned to pnlHistory
  liquidationEvents: LiquidationEvent[]; // any liquidation events during backtest
  totalLiquidationLoss: number; // total PnL lost to liquidations
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
    flip: {
      enabled: config.flip?.enabled ?? false,
      flipThresholdHours: config.flip?.flipThresholdHours ?? 24,
      minGainMultiple: config.flip?.minGainMultiple ?? 1.5,
      flipCooldownHours: config.flip?.flipCooldownHours ?? 6,
    },
    priceData: config.priceData ?? [],
    maintenanceMarginBps: config.maintenanceMarginBps ?? 500, // 5% default
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
  let totalFlips = 0;
  let flipCostPaid = 0;
  let negativeFundingHoursAccum = 0;  // track negative hours in current trade
  let tradeBreakevenReached = false;  // per-trade actual breakeven tracker
  let tradeCumPnl = 0;               // running PnL within current trade
  let actualBreakevenHours = -1;      // actual hours to breakeven (-1 = not reached)
  let lastFlipTime = 0;               // timestamp of last flip
  let breakevenTimestamp = 0;          // when cumulative PnL first >= 0
  let breakevenReached = false;
  const liquidationEvents: LiquidationEvent[] = [];
  let totalLiquidationLoss = 0;

  // Price lookup: find price closest to a timestamp (within 2 hours)
  function findPrice(ts: number): number | null {
    const prices = cfg.priceData;
    if (prices.length === 0) return null;
    let lo = 0, hi = prices.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prices[mid].timestamp < ts) lo = mid + 1;
      else hi = mid;
    }
    // Check lo and lo-1, pick closest
    let best = lo;
    if (lo > 0 && Math.abs(prices[lo - 1].timestamp - ts) < Math.abs(prices[lo].timestamp - ts)) {
      best = lo - 1;
    }
    if (Math.abs(prices[best].timestamp - ts) > 2 * 3600 * 1000) return null; // >2 hours away
    return prices[best].price;
  }

  // Check if a leveraged position would be liquidated
  // Returns { liquidated: boolean, loss: number, liqPrice: number }
  function checkLiquidation(
    entryPrice: number,
    currentPrice: number,
    leverage: number,
    notional: number,
    isLong: boolean
  ): { liquidated: boolean; loss: number; liqPrice: number } {
    const mmBps = cfg.maintenanceMarginBps;
    const mmPct = mmBps / 10000;
    const initialMarginPct = 1 / leverage;

    // Price change %
    const priceChangePct = isLong
      ? (entryPrice - currentPrice) / entryPrice   // long loses when price drops
      : (currentPrice - entryPrice) / entryPrice;   // short loses when price rises

    // Liquidation threshold: price move that wipes out initial margin minus maintenance margin
    const liqThreshold = initialMarginPct - mmPct;

    if (priceChangePct >= liqThreshold) {
      // Liquidated: loss = initial margin (you lose all your margin on this leg)
      const margin = notional * initialMarginPct;
      // Actual loss is slightly less than full margin because maintenance margin exists
      const loss = notional * (priceChangePct - mmPct);
      // Cap loss at margin
      const actualLoss = Math.min(loss, margin);
      // Liquidation price
      const liqPrice = isLong
        ? entryPrice * (1 - liqThreshold)
        : entryPrice * (1 + liqThreshold);
      return { liquidated: true, loss: Math.max(actualLoss, 0), liqPrice };
    }
    return { liquidated: false, loss: 0, liqPrice: 0 };
  }

  // Calculate cost of flipping a position (close + reopen opposite)
  function calcFlipCostBps(): number {
    const feeAEntry = cfg.useMakerFees ? cfg.feeA.makerFeeBps : cfg.feeA.takerFeeBps;
    const feeBEntry = cfg.useMakerFees ? cfg.feeB.makerFeeBps : cfg.feeB.takerFeeBps;
    const spreadCost = (cfg.feeA.avgSpreadBps + cfg.feeB.avgSpreadBps) / 2;
    // Exit fees + re-entry fees (4 trading fees + 2 spread costs)
    return (feeAEntry + feeBEntry) * 4 + spreadCost * 2;
  }

  for (let i = 1; i < data.length; i++) {
    const cur = data[i];
    const prev = data[i - 1];

    // Record PnL at every data point (realized + unrealized) - must be before any continue
    const unrealizedPnlTop = openTrade ? openTrade.pnl : 0;
    pnlHistory.push(cumulativePnl + unrealizedPnlTop);

    // Update open trade PnL
    if (openTrade) {
      // Funding differential PnL (leveraged notional)
      const notionalA = openTrade.notionalA;
      const notionalB = openTrade.notionalB;
      let fundingDiff: number;
      let currentFundingDiff: number;

      if (openTrade.direction === "long_a_short_b") {
        // Collect funding from A (long), pay funding on B (short)
        fundingDiff = notionalA * cur.fundingRateA - notionalB * cur.fundingRateB;
        currentFundingDiff = cur.fundingRateA - cur.fundingRateB;
      } else {
        // Collect funding from B (long), pay funding on A (short)
        fundingDiff = notionalB * cur.fundingRateB - notionalA * cur.fundingRateA;
        currentFundingDiff = cur.fundingRateB - cur.fundingRateA;
      }

      openTrade.fundingCollected += Math.max(fundingDiff, 0);
      openTrade.fundingPaid += Math.abs(Math.min(fundingDiff, 0));
      openTrade.pnl += fundingDiff;

      // Track actual breakeven within this trade
      if (!tradeBreakevenReached) {
        tradeCumPnl += fundingDiff;
        if (tradeCumPnl >= 0) {
          tradeBreakevenReached = true;
          const tradeElapsedMs = cur.timestamp - openTrade.entryTime.getTime();
          actualBreakevenHours = Math.round(tradeElapsedMs / (1000 * 60 * 60));
        }
      }

      // Track negative funding hours
      if (currentFundingDiff < 0) {
        negativeFundingHoursAccum++;
        openTrade.negativeFundingHours++;
      }

      // Liquidation check: get current price and check both legs
      if (openTrade.entryPriceA > 0 && !openTrade.liquidated) {
        const currentPrice = findPrice(cur.timestamp);
        if (currentPrice && openTrade.entryPriceA > 0) {
          // Check leg A (long_a_short_b means long A)
          const isLongA = openTrade.direction === "long_a_short_b";
          const liqA = checkLiquidation(
            openTrade.entryPriceA, currentPrice, leverageA, openTrade.notionalA, isLongA
          );
          // Check leg B (opposite direction)
          const isLongB = !isLongA;
          const liqB = checkLiquidation(
            openTrade.entryPriceB, currentPrice, leverageB, openTrade.notionalB, isLongB
          );

          if (liqA.liquidated) {
            openTrade.liquidated = true;
            openTrade.liquidatedAt = new Date(cur.timestamp);
            openTrade.liquidatedLeg = "A";
            openTrade.liquidationLoss = liqA.loss;
            openTrade.pnl -= liqA.loss;
            totalLiquidationLoss += liqA.loss;
            liquidationEvents.push({
              timestamp: cur.timestamp,
              leg: "A",
              entryPrice: openTrade.entryPriceA,
              liquidationPrice: liqA.liqPrice,
              priceMove: ((currentPrice - openTrade.entryPriceA) / openTrade.entryPriceA) * (isLongA ? -1 : 1) * 100,
              leverage: leverageA,
              notional: openTrade.notionalA,
              loss: liqA.loss,
              strategy: `${cfg.venueA} vs ${cfg.venueB}`,
            });
          } else if (liqB.liquidated) {
            openTrade.liquidated = true;
            openTrade.liquidatedAt = new Date(cur.timestamp);
            openTrade.liquidatedLeg = "B";
            openTrade.liquidationLoss = liqB.loss;
            openTrade.pnl -= liqB.loss;
            totalLiquidationLoss += liqB.loss;
            liquidationEvents.push({
              timestamp: cur.timestamp,
              leg: "B",
              entryPrice: openTrade.entryPriceB,
              liquidationPrice: liqB.liqPrice,
              priceMove: ((currentPrice - openTrade.entryPriceB) / openTrade.entryPriceB) * (isLongB ? -1 : 1) * 100,
              leverage: leverageB,
              notional: openTrade.notionalB,
              loss: liqB.loss,
              strategy: `${cfg.venueA} vs ${cfg.venueB}`,
            });
          }
        }
      }

      // Check for flip opportunity
      if (cfg.flip.enabled && currentFundingDiff < 0 && negativeFundingHoursAccum >= cfg.flip.flipThresholdHours) {
        const hoursSinceLastFlip = (cur.timestamp - lastFlipTime) / (1000 * 3600);
        if (hoursSinceLastFlip >= cfg.flip.flipCooldownHours) {
          // Calculate flip cost (in notional terms)
          const flipCostNotional = (notionalA + notionalB) * calcFlipCostBps() / 10000;

          // Expected gain from flipping: if we flip, we capture the inverted funding rate
          // The flipped position would collect abs(currentFundingDiff) * notional per hour
          // Estimate how long the flipped position would be profitable (use avg negative streak)
          const hourlyGainIfFlipped = Math.abs(currentFundingDiff) * Math.min(notionalA, notionalB);
          const estimatedFlipDuration = negativeFundingHoursAccum; // use what we've seen
          const expectedGain = hourlyGainIfFlipped * estimatedFlipDuration;

          // Only flip if expected gain > flip cost × minGainMultiple
          if (expectedGain > flipCostNotional * cfg.flip.minGainMultiple) {
            // Close current position (exit fees)
            const feeAExitBps = cfg.useMakerFees ? cfg.feeA.makerFeeBps : cfg.feeA.takerFeeBps;
            const feeBExitBps = cfg.useMakerFees ? cfg.feeB.makerFeeBps : cfg.feeB.takerFeeBps;
            const exitFee = (notionalA * feeAExitBps + notionalB * feeBExitBps) / 10000;
            const exitSpreadCost = (notionalA * cfg.feeA.avgSpreadBps + notionalB * cfg.feeB.avgSpreadBps) / 2 / 10000;
            const totalExitCost = exitFee + exitSpreadCost;

            openTrade.exitTime = new Date(cur.timestamp);
            openTrade.exitFundingRateA = cur.fundingRateA;
            openTrade.exitFundingRateB = cur.fundingRateB;
            openTrade.exitCostBps = calcFlipCostBps();
            openTrade.feesPaid += totalExitCost;
            openTrade.pnl -= totalExitCost;
            openTrade.status = "closed";
            openTrade.flipCount++;
            totalFees += totalExitCost;
            flipCostPaid += totalExitCost;

            capital += openTrade.pnl;
            trades.push(openTrade);

            // Open flipped position immediately
            const flippedDirection = openTrade.direction === "long_a_short_b"
              ? "short_a_long_b" : "long_a_short_b";

            const feeAEntryBps = cfg.useMakerFees ? cfg.feeA.makerFeeBps : cfg.feeA.takerFeeBps;
            const feeBEntryBps = cfg.useMakerFees ? cfg.feeB.makerFeeBps : cfg.feeB.takerFeeBps;
            const entryFee = (notionalA * feeAEntryBps + notionalB * feeBEntryBps) / 10000;
            const entrySpreadCost = (notionalA * cfg.feeA.avgSpreadBps + notionalB * cfg.feeB.avgSpreadBps) / 2 / 10000;
            const totalEntryCost = entryFee + entrySpreadCost;

            openTrade = {
              entryTime: new Date(cur.timestamp),
              direction: flippedDirection,
              size: openTrade.size,
              notionalA,
              notionalB,
              leverageA: openTrade.leverageA,
              leverageB: openTrade.leverageB,
              fundingCollected: 0,
              fundingPaid: 0,
              feesPaid: totalEntryCost,
              entryCostBps: feeAEntryBps + feeBEntryBps + (cfg.feeA.avgSpreadBps + cfg.feeB.avgSpreadBps) / 2,
              exitCostBps: 0,
              pnl: -totalEntryCost,
              entryFundingRateA: cur.fundingRateA,
              entryFundingRateB: cur.fundingRateB,
              spreadBps: cur.spreadBps,
              status: "open",
              flipCount: openTrade.flipCount,
              negativeFundingHours: 0,
            };
            totalFees += totalEntryCost;
            flipCostPaid += totalEntryCost;
            totalFlips++;
            lastFlipTime = cur.timestamp;
            negativeFundingHoursAccum = 0;

            pnlHistory.push(cumulativePnl + openTrade.pnl);
            continue;
          }
        }
      }
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

      // Expected breakeven: entry cost bps / entry spread bps * 8 hours
      const entrySpreadBps = Math.abs(cur.fundingRateA - cur.fundingRateB) * 10000;
      const expectedPeriods = entrySpreadBps > 0 ? Math.ceil(totalEntryCostBps / entrySpreadBps) : 999;
      const expectedBreakevenHours = expectedPeriods * 8;
      actualBreakevenHours = -1;
      tradeCumPnl = -totalEntryCost;
      tradeBreakevenReached = false;

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
        flipCount: 0,
        negativeFundingHours: 0,
        expectedBreakevenHours,
        actualBreakevenHours: -1,
        entryPriceA: findPrice(cur.timestamp) ?? 0,
        entryPriceB: findPrice(cur.timestamp) ?? 0,
        liquidated: false,
        liquidationLoss: 0,
      };
      totalFees += totalEntryCost;
      negativeFundingHoursAccum = 0;
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
        openTrade.actualBreakevenHours = actualBreakevenHours;
        openTrade.status = "closed";
        totalFees += totalExitCost;

        capital += openTrade.pnl;
        trades.push(openTrade);
        openTrade = null;
        negativeFundingHoursAccum = 0;
      }
    }

    if (!openTrade) {
      cumulativePnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    }

    // Check for breakeven: total PnL (realized + unrealized) >= 0
    if (!breakevenReached) {
      const unrealizedPnl = openTrade ? openTrade.pnl : 0;
      const totalPnlNow = cumulativePnl + unrealizedPnl;
      if (totalPnlNow >= 0) {
        breakevenReached = true;
        breakevenTimestamp = cur.timestamp;
      }
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
    openTrade.actualBreakevenHours = actualBreakevenHours;
    openTrade.status = "closed";
    totalFees += totalExitCost;

    capital += openTrade.pnl;
    trades.push(openTrade);
    // Update last PnL entry with final exit fees applied
    pnlHistory[pnlHistory.length - 1] = trades.reduce((sum, t) => sum + t.pnl, 0);
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
    totalFlips,
    flipCostPaid,
    avgNegativeFundingHours: totalTrades > 0
      ? trades.reduce((s, t) => s + t.negativeFundingHours, 0) / totalTrades
      : 0,
    breakevenHours: breakevenTimestamp > 0
      ? Math.round((breakevenTimestamp - data[0].timestamp) / (1000 * 60 * 60))
      : -1,
    breakevenTimestamp,
    pnlHistory,
    timestamps: data.map((d) => d.timestamp),
    liquidationEvents,
    totalLiquidationLoss,
  };
}
