/**
 * Stock Basket Venue Pair Optimizer
 *
 * Finds the best venue pair for a basket of tokenized stocks.
 * Strategy: Long tokenized stock on BSC/Uniswap/PancakeSwap + Short stock perp on Hyperliquid/Lighter
 *
 * Uses real stock prices (Yahoo Finance) as proxy for BSC tokenized stocks (1:1 tracking).
 * Fetches funding rates from Hyperliquid HIP-3 stock perps and Lighter.
 *
 * Supports multiple spot venues:
 *   - Uniswap V3 (BSC): bStocks, Ondo tokens
 *   - PancakeSwap (BSC): bStocks, Ondo tokens
 *   - BSC Stocks (generic): Yahoo Finance proxy
 *
 * Usage:
 *   bun run src/optimize-stocks.ts TSLA NVDA AAPL MSFT [options]
 *   bun run src/optimize-stocks.ts --all [options]
 *   bun run src/optimize-stocks.ts --category tech [options]
 *   bun run src/optimize-stocks.ts --spot uniswap [options]
 *
 * Options:
 *   --days <n>        Backtest period in days (default: 30)
 *   --capital <n>     Capital per position (default: 50000)
 *   --all             Use all available stocks
 *   --category <cat>  Filter: mega, semi, crypto, etf, space
 *   --spot <venue>    Spot venue: uniswap, pancakeswap, bsc-stocks, all (default: all)
 *   --min-profit <n>  Min avg profit % to rank (default: 0)
 *   --exclude <tickers> Comma-separated to exclude
 *   --discover        Discover available pools on Uniswap BSC
 */

import { HyperliquidExchange } from "./exchanges/hyperliquid";
import { LighterExchange } from "./exchanges/lighter";
import { runBacktest, EXCHANGE_FEES, type BacktestConfig, type FeeModel } from "./backtest";
import {
  TOKENIZED_STOCKS,
  fetchStockPriceHistory,
  discoverStockPools,
  discoverUniswapStockPools,
  type TokenizedStock,
} from "./exchanges/uniswap-stocks";
import type { FundingRateEntry } from "./exchanges/types";

// ── CLI Parsing ──

const args = process.argv.slice(2);
let CAPITAL = 50_000;
let DAYS = 30;
let MIN_PROFIT_PCT = 0;
let USE_ALL = false;
let CATEGORY: string | null = null;
let SPOT_VENUE: "all" | "uniswap" | "pancakeswap" | "bsc-stocks" = "all";
let EXCLUDE = new Set<string>();
let TICKERS: string[] = [];
let DISCOVER_MODE = false;
let HL_TICKER_MAP = new Map<string, string>(); // manual HL ticker overrides

const consumed = new Set<number>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--capital" && args[i + 1]) {
    CAPITAL = parseFloat(args[i + 1]) || 50_000;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--days" && args[i + 1]) {
    DAYS = parseInt(args[i + 1]) || 30;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--min-profit" && args[i + 1]) {
    MIN_PROFIT_PCT = parseFloat(args[i + 1]) || 0;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--spot" && args[i + 1]) {
    const val = args[i + 1].toLowerCase();
    if (["uniswap", "pancakeswap", "bsc-stocks", "all"].includes(val)) {
      SPOT_VENUE = val as typeof SPOT_VENUE;
    }
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--hl-map" && args[i + 1]) {
    // Manual HL ticker mapping: --hl-map TSLA:TSLAUSD,NVDA:NVDAUSD
    for (const pair of args[i + 1].split(",")) {
      const [stock, hl] = pair.split(":");
      if (stock && hl) HL_TICKER_MAP.set(stock.toUpperCase().trim(), hl.trim());
    }
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--all") {
    USE_ALL = true;
    consumed.add(i);
  } else if (args[i] === "--discover") {
    DISCOVER_MODE = true;
    consumed.add(i);
  } else if (args[i] === "--category" && args[i + 1]) {
    CATEGORY = args[i + 1] || null;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--exclude" && args[i + 1]) {
    for (const c of args[i + 1].split(",")) EXCLUDE.add(c.toUpperCase().trim());
    consumed.add(i); consumed.add(i + 1); i++;
  }
}
for (let i = 0; i < args.length; i++) {
  if (consumed.has(i)) continue;
  if (!args[i].startsWith("--") && isNaN(Number(args[i]))) {
    TICKERS.push(args[i].toUpperCase());
  }
}

// ── Category Definitions ──

const CATEGORIES: Record<string, string[]> = {
  mega: ["TSLA", "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NFLX"],
  semi: ["NVDA", "AMD", "MU", "INTC", "TSM", "AVGO", "ARM", "CRWV", "ORCL"],
  crypto: ["COIN", "MSTR", "HOOD", "PLTR"],
  etf: ["SPY", "QQQ"],
  space: ["SPCX"],
};

// ── Types ──

interface StockBacktestResult {
  ticker: string;
  name: string;
  spotVenue: string;
  perpVenue: "hyperliquid" | "lighter";
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
}

interface AggregatedVenue {
  spotVenue: string;
  perpVenue: "hyperliquid" | "lighter";
  exitOnNegative: boolean;
  totalPnl: number;
  avgProfitPct: number;
  stocksCount: number;
  profitableStocks: number;
  totalFees: number;
  totalFunding: number;
  totalTrades: number;
  avgWinRate: number;
  avgMaxDd: number;
  avgSharpe: number;
  totalLiquidations: number;
  label: string;
  breakdown: StockBacktestResult[];
}

// ── Spot Venue Fee Models ──

const SPOT_FEES: Record<string, FeeModel> = {
  uniswap: { takerFeeBps: 5.0, makerFeeBps: 5.0, avgSpreadBps: 5.0 },
  pancakeswap: { takerFeeBps: 2.5, makerFeeBps: 2.5, avgSpreadBps: 3.0 },
  "bsc-stocks": { takerFeeBps: 3.0, makerFeeBps: 1.0, avgSpreadBps: 2.0 },
};

// ── Stock Category Lookup ──

function getStockCategory(ticker: string): string {
  for (const [cat, tickers] of Object.entries(CATEGORIES)) {
    if (tickers.includes(ticker)) return cat;
  }
  return "other";
}

// ── Pool Discovery Mode ──

async function runDiscovery() {
  console.log("=".repeat(116));
  console.log("  UNISWAP BSC STOCK POOL DISCOVERY");
  console.log("=".repeat(116));
  console.log();

  console.log("  Scanning DeFi Llama for tokenized stock pools on BSC...");
  const allPools = await discoverStockPools();

  if (allPools.length === 0) {
    console.log("  No tokenized stock pools found on BSC.");
    console.log("  This could mean:");
    console.log("    - No pools exist yet for these tokens");
    console.log("    - DeFi Llama API is rate-limited");
    console.log("    - Token addresses need to be updated");
    console.log();
    console.log("  Available tokenized stocks in registry:");
    for (const stock of TOKENIZED_STOCKS) {
      const tokens = stock.tokens.map((t) => `${t.symbol} (${t.issuer})`).join(", ");
      console.log(`    ${stock.ticker.padEnd(6)} ${stock.name.padEnd(22)} ${tokens}`);
    }
    return;
  }

  console.log(`  Found ${allPools.length} pools:`);
  console.log();
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "DEX".padEnd(16) +
    "Symbol".padEnd(16) +
    "TVL".padStart(12) +
    "Vol 24h".padStart(12) +
    "Price".padStart(10)
  );
  console.log("  " + "-".repeat(72));

  for (let i = 0; i < Math.min(allPools.length, 30); i++) {
    const pool = allPools[i];
    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${pool.project.padEnd(16)}` +
      `${pool.symbol.padEnd(16)}` +
      `${fmtDollar(pool.tvl).padStart(12)}` +
      `${fmtDollar(pool.volume24h).padStart(12)}` +
      `${`$${pool.price.toFixed(2)}`.padStart(10)}`
    );
  }

  // Also show Uniswap-specific pools
  const uniPools = allPools.filter(
    (p) => p.project.toLowerCase().includes("uniswap")
  );
  const cakePools = allPools.filter(
    (p) => p.project.toLowerCase().includes("pancakeswap")
  );

  console.log();
  console.log(`  Uniswap pools: ${uniPools.length}  |  PancakeSwap pools: ${cakePools.length}`);
}

// ── Main ──

async function main() {
  // Discovery mode
  if (DISCOVER_MODE) {
    await runDiscovery();
    return;
  }

  const W = 120;
  const hl = new HyperliquidExchange();
  const lighter = new LighterExchange();

  console.log("=".repeat(W));
  console.log("  STOCK BASKET VENUE PAIR OPTIMIZER");
  console.log("  Long tokenized stock on BSC/Uniswap + Short stock perp on Hyperliquid/Lighter");
  console.log("=".repeat(W));
  console.log();
  console.log(`  Capital/position: $${CAPITAL.toLocaleString()}`);
  console.log(`  Period:           ${DAYS} days`);
  console.log(`  Spot venue:       ${SPOT_VENUE}`);
  if (HL_TICKER_MAP.size > 0) {
    console.log(`  HL ticker map:    ${Array.from(HL_TICKER_MAP.entries()).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (CATEGORY) console.log(`  Category:         ${CATEGORY}`);
  if (TICKERS.length > 0) console.log(`  Stocks:           ${TICKERS.join(", ")}`);
  if (USE_ALL) console.log(`  Stocks:           ALL available`);
  console.log();

  // Resolve stock list
  let stocks: TokenizedStock[];
  if (USE_ALL) {
    stocks = TOKENIZED_STOCKS.filter((s) => !EXCLUDE.has(s.ticker));
  } else if (CATEGORY) {
    const catTickers = CATEGORIES[CATEGORY.toLowerCase()];
    if (!catTickers) {
      console.error(`  Category "${CATEGORY}" not found. Options: ${Object.keys(CATEGORIES).join(", ")}`);
      process.exit(1);
    }
    stocks = TOKENIZED_STOCKS.filter(
      (s) => catTickers.includes(s.ticker) && !EXCLUDE.has(s.ticker)
    );
  } else if (TICKERS.length > 0) {
    stocks = TICKERS.map((t) => {
      const s = TOKENIZED_STOCKS.find((x) => x.ticker === t);
      if (!s) { console.error(`  Stock "${t}" not found in registry.`); process.exit(1); }
      return s;
    }).filter((s) => !EXCLUDE.has(s.ticker));
  } else {
    console.error("  Provide stock tickers, --all, or --category.");
    process.exit(1);
  }

  if (stocks.length === 0) {
    console.error("  No stocks to scan.");
    process.exit(1);
  }

  // Check which Hyperliquid coins are available
  console.log("  Checking Hyperliquid availability...");
  let hlCoins: string[] = [];
  try {
    hlCoins = await hl.getAvailableCoins();
  } catch {
    console.log("  WARNING: Could not fetch Hyperliquid coins");
  }

  const hlAvailable = new Set(hlCoins.map((c) => c.toUpperCase()));

  // Fuzzy match: Hyperliquid may use variations like TSLAUSD, stock:TSLA, tsla, etc.
  function findHLTicker(stock: TokenizedStock): string | null {
    const ticker = stock.hyperliquidTicker.toUpperCase();

    // 0. Manual override from --hl-map flag
    if (HL_TICKER_MAP.has(stock.ticker)) {
      const mapped = HL_TICKER_MAP.get(stock.ticker)!;
      if (hlAvailable.has(mapped.toUpperCase())) return mapped;
    }

    // 1. Exact match
    if (hlAvailable.has(ticker)) return ticker;

    // 2. Check with USD suffix (TSLAUSD, TSLA/USD, etc.)
    for (const suffix of ["USD", "/USD", "-USD"]) {
      if (hlAvailable.has(ticker + suffix)) return ticker + suffix;
    }

    // 3. Check with prefix variations (stock:TSLA, xyz:TSLA, etc.)
    for (const coin of hlCoins) {
      const upper = coin.toUpperCase();
      // HIP-3 format: "dex:COIN"
      if (upper.includes(":")) {
        const parts = upper.split(":");
        if (parts[1] === ticker || parts[1].startsWith(ticker)) return coin;
      }
    }

    // 4. Fuzzy: any coin that starts with or contains the ticker
    for (const coin of hlCoins) {
      const upper = coin.toUpperCase();
      if (upper === ticker || upper.startsWith(ticker) || upper.endsWith(ticker)) return coin;
    }

    return null;
  }

  // Map stocks to their HL tickers
  const stockToHL = new Map<string, string>();
  const availableStocks: TokenizedStock[] = [];
  for (const stock of stocks) {
    const hlTicker = findHLTicker(stock);
    if (hlTicker) {
      stockToHL.set(stock.ticker, hlTicker);
      availableStocks.push(stock);
    }
  }

  if (availableStocks.length === 0) {
    console.error("  None of the requested stocks are available on Hyperliquid.");
    console.log(`  Requested: ${stocks.map((s) => s.ticker).join(", ")}`);
    console.log(`  Hyperliquid has ${hlAvailable.size} coins`);
    // Show some stock-like tickers for debugging
    const stockLike = hlCoins.filter((c) => {
      const u = c.toUpperCase();
      return u.includes("TSLA") || u.includes("NVDA") || u.includes("AAPL") || u.includes("SPY") || u.includes("STOCK") || u.includes("HIP");
    });
    if (stockLike.length > 0) {
      console.log(`  Stock-like tickers found: ${stockLike.join(", ")}`);
    }
    return;
  }

  console.log(`  ${availableStocks.length}/${stocks.length} stocks available on Hyperliquid perps`);
  for (const stock of availableStocks) {
    const hlTicker = stockToHL.get(stock.ticker);
    if (hlTicker !== stock.hyperliquidTicker) {
      console.log(`    ${stock.ticker} -> HL ticker: ${hlTicker}`);
    }
  }
  console.log();

  const endTime = Date.now();
  const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

  // ── Fetch all data ──

  const allResults: StockBacktestResult[] = [];
  let done = 0;

  for (const stock of availableStocks) {
    done++;
    process.stdout.write(`\r  [${done}/${availableStocks.length}] ${stock.ticker.padEnd(6)} `);

    // Fetch Hyperliquid funding rate for this stock perp (use mapped HL ticker)
    const hlTicker = stockToHL.get(stock.ticker) || stock.hyperliquidTicker;
    let hlFunding: FundingRateEntry[] = [];
    try {
      hlFunding = await Promise.race([
        hl.fetchFundingRates(hlTicker, startTime, endTime),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000)),
      ]);
    } catch {}

    // Fetch Lighter funding rate if available
    let lighterFunding: FundingRateEntry[] = [];
    if (stock.lighterTicker) {
      try {
        lighterFunding = await Promise.race([
          lighter.fetchFundingRates(stock.lighterTicker, startTime, endTime),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000)),
        ]);
      } catch {}
    }

    // Fetch real stock price from Yahoo Finance (proxy for BSC spot)
    let stockPrices: Array<{ timestamp: number; price: number }> = [];
    try {
      stockPrices = await Promise.race([
        fetchStockPriceHistory(stock.ticker, startTime, endTime),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
      ]);
    } catch {}

    if (hlFunding.length < 2 && lighterFunding.length < 2) continue;

    // Determine which spot venues to test
    const spotVenues: Array<{ id: string; label: string; fee: FeeModel }> = [];
    if (SPOT_VENUE === "all" || SPOT_VENUE === "uniswap") {
      spotVenues.push({ id: "uniswap-stocks", label: "Uniswap BSC", fee: SPOT_FEES.uniswap });
    }
    if (SPOT_VENUE === "all" || SPOT_VENUE === "pancakeswap") {
      spotVenues.push({ id: "pancakeswap", label: "PancakeSwap BSC", fee: SPOT_FEES.pancakeswap });
    }
    if (SPOT_VENUE === "all" || SPOT_VENUE === "bsc-stocks") {
      spotVenues.push({ id: "bsc-stocks", label: "BSC Stocks (proxy)", fee: SPOT_FEES["bsc-stocks"] });
    }

    // ── Test Hyperliquid perp ──

    if (hlFunding.length >= 2) {
      for (const spot of spotVenues) {
        for (const exitOnNeg of [false, true]) {
          const spotFunding = hlFunding.map((r) => ({
            ...r,
            fundingRate: 0,
            coin: `${stock.ticker}-spot`,
          }));

          const config: Partial<BacktestConfig> = {
            initialCapital: CAPITAL,
            strategy: "spot_vs_perp",
            fundingThreshold: 0.00001,
            maxSpreadBps: 100,
            maxPositionSize: CAPITAL * 0.5,
            venueA: "hyperliquid",
            venueB: spot.id,
            feeA: EXCHANGE_FEES.hyperliquid,
            feeB: spot.fee,
            useMakerFees: false,
            exitOnNegativeFunding: exitOnNeg,
            perpLeverageA: 2,
            perpLeverageB: 2,
            priceData: stockPrices,
          };

          try {
            const result = runBacktest(hlFunding, spotFunding, config);
            allResults.push({
              ticker: stock.ticker,
              name: stock.name,
              spotVenue: spot.label,
              perpVenue: "hyperliquid",
              netPnl: result.totalPnl,
              netProfitPct: (result.totalPnl / CAPITAL) * 100,
              totalFees: result.totalFees,
              totalFunding: result.totalFundingCollected - result.totalFundingPaid,
              trades: result.totalTrades,
              winRate: result.winRate,
              maxDrawdownPct: result.maxDrawdownPct * 100,
              breakevenHours: result.breakevenHours,
              sharpeRatio: result.sharpeRatio,
              liquidations: result.liquidationEvents.length,
              exitOnNegative: exitOnNeg,
            });
          } catch {}
        }
      }
    }

    // ── Test Lighter perp (if available) ──

    if (lighterFunding.length >= 2) {
      for (const spot of spotVenues) {
        for (const exitOnNeg of [false, true]) {
          const spotFunding = lighterFunding.map((r) => ({
            ...r,
            fundingRate: 0,
            coin: `${stock.ticker}-spot`,
          }));

          const config: Partial<BacktestConfig> = {
            initialCapital: CAPITAL,
            strategy: "spot_vs_perp",
            fundingThreshold: 0.00001,
            maxSpreadBps: 100,
            maxPositionSize: CAPITAL * 0.5,
            venueA: "lighter",
            venueB: spot.id,
            feeA: EXCHANGE_FEES.lighter,
            feeB: spot.fee,
            useMakerFees: false,
            exitOnNegativeFunding: exitOnNeg,
            perpLeverageA: 2,
            perpLeverageB: 2,
            priceData: stockPrices,
          };

          try {
            const result = runBacktest(lighterFunding, spotFunding, config);
            allResults.push({
              ticker: stock.ticker,
              name: stock.name,
              spotVenue: spot.label,
              perpVenue: "lighter",
              netPnl: result.totalPnl,
              netProfitPct: (result.totalPnl / CAPITAL) * 100,
              totalFees: result.totalFees,
              totalFunding: result.totalFundingCollected - result.totalFundingPaid,
              trades: result.totalTrades,
              winRate: result.winRate,
              maxDrawdownPct: result.maxDrawdownPct * 100,
              breakevenHours: result.breakevenHours,
              sharpeRatio: result.sharpeRatio,
              liquidations: result.liquidationEvents.length,
              exitOnNegative: exitOnNeg,
            });
          } catch {}
        }
      }
    }
  }

  process.stdout.write("\r" + " ".repeat(80) + "\r");

  if (allResults.length === 0) {
    console.log("  No backtest data available. Try a longer period or different stocks.");
    return;
  }

  // ── Aggregate by spot venue + perp venue + exit mode ──

  const groups = new Map<string, StockBacktestResult[]>();
  for (const r of allResults) {
    const key = `${r.spotVenue}|${r.perpVenue}|${r.exitOnNegative}`;
    const arr = groups.get(key) || [];
    arr.push(r);
    groups.set(key, arr);
  }

  const aggregated: AggregatedVenue[] = [];
  for (const [, results] of groups) {
    if (results.length === 0) continue;

    // Deduplicate: keep best result per ticker
    const bestByTicker = new Map<string, StockBacktestResult>();
    for (const r of results) {
      const existing = bestByTicker.get(r.ticker);
      if (!existing || r.netPnl > existing.netPnl) {
        bestByTicker.set(r.ticker, r);
      }
    }
    const deduped = Array.from(bestByTicker.values());

    const totalPnl = deduped.reduce((s, r) => s + r.netPnl, 0);
    const profitable = deduped.filter((r) => r.netPnl > 0);

    aggregated.push({
      spotVenue: deduped[0].spotVenue,
      perpVenue: deduped[0].perpVenue,
      exitOnNegative: deduped[0].exitOnNegative,
      totalPnl,
      avgProfitPct: deduped.reduce((s, r) => s + r.netProfitPct, 0) / deduped.length,
      stocksCount: deduped.length,
      profitableStocks: profitable.length,
      totalFees: deduped.reduce((s, r) => s + r.totalFees, 0),
      totalFunding: deduped.reduce((s, r) => s + r.totalFunding, 0),
      totalTrades: deduped.reduce((s, r) => s + r.trades, 0),
      avgWinRate: deduped.reduce((s, r) => s + r.winRate, 0) / deduped.length,
      avgMaxDd: deduped.reduce((s, r) => s + r.maxDrawdownPct, 0) / deduped.length,
      avgSharpe: deduped.reduce((s, r) => s + r.sharpeRatio, 0) / deduped.length,
      totalLiquidations: deduped.reduce((s, r) => s + r.liquidations, 0),
      label: `${deduped[0].spotVenue} + ${deduped[0].perpVenue} (${deduped[0].exitOnNegative ? "exit neg" : "hold through"})`,
      breakdown: deduped.sort((a, b) => b.netPnl - a.netPnl),
    });
  }

  aggregated.sort((a, b) => b.totalPnl - a.totalPnl);

  // Filter by min profit
  const filtered = MIN_PROFIT_PCT > 0
    ? aggregated.filter((a) => a.avgProfitPct >= MIN_PROFIT_PCT)
    : aggregated;

  // ── Section 1: Top Venue Pairs ──

  console.log();
  console.log("=".repeat(W));
  console.log(`  TOP VENUE PAIRS FOR STOCK BASKET (${stocks.map((s) => s.ticker).join(", ")})`);
  console.log("=".repeat(W));
  console.log();
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "Venue Pair".padEnd(36) +
    "Exit".padEnd(5) +
    "Total PnL".padStart(11) +
    "Avg%".padStart(7) +
    "Stocks+".padStart(8) +
    "Win%".padStart(6) +
    "AvgDD%".padStart(7) +
    "Sharpe".padStart(7) +
    "Fees".padStart(9) +
    "Liq".padStart(5)
  );
  console.log("  " + "-".repeat(W - 2));

  const topVenues = filtered.slice(0, 10);
  for (let i = 0; i < topVenues.length; i++) {
    const a = topVenues[i];
    const exit = a.exitOnNegative ? "neg" : "---";
    const medal = i === 0 ? " <-- BEST" : "";

    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${a.label.padEnd(36)}` +
      `${exit.padEnd(5)}` +
      `${fmtDollar(a.totalPnl).padStart(11)}` +
      `${fmtPct(a.avgProfitPct).padStart(7)}` +
      `${(`${a.profitableStocks}/${a.stocksCount}`).padStart(8)}` +
      `${(a.avgWinRate * 100).toFixed(0).padStart(5)}%` +
      `${fmtPct(a.avgMaxDd).padStart(7)}` +
      `${a.avgSharpe.toFixed(2).padStart(7)}` +
      `${fmtDollar(a.totalFees).padStart(9)}` +
      `${(a.totalLiquidations > 0 ? a.totalLiquidations + "!" : "-").padStart(5)}${medal}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  // ── Section 2: Winner Detail ──

  const winner = topVenues[0];
  console.log();
  console.log("=".repeat(W));
  console.log(`  BEST VENUE: ${winner.label.toUpperCase()}`);
  console.log("=".repeat(W));
  console.log();
  console.log(`  Total PnL:       ${fmtDollar(winner.totalPnl)}`);
  console.log(`  Avg Profit:      ${fmtPct(winner.avgProfitPct)} per stock`);
  console.log(`  Profitable:      ${winner.profitableStocks}/${winner.stocksCount} stocks`);
  console.log(`  Avg Win Rate:    ${(winner.avgWinRate * 100).toFixed(1)}%`);
  console.log(`  Avg Max DD:      ${fmtPct(winner.avgMaxDd)}`);
  console.log(`  Avg Sharpe:      ${winner.avgSharpe.toFixed(2)}`);
  console.log(`  Total Fees:      ${fmtDollar(winner.totalFees)}`);
  console.log(`  Total Trades:    ${winner.totalTrades}`);
  if (winner.totalLiquidations > 0) {
    console.log(`  LIQUIDATIONS:    ${winner.totalLiquidations} events`);
  }

  // ── Section 3: Per-Stock Breakdown ──

  console.log();
  console.log("=".repeat(W));
  console.log(`  PER-STOCK BREAKDOWN`);
  console.log("=".repeat(W));
  console.log();
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "Ticker".padEnd(7) +
    "Name".padEnd(22) +
    "PnL".padStart(10) +
    "Profit%".padStart(9) +
    "Sharpe".padStart(7) +
    "Win%".padStart(6) +
    "MDD%".padStart(7) +
    "Trades".padStart(7) +
    "Fees".padStart(8) +
    "Funding".padStart(10) +
    "Breakeven".padStart(11) +
    "Liq".padStart(5)
  );
  console.log("  " + "-".repeat(W - 2));

  for (let i = 0; i < winner.breakdown.length; i++) {
    const r = winner.breakdown[i];
    const sign = r.netPnl >= 0 ? "+" : "";

    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${r.ticker.padEnd(7)}` +
      `${r.name.padEnd(22)}` +
      `${`${sign}${fmtDollar(r.netPnl)}`.padStart(10)}` +
      `${`${sign}${fmtPct(r.netProfitPct)}`.padStart(9)}` +
      `${r.sharpeRatio.toFixed(2).padStart(7)}` +
      `${(r.winRate * 100).toFixed(0).padStart(5)}%` +
      `${fmtPct(r.maxDrawdownPct).padStart(7)}` +
      `${String(r.trades).padStart(7)}` +
      `${fmtDollar(r.totalFees).padStart(8)}` +
      `${fmtDollar(r.totalFunding).padStart(10)}` +
      `${fmtBe(r.breakevenHours).padStart(11)}` +
      `${(r.liquidations > 0 ? r.liquidations + "!" : "-").padStart(5)}`
    );
  }
  console.log("  " + "-".repeat(W - 2));

  const winners = winner.breakdown.filter((r) => r.netPnl > 0);
  const losers = winner.breakdown.filter((r) => r.netPnl <= 0);
  console.log();
  console.log(`  Winners: ${winners.length}  |  Losers: ${losers.length}  |  Total PnL: ${fmtDollar(winner.totalPnl)}`);

  // ── Section 4: Spot Venue Comparison ──

  const spotGroups = new Map<string, AggregatedVenue[]>();
  for (const a of aggregated) {
    const key = a.spotVenue;
    const arr = spotGroups.get(key) || [];
    arr.push(a);
    spotGroups.set(key, arr);
  }

  if (spotGroups.size > 1) {
    console.log();
    console.log("=".repeat(W));
    console.log("  SPOT VENUE COMPARISON");
    console.log("=".repeat(W));
    console.log();

    console.log(`  ${"Spot Venue".padEnd(28)} ${"Total PnL".padStart(11)} ${"Avg%".padStart(7)} ${"Stocks".padStart(7)} ${"Fees".padStart(9)} ${"Sharpe".padStart(7)}`);
    console.log("  " + "-".repeat(72));

    for (const [spotVenue, venues] of spotGroups) {
      // Aggregate across all perp venues for this spot venue
      const allBreakdowns = venues.flatMap((v) => v.breakdown);
      const bestByTicker = new Map<string, StockBacktestResult>();
      for (const r of allBreakdowns) {
        const existing = bestByTicker.get(r.ticker);
        if (!existing || r.netPnl > existing.netPnl) {
          bestByTicker.set(r.ticker, r);
        }
      }
      const deduped = Array.from(bestByTicker.values());
      const totalPnl = deduped.reduce((s, r) => s + r.netPnl, 0);
      const avgPct = deduped.reduce((s, r) => s + r.netProfitPct, 0) / deduped.length;
      const totalFees = deduped.reduce((s, r) => s + r.totalFees, 0);
      const avgSharpe = deduped.reduce((s, r) => s + r.sharpeRatio, 0) / deduped.length;

      console.log(
        `  ${spotVenue.padEnd(28)} ` +
        `${fmtDollar(totalPnl).padStart(11)} ` +
        `${fmtPct(avgPct).padStart(7)} ` +
        `${String(deduped.length).padStart(7)} ` +
        `${fmtDollar(totalFees).padStart(9)} ` +
        `${avgSharpe.toFixed(2).padStart(7)}`
      );
    }
    console.log("  " + "-".repeat(72));

    // Find best spot venue
    let bestSpotVenue = "";
    let bestSpotPnl = -Infinity;
    for (const [spotVenue, venues] of spotGroups) {
      const allBreakdowns = venues.flatMap((v) => v.breakdown);
      const bestByTicker = new Map<string, StockBacktestResult>();
      for (const r of allBreakdowns) {
        const existing = bestByTicker.get(r.ticker);
        if (!existing || r.netPnl > existing.netPnl) {
          bestByTicker.set(r.ticker, r);
        }
      }
      const deduped = Array.from(bestByTicker.values());
      const totalPnl = deduped.reduce((s, r) => s + r.netPnl, 0);
      if (totalPnl > bestSpotPnl) {
        bestSpotPnl = totalPnl;
        bestSpotVenue = spotVenue;
      }
    }
    console.log(`  --> Best spot venue: ${bestSpotVenue}`);
  }

  // ── Section 5: Hyperliquid vs Lighter ──

  const hlResults = aggregated.filter((a) => a.perpVenue === "hyperliquid");
  const lighterResults = aggregated.filter((a) => a.perpVenue === "lighter");

  if (hlResults.length > 0 && lighterResults.length > 0) {
    console.log();
    console.log("=".repeat(W));
    console.log("  HYPERLIQUID vs LIGHTER");
    console.log("=".repeat(W));
    console.log();

    const bestHL = hlResults[0];
    const bestLT = lighterResults[0];

    console.log(`  ${"Metric".padEnd(22)} ${"Hyperliquid".padStart(18)} ${"Lighter".padStart(18)}`);
    console.log("  " + "-".repeat(58));
    console.log(`  ${"Best total PnL".padEnd(22)} ${fmtDollar(bestHL.totalPnl).padStart(18)} ${fmtDollar(bestLT.totalPnl).padStart(18)}`);
    console.log(`  ${"Best avg profit %".padEnd(22)} ${fmtPct(bestHL.avgProfitPct).padStart(18)} ${fmtPct(bestLT.avgProfitPct).padStart(18)}`);
    console.log(`  ${"Stocks with data".padEnd(22)} ${String(bestHL.stocksCount).padStart(18)} ${String(bestLT.stocksCount).padStart(18)}`);
    console.log(`  ${"Profitable stocks".padEnd(22)} ${`${bestHL.profitableStocks}/${bestHL.stocksCount}`.padStart(18)} ${`${bestLT.profitableStocks}/${bestLT.stocksCount}`.padStart(18)}`);
    console.log(`  ${"Avg Sharpe".padEnd(22)} ${bestHL.avgSharpe.toFixed(2).padStart(18)} ${bestLT.avgSharpe.toFixed(2).padStart(18)}`);

    const overallBest = bestHL.totalPnl > bestLT.totalPnl ? "Hyperliquid" : "Lighter";
    console.log();
    console.log(`  --> Overall winner: ${overallBest}`);
  }

  // ── Section 6: Action Plan ──

  console.log();
  console.log("=".repeat(W));
  console.log("  ACTION PLAN");
  console.log("=".repeat(W));
  console.log();
  console.log(`  Perp venue: ${winner.perpVenue === "hyperliquid" ? "Hyperliquid" : "Lighter"}`);
  console.log(`  Spot venue: ${winner.spotVenue}`);
  console.log(`  Exit mode:  ${winner.exitOnNegative ? "Exit when funding turns negative" : "Hold through negative funding"}`);
  console.log(`  Strategy:   Long tokenized stock on ${winner.spotVenue} + Short stock perp`);
  console.log();

  const profitList = winner.breakdown.filter((r) => r.netPnl > 0);
  const skipList = winner.breakdown.filter((r) => r.netPnl <= 0);

  if (profitList.length > 0) {
    console.log(`  Trade these stocks:`);
    for (const r of profitList) {
      console.log(`    + ${r.ticker.padEnd(6)} ${r.name.padEnd(20)} ${fmtDollar(r.netPnl).padStart(8)}  (${fmtPct(r.netProfitPct)})`);
    }
  }
  if (skipList.length > 0) {
    console.log();
    console.log(`  Skip or use different venue:`);
    for (const r of skipList) {
      console.log(`    - ${r.ticker.padEnd(6)} ${r.name.padEnd(20)} ${fmtDollar(r.netPnl).padStart(8)}  (${fmtPct(r.netProfitPct)})`);
    }
  }

  console.log();
  console.log("  Where to buy spot:");
  if (winner.spotVenue.includes("Uniswap")) {
    console.log("    - Uniswap V3 (BSC): Search for tokenized stock pools");
    console.log("    - App: https://app.uniswap.org (switch to BNB Chain)");
    console.log("    - Pool explorer: https://info.uniswap.org/#/bsc");
  } else if (winner.spotVenue.includes("PancakeSwap")) {
    console.log("    - PancakeSwap (BSC): https://pancakeswap.finance/stocks");
    console.log("    - bStocks: TSLAB, NVDAB, MSFTB, etc.");
    console.log("    - Ondo: TSLAon, NVDAon, AAPLon, etc.");
  } else {
    console.log("    - PancakeSwap (BSC): bStocks (TSLAB, NVDAB, etc.)");
    console.log("    - PancakeSwap (BSC): Ondo stocks (TSLAon, NVDAon, etc.)");
    console.log("    - Uniswap (BSC):     bStocks listed on Uniswap explore");
  }

  console.log();
  console.log("=".repeat(W));
  const hlMapStr = HL_TICKER_MAP.size > 0
    ? ` --hl-map ${Array.from(HL_TICKER_MAP.entries()).map(([k, v]) => `${k}:${v}`).join(",")}`
    : "";
  console.log(`  Re-run: bun run stocks ${stocks.map((s) => s.ticker).join(" ")} --capital ${CAPITAL} --days ${DAYS} --spot ${SPOT_VENUE}${hlMapStr}`);
  console.log("=".repeat(W));
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

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
