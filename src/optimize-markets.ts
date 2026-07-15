/**
 * Market Optimization Scanner
 *
 * Scans all markets for the best arbitrage opportunities in the last 24 hours.
 * Filters for breakeven profits > 0.1% (net of fees).
 *
 * Usage: bun run src/optimize-markets.ts [--capital 50000] [--category L1] [--min-profit 0.1]
 */

import { perpExchanges, spotExchanges, getPerpExchange, getSpotExchange } from "./exchanges";
import { UniswapSpotExchange } from "./exchanges/uniswap";
import { runBacktest, EXCHANGE_FEES, type BacktestConfig, type FeeModel } from "./backtest";
import { MARKETS, TRADITIONAL_MARKETS, type MarketConfig } from "./markets";
import type { FundingRateEntry } from "./exchanges/types";

// ── CLI args ──

const args = process.argv.slice(2);
let CAPITAL = 50000;
let MIN_PROFIT_PCT = 0.1;  // minimum net profit % to show
let CATEGORY: string | null = null;
let COINS: string[] = [];

const consumed = new Set<number>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--capital" && args[i + 1]) {
    CAPITAL = parseFloat(args[i + 1]) || 50000;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--min-profit" && args[i + 1]) {
    MIN_PROFIT_PCT = parseFloat(args[i + 1]) || 0.1;
    consumed.add(i); consumed.add(i + 1); i++;
  } else if (args[i] === "--category" && args[i + 1]) {
    CATEGORY = args[i + 1] || null;
    consumed.add(i); consumed.add(i + 1); i++;
  }
}
// Positional: coin names (skip consumed flag values)
for (let i = 0; i < args.length; i++) {
  if (consumed.has(i)) continue;
  if (!args[i].startsWith("--") && isNaN(Number(args[i]))) {
    COINS.push(args[i].toUpperCase());
  }
}

// ── Types ──

interface VenueResult {
  coin: string;
  name: string;
  category: string;
  strategy: "spot_vs_perp" | "perp_vs_perp";
  venueA: string;
  venueB: string;
  venueALabel: string;
  venueBLabel: string;
  totalPnl: number;
  netProfitPct: number;       // totalPnl / capital * 100
  totalFunding: number;
  totalFees: number;
  trades: number;
  winRate: number;
  maxDrawdownPct: number;
  breakevenHours: number;
  liquidations: number;
  liquidationLoss: number;
  avgSpreadBps: number;
  hourlySpreadBps: number;    // avg hourly funding spread
  annualizedPct: number;
}

// ── Fetch funding rates for all perp exchanges ──

const FETCH_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

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
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
      ]);
      cache.set(ex.info.id, rates);
    } catch {
      cache.set(ex.info.id, []);
    }
  });
  await Promise.allSettled(fetches);
  return cache;
}

// ── Run all venue pairs for a coin ──

function runAllPairs(
  coin: string,
  market: MarketConfig,
  fundingCache: Map<string, FundingRateEntry[]>,
  priceData: Array<{ timestamp: number; price: number }>,
  capital: number
): VenueResult[] {
  const results: VenueResult[] = [];

  // Spot vs Perp combos
  for (const spot of spotExchanges) {
    for (const perp of perpExchanges) {
      const perpRates = fundingCache.get(perp.info.id) || [];
      if (perpRates.length < 2) continue;

      // Use perp rates for both sides (spot side = 0 funding)
      const ratesA = perpRates;
      const ratesB = perpRates.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
      const feeA = EXCHANGE_FEES[perp.info.id] ?? EXCHANGE_FEES.hyperliquid;
      const feeB = EXCHANGE_FEES[spot.info.id] ?? EXCHANGE_FEES.uniswap;

      for (const exitOnNeg of [false, true]) {
        const config: Partial<BacktestConfig> = {
          initialCapital: capital,
          strategy: "spot_vs_perp",
          fundingThreshold: 0.00001,
          maxSpreadBps: 100,
          maxPositionSize: capital * 0.5,
          venueA: perp.info.id,
          venueB: spot.info.id,
          feeA,
          feeB,
          useMakerFees: false,
          exitOnNegativeFunding: exitOnNeg,
          perpLeverageA: 2,
          perpLeverageB: 2,
          priceData,
        };

        const result = runBacktest(ratesA, ratesB, config);
        const netProfitPct = (result.totalPnl / capital) * 100;
        if (netProfitPct < MIN_PROFIT_PCT) continue;

        const totalFunding = result.totalFundingCollected - result.totalFundingPaid;
        const avgSpread = result.trades.length > 0
          ? result.trades.reduce((s, t) => s + t.spreadBps, 0) / result.trades.length
          : 0;

        results.push({
          coin,
          name: market.name,
          category: market.category,
          strategy: "spot_vs_perp",
          venueA: perp.info.id,
          venueB: spot.info.id,
          venueALabel: perp.info.name,
          venueBLabel: spot.info.name,
          totalPnl: result.totalPnl,
          netProfitPct,
          totalFunding,
          totalFees: result.totalFees,
          trades: result.totalTrades,
          winRate: result.winRate,
          maxDrawdownPct: result.maxDrawdownPct * 100,
          breakevenHours: result.breakevenHours,
          liquidations: result.liquidationEvents.length,
          liquidationLoss: result.totalLiquidationLoss,
          avgSpreadBps: avgSpread,
          hourlySpreadBps: result.avgSpreadBps,
          annualizedPct: result.annualizedReturn * 100,
        });
      }
    }
  }

  // Perp vs Perp combos
  for (let i = 0; i < perpExchanges.length; i++) {
    for (let j = i + 1; j < perpExchanges.length; j++) {
      const exA = perpExchanges[i];
      const exB = perpExchanges[j];
      const ratesA = fundingCache.get(exA.info.id) || [];
      const ratesB = fundingCache.get(exB.info.id) || [];
      if (ratesA.length < 2 || ratesB.length < 2) continue;

      const feeA = EXCHANGE_FEES[exA.info.id] ?? EXCHANGE_FEES.hyperliquid;
      const feeB = EXCHANGE_FEES[exB.info.id] ?? EXCHANGE_FEES.aster;

      for (const exitOnNeg of [false, true]) {
        const config: Partial<BacktestConfig> = {
          initialCapital: capital,
          strategy: "perp_vs_perp",
          fundingThreshold: 0.00001,
          maxSpreadBps: 100,
          maxPositionSize: capital * 0.5,
          venueA: exA.info.id,
          venueB: exB.info.id,
          feeA,
          feeB,
          useMakerFees: false,
          exitOnNegativeFunding: exitOnNeg,
          perpLeverageA: 3,
          perpLeverageB: 3,
          priceData,
        };

        const result = runBacktest(ratesA, ratesB, config);
        const netProfitPct = (result.totalPnl / capital) * 100;
        if (netProfitPct < MIN_PROFIT_PCT) continue;

        const totalFunding = result.totalFundingCollected - result.totalFundingPaid;
        const avgSpread = result.trades.length > 0
          ? result.trades.reduce((s, t) => s + t.spreadBps, 0) / result.trades.length
          : 0;

        results.push({
          coin,
          name: market.name,
          category: market.category,
          strategy: "perp_vs_perp",
          venueA: exA.info.id,
          venueB: exB.info.id,
          venueALabel: exA.info.name,
          venueBLabel: exB.info.name,
          totalPnl: result.totalPnl,
          netProfitPct,
          totalFunding,
          totalFees: result.totalFees,
          trades: result.totalTrades,
          winRate: result.winRate,
          maxDrawdownPct: result.maxDrawdownPct * 100,
          breakevenHours: result.breakevenHours,
          liquidations: result.liquidationEvents.length,
          liquidationLoss: result.totalLiquidationLoss,
          avgSpreadBps: avgSpread,
          hourlySpreadBps: result.avgSpreadBps,
          annualizedPct: result.annualizedReturn * 100,
        });
      }
    }
  }

  return results;
}

// ── Main ──

async function main() {
  console.log("=".repeat(110));
  console.log("  MARKET ARBITRAGE OPTIMIZER");
  console.log("  Scans all markets for the best funding rate arbitrage in the last 24 hours");
  console.log("=".repeat(110));
  console.log();
  console.log(`  Capital:    $${CAPITAL.toLocaleString()}`);
  console.log(`  Min Profit: ${MIN_PROFIT_PCT}% net of fees`);
  if (CATEGORY) console.log(`  Category:   ${CATEGORY}`);
  if (COINS.length > 0) console.log(`  Coins:      ${COINS.join(", ")}`);
  console.log();

  // Select markets
  let markets = COINS.length > 0
    ? MARKETS.filter((m) => COINS.includes(m.hlCoin))
    : CATEGORY
      ? MARKETS.filter((m) => m.category === CATEGORY)
      : MARKETS;

  if (markets.length === 0) {
    console.error("  No matching markets found.");
    process.exit(1);
  }

  const endTime = Date.now();
  const startTime = endTime - FETCH_WINDOW_MS;

  console.log(`  Scanning ${markets.length} markets across ${perpExchanges.length} perp + ${spotExchanges.length} spot exchanges...`);
  console.log(`  That's ${markets.length * perpExchanges.length * (perpExchanges.length - 1) / 2} perp pairs + ${markets.length * spotExchanges.length * perpExchanges.length} spot/perp combos`);
  console.log();

  // Fetch price data from CoinGecko
  const uni = new UniswapSpotExchange();
  let priceData: Array<{ timestamp: number; price: number }> = [];
  try {
    priceData = await uni.fetchPrices("ETHUSDT", startTime, endTime);
  } catch {}

  const allResults: VenueResult[] = [];
  let scanned = 0;

  for (const market of markets) {
    scanned++;
    process.stdout.write(`\r  [${scanned}/${markets.length}] ${market.name.padEnd(20)} ${market.hlCoin.padEnd(6)}`);

    // Fetch funding rates for all perp exchanges
    const fundingCache = await fetchAllFunding(market.hlCoin, startTime, endTime);

    // Fetch coin-specific price data for liquidation checks
    let coinPriceData = priceData;
    if (market.hlCoin !== "ETH") {
      try {
        coinPriceData = await uni.fetchPrices(market.binanceSymbol, startTime, endTime);
      } catch {
        coinPriceData = [];
      }
    }

    // Run all pairs
    const coinResults = runAllPairs(
      market.hlCoin,
      market,
      fundingCache,
      coinPriceData,
      CAPITAL
    );
    allResults.push(...coinResults);
  }

  process.stdout.write("\r" + " ".repeat(80) + "\r");

  if (allResults.length === 0) {
    console.log("  No opportunities found with >" + MIN_PROFIT_PCT + "% net profit in the last 24 hours.");
    console.log();
    console.log("  Possible reasons:");
    console.log("    - Funding rates were too low across all venues");
    console.log("    - Fees ate into all profits");
    console.log("    - Price data unavailable for liquidation checks");
    console.log();
    console.log("  Try: lower --min-profit, or check during volatile periods.");
    return;
  }

  // Deduplicate: keep only best result per (coin, venueA, venueB, strategy)
  const bestByKey = new Map<string, VenueResult>();
  for (const r of allResults) {
    const key = `${r.coin}|${r.venueA}|${r.venueB}|${r.strategy}`;
    const existing = bestByKey.get(key);
    if (!existing || r.netProfitPct > existing.netProfitPct) {
      bestByKey.set(key, r);
    }
  }
  const deduped = Array.from(bestByKey.values());
  deduped.sort((a, b) => b.netProfitPct - a.netProfitPct);

  // Print results
  console.log("=".repeat(110));
  console.log(`  Found ${deduped.length} opportunities with >${MIN_PROFIT_PCT}% net profit`);
  console.log("=".repeat(110));
  console.log();

  // Table header
  console.log(
    "  " +
    "#".padStart(3) + "  " +
    "Coin".padEnd(8) +
    "Strategy".padEnd(14) +
    "Venue Pair".padEnd(28) +
    "Net PnL".padStart(10) +
    "Profit%".padStart(9) +
    "APY%".padStart(9) +
    "Fees".padStart(8) +
    "Trades".padStart(7) +
    "Win%".padStart(6) +
    "Liq".padStart(5)
  );
  console.log("  " + "-".repeat(106));

  const top = deduped.slice(0, 30);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const strat = r.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
    const pair = `${r.venueALabel} vs ${r.venueBLabel}`.padEnd(28);
    const pnl = `$${r.totalPnl.toFixed(0)}`.padStart(10);
    const pct = `${r.netProfitPct.toFixed(2)}%`.padStart(9);
    const apy = `${r.annualizedPct.toFixed(0)}%`.padStart(9);
    const fees = `$${r.totalFees.toFixed(0)}`.padStart(8);
    const trades = `${r.trades}`.padStart(7);
    const win = `${(r.winRate * 100).toFixed(0)}%`.padStart(6);
    const liq = r.liquidations > 0 ? `${r.liquidations}!`.padStart(5) : "  -".padStart(5);
    const medal = i === 0 ? " <- BEST" : i < 3 ? " *" : "";

    console.log(
      `  ${(i + 1 + ".").padStart(4)} ` +
      `${r.coin.padEnd(8)}` +
      `${strat.padEnd(14)}` +
      `${pair}` +
      `${pnl}` +
      `${pct}` +
      `${apy}` +
      `${fees}` +
      `${trades}` +
      `${win}` +
      `${liq}${medal}`
    );
  }

  console.log("  " + "-".repeat(106));

  // Top 3 details
  console.log();
  for (let i = 0; i < Math.min(3, top.length); i++) {
    const r = top[i];
    const strat = r.strategy === "spot_vs_perp" ? "Spot vs Perp" : "Perp vs Perp";
    const be = r.breakevenHours;
    let beStr: string;
    if (be < 0) beStr = "never";
    else if (be < 24) beStr = `${be} hours`;
    else beStr = `${(be / 24).toFixed(1)} days`;

    console.log(`  ${i + 1}. ${r.coin} (${r.name}) — ${r.venueALabel} vs ${r.venueBLabel}`);
    console.log(`     Strategy:      ${strat}`);
    console.log(`     Net Profit:    $${r.totalPnl.toFixed(2)} (${r.netProfitPct.toFixed(2)}%)`);
    console.log(`     Annualized:    ${r.annualizedPct.toFixed(1)}%`);
    console.log(`     Total Funding: $${r.totalFunding.toFixed(2)}`);
    console.log(`     Total Fees:    $${r.totalFees.toFixed(2)}`);
    console.log(`     Trades:        ${r.trades} (${(r.winRate * 100).toFixed(0)}% win rate)`);
    console.log(`     Max Drawdown:  ${r.maxDrawdownPct.toFixed(2)}%`);
    console.log(`     Breakeven:     ${beStr}`);
    if (r.liquidations > 0) {
      console.log(`     LIQUIDATIONS:  ${r.liquidations} events, $${r.liquidationLoss.toFixed(0)} lost`);
    }
    console.log();
  }

  console.log("=".repeat(110));
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
