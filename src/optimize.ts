/**
 * Backtest Optimization Engine
 *
 * Tests all strategy/venue combinations for a given coin
 * and ranks them by net PnL with minimal drawdown.
 *
 * Includes realistic fees (taker/maker) and bid-ask spread costs.
 * Perp vs Perp uses 3x leverage on both sides.
 *
 * BasisOS enhancements:
 * - Risk-adjusted leverage (RLmax) per asset
 * - Rebalancing with target leverage
 * - Objective function: F = Ā / ((1 - α·DDq5)(1 - β·Δ))
 */

import { perpExchanges, spotExchanges, getPerpExchange, getSpotExchange } from "./exchanges";
import { UniswapSpotExchange } from "./exchanges/uniswap";
import {
  runBacktest, EXCHANGE_FEES,
  calcRiskAdjustedLeverage, calcObjectiveFunction,
  type BacktestConfig, type BacktestResult, type FeeModel,
  type RebalanceConfig, type RiskAdjustedLeverage, type ObjectiveFunctionResult,
} from "./backtest";
import type { FundingRateEntry } from "./exchanges/types";
import { TRADITIONAL_MARKETS } from "./markets";

export interface VenueCombo {
  strategy: "spot_vs_perp" | "perp_vs_perp";
  spotId: string | null;
  perpA: string;
  perpB: string;
  label: string;
}

export interface OptimizationResult {
  combo: VenueCombo;
  result: BacktestResult;
  netPnl: number;          // total PnL after fees
  totalFees: number;
  apy: number;
  maxDrawdownPct: number;
  score: number;           // composite score: PnL - (drawdown penalty)
  exitOnNegative: boolean; // whether this uses exit-on-negative-funding mode
  // BasisOS: objective function and leverage
  objectiveResult: ObjectiveFunctionResult;
  leverageConfig: { minLeverage: number; targetLeverage: number; maxLeverage: number };
  riskLeverage: RiskAdjustedLeverage | null;
  rebalanceEnabled: boolean;
}

export interface CrossoverPeriod {
  start: Date;
  end: Date;
  betterCombo: string;     // name of the combo that was better
  betterPnl: number;       // that combo's PnL at end of period
  winnerPnl: number;       // winner's PnL at end of period
  advantage: number;       // how much better (betterPnl - winnerPnl)
}

export interface CrossoverAnalysis {
  totalHoursBetter: number;           // hours the winner was NOT #1
  totalHours: number;                 // total hours in the backtest
  pctTimeNotBest: number;             // % of time winner wasn't best
  periods: CrossoverPeriod[];         // individual periods where someone else was better
  bestChallenger: string | null;      // the combo that spent the most time beating the winner
  maxAdvantage: number;               // biggest advantage any challenger had over the winner
  maxAdvantageCombo: string | null;   // which combo had that max advantage
}

export function analyzeCrossovers(
  results: OptimizationResult[],
  maxChallengers = 10
): CrossoverAnalysis | null {
  if (results.length < 2) return null;

  const winner = results[0];
  const winnerTimestamps = winner.result.timestamps;
  const winnerHistory = winner.result.pnlHistory;

  if (winnerTimestamps.length === 0) return null;

  // Take up to maxChallengers other combos
  const challengers = results.slice(1, maxChallengers + 1);

  // Build a map of timestamp -> { comboLabel: pnl } for all combos
  // Find overlapping timestamps
  const winnerTsSet = new Set(winnerTimestamps);
  const overlappingTs: number[] = [];
  for (let i = 0; i < winnerTimestamps.length; i++) {
    // Check if at least one challenger has this timestamp
    const ts = winnerTimestamps[i];
    const hasChallenger = challengers.some((c) =>
      c.result.timestamps.some((t) => Math.abs(t - ts) < 3600 * 1000) // within 1 hour
    );
    if (hasChallenger) overlappingTs.push(ts);
  }

  if (overlappingTs.length === 0) return null;

  // For each overlapping timestamp, find the best challenger PnL
  const periods: CrossoverPeriod[] = [];
  let currentPeriod: CrossoverPeriod | null = null;
  let totalHoursBetter = 0;

  for (let i = 0; i < overlappingTs.length; i++) {
    const ts = overlappingTs[i];
    const winnerIdx = winnerTimestamps.findIndex((t) => Math.abs(t - ts) < 3600 * 1000);
    if (winnerIdx < 0) continue;
    const winnerPnl = winnerHistory[winnerIdx];

    // Find best challenger at this timestamp
    let bestChallengerLabel = "";
    let bestChallengerPnl = -Infinity;

    for (const ch of challengers) {
      const chIdx = ch.result.timestamps.findIndex((t) => Math.abs(t - ts) < 3600 * 1000);
      if (chIdx < 0) continue;
      const chPnl = ch.result.pnlHistory[chIdx];
      if (chPnl > bestChallengerPnl) {
        bestChallengerPnl = chPnl;
        bestChallengerLabel = ch.combo.label;
      }
    }

    if (bestChallengerPnl > winnerPnl) {
      // Challenger is winning
      if (currentPeriod && currentPeriod.betterCombo === bestChallengerLabel) {
        // Extend current period
        currentPeriod.end = new Date(ts);
        currentPeriod.betterPnl = bestChallengerPnl;
        currentPeriod.winnerPnl = winnerPnl;
        currentPeriod.advantage = bestChallengerPnl - winnerPnl;
      } else {
        // Start new period
        if (currentPeriod) periods.push(currentPeriod);
        currentPeriod = {
          start: new Date(ts),
          end: new Date(ts),
          betterCombo: bestChallengerLabel,
          betterPnl: bestChallengerPnl,
          winnerPnl,
          advantage: bestChallengerPnl - winnerPnl,
        };
      }
    } else {
      // Winner is ahead
      if (currentPeriod) {
        periods.push(currentPeriod);
        currentPeriod = null;
      }
    }
  }
  if (currentPeriod) periods.push(currentPeriod);

  // Calculate hours
  for (const p of periods) {
    const hours = Math.round((p.end.getTime() - p.start.getTime()) / (1000 * 60 * 60));
    totalHoursBetter += hours || 1; // at least 1 hour per period
  }

  const totalHours = Math.round(
    (winnerTimestamps[winnerTimestamps.length - 1] - winnerTimestamps[0]) / (1000 * 60 * 60)
  );

  // Find the challenger that spent the most time beating the winner
  const challengerTime: Record<string, number> = {};
  for (const p of periods) {
    const hours = Math.round((p.end.getTime() - p.start.getTime()) / (1000 * 60 * 60)) || 1;
    challengerTime[p.betterCombo] = (challengerTime[p.betterCombo] || 0) + hours;
  }
  let bestChallengerName: string | null = null;
  let maxTime = 0;
  for (const [name, hours] of Object.entries(challengerTime)) {
    if (hours > maxTime) {
      maxTime = hours;
      bestChallengerName = name;
    }
  }

  // Find max advantage
  let maxAdv = 0;
  let maxAdvCombo: string | null = null;
  for (const p of periods) {
    if (p.advantage > maxAdv) {
      maxAdv = p.advantage;
      maxAdvCombo = p.betterCombo;
    }
  }

  return {
    totalHoursBetter,
    totalHours,
    pctTimeNotBest: totalHours > 0 ? (totalHoursBetter / totalHours) * 100 : 0,
    periods,
    bestChallenger: bestChallengerName,
    maxAdvantage: maxAdv,
    maxAdvantageCombo: maxAdvCombo,
  };
}

// BasisOS: Score using objective function F = Ā / ((1 - α·DDq5)(1 - β·Δ))
// Falls back to simple PnL - drawdown penalty when objective function isn't available
function calcScore(
  pnl: number,
  maxDrawdownPct: number,
  objectiveResult?: ObjectiveFunctionResult,
): number {
  // If net PnL is negative, always return a negative score
  // The objective function can produce positive values even with negative PnL
  // (avgApy computed from mean returns can be positive while total PnL is negative)
  if (pnl <= 0) {
    return pnl - maxDrawdownPct * 1000;
  }
  if (objectiveResult && objectiveResult.objective > 0) {
    // Use BasisOS objective function, scaled to be comparable with old scores
    return objectiveResult.objective * 10000;
  }
  // Fallback: PnL - drawdown penalty
  const ddPenalty = maxDrawdownPct * 1000;
  return pnl - ddPenalty;
}

// Check if a coin is a traditional asset (stock, commodity, ETF)
export function isTraditionalAsset(coin: string): boolean {
  return TRADITIONAL_MARKETS.some((m) => m.hlCoin === coin.toUpperCase());
}

// Get combos filtered by asset type
export function getAllCombos(traditionalOnly = false): VenueCombo[] {
  const combos: VenueCombo[] = [];

  if (!traditionalOnly) {
    // Spot vs Perp: each spot exchange × each perp exchange
    for (const spot of spotExchanges) {
      for (const perp of perpExchanges) {
        combos.push({
          strategy: "spot_vs_perp",
          spotId: spot.info.id,
          perpA: spot.info.id,
          perpB: perp.info.id,
          label: `${spot.info.name} vs ${perp.info.name}`,
        });
      }
    }
  }

  // Perp vs Perp: each pair of perp exchanges
  for (let i = 0; i < perpExchanges.length; i++) {
    for (let j = i + 1; j < perpExchanges.length; j++) {
      combos.push({
        strategy: "perp_vs_perp",
        spotId: null,
        perpA: perpExchanges[i].info.id,
        perpB: perpExchanges[j].info.id,
        label: `${perpExchanges[i].info.name} vs ${perpExchanges[j].info.name}`,
      });
    }
  }

  return combos;
}

async function fetchVenueFunding(
  venueId: string,
  coin: string,
  startTime: number,
  endTime: number
): Promise<FundingRateEntry[]> {
  const perp = getPerpExchange(venueId);
  if (!perp) return [];

  try {
    return await Promise.race([
      perp.fetchFundingRates(coin, startTime, endTime),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("exchange timeout")), 45000)),
    ]);
  } catch {
    return [];
  }
}

async function fetchVenuePrices(
  venueId: string,
  coin: string,
  startTime: number,
  endTime: number
): Promise<Array<{ timestamp: number; price: number }>> {
  // Try to find a matching spot exchange for this venue
  const spot = getSpotExchange(venueId);
  if (spot) {
    const symbol = coin.endsWith("USDT") ? coin : `${coin}USDT`;
    try {
      return await Promise.race([
        spot.fetchPrices(symbol, startTime, endTime),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("price timeout")), 30000)),
      ]);
    } catch {
      return [];
    }
  }

  // For perp-only venues (hyperliquid, lighter, etc.), try to find a corresponding spot exchange
  const perpToSpot: Record<string, string> = {
    "binance-perp": "binance",
    "bybit": "bybit-spot",
    "okx": "okx-spot",
    "mexc": "mexc-spot",
    "hyperliquid": "hyperliquid-spot",
    "lighter": "lighter-spot",
  };
  const spotId = perpToSpot[venueId];
  if (spotId) {
    const fallbackSpot = getSpotExchange(spotId);
    if (fallbackSpot) {
      const symbol = coin.endsWith("USDT") ? coin : `${coin}USDT`;
      try {
        return await Promise.race([
          fallbackSpot.fetchPrices(symbol, startTime, endTime),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("price timeout")), 30000)),
        ]);
      } catch {
        return [];
      }
    }
  }

  return [];
}

export async function optimizeCoin(
  coin: string,
  days: number,
  capital: number,
  onProgress?: (current: number, total: number, combo: VenueCombo) => void
): Promise<OptimizationResult[]> {
  const isTraditional = isTraditionalAsset(coin);
  const combos = getAllCombos(isTraditional);
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  const fundingCache = new Map<string, FundingRateEntry[]>();
  const priceCache = new Map<string, Array<{ timestamp: number; price: number }>>();
  const perpVenueIds = new Set<string>();
  const allVenueIds = new Set<string>();

  for (const combo of combos) {
    if (combo.strategy === "spot_vs_perp") {
      allVenueIds.add(combo.perpA);
      perpVenueIds.add(combo.perpB);
      allVenueIds.add(combo.perpB);
    } else {
      perpVenueIds.add(combo.perpA);
      perpVenueIds.add(combo.perpB);
      allVenueIds.add(combo.perpA);
      allVenueIds.add(combo.perpB);
    }
  }

  // Fetch funding data for all perp venues
  for (const venueId of perpVenueIds) {
    const key = `perp_${venueId}`;
    if (!fundingCache.has(key)) {
      try {
        const data = await fetchVenueFunding(venueId, coin, startTime, endTime);
        fundingCache.set(key, data);
      } catch {
        fundingCache.set(key, []);
      }
    }
  }

  // Fetch price data from each venue
  for (const venueId of allVenueIds) {
    const key = `price_${venueId}`;
    if (!priceCache.has(key)) {
      try {
        const data = await fetchVenuePrices(venueId, coin, startTime, endTime);
        priceCache.set(key, data);
      } catch {
        priceCache.set(key, []);
      }
    }
  }

  // Fallback: fetch Uniswap (DeFi Llama) prices
  let fallbackPriceData: Array<{ timestamp: number; price: number }> = [];
  try {
    const uni = new UniswapSpotExchange();
    const symbol = coin.endsWith("USDT") ? coin : `${coin}USDT`;
    fallbackPriceData = await uni.fetchPrices(symbol, startTime, endTime);
  } catch {
    fallbackPriceData = [];
  }

  // ── BasisOS: Compute risk-adjusted leverage (RLmax) from price data ──
  const bestPriceData = fallbackPriceData.length > 0
    ? fallbackPriceData
    : Array.from(priceCache.values()).find(p => p.length > 50) ?? [];

  const riskLeverage = bestPriceData.length > 30
    ? calcRiskAdjustedLeverage(bestPriceData, 5, 2, 0.05)
    : null;

  // Generate leverage configurations to test based on RLmax
  const leverageConfigs: Array<{ minLeverage: number; targetLeverage: number; maxLeverage: number }> = [];
  if (riskLeverage && riskLeverage.rlmax > 1) {
    const rlmax = riskLeverage.rlmax;
    // Test several configurations within the safe range
    for (let target = 2; target <= Math.min(rlmax, 8); target++) {
      const min = Math.max(1, target - 2);
      const max = Math.min(rlmax, target + 3);
      leverageConfigs.push({ minLeverage: min, targetLeverage: target, maxLeverage: max });
    }
    // Also test the "optimal" config (target at midpoint of safe range)
    const midTarget = Math.round(rlmax * 0.5);
    if (!leverageConfigs.some(c => c.targetLeverage === midTarget)) {
      leverageConfigs.push({
        minLeverage: Math.max(1, midTarget - 2),
        targetLeverage: midTarget,
        maxLeverage: Math.min(rlmax, midTarget + 3),
      });
    }
  } else {
    // Fallback: test standard configurations
    leverageConfigs.push(
      { minLeverage: 1, targetLeverage: 2, maxLeverage: 4 },
      { minLeverage: 1, targetLeverage: 3, maxLeverage: 5 },
      { minLeverage: 2, targetLeverage: 4, maxLeverage: 6 },
    );
  }

  const results: OptimizationResult[] = [];

  // Total iterations: combos × leverageConfigs × exitModes
  const exitModes = [false, true];
  const totalIterations = combos.length * leverageConfigs.length * exitModes.length;
  let iteration = 0;

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i];

    try {
      let ratesA: FundingRateEntry[];
      let ratesB: FundingRateEntry[];
      let feeA: FeeModel;
      let feeB: FeeModel;

      if (combo.strategy === "spot_vs_perp") {
        const perpKey = `perp_${combo.perpB}`;
        const perpRates = fundingCache.get(perpKey) || [];
        if (perpRates.length === 0) continue;

        ratesA = perpRates;
        ratesB = perpRates.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));

        feeA = EXCHANGE_FEES[combo.perpA] ?? { takerFeeBps: 0, makerFeeBps: 0, avgSpreadBps: 0 };
        feeB = EXCHANGE_FEES[combo.perpB] ?? EXCHANGE_FEES.hyperliquid;
      } else {
        const keyA = `perp_${combo.perpA}`;
        const keyB = `perp_${combo.perpB}`;
        ratesA = fundingCache.get(keyA) || [];
        ratesB = fundingCache.get(keyB) || [];
        if (ratesA.length === 0 || ratesB.length === 0) continue;

        feeA = EXCHANGE_FEES[combo.perpA] ?? EXCHANGE_FEES.hyperliquid;
        feeB = EXCHANGE_FEES[combo.perpB] ?? EXCHANGE_FEES.aster;
      }

      // Resolve price data
      let priceDataA: Array<{ timestamp: number; price: number }>;
      let priceDataB: Array<{ timestamp: number; price: number }>;

      if (combo.strategy === "spot_vs_perp") {
        priceDataA = priceCache.get(`price_${combo.perpA}`) || fallbackPriceData;
        priceDataB = priceCache.get(`price_${combo.perpB}`) || fallbackPriceData;
        if (priceDataA.length === 0 && priceDataB.length > 0) priceDataA = priceDataB;
        if (priceDataB.length === 0 && priceDataA.length > 0) priceDataB = priceDataA;
      } else {
        priceDataA = priceCache.get(`price_${combo.perpA}`) || fallbackPriceData;
        priceDataB = priceCache.get(`price_${combo.perpB}`) || fallbackPriceData;
        if (priceDataA.length === 0) priceDataA = fallbackPriceData;
        if (priceDataB.length === 0) priceDataB = fallbackPriceData;
      }

      let bestResult: OptimizationResult | null = null;

      // Test each leverage config × exit mode
      for (const levCfg of leverageConfigs) {
        for (const exitOnNeg of exitModes) {
          iteration++;
          if (iteration % 10 === 0) {
            onProgress?.(iteration, totalIterations, combo);
          }

          const rebalance: RebalanceConfig = {
            enabled: true,
            minLeverage: levCfg.minLeverage,
            targetLeverage: levCfg.targetLeverage,
            maxLeverage: levCfg.maxLeverage,
            deviationThreshold: 0.15,
          };

          const config: Partial<BacktestConfig> = {
            initialCapital: capital,
            strategy: combo.strategy,
            fundingThreshold: 0.00001,
            maxSpreadBps: 100,
            maxPositionSize: capital * 0.5,
            venueA: combo.perpA,
            venueB: combo.perpB,
            feeA,
            feeB,
            useMakerFees: false,
            exitOnNegativeFunding: exitOnNeg,
            perpLeverageA: combo.strategy === "perp_vs_perp" ? levCfg.targetLeverage : 1,
            perpLeverageB: combo.strategy === "perp_vs_perp" ? levCfg.targetLeverage : levCfg.targetLeverage,
            priceData: fallbackPriceData,
            priceDataA,
            priceDataB,
            rebalance,
            coin,
          };

          const result = runBacktest(ratesA, ratesB, config);
          const netPnl = result.totalPnl;

          // Compute objective function
          const objectiveResult = calcObjectiveFunction(
            result.pnlHistory,
            result.timestamps,
            capital,
            levCfg,
            { alpha: 0.5, beta: 0.3 },
          );

          const score = calcScore(netPnl, result.maxDrawdownPct, objectiveResult);

          const entry: OptimizationResult = {
            combo,
            result,
            netPnl,
            totalFees: result.totalFees,
            apy: result.annualizedReturn * 100,
            maxDrawdownPct: result.maxDrawdownPct * 100,
            score,
            exitOnNegative: exitOnNeg,
            objectiveResult,
            leverageConfig: levCfg,
            riskLeverage,
            rebalanceEnabled: true,
          };

          if (!bestResult || entry.score > bestResult.score) {
            bestResult = entry;
          }
        }
      }

      if (bestResult) results.push(bestResult);
    } catch {
      // Skip failed combos
    }
  }

  // Sort by objective function score
  results.sort((a, b) => b.score - a.score);

  return results;
}

// === Multi-Perp Optimization: 1 Spot vs N Perps ===

export interface MultiPerpCombo {
  strategy: "spot_vs_multi_perp";
  spotId: string;
  perpVenues: string[];
  label: string;
  legCount: number;
}

export interface MultiPerpOptResult {
  combo: MultiPerpCombo;
  result: BacktestResult;
  netPnl: number;
  totalFees: number;
  score: number;
  exitOnNegative: boolean;
}

// Generate top-N combinations of N perp venues from the available pool
function* combinations<T>(arr: T[], n: number): Generator<T[]> {
  if (n === 0) { yield []; return; }
  for (let i = 0; i <= arr.length - n; i++) {
    for (const rest of combinations(arr.slice(i + 1), n - 1)) {
      yield [arr[i], ...rest];
    }
  }
}

function generateMultiPerpCombos(perpVenueIds: string[], maxLegs: number): MultiPerpCombo[] {
  const combos: MultiPerpCombo[] = [];
  // Test 2, 3, 4, 5 leg combos (from highest funding venues)
  for (let n = 2; n <= Math.min(maxLegs, perpVenueIds.length); n++) {
    // To keep combinations manageable, take top venues by data availability
    // and limit to first 8 candidates
    const candidates = perpVenueIds.slice(0, Math.min(8, perpVenueIds.length));
    for (const perps of combinations(candidates, n)) {
      const names = perps.map((id) => {
        const p = getPerpExchange(id);
        return p?.info.name ?? id;
      });
      combos.push({
        strategy: "spot_vs_multi_perp",
        spotId: "uniswap",
        perpVenues: perps,
        label: `Spot vs ${names.join(" + ")}`,
        legCount: n,
      });
    }
  }
  return combos;
}

export async function optimizeMultiPerp(
  coin: string,
  days: number,
  capital: number,
  maxLegs: number = 4,
  onProgress?: (current: number, total: number, combo: MultiPerpCombo) => void
): Promise<MultiPerpOptResult[]> {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  // Fetch funding data for all perp venues
  const fundingCache = new Map<string, FundingRateEntry[]>();
  const perpVenueIds = perpExchanges.map((e) => e.info.id);

  for (const venueId of perpVenueIds) {
    try {
      const data = await fetchVenueFunding(venueId, coin, startTime, endTime);
      fundingCache.set(venueId, data);
    } catch {
      fundingCache.set(venueId, []);
    }
  }

  // Only use venues that have data
  const validVenueIds = perpVenueIds.filter((id) => (fundingCache.get(id)?.length ?? 0) > 0);

  // Fetch spot price data
  let spotPriceData: Array<{ timestamp: number; price: number }> = [];
  try {
    const uni = new UniswapSpotExchange();
    const symbol = coin.endsWith("USDT") ? coin : `${coin}USDT`;
    spotPriceData = await uni.fetchPrices(symbol, startTime, endTime);
  } catch {}

  // Fetch per-venue price data
  const priceCache = new Map<string, Array<{ timestamp: number; price: number }>>();
  for (const venueId of validVenueIds) {
    try {
      const data = await fetchVenuePrices(venueId, coin, startTime, endTime);
      priceCache.set(venueId, data);
    } catch {
      priceCache.set(venueId, []);
    }
  }

  // Also fetch single-perp results for comparison
  const singleResults: OptimizationResult[] = [];
  for (const venueId of validVenueIds) {
    const ratesB = fundingCache.get(venueId) || [];
    if (ratesB.length === 0) continue;
    const ratesA = ratesB.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
    const feeA = EXCHANGE_FEES["uniswap"] ?? EXCHANGE_FEES.hyperliquid;
    const feeB = EXCHANGE_FEES[venueId] ?? EXCHANGE_FEES.hyperliquid;

    const config: Partial<BacktestConfig> = {
      initialCapital: capital,
      strategy: "spot_vs_perp",
      fundingThreshold: 0.00001,
      maxSpreadBps: 100,
      maxPositionSize: capital * 0.5,
      venueA: "uniswap",
      venueB: venueId,
      feeA,
      feeB,
      perpLeverageA: 1,
      perpLeverageB: 3,
      priceData: spotPriceData,
      priceDataA: spotPriceData,
      priceDataB: priceCache.get(venueId) || spotPriceData,
    };
    const result = runBacktest(ratesA, ratesB, config);
    const objResult = calcObjectiveFunction(result.pnlHistory, result.timestamps, capital, { minLeverage: 1, targetLeverage: 3, maxLeverage: 5 });
    singleResults.push({
      combo: { strategy: "spot_vs_perp", spotId: "uniswap", perpA: "uniswap", perpB: venueId, label: `Spot vs ${getPerpExchange(venueId)?.info.name ?? venueId}` },
      result,
      netPnl: result.totalPnl,
      totalFees: result.totalFees,
      apy: result.annualizedReturn * 100,
      maxDrawdownPct: result.maxDrawdownPct * 100,
      score: calcScore(result.totalPnl, result.maxDrawdownPct, objResult),
      exitOnNegative: false,
      objectiveResult: objResult,
      leverageConfig: { minLeverage: 1, targetLeverage: 3, maxLeverage: 5 },
      riskLeverage: null,
      rebalanceEnabled: false,
    });
  }

  // Generate multi-perp combos
  const multiCombos = generateMultiPerpCombos(validVenueIds, maxLegs);
  const multiResults: MultiPerpOptResult[] = [];

  for (let i = 0; i < multiCombos.length; i++) {
    const combo = multiCombos[i];
    onProgress?.(i + 1, multiCombos.length, combo);

    // Get rates for each leg
    const ratesBMulti = combo.perpVenues.map((id) => fundingCache.get(id) || []);
    if (ratesBMulti.some((r) => r.length === 0)) continue;

    const feesBMulti = combo.perpVenues.map((id) => EXCHANGE_FEES[id] ?? EXCHANGE_FEES.hyperliquid);
    const priceDataBMulti = combo.perpVenues.map((id) => priceCache.get(id) || spotPriceData);

    // Use first perp's funding for the spot leg timing
    const ratesA = ratesBMulti[0].map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));

    for (const exitOnNeg of [false, true]) {
      const config: Partial<BacktestConfig> = {
        initialCapital: capital,
        strategy: "spot_vs_multi_perp",
        fundingThreshold: 0.00001,
        maxSpreadBps: 100,
        maxPositionSize: capital * 0.5,
        venueA: "uniswap",
        venueB: combo.perpVenues[0],
        feeA: EXCHANGE_FEES["uniswap"] ?? EXCHANGE_FEES.hyperliquid,
        feeB: feesBMulti[0],
        perpLeverageA: 1,
        perpLeverageB: 3,
        useMakerFees: false,
        exitOnNegativeFunding: exitOnNeg,
        priceData: spotPriceData,
        priceDataA: spotPriceData,
        priceDataB: priceDataBMulti[0],
        ratesBMulti,
        feesBMulti,
        venuesBMulti: combo.perpVenues,
        priceDataBMulti,
        multiPerpCount: combo.legCount,
      };

      const result = runBacktest(ratesA, ratesBMulti[0], config);
      const score = calcScore(result.totalPnl, result.maxDrawdownPct);

      multiResults.push({
        combo,
        result,
        netPnl: result.totalPnl,
        totalFees: result.totalFees,
        score,
        exitOnNegative: exitOnNeg,
      });
    }
  }

  multiResults.sort((a, b) => b.score - a.score);

  // Log single-perp summary
  if (singleResults.length > 0) {
    const bestSingle = singleResults.sort((a, b) => b.score - a.score)[0];
    console.log(`\n  Best single-perp: ${bestSingle.combo.label} | PnL: $${bestSingle.netPnl.toFixed(0)} | Score: ${bestSingle.score.toFixed(0)}`);
    if (multiResults.length > 0) {
      const bestMulti = multiResults[0];
      console.log(`  Best multi-perp (${bestMulti.combo.legCount} legs): ${bestMulti.combo.label} | PnL: $${bestMulti.netPnl.toFixed(0)} | Score: ${bestMulti.score.toFixed(0)}`);
      const improvement = bestSingle.netPnl > 0
        ? ((bestMulti.netPnl - bestSingle.netPnl) / Math.abs(bestSingle.netPnl) * 100).toFixed(1)
        : "n/a";
      console.log(`  Improvement: ${improvement}%`);
    }
  }

  return multiResults;
}
