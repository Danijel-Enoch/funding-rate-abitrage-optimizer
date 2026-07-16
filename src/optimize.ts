/**
 * Backtest Optimization Engine
 *
 * Tests all strategy/venue combinations for a given coin
 * and ranks them by net PnL with minimal drawdown.
 *
 * Includes realistic fees (taker/maker) and bid-ask spread costs.
 * Perp vs Perp uses 3x leverage on both sides.
 */

import { perpExchanges, spotExchanges, getPerpExchange, getSpotExchange } from "./exchanges";
import { UniswapSpotExchange } from "./exchanges/uniswap";
import { runBacktest, EXCHANGE_FEES, type BacktestConfig, type BacktestResult, type FeeModel } from "./backtest";
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

// Score = PnL - (max drawdown * penalty factor)
// We want high PnL AND low drawdown
function calcScore(pnl: number, maxDrawdownPct: number): number {
  const ddPenalty = maxDrawdownPct * 1000; // 1% DD = $1000 penalty on $50k
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
  const combos = getAllCombos(isTraditional); // For traditional, only perp_vs_perp
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  const fundingCache = new Map<string, FundingRateEntry[]>();
  const priceCache = new Map<string, Array<{ timestamp: number; price: number }>>();
  const perpVenueIds = new Set<string>();
  const allVenueIds = new Set<string>();

  for (const combo of combos) {
    if (combo.strategy === "spot_vs_perp") {
      allVenueIds.add(combo.perpA); // spot venue
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

  // Fetch price data from each venue for inter-exchange price spread tracking
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

  // Fallback: fetch Uniswap (DeFi Llama) prices as a reference when venue-specific data is missing
  let fallbackPriceData: Array<{ timestamp: number; price: number }> = [];
  try {
    const uni = new UniswapSpotExchange();
    const symbol = coin.endsWith("USDT") ? coin : `${coin}USDT`;
    fallbackPriceData = await uni.fetchPrices(symbol, startTime, endTime);
  } catch {
    fallbackPriceData = [];
  }

  const results: OptimizationResult[] = [];

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i];
    onProgress?.(i + 1, combos.length, combo);

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

      // Test both modes: hold through negative AND exit on negative
      // Pick whichever gives better PnL for this combo
      let bestResult: OptimizationResult | null = null;

      for (const exitOnNeg of [false, true]) {
        // Resolve per-exchange price data: use venue-specific data, falling back to Uniswap/DeFi Llama
        let priceDataA: Array<{ timestamp: number; price: number }>;
        let priceDataB: Array<{ timestamp: number; price: number }>;

        if (combo.strategy === "spot_vs_perp") {
          // Leg A = spot venue, Leg B = perp venue
          priceDataA = priceCache.get(`price_${combo.perpA}`) || fallbackPriceData;
          priceDataB = priceCache.get(`price_${combo.perpB}`) || fallbackPriceData;
          // If spot venue has no data but perp venue does, use perp data for both
          if (priceDataA.length === 0 && priceDataB.length > 0) priceDataA = priceDataB;
          if (priceDataB.length === 0 && priceDataA.length > 0) priceDataB = priceDataA;
        } else {
          // Perp vs Perp: fetch from each perp venue's corresponding spot exchange
          priceDataA = priceCache.get(`price_${combo.perpA}`) || fallbackPriceData;
          priceDataB = priceCache.get(`price_${combo.perpB}`) || fallbackPriceData;
          // If a perp venue has no spot price data, use fallback for that side
          if (priceDataA.length === 0) priceDataA = fallbackPriceData;
          if (priceDataB.length === 0) priceDataB = fallbackPriceData;
        }

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
          perpLeverageA: combo.strategy === "perp_vs_perp" ? 3 : 2,
          perpLeverageB: combo.strategy === "perp_vs_perp" ? 3 : 2,
          priceData: fallbackPriceData,
          priceDataA,
          priceDataB,
        };

        const result = runBacktest(ratesA, ratesB, config);
        const netPnl = result.totalPnl;
        const score = calcScore(netPnl, result.maxDrawdownPct);

        const entry: OptimizationResult = {
          combo,
          result,
          netPnl,
          totalFees: result.totalFees,
          apy: result.annualizedReturn * 100,
          maxDrawdownPct: result.maxDrawdownPct * 100,
          score,
          exitOnNegative: exitOnNeg,
        };

        if (!bestResult || entry.score > bestResult.score) {
          bestResult = entry;
        }
      }

      if (bestResult) results.push(bestResult);
    } catch {
      // Skip failed combos
    }
  }

  // Sort by composite score (PnL - drawdown penalty)
  results.sort((a, b) => b.score - a.score);

  return results;
}
