/**
 * Funding Rate Duration Analysis — Multi-Period
 * Analyzes how long positive and negative funding lasted for each market
 * across all exchanges over past 30 and 180 days.
 * Run: bun run src/funding-duration.ts [days]
 * Default: runs both 30 and 180 day analyses
 */

import { perpExchanges } from "./exchanges/index";
import type { FundingRateEntry } from "./exchanges/types";

const TOP_MARKETS = [
  // L1
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "NEAR", "SUI", "TON",
  // L2
  "ARB", "OP",
  // DeFi
  "UNI", "AAVE", "ENA", "MKR", "CRV", "LDO", "DYDX", "PENDLE",
  // AI
  "FET", "RENDER", "TAO", "VIRTUAL",
  // Meme
  "PEPE", "WIF", "BONK", "TRUMP", "FARTCOIN", "SHIB", "POPCAT",
  // Infra
  "INJ", "TIA", "EIGEN", "HYPE", "BERA",
  // Gaming
  "AXS", "SAND",
  // Oracle
  "API3",
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

async function fetchAllRates(
  exchange: any,
  coin: string,
  startTime: number,
  endTime: number,
): Promise<FundingRateEntry[]> {
  const days = (endTime - startTime) / (24 * 60 * 60 * 1000);
  const perCoinTimeout = days > 90 ? 45000 : 20000;
  try {
    return await Promise.race([
      exchange.fetchFundingRates(coin, startTime, endTime),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), perCoinTimeout),
      ),
    ]);
  } catch {
    return [];
  }
}

function analyzeStreaks(
  rates: FundingRateEntry[],
  coin: string,
  exchangeId: string,
): StreakStats | null {
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

  for (let i = 0; i < rates.length; i++) {
    const rate = rates[i].fundingRate;
    const isPositive = rate >= 0;

    if (isPositive) {
      totalPositiveHours++;
      if (currentStreakType === "positive") {
        currentStreakLength++;
      } else {
        if (currentStreakType === "negative" && currentStreakLength > 0) {
          totalNegativeStreaks++;
          sumNegativeStreaks += currentStreakLength;
          longestNegativeHours = Math.max(
            longestNegativeHours,
            currentStreakLength,
          );
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
          longestPositiveHours = Math.max(
            longestPositiveHours,
            currentStreakLength,
          );
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
    coin,
    exchange: exchangeId,
    totalPositiveHours,
    totalNegativeHours,
    longestPositiveHours,
    longestNegativeHours,
    avgPositiveStreak:
      totalPositiveStreaks > 0 ? sumPositiveStreaks / totalPositiveStreaks : 0,
    avgNegativeStreak:
      totalNegativeStreaks > 0 ? sumNegativeStreaks / totalNegativeStreaks : 0,
    positiveStreaks: totalPositiveStreaks,
    negativeStreaks: totalNegativeStreaks,
    positivePctOfTime:
      totalHours > 0 ? (totalPositiveHours / totalHours) * 100 : 0,
  };
}

function fmtHours(hours: number): string {
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`;
  return `${hours.toFixed(0)}h`;
}

function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function printPerExchangeTable(
  exchangeName: string,
  stats: StreakStats[],
) {
  if (stats.length === 0) return;

  console.log();
  console.log(`${"=".repeat(130)}`);
  console.log(`  ${exchangeName.toUpperCase()}`);
  console.log(`${"=".repeat(130)}`);
  console.log();
  console.log(
    "  " +
      "Market".padEnd(10) +
      "Pos%".padStart(7) +
      "Neg%".padStart(7) +
      "Longest+".padStart(11) +
      "Longest-".padStart(11) +
      "Avg+".padStart(9) +
      "Avg-".padStart(9) +
      "#+".padStart(5) +
      "#-".padStart(5) +
      "Time+".padStart(10) +
      "Time-".padStart(10),
  );
  console.log("  " + "-".repeat(100));

  stats.sort((a, b) => b.positivePctOfTime - a.positivePctOfTime);

  for (const s of stats) {
    console.log(
      "  " +
        s.coin.padEnd(10) +
        fmtPct(s.positivePctOfTime).padStart(7) +
        fmtPct(100 - s.positivePctOfTime).padStart(7) +
        fmtHours(s.longestPositiveHours).padStart(11) +
        fmtHours(s.longestNegativeHours).padStart(11) +
        fmtHours(s.avgPositiveStreak).padStart(9) +
        fmtHours(s.avgNegativeStreak).padStart(9) +
        String(s.positiveStreaks).padStart(5) +
        String(s.negativeStreaks).padStart(5) +
        fmtHours(s.totalPositiveHours).padStart(10) +
        fmtHours(s.totalNegativeHours).padStart(10),
    );
  }
}

function printCrossExchangeSummary(allStats: StreakStats[]) {
  console.log();
  console.log(`${"=".repeat(130)}`);
  console.log(`  CROSS-EXCHANGE SUMMARY`);
  console.log(`${"=".repeat(130)}`);
  console.log();

  const coinMap = new Map<string, StreakStats[]>();
  for (const s of allStats) {
    if (!coinMap.has(s.coin)) coinMap.set(s.coin, []);
    coinMap.get(s.coin)!.push(s);
  }

  console.log(
    "  " +
      "Market".padEnd(10) +
      "Exch".padStart(5) +
      "Avg Pos%".padStart(10) +
      "Min Pos%".padStart(10) +
      "Max Pos%".padStart(10) +
      "Avg Longest+".padStart(14) +
      "Avg Longest-".padStart(14) +
      "Avg Neg Streak".padStart(16) +
      "Max Neg Streak".padStart(16),
  );
  console.log("  " + "-".repeat(110));

  interface SummaryRow {
    coin: string;
    count: number;
    avgPosPct: number;
    minPosPct: number;
    maxPosPct: number;
    avgLongestPos: number;
    avgLongestNeg: number;
    avgNegStreak: number;
    maxNegStreak: number;
  }

  const rows: SummaryRow[] = [];
  for (const [coin, stats] of coinMap) {
    const count = stats.length;
    const avgPosPct =
      stats.reduce((s, x) => s + x.positivePctOfTime, 0) / count;
    const minPosPct = Math.min(...stats.map((s) => s.positivePctOfTime));
    const maxPosPct = Math.max(...stats.map((s) => s.positivePctOfTime));
    const avgLongestPos =
      stats.reduce((s, x) => s + x.longestPositiveHours, 0) / count;
    const avgLongestNeg =
      stats.reduce((s, x) => s + x.longestNegativeHours, 0) / count;
    const avgNegStreak =
      stats.reduce((s, x) => s + x.avgNegativeStreak, 0) / count;
    const maxNegStreak = Math.max(
      ...stats.map((s) => s.longestNegativeHours),
    );
    rows.push({
      coin,
      count,
      avgPosPct,
      minPosPct,
      maxPosPct,
      avgLongestPos,
      avgLongestNeg,
      avgNegStreak,
      maxNegStreak,
    });
  }

  rows.sort((a, b) => b.avgPosPct - a.avgPosPct);

  for (const r of rows) {
    console.log(
      "  " +
        r.coin.padEnd(10) +
        String(r.count).padStart(5) +
        fmtPct(r.avgPosPct).padStart(10) +
        fmtPct(r.minPosPct).padStart(10) +
        fmtPct(r.maxPosPct).padStart(10) +
        fmtHours(r.avgLongestPos).padStart(14) +
        fmtHours(r.avgLongestNeg).padStart(14) +
        fmtHours(r.avgNegStreak).padStart(16) +
        fmtHours(r.maxNegStreak).padStart(16),
    );
  }
}

async function runAnalysis(days: number) {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  console.log();
  console.log(`${"=".repeat(130)}`);
  console.log(
    `  FUNDING RATE DURATION — PAST ${days} DAYS (${TOP_MARKETS.length} markets)`,
  );
  console.log(`${"=".repeat(130)}`);
  console.log();
  console.log(
    `  Period: ${new Date(startTime).toLocaleDateString()} → ${new Date(endTime).toLocaleDateString()}`,
  );
  console.log(
    `  Exchanges: ${perpExchanges.map((e) => e.info.name).join(", ")}`,
  );
  console.log(`  Markets: ${TOP_MARKETS.join(", ")}`);
  console.log();

  const allStats: StreakStats[] = [];

  for (const exchange of perpExchanges) {
    console.log(`  Fetching ${exchange.info.name}...`);

    let completed = 0;
    const coinPromises = TOP_MARKETS.map(async (coin) => {
      const rates = await fetchAllRates(exchange, coin, startTime, endTime);
      completed++;
      if (completed % 10 === 0) {
        console.log(`    ${exchange.info.name}: ${completed}/${TOP_MARKETS.length} done`);
      }
      if (rates.length === 0) return;
      const stats = analyzeStreaks(rates, coin, exchange.info.id);
      if (stats) allStats.push(stats);
    });

    const exchangePromise = Promise.allSettled(coinPromises);

    const timeoutMs = days > 90 ? 600000 : 180000;
    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.log(`    ${exchange.info.name} timed out after ${completed} coins`);
        resolve();
      }, timeoutMs),
    );

    await Promise.race([exchangePromise, timeoutPromise]);
    console.log(`    ${exchange.info.name}: ${completed}/${TOP_MARKETS.length} coins fetched`);
  }

  // Per-exchange tables
  for (const exchange of perpExchanges) {
    const stats = allStats.filter((s) => s.exchange === exchange.info.id);
    printPerExchangeTable(exchange.info.name, stats);
  }

  // Cross-exchange summary
  printCrossExchangeSummary(allStats);

  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Single period
    const days = parseInt(args[0]);
    if (isNaN(days) || days <= 0) {
      console.error("Usage: bun run src/funding-duration.ts [days]");
      process.exit(1);
    }
    await runAnalysis(days);
  } else {
    // Run both 30 and 180 day analyses
    await runAnalysis(30);
    await runAnalysis(180);
  }
}

main().catch(console.error);
