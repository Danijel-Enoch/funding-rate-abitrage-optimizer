/**
 * Funding Rate Duration Analysis
 * Analyzes how long positive and negative funding lasted for each market
 * across all exchanges over the past 30-180 days.
 */

import { perpExchanges } from "./exchanges/index";
import type { FundingRateEntry } from "./exchanges/types";

// Top coins to analyze (most liquid across exchanges)
const COINS = [
  "BTC", "ETH", "SOL", "DOGE", "XRP", "AVAX", "LINK",
  "ARB", "SUI", "NEAR", "AAVE", "UNI", "ENA", "WIF",
  "TIA", "RENDER", "FET", "INJ", "TON", "TRUMP", "PEPE"
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
  maxPositiveStreakDays: number;
  maxNegativeStreakDays: number;
  positivePctOfTime: number;
}

async function fetchAllRates(
  exchange: any,
  coin: string,
  startTime: number,
  endTime: number
): Promise<FundingRateEntry[]> {
  try {
    return await Promise.race([
      exchange.fetchFundingRates(coin, startTime, endTime),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
  } catch {
    return [];
  }
}

function analyzeStreaks(rates: FundingRateEntry[], coin: string, exchangeId: string): StreakStats | null {
  if (rates.length < 10) return null;

  // Sort by timestamp
  rates.sort((a, b) => a.timestamp - b.timestamp);

  // Calculate streaks
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

  for (let i = 0; i < rates.length; i++) {
    const rate = rates[i].fundingRate;
    const isPositive = rate >= 0;

    if (isPositive) {
      totalPositiveHours++;
      if (currentStreakType === "positive") {
        currentStreakLength++;
      } else {
        // New positive streak
        if (currentStreakType === "negative" && currentStreakLength > 0) {
          // End of negative streak
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
        // New negative streak
        if (currentStreakType === "positive" && currentStreakLength > 0) {
          // End of positive streak
          sumPositiveStreaks += currentStreakLength;
          longestPositiveHours = Math.max(longestPositiveHours, currentStreakLength);
        }
        currentStreakType = "negative";
        currentStreakLength = 1;
        totalNegativeStreaks++;
      }
    }
  }

  // Handle last streak
  if (currentStreakType === "positive" && currentStreakLength > 0) {
    sumPositiveStreaks += currentStreakLength;
    longestPositiveHours = Math.max(longestPositiveHours, currentStreakLength);
  } else if (currentStreakType === "negative" && currentStreakLength > 0) {
    sumNegativeStreaks += currentStreakLength;
    longestNegativeHours = Math.max(longestNegativeHours, currentStreakLength);
  }

  const totalHours = totalPositiveHours + totalNegativeHours;

  return {
    coin,
    exchange: exchangeId,
    totalPositiveHours,
    totalNegativeHours,
    longestPositiveHours,
    longestNegativeHours,
    avgPositiveStreak: totalPositiveStreaks > 0 ? sumPositiveStreaks / totalPositiveStreaks : 0,
    avgNegativeStreak: totalNegativeStreaks > 0 ? sumNegativeStreaks / totalNegativeStreaks : 0,
    positiveStreaks: totalPositiveStreaks,
    negativeStreaks: totalNegativeStreaks,
    maxPositiveStreakDays: longestPositiveHours / 24,
    maxNegativeStreakDays: longestNegativeHours / 24,
    positivePctOfTime: totalHours > 0 ? (totalPositiveHours / totalHours) * 100 : 0,
  };
}

function formatHours(hours: number): string {
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`;
  return `${hours}h`;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

async function main() {
  const DAYS = parseInt(process.argv[2] || "90");
  const endTime = Date.now();
  const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

  console.log("=".repeat(140));
  console.log(`  FUNDING RATE DURATION ANALYSIS — PAST ${DAYS} DAYS`);
  console.log("=".repeat(140));
  console.log();
  console.log(`  Period: ${new Date(startTime).toLocaleDateString()} to ${new Date(endTime).toLocaleDateString()}`);
  console.log(`  Exchanges: ${perpExchanges.map(e => e.info.name).join(", ")}`);
  console.log(`  Markets: ${COINS.length} coins`);
  console.log();

  const allStats: StreakStats[] = [];

  // Fetch and analyze for each exchange (with per-exchange timeout)
  for (const exchange of perpExchanges) {
    console.log(`  Fetching ${exchange.info.name}...`);

    const exchangePromise = (async () => {
      // Fetch all coins in parallel for this exchange
      const results = await Promise.allSettled(
        COINS.map(async (coin) => {
          const rates = await fetchAllRates(exchange, coin, startTime, endTime);
          if (rates.length === 0) return null;
          return analyzeStreaks(rates, coin, exchange.info.id);
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) allStats.push(r.value);
      }
    })();

    // Timeout per exchange: 60 seconds
    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.log(`    ${exchange.info.name} timed out, skipping...`);
        resolve();
      }, 60000)
    );

    await Promise.race([exchangePromise, timeoutPromise]);
  }

  // Print detailed table per exchange
  for (const exchange of perpExchanges) {
    const exchangeStats = allStats.filter(s => s.exchange === exchange.info.id);
    if (exchangeStats.length === 0) continue;

    console.log();
    console.log("=".repeat(140));
    console.log(`  ${exchange.info.name.toUpperCase()}`);
    console.log("=".repeat(140));
    console.log();

    // Header
    console.log(
      "  " +
      "Coin".padEnd(8) +
      "Pos%".padStart(7) +
      "Neg%".padStart(7) +
      "Longest+".padStart(10) +
      "Longest-".padStart(10) +
      "Avg+".padStart(8) +
      "Avg-".padStart(8) +
      "#+".padStart(5) +
      "#-".padStart(5) +
      "Total+".padStart(10) +
      "Total-".padStart(10)
    );
    console.log("  " + "-".repeat(120));

    // Sort by positive percentage
    exchangeStats.sort((a, b) => b.positivePctOfTime - a.positivePctOfTime);

    for (const s of exchangeStats) {
      console.log(
        "  " +
        s.coin.padEnd(8) +
        formatPct(s.positivePctOfTime).padStart(7) +
        formatPct(100 - s.positivePctOfTime).padStart(7) +
        formatHours(s.longestPositiveHours).padStart(10) +
        formatHours(s.longestNegativeHours).padStart(10) +
        formatHours(s.avgPositiveStreak).padStart(8) +
        formatHours(s.avgNegativeStreak).padStart(8) +
        String(s.positiveStreaks).padStart(5) +
        String(s.negativeStreaks).padStart(5) +
        formatHours(s.totalPositiveHours).padStart(10) +
        formatHours(s.totalNegativeHours).padStart(10)
      );
    }
  }

  // Print cross-exchange summary
  console.log();
  console.log("=".repeat(140));
  console.log("  CROSS-EXCHANGE SUMMARY");
  console.log("=".repeat(140));
  console.log();

  // Aggregate by coin
  const coinStats = new Map<string, StreakStats[]>();
  for (const s of allStats) {
    if (!coinStats.has(s.coin)) coinStats.set(s.coin, []);
    coinStats.get(s.coin)!.push(s);
  }

  console.log(
    "  " +
    "Coin".padEnd(8) +
    "Exchanges".padStart(10) +
    "Avg Pos%".padStart(10) +
    "Min Pos%".padStart(10) +
    "Max Pos%".padStart(10) +
    "Avg Longest+".padStart(14) +
    "Avg Longest-".padStart(14) +
    "Avg Longest+ (d)".padStart(18) +
    "Avg Longest- (d)".padStart(18)
  );
  console.log("  " + "-".repeat(120));

  const summaryData: Array<{
    coin: string;
    count: number;
    avgPosPct: number;
    minPosPct: number;
    maxPosPct: number;
    avgLongestPos: number;
    avgLongestNeg: number;
  }> = [];

  for (const [coin, stats] of coinStats) {
    const count = stats.length;
    const avgPosPct = stats.reduce((s, x) => s + x.positivePctOfTime, 0) / count;
    const minPosPct = Math.min(...stats.map(s => s.positivePctOfTime));
    const maxPosPct = Math.max(...stats.map(s => s.positivePctOfTime));
    const avgLongestPos = stats.reduce((s, x) => s + x.longestPositiveHours, 0) / count;
    const avgLongestNeg = stats.reduce((s, x) => s + x.longestNegativeHours, 0) / count;

    summaryData.push({
      coin,
      count,
      avgPosPct,
      minPosPct,
      maxPosPct,
      avgLongestPos,
      avgLongestNeg,
    });
  }

  // Sort by average positive percentage
  summaryData.sort((a, b) => b.avgPosPct - a.avgPosPct);

  for (const s of summaryData) {
    console.log(
      "  " +
      s.coin.padEnd(8) +
      String(s.count).padStart(10) +
      formatPct(s.avgPosPct).padStart(10) +
      formatPct(s.minPosPct).padStart(10) +
      formatPct(s.maxPosPct).padStart(10) +
      formatHours(s.avgLongestPos).padStart(14) +
      formatHours(s.avgLongestNeg).padStart(14) +
      `${(s.avgLongestPos / 24).toFixed(1)}d`.padStart(18) +
      `${(s.avgLongestNeg / 24).toFixed(1)}d`.padStart(18)
    );
  }

  // Print insights
  console.log();
  console.log("=".repeat(140));
  console.log("  KEY INSIGHTS FOR VAULT DESIGN");
  console.log("=".repeat(140));
  console.log();

  // Find best coins for basis trading
  const bestCoins = summaryData.filter(s => s.avgPosPct > 60 && s.count >= 3);
  const worstCoins = summaryData.filter(s => s.avgPosPct < 40);
  const volatileCoins = summaryData.filter(s => s.avgLongestNeg > 24);

  console.log("  BEST CANDIDATES (funding positive >60% of time on 3+ exchanges):");
  for (const s of bestCoins.slice(0, 5)) {
    console.log(`    ${s.coin.padEnd(8)} ${formatPct(s.avgPosPct)} positive, max negative streak: ${(s.avgLongestNeg / 24).toFixed(1)}d`);
  }

  console.log();
  console.log("  WORST CANDIDATES (funding positive <40% of time):");
  for (const s of worstCoins.slice(0, 5)) {
    console.log(`    ${s.coin.padEnd(8)} ${formatPct(s.avgPosPct)} positive, max negative streak: ${(s.avgLongestNeg / 24).toFixed(1)}d`);
  }

  console.log();
  console.log("  COINS WITH LONG NEGATIVE STREAKS (>24h avg):");
  for (const s of volatileCoins.slice(0, 5)) {
    console.log(`    ${s.coin.padEnd(8)} avg negative streak: ${(s.avgLongestNeg / 24).toFixed(1)}d, need flip strategy`);
  }

  // Calculate optimal flip threshold
  console.log();
  console.log("  FLIP STRATEGY RECOMMENDATIONS:");
  console.log("    If avg negative streak > 12h: Consider flipping positions");
  console.log("    If avg negative streak < 6h: Hold through negative periods");
  console.log("    If funding swings frequently: Use tighter flip threshold (2-3%)");
  console.log("    If funding is stable: Use wider flip threshold (5-10%)");
}

main().catch(console.error);
