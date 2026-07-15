/**
 * Correlation Analysis: Profitability vs Funding Rate Duration
 *
 * For each coin, computes:
 *   - Duration metrics from funding rate streaks (positive %, streak lengths, etc.)
 *   - Profitability from 30-day backtests (PnL, APY, drawdown, Sharpe, etc.)
 * Then calculates Pearson correlation coefficients between them.
 *
 * Usage: bun run src/correlation.ts [days]
 */

import { perpExchanges, spotExchanges, getPerpExchange } from "./exchanges";
import { runBacktest, EXCHANGE_FEES, type BacktestResult } from "./backtest";
import type { FundingRateEntry } from "./exchanges/types";
import { MARKETS, TRADITIONAL_MARKETS } from "./markets";

const COINS = [
  "BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT", "SUI",
  "ARB", "OP", "NEAR", "INJ", "TIA", "FET", "RENDER", "TAO",
  "ENA", "AAVE", "UNI", "MKR", "PENDLE", "DYDX", "LDO",
  "PEPE", "WIF", "BONK", "TRUMP", "POPCAT",
  "HYPE", "BERA", "EIGEN",
];

// Accept --coins flag to limit scope for faster runs
const FLAG_COINS = process.argv.find(a => a.startsWith("--coins="));
const ACTIVE_COINS = FLAG_COINS
  ? COINS.filter(c => FLAG_COINS.split("=")[1].split(",").includes(c))
  : COINS;

interface DurationMetrics {
  positivePct: number;
  longestPositiveHrs: number;
  longestNegativeHrs: number;
  avgPositiveStreak: number;
  avgNegativeStreak: number;
  positiveStreakCount: number;
  negativeStreakCount: number;
}

interface ProfitabilityMetrics {
  totalPnl: number;
  annualizedReturn: number;
  winRate: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalFees: number;
  totalTrades: number;
}

interface CoinData {
  coin: string;
  category: string;
  duration: DurationMetrics;
  profitability: ProfitabilityMetrics;
  exchangeCount: number;
}

// ─── Pearson Correlation ──────────────────────────────────────

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}

function correlationLabel(r: number): string {
  const abs = Math.abs(r);
  if (abs >= 0.7) return r > 0 ? "strong +" : "strong -";
  if (abs >= 0.4) return r > 0 ? "moderate +" : "moderate -";
  if (abs >= 0.2) return r > 0 ? "weak +" : "weak -";
  return "none";
}

// ─── Funding Rate Fetching ────────────────────────────────────

async function fetchRates(
  exchange: any,
  coin: string,
  startTime: number,
  endTime: number,
): Promise<FundingRateEntry[]> {
  try {
    return await Promise.race([
      exchange.fetchFundingRates(coin, startTime, endTime),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 20000),
      ),
    ]);
  } catch {
    return [];
  }
}

// ─── Streak Analysis ──────────────────────────────────────────

function analyzeStreaks(rates: FundingRateEntry[]): DurationMetrics | null {
  if (rates.length < 10) return null;

  rates.sort((a, b) => a.timestamp - b.timestamp);

  let currentType: "pos" | "neg" | null = null;
  let currentLen = 0;
  let totalPos = 0, totalNeg = 0;
  let longestPos = 0, longestNeg = 0;
  let posStreaks = 0, negStreaks = 0;
  let sumPosStreaks = 0, sumNegStreaks = 0;

  for (const r of rates) {
    const isPos = r.fundingRate >= 0;
    if (isPos) {
      totalPos++;
      if (currentType === "pos") {
        currentLen++;
      } else {
        if (currentType === "neg" && currentLen > 0) {
          negStreaks++;
          sumNegStreaks += currentLen;
          longestNeg = Math.max(longestNeg, currentLen);
        }
        currentType = "pos";
        currentLen = 1;
        posStreaks++;
      }
    } else {
      totalNeg++;
      if (currentType === "neg") {
        currentLen++;
      } else {
        if (currentType === "pos" && currentLen > 0) {
          posStreaks++;
          sumPosStreaks += currentLen;
          longestPos = Math.max(longestPos, currentLen);
        }
        currentType = "neg";
        currentLen = 1;
        negStreaks++;
      }
    }
  }

  if (currentType === "pos" && currentLen > 0) {
    posStreaks++;
    sumPosStreaks += currentLen;
    longestPos = Math.max(longestPos, currentLen);
  } else if (currentType === "neg" && currentLen > 0) {
    negStreaks++;
    sumNegStreaks += currentLen;
    longestNeg = Math.max(longestNeg, currentLen);
  }

  const total = totalPos + totalNeg;

  return {
    positivePct: total > 0 ? (totalPos / total) * 100 : 50,
    longestPositiveHrs: longestPos,
    longestNegativeHrs: longestNeg,
    avgPositiveStreak: posStreaks > 0 ? sumPosStreaks / posStreaks : 0,
    avgNegativeStreak: negStreaks > 0 ? sumNegStreaks / negStreaks : 0,
    positiveStreakCount: posStreaks,
    negativeStreakCount: negStreaks,
  };
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const DAYS = parseInt(process.argv[2] || "30");
  const CAPITAL = 50000;
  const endTime = Date.now();
  const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

  console.log("=".repeat(120));
  console.log(`  CORRELATION: PROFITABILITY vs FUNDING RATE DURATION — ${DAYS} DAYS`);
  console.log("=".repeat(120));
  console.log();
  console.log(`  Period: ${new Date(startTime).toLocaleDateString()} → ${new Date(endTime).toLocaleDateString()}`);
  console.log(`  Capital: $${CAPITAL.toLocaleString()}`);
  console.log(`  Exchanges: ${perpExchanges.map(e => e.info.name).join(", ")}`);
  console.log(`  Spot: ${spotExchanges.map(e => e.info.name).join(", ")}`);
  console.log(`  Markets: ${ACTIVE_COINS.length} coins`);
  console.log();

  // ─── Step 1: Fetch data per exchange ───────────────────────

  // coin → exchangeId → { rates, streaks }
  const exchangeData = new Map<string, Map<string, { rates: FundingRateEntry[]; streaks: DurationMetrics }>>();

  for (const exchange of perpExchanges) {
    console.log(`  Fetching ${exchange.info.name}...`);

    for (const coin of ACTIVE_COINS) {
      const rates = await fetchRates(exchange, coin, startTime, endTime);
      if (rates.length < 10) continue;

      const streaks = analyzeStreaks(rates);
      if (!streaks) continue;

      if (!exchangeData.has(coin)) exchangeData.set(coin, new Map());
      exchangeData.get(coin)!.set(exchange.info.id, { rates, streaks });
    }
  }

  console.log(`\n  Data fetched. Running backtests...\n`);

  // ─── Step 2: Run backtests and aggregate per coin ──────────

  const allData: CoinData[] = [];

  for (const coin of ACTIVE_COINS) {
    const exchMap = exchangeData.get(coin);
    if (!exchMap || exchMap.size === 0) continue;

    // Average duration metrics across exchanges
    const durationMetrics: DurationMetrics = {
      positivePct: 0,
      longestPositiveHrs: 0,
      longestNegativeHrs: 0,
      avgPositiveStreak: 0,
      avgNegativeStreak: 0,
      positiveStreakCount: 0,
      negativeStreakCount: 0,
    };

    const streaksList = Array.from(exchMap.values()).map(d => d.streaks);
    const n = streaksList.length;

    for (const s of streaksList) {
      durationMetrics.positivePct += s.positivePct;
      durationMetrics.longestPositiveHrs += s.longestPositiveHrs;
      durationMetrics.longestNegativeHrs += s.longestNegativeHrs;
      durationMetrics.avgPositiveStreak += s.avgPositiveStreak;
      durationMetrics.avgNegativeStreak += s.avgNegativeStreak;
      durationMetrics.positiveStreakCount += s.positiveStreakCount;
      durationMetrics.negativeStreakCount += s.negativeStreakCount;
    }
    for (const key of Object.keys(durationMetrics) as (keyof DurationMetrics)[]) {
      (durationMetrics as any)[key] /= n;
    }

    // Run backtest: Binance spot vs each perp exchange
    const profitMetrics: ProfitabilityMetrics = {
      totalPnl: 0,
      annualizedReturn: 0,
      winRate: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      totalFees: 0,
      totalTrades: 0,
    };

    let validBacktests = 0;

    for (const [exchangeId, { rates }] of Array.from(exchMap.entries())) {
      const perp = getPerpExchange(exchangeId);
      if (!perp) continue;

      const spotRates: FundingRateEntry[] = rates.map(r => ({
        ...r,
        fundingRate: 0,
        coin: "spot",
      }));

      const feeA = EXCHANGE_FEES["binance"] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 1 };
      const feeB = EXCHANGE_FEES[exchangeId] ?? EXCHANGE_FEES.hyperliquid;

      try {
        const result = runBacktest(rates, spotRates, {
          initialCapital: CAPITAL,
          strategy: "spot_vs_perp",
          venueA: "binance",
          venueB: exchangeId,
          feeA,
          feeB,
          useMakerFees: false,
          exitOnNegativeFunding: false,
          perpLeverage: 2,
        });

        profitMetrics.totalPnl += result.totalPnl;
        profitMetrics.annualizedReturn += result.annualizedReturn;
        profitMetrics.winRate += result.winRate;
        profitMetrics.maxDrawdownPct += result.maxDrawdownPct;
        profitMetrics.sharpeRatio += result.sharpeRatio;
        profitMetrics.totalFees += result.totalFees;
        profitMetrics.totalTrades += result.totalTrades;
        validBacktests++;
      } catch {
        // skip failed
      }
    }

    if (validBacktests === 0) continue;

    for (const key of Object.keys(profitMetrics) as (keyof ProfitabilityMetrics)[]) {
      (profitMetrics as any)[key] /= validBacktests;
    }

    // Get category
    const mkt = MARKETS.find(m => m.hlCoin === coin) || TRADITIONAL_MARKETS.find(m => m.hlCoin === coin);
    const category = mkt?.category ?? "Other";

    allData.push({
      coin,
      category,
      duration: durationMetrics,
      profitability: profitMetrics,
      exchangeCount: validBacktests,
    });
  }

  if (allData.length < 3) {
    console.log("  Not enough data points for correlation analysis.");
    return;
  }

  console.log(`  Computed metrics for ${allData.length} coins\n`);

  // ─── Step 3: Per-coin table ───────────────────────────────

  console.log("=".repeat(120));
  console.log("  PER-COIN DATA");
  console.log("=".repeat(120));
  console.log();

  console.log(
    "  " +
    "Coin".padEnd(8) +
    "Cat".padEnd(8) +
    "Exch".padStart(5) +
    "Pos%".padStart(7) +
    "Long+".padStart(9) +
    "Long-".padStart(9) +
    "PnL".padStart(12) +
    "APY".padStart(9) +
    "Win%".padStart(7) +
    "MDD%".padStart(8) +
    "Sharpe".padStart(8) +
    "Fees".padStart(10) +
    "Trades".padStart(7)
  );
  console.log("  " + "-".repeat(110));

  allData.sort((a, b) => b.profitability.totalPnl - a.profitability.totalPnl);

  for (const d of allData) {
    const pnl = `$${d.profitability.totalPnl.toFixed(0)}`.padStart(12);
    const apy = `${(d.profitability.annualizedReturn * 100).toFixed(1)}%`.padStart(9);
    const win = `${(d.profitability.winRate * 100).toFixed(0)}%`.padStart(7);
    const mdd = `${(d.profitability.maxDrawdownPct * 100).toFixed(1)}%`.padStart(8);
    const sharpe = d.profitability.sharpeRatio.toFixed(2).padStart(8);
    const fees = `$${d.profitability.totalFees.toFixed(0)}`.padStart(10);
    const trades = String(Math.round(d.profitability.totalTrades)).padStart(7);
    const longP = d.duration.longestPositiveHrs >= 48
      ? `${(d.duration.longestPositiveHrs / 24).toFixed(1)}d`
      : `${d.duration.longestPositiveHrs.toFixed(0)}h`;
    const longN = d.duration.longestNegativeHrs >= 48
      ? `${(d.duration.longestNegativeHrs / 24).toFixed(1)}d`
      : `${d.duration.longestNegativeHrs.toFixed(0)}h`;

    console.log(
      "  " +
      d.coin.padEnd(8) +
      d.category.padEnd(8) +
      String(d.exchangeCount).padStart(5) +
      `${d.duration.positivePct.toFixed(1)}%`.padStart(7) +
      longP.padStart(9) +
      longN.padStart(9) +
      pnl + apy + win + mdd + sharpe + fees + trades
    );
  }

  // ─── Step 4: Correlation matrix ───────────────────────────

  const durationKeys: [keyof DurationMetrics, string][] = [
    ["positivePct", "Positive %"],
    ["longestPositiveHrs", "Longest Pos"],
    ["longestNegativeHrs", "Longest Neg"],
    ["avgPositiveStreak", "Avg Pos Streak"],
    ["avgNegativeStreak", "Avg Neg Streak"],
    ["positiveStreakCount", "# Pos Streaks"],
    ["negativeStreakCount", "# Neg Streaks"],
  ];

  const profitKeys: [keyof ProfitabilityMetrics, string][] = [
    ["totalPnl", "PnL"],
    ["annualizedReturn", "APY"],
    ["winRate", "Win Rate"],
    ["maxDrawdownPct", "Max DD"],
    ["sharpeRatio", "Sharpe"],
    ["totalFees", "Total Fees"],
  ];

  console.log();
  console.log("=".repeat(120));
  console.log("  CORRELATION MATRIX (Pearson r)");
  console.log("=".repeat(120));
  console.log();

  // Header
  const colW = 12;
  const rowW = 18;
  console.log("  " + " ".repeat(rowW) + profitKeys.map(([, label]) => label.padStart(colW)).join(""));
  console.log("  " + "-".repeat(rowW + profitKeys.length * colW));

  for (const [dKey, dLabel] of durationKeys) {
    const x = allData.map(d => d.duration[dKey]);
    let row = `  ${dLabel.padEnd(rowW)}`;

    for (const [pKey] of profitKeys) {
      const y = allData.map(d => d.profitability[pKey]);
      const r = pearson(x, y);
      row += r.toFixed(2).padStart(colW);
    }

    console.log(row);
  }

  // ─── Step 5: Key insights ─────────────────────────────────

  console.log();
  console.log("=".repeat(120));
  console.log("  KEY INSIGHTS");
  console.log("=".repeat(120));
  console.log();

  // Find strongest correlations
  interface CorrelationPair {
    durationMetric: string;
    profitMetric: string;
    r: number;
  }

  const pairs: CorrelationPair[] = [];

  for (const [dKey, dLabel] of durationKeys) {
    const x = allData.map(d => d.duration[dKey]);
    for (const [pKey, pLabel] of profitKeys) {
      const y = allData.map(d => d.profitability[pKey]);
      pairs.push({ durationMetric: dLabel, profitMetric: pLabel, r: pearson(x, y) });
    }
  }

  // Sort by absolute correlation
  pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  console.log("  TOP 10 STRONGEST CORRELATIONS:");
  console.log();
  console.log("  " +
    "Duration Metric".padEnd(18) +
    "Profit Metric".padStart(14) +
    "r".padStart(8) +
    "  Strength"
  );
  console.log("  " + "-".repeat(60));

  for (const p of pairs.slice(0, 10)) {
    console.log(
      "  " +
      p.durationMetric.padEnd(18) +
      p.profitMetric.padStart(14) +
      p.r.toFixed(3).padStart(8) +
      `  ${correlationLabel(p.r)}`
    );
  }

  // Interpretation
  console.log();
  console.log("  INTERPRETATION:");
  console.log();

  const strongest = pairs[0];
  if (Math.abs(strongest.r) >= 0.5) {
    const dir = strongest.r > 0 ? "increases" : "decreases";
    console.log(`  • ${strongest.durationMetric} ${dir} ${strongest.profitMetric} (r=${strongest.r.toFixed(2)})`);
  }

  const negStreakDD = pairs.find(p => p.durationMetric === "Longest Neg" && p.profitMetric === "Max DD");
  if (negStreakDD && Math.abs(negStreakDD.r) >= 0.3) {
    console.log(`  • Longer negative funding streaks correlate with higher drawdown (r=${negStreakDD.r.toFixed(2)})`);
  }

  const posPctPnl = pairs.find(p => p.durationMetric === "Positive %" && p.profitMetric === "PnL");
  if (posPctPnl && Math.abs(posPctPnl.r) >= 0.3) {
    const dir = posPctPnl.r > 0 ? "higher" : "lower";
    console.log(`  • Higher positive funding % correlates with ${dir} PnL (r=${posPctPnl.r.toFixed(2)})`);
  }

  console.log();
  console.log("  " + "=".repeat(110));
}

main().catch(console.error);
