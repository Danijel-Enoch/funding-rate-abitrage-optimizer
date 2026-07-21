/**
 * Basket Venue Pair Optimizer
 *
 * Finds the best venue pair for a basket of tokens/markets.
 * For a given basket, tests every venue pair across ALL tokens and
 * ranks them by aggregate performance.
 *
 * Answers: "Which exchange pair should I use for my whole basket?"
 *
 * Usage:
 *   bun run src/optimize-basket.ts BTC ETH SOL TRUMP PEPE [options]
 *   bun run src/optimize-basket.ts --category L1 [options]
 *
 * Options:
 *   --days <n>            Backtest period in days (default: 30)
 *   --capital <n>         Capital per position (default: 50000)
 *   --category <cat>      Use all coins in a category
 *   --min-profit <n>      Min net profit % for a venue pair to rank (default: 0)
 *   --exclude <coins>     Comma-separated coins to exclude
 *   --strategy <type>     Filter: spot_vs_perp, perp_vs_perp, or all (default: all)
 */

import { perpExchanges, spotExchanges, getPerpExchange, getSpotExchange } from "./exchanges";
import { UniswapSpotExchange } from "./exchanges/uniswap";
import {
  runBacktest, EXCHANGE_FEES,
  calcRiskAdjustedLeverage, calcObjectiveFunction,
  type BacktestConfig, type BacktestResult, type FeeModel,
  type RebalanceConfig, type RiskAdjustedLeverage, type ObjectiveFunctionResult,
} from "./backtest";
import { MARKETS, getMarketsByCategory, type MarketConfig } from "./markets";
import type { FundingRateEntry } from "./exchanges/types";

// ── CLI Parsing ──

const args = process.argv.slice(2);
let CAPITAL = 50_000;
let DAYS = 30;
let CATEGORY: string | null = null;
let MIN_PROFIT_PCT = 0;
let STRATEGY_FILTER: "all" | "spot_vs_perp" | "perp_vs_perp" = "all";
let EXCLUDE = new Set<string>();
let COINS: string[] = [];

const consumed = new Set<number>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--capital" && args[i + 1]) {
    CAPITAL = parseFloat(args[i + 1]) || 50_000;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--days" && args[i + 1]) {
    DAYS = parseInt(args[i + 1]) || 30;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--category" && args[i + 1]) {
    CATEGORY = args[i + 1] || null;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--min-profit" && args[i + 1]) {
    MIN_PROFIT_PCT = parseFloat(args[i + 1]) || 0;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--strategy" && args[i + 1]) {
    const val = args[i + 1].toLowerCase();
    if (val === "spot_vs_perp" || val === "perp_vs_perp" || val === "all") {
      STRATEGY_FILTER = val;
    }
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--exclude" && args[i + 1]) {
    for (const c of args[i + 1].split(",")) EXCLUDE.add(c.toUpperCase().trim());
    consumed.add(i); consumed.add(i + 1); i++;
  }
}
for (let i = 0; i < args.length; i++) {
  if (consumed.has(i)) continue;
  if (!args[i].startsWith("--") && isNaN(Number(args[i]))) {
    COINS.push(args[i].toUpperCase());
  }
}

// ── Types ──

interface VenuePairResult {
  venueA: string;
  venueB: string;
  label: string;
  strategy: "spot_vs_perp" | "perp_vs_perp";
  coin: string;
  coinName: string;
  category: string;
  netPnl: number;
  netProfitPct: number;
  totalFees: number;
  totalFunding: number;
  trades: number;
  winRate: number;
  maxDrawdownPct: number;
  breakevenHours: number;
  sharpeRatio: number;
  liquidations: number;
  exitOnNegative: boolean;
  // BasisOS
  objectiveResult: ObjectiveFunctionResult;
  leverageConfig: { minLeverage: number; targetLeverage: number; maxLeverage: number };
  riskLeverage: RiskAdjustedLeverage | null;
  rebalances: number;
}

interface AggregatedVenuePair {
  venueA: string;
  venueB: string;
  label: string;
  strategy: "spot_vs_perp" | "perp_vs_perp";
  totalPnl: number;
  totalProfitPct: number;
  avgProfitPct: number;
  coinsCount: number;
  profitableCoins: number;
  totalFees: number;
  totalFunding: number;
  totalTrades: number;
  avgWinRate: number;
  avgMaxDd: number;
  avgSharpe: number;
  totalLiquidations: number;
  exitOnNegative: boolean;
  coinBreakdown: VenuePairResult[];
  // BasisOS
  avgObjectiveF: number;
  avgDDq5: number;
  avgLeverageAsym: number;
  totalRebalances: number;
}

// ── Data Fetching ──

async function fetchAllFunding(
  coin: string,
  startTime: number,
  endTime: number
): Promise<Map<string, FundingRateEntry[]>> {
  const cache = new Map<string, FundingRateEntry[]>();
  const fetches = perpExchanges.map(async (ex) => {
    try {
      const rates = await Promise.race([
        ex.fetchFundingRates(coin, startTime, endTime),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000)),
      ]);
      cache.set(ex.info.id, rates);
    } catch {
      cache.set(ex.info.id, []);
    }
  });
  await Promise.allSettled(fetches);
  return cache;
}

// ── Build Venue Pairs ──

interface VenuePair {
  strategy: "spot_vs_perp" | "perp_vs_perp";
  venueA: string;
  venueB: string;
  label: string;
}

function buildVenuePairs(): VenuePair[] {
  const pairs: VenuePair[] = [];

  if (STRATEGY_FILTER === "all" || STRATEGY_FILTER === "spot_vs_perp") {
    for (const perp of perpExchanges) {
      for (const spot of spotExchanges) {
        pairs.push({
          strategy: "spot_vs_perp",
          venueA: perp.info.id,
          venueB: spot.info.id,
          label: `${perp.info.name} vs ${spot.info.name}`,
        });
      }
    }
  }

  if (STRATEGY_FILTER === "all" || STRATEGY_FILTER === "perp_vs_perp") {
    for (let i = 0; i < perpExchanges.length; i++) {
      for (let j = i + 1; j < perpExchanges.length; j++) {
        pairs.push({
          strategy: "perp_vs_perp",
          venueA: perpExchanges[i].info.id,
          venueB: perpExchanges[j].info.id,
          label: `${perpExchanges[i].info.name} vs ${perpExchanges[j].info.name}`,
        });
      }
    }
  }

  return pairs;
}

// ── Backtest One Coin on One Venue Pair ──

function backtestCoinOnPair(
  coin: string,
  market: MarketConfig,
  pair: VenuePair,
  fundingCache: Map<string, FundingRateEntry[]>,
  priceData: Array<{ timestamp: number; price: number }>,
): VenuePairResult | null {
  let ratesA: FundingRateEntry[];
  let ratesB: FundingRateEntry[];
  let feeA: FeeModel;
  let feeB: FeeModel;

  if (pair.strategy === "spot_vs_perp") {
    const perpRates = fundingCache.get(pair.venueA) || [];
    if (perpRates.length < 2) return null;
    ratesA = perpRates;
    ratesB = perpRates.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
    feeA = EXCHANGE_FEES[pair.venueA] ?? EXCHANGE_FEES.hyperliquid;
    feeB = EXCHANGE_FEES[pair.venueB] ?? EXCHANGE_FEES.uniswap;
  } else {
    ratesA = fundingCache.get(pair.venueA) || [];
    ratesB = fundingCache.get(pair.venueB) || [];
    if (ratesA.length < 2 || ratesB.length < 2) return null;
    feeA = EXCHANGE_FEES[pair.venueA] ?? EXCHANGE_FEES.hyperliquid;
    feeB = EXCHANGE_FEES[pair.venueB] ?? EXCHANGE_FEES.aster;
  }

  // Compute RLmax from price data
  const riskLeverage = priceData.length > 30
    ? calcRiskAdjustedLeverage(priceData, 5, 2, 0.05)
    : null;

  // Generate leverage configs based on RLmax
  const leverageConfigs: Array<{ minLeverage: number; targetLeverage: number; maxLeverage: number }> = [];
  if (riskLeverage && riskLeverage.rlmax > 1) {
    const rlmax = riskLeverage.rlmax;
    for (let target = 2; target <= Math.min(rlmax, 6); target++) {
      leverageConfigs.push({
        minLeverage: Math.max(1, target - 2),
        targetLeverage: target,
        maxLeverage: Math.min(rlmax, target + 3),
      });
    }
  } else {
    leverageConfigs.push(
      { minLeverage: 1, targetLeverage: 2, maxLeverage: 4 },
      { minLeverage: 1, targetLeverage: 3, maxLeverage: 5 },
    );
  }

  let bestResult: VenuePairResult | null = null;

  for (const levCfg of leverageConfigs) {
    for (const exitOnNeg of [false, true]) {
      const rebalance: RebalanceConfig = {
        enabled: true,
        minLeverage: levCfg.minLeverage,
        targetLeverage: levCfg.targetLeverage,
        maxLeverage: levCfg.maxLeverage,
        deviationThreshold: 0.15,
      };

      const config: Partial<BacktestConfig> = {
        initialCapital: CAPITAL,
        strategy: pair.strategy,
        fundingThreshold: 0.00001,
        maxSpreadBps: 100,
        maxPositionSize: CAPITAL * 0.5,
        venueA: pair.venueA,
        venueB: pair.venueB,
        feeA,
        feeB,
        useMakerFees: false,
        exitOnNegativeFunding: exitOnNeg,
        perpLeverageA: pair.strategy === "perp_vs_perp" ? levCfg.targetLeverage : 1,
        perpLeverageB: pair.strategy === "perp_vs_perp" ? levCfg.targetLeverage : levCfg.targetLeverage,
        priceData,
        rebalance,
        coin,
      };

      try {
        const result = runBacktest(ratesA, ratesB, config);
        const netPnl = result.totalPnl;
        const netProfitPct = (netPnl / CAPITAL) * 100;
        const totalFunding = result.totalFundingCollected - result.totalFundingPaid;

        const objectiveResult = calcObjectiveFunction(
          result.pnlHistory,
          result.timestamps,
          CAPITAL,
          levCfg,
          { alpha: 0.5, beta: 0.3 },
        );

        const entry: VenuePairResult = {
          venueA: pair.venueA,
          venueB: pair.venueB,
          label: pair.label,
          strategy: pair.strategy,
          coin,
          coinName: market.name,
          category: market.category,
          netPnl,
          netProfitPct,
          totalFees: result.totalFees,
          totalFunding,
          trades: result.totalTrades,
          winRate: result.winRate,
          maxDrawdownPct: result.maxDrawdownPct * 100,
          breakevenHours: result.breakevenHours,
          sharpeRatio: result.sharpeRatio,
          liquidations: result.liquidationEvents.length,
          exitOnNegative: exitOnNeg,
          objectiveResult,
          leverageConfig: levCfg,
          riskLeverage,
          rebalances: result.totalRebalances,
        };

        // Pick best by objective function score
        const score = objectiveResult.objective > 0 ? objectiveResult.objective : netPnl / 1000;
        const bestScore = bestResult
          ? (bestResult.objectiveResult.objective > 0 ? bestResult.objectiveResult.objective : bestResult.netPnl / 1000)
          : -Infinity;

        if (score > bestScore) {
          bestResult = entry;
        }
      } catch {
        // skip
      }
    }
  }

  return bestResult;
}

// ── Aggregate Results by Venue Pair ──

function aggregateByVenuePair(results: VenuePairResult[]): AggregatedVenuePair[] {
  // Group by (venueA, venueB, strategy, exitOnNegative)
  const groups = new Map<string, VenuePairResult[]>();

  for (const r of results) {
    // Key includes exit mode to keep them separate
    const key = `${r.venueA}|${r.venueB}|${r.strategy}|${r.exitOnNegative}`;
    const arr = groups.get(key) || [];
    arr.push(r);
    groups.set(key, arr);
  }

  const aggregated: AggregatedVenuePair[] = [];

  for (const [, coins] of groups) {
    if (coins.length === 0) continue;

    const totalPnl = coins.reduce((s, c) => s + c.netPnl, 0);
    const totalProfitPct = coins.reduce((s, c) => s + c.netProfitPct, 0);
    const profitable = coins.filter((c) => c.netPnl > 0);

    aggregated.push({
      venueA: coins[0].venueA,
      venueB: coins[0].venueB,
      label: coins[0].label,
      strategy: coins[0].strategy,
      totalPnl,
      totalProfitPct,
      avgProfitPct: totalProfitPct / coins.length,
      coinsCount: coins.length,
      profitableCoins: profitable.length,
      totalFees: coins.reduce((s, c) => s + c.totalFees, 0),
      totalFunding: coins.reduce((s, c) => s + c.totalFunding, 0),
      totalTrades: coins.reduce((s, c) => s + c.trades, 0),
      avgWinRate: coins.reduce((s, c) => s + c.winRate, 0) / coins.length,
      avgMaxDd: coins.reduce((s, c) => s + c.maxDrawdownPct, 0) / coins.length,
      avgSharpe: coins.reduce((s, c) => s + c.sharpeRatio, 0) / coins.length,
      totalLiquidations: coins.reduce((s, c) => s + c.liquidations, 0),
      exitOnNegative: coins[0].exitOnNegative,
      coinBreakdown: coins.sort((a, b) => b.netPnl - a.netPnl),
      avgObjectiveF: coins.reduce((s, c) => s + c.objectiveResult.objective, 0) / coins.length,
      avgDDq5: coins.reduce((s, c) => s + c.objectiveResult.ddq5, 0) / coins.length,
      avgLeverageAsym: coins.reduce((s, c) => s + c.objectiveResult.leverageAsymmetry, 0) / coins.length,
      totalRebalances: coins.reduce((s, c) => s + c.rebalances, 0),
    });
  }

  // Sort by total PnL descending
  aggregated.sort((a, b) => b.totalPnl - a.totalPnl);

  return aggregated;
}

// ── Display Helpers ──

function fmtDollar(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function fmtBe(h: number): string {
  if (h < 0) return "never";
  if (h < 24) return `${h}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function getVenueName(id: string): string {
  const perp = getPerpExchange(id);
  if (perp) return perp.info.name;
  const spot = getSpotExchange(id);
  if (spot) return spot.info.name;
  return id;
}

// ── Main ──

async function main() {
  const W = 116;

  console.log("=".repeat(W));
  console.log("  BASKET VENUE PAIR OPTIMIZER");
  console.log("  Finds the best exchange pair for a basket of tokens");
  console.log("=".repeat(W));
  console.log();
  console.log(`  Capital/position: ${fmtDollar(CAPITAL)}`);
  console.log(`  Period:           ${DAYS} days`);
  if (STRATEGY_FILTER !== "all") console.log(`  Strategy:         ${STRATEGY_FILTER}`);
  if (CATEGORY) console.log(`  Category:         ${CATEGORY}`);
  if (COINS.length > 0) console.log(`  Basket:           ${COINS.join(", ")}`);
  console.log();

  // Resolve markets
  let markets: MarketConfig[];
  if (COINS.length > 0) {
    markets = COINS.map((c) => {
      const m = MARKETS.find((m) => m.hlCoin === c);
      if (!m) { console.error(`  Coin "${c}" not found. Use --list in index.ts.`); process.exit(1); }
      return m;
    }).filter((m) => !EXCLUDE.has(m.hlCoin));
  } else if (CATEGORY) {
    markets = getMarketsByCategory(CATEGORY).filter((m) => !EXCLUDE.has(m.hlCoin));
  } else {
    console.error("  Provide coin names or --category.");
    process.exit(1);
  }

  if (markets.length === 0) {
    console.error("  No markets to scan.");
    process.exit(1);
  }

  const pairs = buildVenuePairs();
  const endTime = Date.now();
  const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

  console.log(`  Basket:   ${markets.length} coins`);
  console.log(`  Pairs:    ${pairs.length} venue pairs`);
  console.log(`  Total:    ${markets.length * pairs.length} backtests`);
  console.log();

  // Fetch shared price data
  const uni = new UniswapSpotExchange();
  let priceData: Array<{ timestamp: number; price: number }> = [];
  try { priceData = await uni.fetchPrices("ETHUSDT", startTime, endTime); } catch {}

  // Run all backtests
  const allResults: VenuePairResult[] = [];
  let done = 0;
  const total = markets.length;

  for (const market of markets) {
    done++;
    process.stdout.write(`\r  [${done}/${total}] ${market.hlCoin.padEnd(8)} `);

    const fundingCache = await fetchAllFunding(market.hlCoin, startTime, endTime);

    let coinPriceData = priceData;
    if (market.hlCoin !== "ETH") {
      try { coinPriceData = await uni.fetchPrices(market.binanceSymbol, startTime, endTime); } catch { coinPriceData = []; }
    }

    for (const pair of pairs) {
      const result = backtestCoinOnPair(market.hlCoin, market, pair, fundingCache, coinPriceData);
      if (result) allResults.push(result);
    }
  }

  process.stdout.write("\r" + " ".repeat(80) + "\r");

  if (allResults.length === 0) {
    console.log("  No data available. Try different coins or a longer period.");
    return;
  }

  // Aggregate by venue pair
  const aggregated = aggregateByVenuePair(allResults);

  // Filter by min profit
  const filtered = MIN_PROFIT_PCT > 0
    ? aggregated.filter((a) => a.avgProfitPct >= MIN_PROFIT_PCT)
    : aggregated;

  if (filtered.length === 0) {
    console.log(`  No venue pairs with >= ${MIN_PROFIT_PCT}% avg profit across the basket.`);
    console.log(`  Try lowering --min-profit or removing it.`);
    console.log();
    console.log(`  Showing best available (no filter):`);
    filtered.push(...aggregated);
  }

  // ── Section 1: Top Venue Pairs Ranked ──

  console.log();
  console.log("=".repeat(W));
  console.log(`  TOP VENUE PAIRS FOR BASKET (${markets.map((m) => m.hlCoin).join(", ")})`);
  console.log("=".repeat(W));
  console.log();
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "Venue Pair".padEnd(32) +
    "Strat".padEnd(12) +
    "Exit".padEnd(5) +
    "PnL".padStart(11) +
    "Prof%".padStart(7) +
    "C/TC".padStart(7) +
    "Win%".padStart(6) +
    "DD%".padStart(7) +
    "Sharpe".padStart(7) +
    "Obj.F".padStart(8) +
    "DDq5".padStart(7) +
    "Rebal".padStart(6) +
    "Liq".padStart(5)
  );
  console.log("  " + "-".repeat(W - 2));

  const topPairs = filtered.slice(0, 20);
  for (let i = 0; i < topPairs.length; i++) {
    const a = topPairs[i];
    const strat = a.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
    const exit = a.exitOnNegative ? "neg" : "---";
    const medal = i === 0 ? " <-- BEST" : "";

    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${a.label.padEnd(32)}` +
      `${strat.padEnd(12)}` +
      `${exit.padEnd(5)}` +
      `${fmtDollar(a.totalPnl).padStart(11)}` +
      `${fmtPct(a.avgProfitPct).padStart(7)}` +
      `${(`${a.profitableCoins}/${a.coinsCount}`).padStart(7)}` +
      `${(a.avgWinRate * 100).toFixed(0).padStart(5)}%` +
      `${fmtPct(a.avgMaxDd).padStart(7)}` +
      `${a.avgSharpe.toFixed(2).padStart(7)}` +
      `${a.avgObjectiveF.toFixed(3).padStart(8)}` +
      `${fmtPct(a.avgDDq5).padStart(7)}` +
      `${String(a.totalRebalances).padStart(6)}` +
      `${(a.totalLiquidations > 0 ? a.totalLiquidations + "!" : "-").padStart(5)}${medal}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  // ── Section 2: Winner Detail ──

  const winner = topPairs[0];
  console.log();
  console.log("=".repeat(W));
  console.log(`  BEST VENUE PAIR: ${winner.label.toUpperCase()}`);
  console.log("=".repeat(W));
  console.log();
  console.log(`  Strategy:        ${winner.strategy === "spot_vs_perp" ? "Spot vs Perp" : "Perp vs Perp"}`);
  console.log(`  Exit Mode:       ${winner.exitOnNegative ? "Exit on negative funding" : "Hold through negative"}`);
  console.log(`  Total PnL:       ${fmtDollar(winner.totalPnl)}`);
  console.log(`  Avg Profit:      ${fmtPct(winner.avgProfitPct)} per coin`);
  console.log(`  Profitable:      ${winner.profitableCoins}/${winner.coinsCount} coins`);
  console.log(`  Avg Win Rate:    ${(winner.avgWinRate * 100).toFixed(1)}%`);
  console.log(`  Avg Max DD:      ${fmtPct(winner.avgMaxDd)}`);
  console.log(`  Avg Sharpe:      ${winner.avgSharpe.toFixed(2)}`);
  console.log(`  Total Fees:      ${fmtDollar(winner.totalFees)}`);
  console.log(`  Total Trades:    ${winner.totalTrades}`);
  console.log(`  Obj.F:           ${winner.avgObjectiveF.toFixed(4)}  (higher = better)`);
  console.log(`  DDq5:            ${fmtPct(winner.avgDDq5)}  (5% quantile drawdown)`);
  console.log(`  Leverage Asym:   ${winner.avgLeverageAsym.toFixed(4)}  (0 = balanced)`);
  console.log(`  Rebalances:      ${winner.totalRebalances} across basket`);
  if (winner.totalLiquidations > 0) {
    console.log(`  LIQUIDATIONS:    ${winner.totalLiquidations} events across basket`);
  }

  // ── Section 3: Per-Coin Breakdown on Best Pair ──

  console.log();
  console.log("=".repeat(W));
  console.log(`  PER-COIN BREAKDOWN ON ${winner.label.toUpperCase()}`);
  console.log("=".repeat(W));
  console.log();
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "Coin".padEnd(8) +
    "Name".padEnd(20) +
    "PnL".padStart(10) +
    "Profit%".padStart(9) +
    "Sharpe".padStart(7) +
    "Win%".padStart(6) +
    "MDD%".padStart(7) +
    "Obj.F".padStart(8) +
    "RLmax".padStart(7) +
    "Rebal".padStart(6) +
    "Liq".padStart(5)
  );
  console.log("  " + "-".repeat(W - 2));

  for (let i = 0; i < winner.coinBreakdown.length; i++) {
    const c = winner.coinBreakdown[i];
    const status = c.netPnl > 0 ? "+" : "";

    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${c.coin.padEnd(8)}` +
      `${c.coinName.padEnd(20)}` +
      `${`${status}${fmtDollar(c.netPnl)}`.padStart(10)}` +
      `${`${status}${fmtPct(c.netProfitPct)}`.padStart(9)}` +
      `${c.sharpeRatio.toFixed(2).padStart(7)}` +
      `${(c.winRate * 100).toFixed(0).padStart(5)}%` +
      `${fmtPct(c.maxDrawdownPct).padStart(7)}` +
      `${c.objectiveResult.objective.toFixed(3).padStart(8)}` +
      `${(c.riskLeverage ? c.riskLeverage.rlmax.toFixed(1) : "-").padStart(7)}` +
      `${String(c.rebalances).padStart(6)}` +
      `${(c.liquidations > 0 ? c.liquidations + "!" : "-").padStart(5)}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  // Summary stats
  const winners = winner.coinBreakdown.filter((c) => c.netPnl > 0);
  const losers = winner.coinBreakdown.filter((c) => c.netPnl <= 0);
  console.log();
  console.log(`  Winners: ${winners.length}  |  Losers: ${losers.length}  |  Total PnL: ${fmtDollar(winner.totalPnl)}`);
  if (losers.length > 0) {
    console.log(`  Worst coin: ${losers[losers.length - 1].coin} (${fmtDollar(losers[losers.length - 1].netPnl)})`);
  }

  // ── Section 4: How Top Pairs Compare Per Coin ──

  if (topPairs.length >= 2) {
    console.log();
    console.log("=".repeat(W));
    console.log("  VENUE PAIR COMPARISON PER COIN (Top 5 pairs)");
    console.log("=".repeat(W));
    console.log();

    const top5 = topPairs.slice(0, Math.min(5, topPairs.length));
    const coinList = winner.coinBreakdown.map((c) => c.coin);

    // Header
    let header = "  " + "Coin".padEnd(8);
    for (let i = 0; i < top5.length; i++) {
      const label = `#${i + 1} ${top5[i].label}`.substring(0, 22);
      header += label.padEnd(24);
    }
    console.log(header);
    console.log("  " + "-".repeat(W - 2));

    for (const coin of coinList) {
      let row = `  ${coin.padEnd(8)}`;
      for (const pair of top5) {
        const match = pair.coinBreakdown.find((c) => c.coin === coin);
        if (match) {
          const val = `${match.netPnl >= 0 ? "+" : ""}${fmtDollar(match.netPnl)}`;
          row += val.padEnd(24);
        } else {
          row += "-".padEnd(24);
        }
      }
      console.log(row);
    }
    console.log("  " + "-".repeat(W - 2));
  }

  // ── Section 5: Spot/Perp vs Perp/Perp Summary ──

  const spotPerpPairs = filtered.filter((a) => a.strategy === "spot_vs_perp");
  const perpPerpPairs = filtered.filter((a) => a.strategy === "perp_vs_perp");

  if (spotPerpPairs.length > 0 && perpPerpPairs.length > 0) {
    console.log();
    console.log("=".repeat(W));
    console.log("  STRATEGY COMPARISON: SPOT/PERP vs PERP/PERP");
    console.log("=".repeat(W));
    console.log();

    const bestSPPnl = spotPerpPairs[0].totalPnl;
    const bestPPPnl = perpPerpPairs[0].totalPnl;
    const avgSPPnl = spotPerpPairs.reduce((s, a) => s + a.totalPnl, 0) / spotPerpPairs.length;
    const avgPPPnl = perpPerpPairs.reduce((s, a) => s + a.totalPnl, 0) / perpPerpPairs.length;

    console.log(`  ${"Metric".padEnd(22)} ${"Spot/Perp".padStart(18)} ${"Perp/Perp".padStart(18)}`);
    console.log("  " + "-".repeat(58));
    console.log(`  ${"Best pair PnL".padEnd(22)} ${fmtDollar(bestSPPnl).padStart(18)} ${fmtDollar(bestPPPnl).padStart(18)}`);
    console.log(`  ${"Avg pair PnL".padEnd(22)} ${fmtDollar(avgSPPnl).padStart(18)} ${fmtDollar(avgPPPnl).padStart(18)}`);
    console.log(`  ${"Pairs with data".padEnd(22)} ${String(spotPerpPairs.length).padStart(18)} ${String(perpPerpPairs.length).padStart(18)}`);
    console.log(`  ${"Best winner".padEnd(22)} ${spotPerpPairs[0].label.padEnd(18).substring(0, 18)} ${perpPerpPairs[0].label.padEnd(18).substring(0, 18)}`);

    const overallBest = bestSPPnl > bestPPPnl ? "Spot/Perp" : "Perp/Perp";
    console.log();
    console.log(`  --> Overall winner: ${overallBest} (${fmtDollar(Math.max(bestSPPnl, bestPPPnl))})`);
  }

  // ── Section 6: Bottom Pairs (avoid) ──

  if (filtered.length > 5) {
    console.log();
    console.log("=".repeat(W));
    console.log("  WORST VENUE PAIRS (avoid)");
    console.log("=".repeat(W));
    console.log();

    const bottom = filtered.slice(-5).reverse();
    for (let i = 0; i < bottom.length; i++) {
      const a = bottom[i];
      const strat = a.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
      console.log(
        `  ${a.label.padEnd(32)} ${strat.padEnd(12)} ` +
        `${fmtDollar(a.totalPnl).padStart(10)}  ` +
        `${fmtPct(a.avgProfitPct).padStart(7)} avg  ` +
        `${a.profitableCoins}/${a.coinsCount} coins`
      );
    }
  }

  // ── Section 7: Action Plan ──

  console.log();
  console.log("=".repeat(W));
  console.log("  ACTION PLAN");
  console.log("=".repeat(W));
  console.log();
  console.log(`  Use ${winner.label} for your basket.`);
  console.log(`  Strategy: ${winner.strategy === "spot_vs_perp" ? "Long spot + Short perp (or vice versa)" : "Long perp A + Short perp B"}`);
  console.log(`  Exit mode: ${winner.exitOnNegative ? "Exit when funding turns negative" : "Hold through negative funding"}`);
  const bestCoin = winner.coinBreakdown[0];
  if (bestCoin) {
    const lc = bestCoin.leverageConfig;
    console.log(`  Leverage:        target ${lc.targetLeverage}x  [${lc.minLeverage}-${lc.maxLeverage}]`);
    console.log(`  Rebalancing:     every period, drift > 15% of target`);
    console.log(`  Objective F:     ${bestCoin.objectiveResult.objective.toFixed(4)}`);
  }
  console.log();

  const profitable = winner.coinBreakdown.filter((c) => c.netPnl > 0);
  const skip = winner.coinBreakdown.filter((c) => c.netPnl <= 0);

  if (profitable.length > 0) {
    console.log(`  Trade these coins on ${winner.label}:`);
    for (const c of profitable) {
      const rl = c.riskLeverage ? ` RLmax=${c.riskLeverage.rlmax.toFixed(1)}x` : "";
      console.log(`    + ${c.coin.padEnd(8)} ${fmtDollar(c.netPnl).padStart(8)}  (${fmtPct(c.netProfitPct)})${rl}  F=${c.objectiveResult.objective.toFixed(3)}  rebal=${c.rebalances}`);
    }
  }
  if (skip.length > 0) {
    console.log();
    console.log(`  Skip on this pair (use different venue or skip entirely):`);
    for (const c of skip) {
      console.log(`    - ${c.coin.padEnd(8)} ${fmtDollar(c.netPnl).padStart(8)}  (${fmtPct(c.netProfitPct)})`);
    }
  }

  console.log();
  console.log("=".repeat(W));
  console.log(`  Re-run: bun run basket ${markets.map((m) => m.hlCoin).join(" ")} --capital ${CAPITAL} --days ${DAYS}`);
  console.log("=".repeat(W));
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
