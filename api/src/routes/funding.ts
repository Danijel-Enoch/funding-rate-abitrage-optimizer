import { Elysia, t } from "elysia";
import { perpExchanges } from "../../../src/exchanges";
import type { FundingRateEntry } from "../../../src/exchanges/types";

const TOP_MARKETS = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "NEAR", "SUI", "TON",
  "ARB", "OP", "UNI", "AAVE", "ENA", "MKR", "CRV", "LDO", "DYDX", "PENDLE",
  "FET", "RENDER", "TAO", "VIRTUAL",
  "PEPE", "WIF", "BONK", "TRUMP", "FARTCOIN", "SHIB", "POPCAT",
  "INJ", "TIA", "EIGEN", "HYPE", "BERA",
];

interface StreakStats {
  coin: string;
  exchange: string;
  totalPositiveHours: number;
  totalNegativeHours: number;
  longestPositiveHours: number;
  longestNegativeHours: number;
  avgPositiveStreak: number;
  avgNegativeStreak: number;
  positiveStreaks: number;
  negativeStreaks: number;
  positivePctOfTime: number;
}

function analyzeStreaks(rates: FundingRateEntry[], coin: string, exchangeId: string): StreakStats | null {
  if (rates.length < 10) return null;
  rates.sort((a, b) => a.timestamp - b.timestamp);

  let currentStreakType: "positive" | "negative" | null = null;
  let currentStreakLength = 0;
  let totalPositiveHours = 0;
  let totalNegativeHours = 0;
  let longestPositiveHours = 0;
  let longestNegativeHours = 0;
  let totalPositiveStreaks = 0;
  let totalNegativeStreaks = 0;
  let sumPositiveStreaks = 0;
  let sumNegativeStreaks = 0;

  for (const rate of rates) {
    const isPositive = rate.fundingRate >= 0;
    if (isPositive) {
      totalPositiveHours++;
      if (currentStreakType === "positive") {
        currentStreakLength++;
      } else {
        if (currentStreakType === "negative" && currentStreakLength > 0) {
          totalNegativeStreaks++;
          sumNegativeStreaks += currentStreakLength;
          longestNegativeHours = Math.max(longestNegativeHours, currentStreakLength);
        }
        currentStreakType = "positive";
        currentStreakLength = 1;
        totalPositiveStreaks++;
      }
    } else {
      totalNegativeHours++;
      if (currentStreakType === "negative") {
        currentStreakLength++;
      } else {
        if (currentStreakType === "positive" && currentStreakLength > 0) {
          sumPositiveStreaks += currentStreakLength;
          longestPositiveHours = Math.max(longestPositiveHours, currentStreakLength);
        }
        currentStreakType = "negative";
        currentStreakLength = 1;
        totalNegativeStreaks++;
      }
    }
  }
  if (currentStreakType === "positive" && currentStreakLength > 0) {
    sumPositiveStreaks += currentStreakLength;
    longestPositiveHours = Math.max(longestPositiveHours, currentStreakLength);
  } else if (currentStreakType === "negative" && currentStreakLength > 0) {
    sumNegativeStreaks += currentStreakLength;
    longestNegativeHours = Math.max(longestNegativeHours, currentStreakLength);
  }

  const totalHours = totalPositiveHours + totalNegativeHours;
  return {
    coin, exchange: exchangeId,
    totalPositiveHours, totalNegativeHours,
    longestPositiveHours, longestNegativeHours,
    avgPositiveStreak: totalPositiveStreaks > 0 ? sumPositiveStreaks / totalPositiveStreaks : 0,
    avgNegativeStreak: totalNegativeStreaks > 0 ? sumNegativeStreaks / totalNegativeStreaks : 0,
    positiveStreaks: totalPositiveStreaks,
    negativeStreaks: totalNegativeStreaks,
    positivePctOfTime: totalHours > 0 ? (totalPositiveHours / totalHours) * 100 : 0,
  };
}

export const fundingRoutes = new Elysia()
  .get("/api/funding-duration", async ({ query }: { query: { days?: string; coins?: string } }) => {
    const days = parseInt(query.days ?? "30");
    const coins = query.coins
      ? query.coins.split(",").map((c) => c.toUpperCase())
      : TOP_MARKETS;
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;

    const allStats: StreakStats[] = [];

    // Fetch in batches to avoid overload
    const exchange = perpExchanges[0]; // Hyperliquid
    for (const coin of coins) {
      try {
        const rates = await Promise.race([
          exchange.fetchFundingRates(coin, startTime, endTime),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000)),
        ]);
        const stats = analyzeStreaks(rates, coin, exchange.info.id);
        if (stats) allStats.push(stats);
      } catch {
        // skip failed coins
      }
    }

    allStats.sort((a, b) => b.positivePctOfTime - a.positivePctOfTime);

    return {
      days,
      exchange: "Hyperliquid",
      count: allStats.length,
      stats: allStats,
    };
  }, {
    query: t.Object({
      days: t.Optional(t.String()),
      coins: t.Optional(t.String()),
    }),
  });
