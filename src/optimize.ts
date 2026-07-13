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
  const spot = getSpotExchange(venueId);
  if (spot) {
    const symbol = coin.endsWith("USDT") ? coin : `${coin}USDT`;
    return spot.fetchPrices(symbol, startTime, endTime);
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
  const perpVenueIds = new Set<string>();
  const spotVenueIds = new Set<string>();

  for (const combo of combos) {
    if (combo.strategy === "spot_vs_perp") {
      spotVenueIds.add(combo.perpA);
      perpVenueIds.add(combo.perpB);
    } else {
      perpVenueIds.add(combo.perpA);
      perpVenueIds.add(combo.perpB);
    }
  }

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
