/**
 * Basket Strategy Optimizer
 *
 * Finds the best portfolio-level strategy for a basket of tokens/markets.
 * For each token, it discovers the optimal venue combo, then runs portfolio
 * allocation analysis across multiple strategies:
 *
 *   1. Equal-Weight    — equal capital per position
 *   2. Score-Weighted  — weight by backtest composite score
 *   3. Risk-Parity     — weight inversely by max drawdown
 *   4. Kelly-Optimal   — weight by edge/variance (fractional Kelly)
 *
 * Outputs:
 *   - Per-token best strategy breakdown
 *   - Portfolio-level PnL, Sharpe, max drawdown under each allocation
 *   - Capital allocation table
 *   - Correlation matrix between positions
 *   - Recommended portfolio
 *
 * Usage:
 *   bun run src/optimize-basket.ts BTC ETH SOL TRUMP PEPE [options]
 *
 * Options:
 *   --days <n>            Backtest period in days (default: 30)
 *   --capital <n>         Total capital to allocate (default: 100000)
 *   --category <cat>      Use all coins in a category (e.g. --category L1)
 *   --top <n>             Only keep top N coins by score (default: all)
 *   --max-positions <n>   Max simultaneous positions (default: basket size)
 *   --min-score <n>       Minimum composite score to include (default: -9999)
 *   --exclude <coins>     Comma-separated coins to exclude
 */

import { perpExchanges, spotExchanges, getPerpExchange, getSpotExchange } from "./exchanges";
import { UniswapSpotExchange } from "./exchanges/uniswap";
import { runBacktest, EXCHANGE_FEES, type BacktestConfig, type BacktestResult, type FeeModel } from "./backtest";
import { MARKETS, getMarketsByCategory, type MarketConfig } from "./markets";
import type { FundingRateEntry } from "./exchanges/types";

// ── CLI Parsing ──

const args = process.argv.slice(2);
let TOTAL_CAPITAL = 100_000;
let DAYS = 30;
let CATEGORY: string | null = null;
let TOP_N: number | null = null;
let MAX_POSITIONS: number | null = null;
let MIN_SCORE = -9999;
let EXCLUDE = new Set<string>();
let COINS: string[] = [];

const consumed = new Set<number>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--capital" && args[i + 1]) {
    TOTAL_CAPITAL = parseFloat(args[i + 1]) || 100_000;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--days" && args[i + 1]) {
    DAYS = parseInt(args[i + 1]) || 30;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--category" && args[i + 1]) {
    CATEGORY = args[i + 1] || null;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--top" && args[i + 1]) {
    TOP_N = parseInt(args[i + 1]) || null;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--max-positions" && args[i + 1]) {
    MAX_POSITIONS = parseInt(args[i + 1]) || null;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--min-score" && args[i + 1]) {
    MIN_SCORE = parseFloat(args[i + 1]) || -9999;
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

interface CoinOptimization {
  coin: string;
  market: MarketConfig;
  bestCombo: {
    strategy: "spot_vs_perp" | "perp_vs_perp";
    venueA: string;
    venueB: string;
    label: string;
    exitOnNegative: boolean;
  };
  result: BacktestResult;
  score: number;
  netPnl: number;
  apy: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalFees: number;
  winRate: number;
  fundingCollected: number;
  hourlySpreadBps: number;
}

interface Allocation {
  coin: string;
  weight: number;
  capital: number;
  score: number;
  sharpe: number;
  maxDd: number;
}

interface PortfolioResult {
  name: string;
  allocations: Allocation[];
  totalPnl: number;
  portfolioReturn: number;
  portfolioSharpe: number;
  portfolioMaxDd: number;
  portfolioWinRate: number;
  totalFees: number;
  annualizedPct: number;
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

// ── Score Calculation ──

function calcScore(pnl: number, maxDrawdownPct: number, sharpe: number): number {
  const ddPenalty = maxDrawdownPct * 1000;
  return pnl - ddPenalty + sharpe * 500;
}

// ── Optimize Single Coin ──

async function optimizeOneCoin(
  coin: string,
  market: MarketConfig,
  capital: number,
  startTime: number,
  endTime: number,
  fundingCache: Map<string, FundingRateEntry[]>,
  priceData: Array<{ timestamp: number; price: number }>,
): Promise<CoinOptimization | null> {
  // Generate combos: spot x perp + perp x perp
  const combos: Array<{
    strategy: "spot_vs_perp" | "perp_vs_perp";
    venueA: string;
    venueB: string;
    label: string;
  }> = [];

  for (const spot of spotExchanges) {
    for (const perp of perpExchanges) {
      combos.push({
        strategy: "spot_vs_perp",
        venueA: perp.info.id,
        venueB: spot.info.id,
        label: `${perp.info.name} vs ${spot.info.name}`,
      });
    }
  }
  for (let i = 0; i < perpExchanges.length; i++) {
    for (let j = i + 1; j < perpExchanges.length; j++) {
      combos.push({
        strategy: "perp_vs_perp",
        venueA: perpExchanges[i].info.id,
        venueB: perpExchanges[j].info.id,
        label: `${perpExchanges[i].info.name} vs ${perpExchanges[j].info.name}`,
      });
    }
  }

  let best: CoinOptimization | null = null;

  for (const combo of combos) {
    for (const exitOnNeg of [false, true]) {
      let ratesA: FundingRateEntry[];
      let ratesB: FundingRateEntry[];
      let feeA: FeeModel;
      let feeB: FeeModel;

      if (combo.strategy === "spot_vs_perp") {
        const perpRates = fundingCache.get(combo.venueA) || [];
        if (perpRates.length < 2) continue;
        ratesA = perpRates;
        ratesB = perpRates.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
        feeA = EXCHANGE_FEES[combo.venueA] ?? EXCHANGE_FEES.hyperliquid;
        feeB = EXCHANGE_FEES[combo.venueB] ?? EXCHANGE_FEES.uniswap;
      } else {
        ratesA = fundingCache.get(combo.venueA) || [];
        ratesB = fundingCache.get(combo.venueB) || [];
        if (ratesA.length < 2 || ratesB.length < 2) continue;
        feeA = EXCHANGE_FEES[combo.venueA] ?? EXCHANGE_FEES.hyperliquid;
        feeB = EXCHANGE_FEES[combo.venueB] ?? EXCHANGE_FEES.aster;
      }

      const config: Partial<BacktestConfig> = {
        initialCapital: capital,
        strategy: combo.strategy,
        fundingThreshold: 0.00001,
        maxSpreadBps: 100,
        maxPositionSize: capital * 0.5,
        venueA: combo.venueA,
        venueB: combo.venueB,
        feeA,
        feeB,
        useMakerFees: false,
        exitOnNegativeFunding: exitOnNeg,
        perpLeverageA: combo.strategy === "perp_vs_perp" ? 3 : 2,
        perpLeverageB: combo.strategy === "perp_vs_perp" ? 3 : 2,
        priceData,
      };

      try {
        const result = runBacktest(ratesA, ratesB, config);
        const netPnl = result.totalPnl;
        const score = calcScore(netPnl, result.maxDrawdownPct, result.sharpeRatio);

        if (!best || score > best.score) {
          best = {
            coin,
            market,
            bestCombo: {
              strategy: combo.strategy,
              venueA: combo.venueA,
              venueB: combo.venueB,
              label: combo.label,
              exitOnNegative: exitOnNeg,
            },
            result,
            score,
            netPnl,
            apy: result.annualizedReturn * 100,
            maxDrawdownPct: result.maxDrawdownPct * 100,
            sharpeRatio: result.sharpeRatio,
            totalFees: result.totalFees,
            winRate: result.winRate,
            fundingCollected: result.totalFundingCollected - result.totalFundingPaid,
            hourlySpreadBps: result.avgSpreadBps,
          };
        }
      } catch {
        // skip
      }
    }
  }

  return best;
}

// ── Portfolio Construction ──

function buildPortfolio(
  name: string,
  coins: CoinOptimization[],
  totalCapital: number,
  maxPositions: number,
  allocateFn: (coins: CoinOptimization[], totalCapital: number, maxPositions: number) => Allocation[],
): PortfolioResult {
  const allocations = allocateFn(coins, totalCapital, maxPositions);
  const capitalPerCoin = new Map(allocations.map((a) => [a.coin, a.capital]));

  let totalPnl = 0;
  let totalFees = 0;
  let totalWeightedWinRate = 0;
  let totalWeight = 0;

  const portfolioAllocations: Allocation[] = [];

  for (const coin of coins) {
    const alloc = capitalPerCoin.get(coin.coin);
    if (!alloc || alloc <= 0) continue;

    // Scale results proportionally to capital allocation
    const scaleFactor = alloc / TOTAL_CAPITAL;
    const scaledPnl = coin.netPnl * scaleFactor;
    const scaledFees = coin.totalFees * scaleFactor;

    totalPnl += scaledPnl;
    totalFees += scaledFees;
    totalWeightedWinRate += coin.winRate * alloc;
    totalWeight += alloc;

    portfolioAllocations.push({
      coin: coin.coin,
      weight: alloc / totalCapital,
      capital: alloc,
      score: coin.score,
      sharpe: coin.sharpeRatio,
      maxDd: coin.maxDrawdownPct,
    });
  }

  // Portfolio Sharpe: weighted average of individual Sharpes (simplified)
  const portfolioSharpe = portfolioAllocations.reduce(
    (s, a) => s + a.sharpe * a.weight, 0
  );

  // Portfolio max drawdown: weighted sum of individual max DDs (conservative estimate)
  const portfolioMaxDd = portfolioAllocations.reduce(
    (s, a) => s + a.maxDd * a.weight, 0
  );

  return {
    name,
    allocations: portfolioAllocations,
    totalPnl,
    portfolioReturn: totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0,
    portfolioSharpe,
    portfolioMaxDd,
    portfolioWinRate: totalWeight > 0 ? totalWeightedWinRate / totalWeight : 0,
    totalFees,
    annualizedPct: totalCapital > 0
      ? (Math.pow(1 + totalPnl / totalCapital, 365 / DAYS) - 1) * 100
      : 0,
  };
}

// ── Allocation Strategies ──

function equalWeight(coins: CoinOptimization[], totalCapital: number, maxPositions: number): Allocation[] {
  const n = Math.min(coins.length, maxPositions);
  const perCoin = totalCapital / n;
  return coins.slice(0, n).map((c) => ({
    coin: c.coin,
    weight: 1 / n,
    capital: perCoin,
    score: c.score,
    sharpe: c.sharpeRatio,
    maxDd: c.maxDrawdownPct,
  }));
}

function scoreWeighted(coins: CoinOptimization[], totalCapital: number, maxPositions: number): Allocation[] {
  const top = coins.slice(0, maxPositions);
  // Only use positive scores
  const positiveScores = top.map((c) => Math.max(c.score, 0.01));
  const totalScore = positiveScores.reduce((s, v) => s + v, 0);
  return top.map((c, i) => ({
    coin: c.coin,
    weight: positiveScores[i] / totalScore,
    capital: (positiveScores[i] / totalScore) * totalCapital,
    score: c.score,
    sharpe: c.sharpeRatio,
    maxDd: c.maxDrawdownPct,
  }));
}

function riskParity(coins: CoinOptimization[], totalCapital: number, maxPositions: number): Allocation[] {
  const top = coins.slice(0, maxPositions);
  // Weight inversely by max drawdown (higher DD = less capital)
  const invDds = top.map((c) => {
    const dd = Math.max(c.maxDrawdownPct, 0.1); // floor at 0.1% to avoid div by 0
    return 1 / dd;
  });
  const totalInvDd = invDds.reduce((s, v) => s + v, 0);
  return top.map((c, i) => ({
    coin: c.coin,
    weight: invDds[i] / totalInvDd,
    capital: (invDds[i] / totalInvDd) * totalCapital,
    score: c.score,
    sharpe: c.sharpeRatio,
    maxDd: c.maxDrawdownPct,
  }));
}

function kellyOptimal(coins: CoinOptimization[], totalCapital: number, maxPositions: number): Allocation[] {
  const top = coins.slice(0, maxPositions);
  // Fractional Kelly: f* = (p * b - q) / b, where p = win rate, b = avg win / avg loss
  // Simplified: use APY as edge proxy and drawdown as variance proxy
  const kellyFractions = top.map((c) => {
    const p = c.winRate;
    const q = 1 - p;
    // Use sharpe as a proxy for edge/variance
    const edge = Math.max(c.sharpeRatio, 0.01);
    const f = (p * edge - q) / Math.max(edge, 1);
    return Math.max(f * 0.25, 0.01); // Quarter-Kelly for safety, floor at 1%
  });
  const totalKelly = kellyFractions.reduce((s, v) => s + v, 0);
  return top.map((c, i) => ({
    coin: c.coin,
    weight: kellyFractions[i] / totalKelly,
    capital: (kellyFractions[i] / totalKelly) * totalCapital,
    score: c.score,
    sharpe: c.sharpeRatio,
    maxDd: c.maxDrawdownPct,
  }));
}

// ── Correlation Matrix ──

function computeCorrelationMatrix(coins: CoinOptimization[]): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();

  for (const a of coins) {
    const row = new Map<string, number>();
    for (const b of coins) {
      if (a.coin === b.coin) {
        row.set(b.coin, 1.0);
      } else if (matrix.has(b.coin) && matrix.get(b.coin)!.has(a.coin)) {
        row.set(b.coin, matrix.get(b.coin)!.get(a.coin)!);
      } else {
        // Correlation based on PnL history overlap
        const tsA = a.result.timestamps;
        const tsB = b.result.timestamps;
        const pnlA = a.result.pnlHistory;
        const pnlB = b.result.pnlHistory;

        // Find overlapping timestamps
        const bMap = new Map<number, number>();
        for (let i = 0; i < tsB.length; i++) bMap.set(tsB[i], i);

        const pairedA: number[] = [];
        const pairedB: number[] = [];

        for (let i = 0; i < tsA.length; i++) {
          const j = bMap.get(tsA[i]);
          if (j !== undefined) {
            pairedA.push(pnlA[i]);
            pairedB.push(pnlB[j]);
          }
        }

        if (pairedA.length < 5) {
          row.set(b.coin, 0);
        } else {
          row.set(b.coin, pearsonCorrelation(pairedA, pairedB));
        }
      }
    }
    matrix.set(a.coin, row);
  }

  return matrix;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

// ── Display Helpers ──

function formatDollar(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function formatPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function formatBe(h: number): string {
  if (h < 0) return "never";
  if (h < 24) return `${h}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ── Main ──

async function main() {
  const W = 110;

  console.log("=".repeat(W));
  console.log("  BASKET STRATEGY OPTIMIZER");
  console.log("  Finds the best portfolio of funding-rate arbitrage positions");
  console.log("=".repeat(W));
  console.log();
  console.log(`  Capital:       ${formatDollar(TOTAL_CAPITAL)}`);
  console.log(`  Period:        ${DAYS} days`);
  if (CATEGORY) console.log(`  Category:      ${CATEGORY}`);
  if (COINS.length > 0) console.log(`  Basket:        ${COINS.join(", ")}`);
  if (TOP_N) console.log(`  Top N:         ${TOP_N}`);
  if (MAX_POSITIONS) console.log(`  Max Positions: ${MAX_POSITIONS}`);
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
    console.error("  Provide coin names or --category. Run with --help for usage.");
    process.exit(1);
  }

  if (markets.length === 0) {
    console.error("  No markets to scan.");
    process.exit(1);
  }

  const maxPos = MAX_POSITIONS ?? markets.length;
  const endTime = Date.now();
  const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

  console.log(`  Scanning ${markets.length} markets across ${perpExchanges.length} perp exchanges...`);
  console.log();

  // Fetch shared price data
  const uni = new UniswapSpotExchange();
  let priceData: Array<{ timestamp: number; price: number }> = [];
  try {
    priceData = await uni.fetchPrices("ETHUSDT", startTime, endTime);
  } catch {}

  // Optimize each coin
  const optimizations: CoinOptimization[] = [];
  let scanned = 0;

  for (const market of markets) {
    scanned++;
    process.stdout.write(`\r  [${scanned}/${markets.length}] Optimizing ${market.hlCoin.padEnd(8)}`);

    const fundingCache = await fetchAllFunding(market.hlCoin, startTime, endTime);

    // Fetch coin-specific price data
    let coinPriceData = priceData;
    if (market.hlCoin !== "ETH") {
      try {
        coinPriceData = await uni.fetchPrices(market.binanceSymbol, startTime, endTime);
      } catch {
        coinPriceData = [];
      }
    }

    const opt = await optimizeOneCoin(
      market.hlCoin,
      market,
      TOTAL_CAPITAL,
      startTime,
      endTime,
      fundingCache,
      coinPriceData,
    );

    if (opt && opt.score >= MIN_SCORE) {
      optimizations.push(opt);
    }
  }

  process.stdout.write("\r" + " ".repeat(80) + "\r");

  if (optimizations.length === 0) {
    console.log("  No viable positions found. Try a longer period or different coins.");
    return;
  }

  // Sort by score descending
  optimizations.sort((a, b) => b.score - a.score);

  // Apply top-N filter
  const topCoins = TOP_N ? optimizations.slice(0, TOP_N) : optimizations;

  // ── Section 1: Per-Token Best Strategy ──

  console.log();
  console.log("=".repeat(W));
  console.log("  PER-TOKEN BEST STRATEGY");
  console.log("=".repeat(W));
  console.log();
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "Coin".padEnd(8) +
    "Strategy".padEnd(13) +
    "Venue Pair".padEnd(26) +
    "PnL".padStart(10) +
    "APY%".padStart(8) +
    "Score".padStart(8) +
    "Sharpe".padStart(8) +
    "MDD%".padStart(7) +
    "Win%".padStart(6) +
    "Fees".padStart(8)
  );
  console.log("  " + "-".repeat(W - 2));

  for (let i = 0; i < topCoins.length; i++) {
    const c = topCoins[i];
    const strat = c.bestCombo.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
    const medal = i === 0 ? " <- BEST" : "";
    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${c.coin.padEnd(8)}` +
      `${strat.padEnd(13)}` +
      `${c.bestCombo.label.padEnd(26)}` +
      `${formatDollar(c.netPnl).padStart(10)}` +
      `${formatPct(c.apy).padStart(8)}` +
      `${c.score.toFixed(0).padStart(8)}` +
      `${c.sharpeRatio.toFixed(2).padStart(8)}` +
      `${formatPct(c.maxDrawdownPct).padStart(7)}` +
      `${(c.winRate * 100).toFixed(0).padStart(5)}%` +
      `${formatDollar(c.totalFees).padStart(8)}${medal}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  // ── Section 2: Portfolio Allocation Comparison ──

  console.log();
  console.log("=".repeat(W));
  console.log("  PORTFOLIO ALLOCATION COMPARISON");
  console.log("  Same positions, different sizing strategies");
  console.log("=".repeat(W));
  console.log();

  const strategies: Array<{
    name: string;
    fn: (coins: CoinOptimization[], totalCapital: number, maxPositions: number) => Allocation[];
  }> = [
    { name: "Equal Weight", fn: equalWeight },
    { name: "Score Weighted", fn: scoreWeighted },
    { name: "Risk Parity", fn: riskParity },
    { name: "Kelly Optimal (1/4)", fn: kellyOptimal },
  ];

  const portfolios: PortfolioResult[] = [];

  for (const strat of strategies) {
    const portfolio = buildPortfolio(strat.name, topCoins, TOTAL_CAPITAL, maxPos, strat.fn);
    portfolios.push(portfolio);
  }

  // Sort portfolios by composite: PnL - (maxDD * 1000)
  portfolios.sort((a, b) => {
    const sa = a.totalPnl - a.portfolioMaxDd * 10 * TOTAL_CAPITAL / 100;
    const sb = b.totalPnl - b.portfolioMaxDd * 10 * TOTAL_CAPITAL / 100;
    return sb - sa;
  });

  console.log(
    "  " +
    "Strategy".padEnd(22) +
    "PnL".padStart(12) +
    "Return%".padStart(10) +
    "Ann.%".padStart(8) +
    "Sharpe".padStart(8) +
    "MaxDD%".padStart(8) +
    "Win%".padStart(7) +
    "Fees".padStart(10) +
    "Positions".padStart(10)
  );
  console.log("  " + "-".repeat(W - 2));

  for (let i = 0; i < portfolios.length; i++) {
    const p = portfolios[i];
    const best = i === 0 ? " <- BEST" : "";
    console.log(
      `  ${p.name.padEnd(22)}` +
      `${formatDollar(p.totalPnl).padStart(12)}` +
      `${formatPct(p.portfolioReturn).padStart(10)}` +
      `${formatPct(p.annualizedPct).padStart(8)}` +
      `${p.portfolioSharpe.toFixed(2).padStart(8)}` +
      `${formatPct(p.portfolioMaxDd).padStart(8)}` +
      `${(p.portfolioWinRate * 100).toFixed(0).padStart(6)}%` +
      `${formatDollar(p.totalFees).padStart(10)}` +
      `${String(p.allocations.length).padStart(10)}${best}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  // ── Section 3: Recommended Portfolio Detail ──

  const recommended = portfolios[0];
  console.log();
  console.log("=".repeat(W));
  console.log(`  RECOMMENDED PORTFOLIO: ${recommended.name.toUpperCase()}`);
  console.log("=".repeat(W));
  console.log();
  console.log(`  Total PnL:        ${formatDollar(recommended.totalPnl)}`);
  console.log(`  Period Return:    ${formatPct(recommended.portfolioReturn)}`);
  console.log(`  Annualized:       ${formatPct(recommended.annualizedPct)}`);
  console.log(`  Sharpe Ratio:     ${recommended.portfolioSharpe.toFixed(2)}`);
  console.log(`  Max Drawdown:     ${formatPct(recommended.portfolioMaxDd)}`);
  console.log(`  Win Rate:         ${(recommended.portfolioWinRate * 100).toFixed(1)}%`);
  console.log(`  Total Fees:       ${formatDollar(recommended.totalFees)}`);
  console.log(`  Positions:        ${recommended.allocations.length}/${topCoins.length}`);
  console.log();

  console.log("  ALLOCATION BREAKDOWN");
  console.log("  " + "-".repeat(W - 2));
  console.log(
    "  " +
    "Coin".padEnd(8) +
    "Weight".padStart(8) +
    "Capital".padStart(12) +
    "Score".padStart(8) +
    "Sharpe".padStart(8) +
    "MDD%".padStart(8)
  );
  console.log("  " + "-".repeat(W - 2));

  for (const a of recommended.allocations) {
    console.log(
      `  ${a.coin.padEnd(8)}` +
      `${formatPct(a.weight * 100).padStart(8)}` +
      `${formatDollar(a.capital).padStart(12)}` +
      `${a.score.toFixed(0).padStart(8)}` +
      `${a.sharpe.toFixed(2).padStart(8)}` +
      `${formatPct(a.maxDd).padStart(8)}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  // ── Section 4: Position Details ──

  console.log();
  console.log("=".repeat(W));
  console.log("  POSITION DETAILS");
  console.log("=".repeat(W));
  console.log();

  for (let i = 0; i < recommended.allocations.length; i++) {
    const a = recommended.allocations[i];
    const opt = topCoins.find((c) => c.coin === a.coin)!;
    const strat = opt.bestCombo.strategy === "spot_vs_perp" ? "Spot vs Perp" : "Perp vs Perp";
    const be = opt.result.breakevenHours;

    console.log(`  ${i + 1}. ${opt.coin} (${opt.market.name}) — ${opt.bestCombo.label}`);
    console.log(`     Strategy:      ${strat} ${opt.bestCombo.exitOnNegative ? "(exit on neg)" : "(hold through)"}`);
    console.log(`     Allocation:    ${formatDollar(a.capital)} (${formatPct(a.weight * 100)})`);
    console.log(`     PnL (scaled):  ${formatDollar(opt.netPnl * (a.capital / TOTAL_CAPITAL))}`);
    console.log(`     Annualized:    ${formatPct(opt.apy)}`);
    console.log(`     Funding Net:   ${formatDollar(opt.fundingCollected)}`);
    console.log(`     Fees:          ${formatDollar(opt.totalFees * (a.capital / TOTAL_CAPITAL))}`);
    console.log(`     Trades:        ${opt.result.totalTrades} (${(opt.winRate * 100).toFixed(0)}% win)`);
    console.log(`     Max Drawdown:  ${formatPct(opt.maxDrawdownPct)}`);
    console.log(`     Sharpe:        ${opt.sharpeRatio.toFixed(2)}`);
    console.log(`     Breakeven:     ${formatBe(be)}`);
    if (opt.result.liquidationEvents.length > 0) {
      console.log(`     LIQUIDATIONS:  ${opt.result.liquidationEvents.length} events`);
    }
    console.log();
  }

  // ── Section 5: Correlation Matrix ──

  if (recommended.allocations.length >= 2) {
    console.log("=".repeat(W));
    console.log("  CORRELATION MATRIX (PnL overlap)");
    console.log("=".repeat(W));
    console.log();

    const corrMatrix = computeCorrelationMatrix(topCoins);
    const coinNames = topCoins.map((c) => c.coin);

    // Header
    const colW = 8;
    let header = "  " + "".padEnd(8);
    for (const name of coinNames) header += name.padStart(colW);
    console.log(header);
    console.log("  " + "-".repeat(8 + coinNames.length * colW));

    for (const a of coinNames) {
      let row = `  ${a.padEnd(8)}`;
      for (const b of coinNames) {
        const val = corrMatrix.get(a)?.get(b) ?? 0;
        const display = val === 1 ? "  1.00" : (val >= 0 ? " " : "") + val.toFixed(2);
        row += display.padStart(colW);
      }
      console.log(row);
    }

    // Highlight high correlations
    const highCorr: Array<{ a: string; b: string; corr: number }> = [];
    for (let i = 0; i < coinNames.length; i++) {
      for (let j = i + 1; j < coinNames.length; j++) {
        const corr = corrMatrix.get(coinNames[i])?.get(coinNames[j]) ?? 0;
        if (Math.abs(corr) > 0.7) {
          highCorr.push({ a: coinNames[i], b: coinNames[j], corr });
        }
      }
    }

    if (highCorr.length > 0) {
      console.log();
      console.log("  WARNING: High correlation detected (>0.7):");
      for (const h of highCorr) {
        console.log(`    ${h.a} <-> ${h.b}: ${h.corr.toFixed(2)}`);
      }
      console.log("  Consider reducing allocation to one of these to diversify.");
    }
  }

  // ── Section 6: Risk Summary ──

  console.log();
  console.log("=".repeat(W));
  console.log("  RISK SUMMARY");
  console.log("=".repeat(W));
  console.log();

  const totalAllocated = recommended.allocations.reduce((s, a) => s + a.capital, 0);
  const unallocated = TOTAL_CAPITAL - totalAllocated;
  const maxSingleDd = Math.max(...recommended.allocations.map((a) => a.maxDd));
  const avgSharpe = recommended.portfolioSharpe;
  const hasLiquidationRisk = topCoins.some((c) => c.result.liquidationEvents.length > 0);

  console.log(`  Total Capital:         ${formatDollar(TOTAL_CAPITAL)}`);
  console.log(`  Allocated:             ${formatDollar(totalAllocated)} (${formatPct((totalAllocated / TOTAL_CAPITAL) * 100)})`);
  if (unallocated > 0) {
    console.log(`  Cash Reserve:          ${formatDollar(unallocated)} (${formatPct((unallocated / TOTAL_CAPITAL) * 100)})`);
  }
  console.log(`  Number of Positions:   ${recommended.allocations.length}`);
  console.log(`  Concentration (max):   ${formatPct(Math.max(...recommended.allocations.map((a) => a.weight * 100)))}`);
  console.log(`  Portfolio Sharpe:      ${avgSharpe.toFixed(2)}`);
  console.log(`  Worst-Case Single DD:  ${formatPct(maxSingleDd)}`);
  console.log(`  Est. Portfolio DD:     ${formatPct(recommended.portfolioMaxDd)}`);
  if (hasLiquidationRisk) {
    console.log(`  LIQUIDATION RISK:      YES — some positions have liquidation events`);
  } else {
    console.log(`  Liquidation Risk:      None detected`);
  }

  // ── Section 7: Action Plan ──

  console.log();
  console.log("=".repeat(W));
  console.log("  ACTION PLAN");
  console.log("=".repeat(W));
  console.log();

  for (let i = 0; i < recommended.allocations.length; i++) {
    const a = recommended.allocations[i];
    const opt = topCoins.find((c) => c.coin === a.coin)!;
    const dir = opt.bestCombo.strategy === "spot_vs_perp"
      ? `Long ${opt.coin} spot + Short ${opt.coin} perp on ${getVenueName(opt.bestCombo.venueA)}`
      : `Long ${opt.coin} on ${getVenueName(opt.bestCombo.venueA)} + Short ${opt.coin} on ${getVenueName(opt.bestCombo.venueB)}`;
    const exitMode = opt.bestCombo.exitOnNegative ? "Exit if funding turns negative" : "Hold through negative funding";

    console.log(`  ${i + 1}. ${opt.coin}: Allocate ${formatDollar(a.capital)}`);
    console.log(`     ${dir}`);
    console.log(`     Exit mode: ${exitMode}`);
    console.log();
  }

  console.log("=".repeat(W));
  console.log(`  Run: bun run src/optimize-basket.ts ${topCoins.map((c) => c.coin).join(" ")} --capital ${TOTAL_CAPITAL} --days ${DAYS}`);
  console.log("=".repeat(W));
}

function getVenueName(id: string): string {
  const perp = getPerpExchange(id);
  if (perp) return perp.info.name;
  const spot = getSpotExchange(id);
  if (spot) return spot.info.name;
  return id;
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
