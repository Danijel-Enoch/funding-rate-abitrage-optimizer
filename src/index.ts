/**
 * Basis Trading Backtest - CLI Mode
 *
 * Usage:
 *   bun run src/index.ts [coin] [days] [capital]
 *   bun run src/index.ts --optimize ETH [days] [capital]
 *   bun run src/index.ts --markets
 *   bun run src/index.ts --all [days] [capital]
 *   bun run src/index.ts --category L1 [days] [capital]
 *   bun run src/index.ts --list
 *   bun run src/index.ts --venue hyperliquid lighter ETH 30 50000
 */

import { HyperliquidExchange } from "./exchanges/hyperliquid";
import { UniswapSpotExchange } from "./exchanges/uniswap";
import { BinanceSpotExchange } from "./exchanges/binance";
import { runBacktest, type BacktestConfig } from "./backtest";
import { MARKETS, getCategories, getMarketsByCategory, type MarketConfig } from "./markets";
import { optimizeCoin, analyzeCrossovers, optimizeMultiPerp, MultiPerpOptResult } from "./optimize";

const hl = new HyperliquidExchange();
const spot = new UniswapSpotExchange();
const binanceSpot = new BinanceSpotExchange();

const args = process.argv.slice(2);
let MODE = "ETH";
let DAYS = 30;
let INITIAL_CAPITAL = 50000;
let VENUE_A = "hyperliquid";
let VENUE_B = "binance";

if (args[0] === "--list") {
  MODE = "--list";
} else if (args[0] === "--markets") {
  MODE = "--markets";
} else if (args[0] === "--optimize") {
  MODE = "--optimize";
  VENUE_A = args[1] || "ETH";
  DAYS = parseInt(args[2] || "30");
  INITIAL_CAPITAL = parseFloat(args[3] || "50000");
} else if (args[0] === "--multi") {
  MODE = "--multi";
  VENUE_A = args[1] || "ETH";
  DAYS = parseInt(args[2] || "30");
  INITIAL_CAPITAL = parseFloat(args[3] || "50000");
} else if (args[0] === "--all") {
  MODE = "--all";
  DAYS = parseInt(args[1] || "30");
  INITIAL_CAPITAL = parseFloat(args[2] || "50000");
} else if (args[0] === "--category") {
  MODE = "--category";
  DAYS = parseInt(args[2] || "30");
  INITIAL_CAPITAL = parseFloat(args[3] || "50000");
} else if (args[0] === "--venue") {
  MODE = "--venue";
  VENUE_A = args[1] || "hyperliquid";
  VENUE_B = args[2] || "binance";
  VENUE_A = args[3] || "ETH";
  DAYS = parseInt(args[4] || "30");
  INITIAL_CAPITAL = parseFloat(args[5] || "50000");
} else {
  MODE = args[0] || "ETH";
  DAYS = parseInt(args[1] || "30");
  INITIAL_CAPITAL = parseFloat(args[2] || "50000");
}

async function runSingleBacktest(market: MarketConfig, days: number, capital: number) {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  try {
    const ratesA = await Promise.race([
      hl.fetchFundingRates(market.hlCoin, startTime, endTime),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("HL timeout")), 20000)),
    ]);

    // Fetch prices from both exchanges in parallel for price spread tracking
    const [pricesHL, pricesBinance] = await Promise.all([
      Promise.race([
        spot.fetchPrices(market.binanceSymbol, startTime, endTime),
        new Promise<Array<{ timestamp: number; price: number }>>((_, rej) => setTimeout(() => rej(new Error("Spot timeout")), 20000)),
      ]).catch(() => [] as Array<{ timestamp: number; price: number }>),
      Promise.race([
        binanceSpot.fetchPrices(market.binanceSymbol, startTime, endTime),
        new Promise<Array<{ timestamp: number; price: number }>>((_, rej) => setTimeout(() => rej(new Error("Binance timeout")), 20000)),
      ]).catch(() => [] as Array<{ timestamp: number; price: number }>),
    ]);

    if (ratesA.length === 0) {
      console.error(`  ${market.hlCoin}: no HL funding data`);
      return null;
    }
    if (pricesHL.length === 0 && pricesBinance.length === 0) {
      console.error(`  ${market.hlCoin}: no price data from either exchange`);
      return null;
    }

    // Create synthetic spot funding (0 for all)
    const ratesB = ratesA.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));

    // Use Binance prices as primary for HL leg (closest perp venue match),
    // Uniswap prices for the Binance leg (or vice versa)
    const priceDataA = pricesBinance.length > 0 ? pricesBinance : pricesHL;
    const priceDataB = pricesHL.length > 0 ? pricesHL : pricesBinance;

    const config: Partial<BacktestConfig> = {
      initialCapital: capital,
      strategy: "spot_vs_perp",
      fundingThreshold: 0.00001,
      maxSpreadBps: 50,
      maxPositionSize: capital * 0.5,
      venueA: "binance",
      venueB: "hyperliquid",
      priceDataA,
      priceDataB,
    };

    const result = runBacktest(ratesA, ratesB, config);
    return { market, result };
  } catch (e: any) {
    console.error(`  ${market.hlCoin}: ${e?.message ?? "fetch failed"}`);
    return null;
  }
}

function printResult(market: MarketConfig, result: any, capital: number) {
  const ret = ((result.totalPnl / capital) * 100).toFixed(2);
  const ann = (result.annualizedReturn * 100).toFixed(1);
  const wr = (result.winRate * 100).toFixed(0);
  const dd = (result.maxDrawdown * 100).toFixed(1);
  const sr = result.sharpeRatio.toFixed(1);
  const trades = result.totalTrades;
  const pnl = result.totalPnl.toFixed(0);
  const be = result.breakevenHours;

  let beStr: string;
  if (be < 0) {
    beStr = "never";
  } else if (be < 24) {
    beStr = `${be}h`;
  } else {
    beStr = `${(be / 24).toFixed(1)}d`;
  }

  console.log(
    `  ${market.hlCoin.padEnd(8)}` +
    `${market.name.padEnd(25)}` +
    `${String(trades).padStart(5)}` +
    `${(wr + "%").padStart(6)}` +
    `$${pnl.padStart(8)}` +
    `${(ret + "%").padStart(8)}` +
    `${(ann + "%").padStart(8)}` +
    `${(dd + "%").padStart(7)}` +
    `${sr.padStart(7)}` +
    `${beStr.padStart(8)}`
  );
}

async function main() {
  if (MODE === "--list") {
    console.log("\nAvailable Markets:\n");
    const categories = getCategories();
    for (const cat of categories) {
      const markets = getMarketsByCategory(cat);
      console.log(`  ${cat} (${markets.length}):`);
      for (const m of markets) console.log(`    ${m.hlCoin.padEnd(10)} ${m.name}`);
      console.log();
    }
    console.log(`Total: ${MARKETS.length} markets`);
    return;
  }

  if (MODE === "--markets") {
    const ex = await import("./exchanges/index");

    console.log("=".repeat(100));
    console.log("  MARKET AVAILABILITY ACROSS EXCHANGES");
    console.log("=".repeat(100));
    console.log();
    console.log("  Fetching available coins from each exchange...\n");

    const [hlCoins, ligCoins, astCoins, extCoins, binCoins] = await Promise.all([
      ex.hyperliquid.getAvailableCoins().catch(() => [] as string[]),
      ex.lighter.getAvailableCoins().catch(() => [] as string[]),
      ex.aster.getAvailableCoins().catch(() => [] as string[]),
      ex.extended.getAvailableCoins().catch(() => [] as string[]),
      ex.binanceSpot.getAvailableSymbols().catch(() => [] as string[]),
    ]);

    // Normalize: strip USDT suffix from Binance, /USDC from Lighter
    const normalize = (s: string) => s.replace(/USDT$/, "").replace(/\/USDC$/, "").toUpperCase();

    const hlSet = new Set(hlCoins.map(normalize));
    const ligSet = new Set(ligCoins.map(normalize));
    const astSet = new Set(astCoins.map(normalize));
    const extSet = new Set(extCoins.map(normalize));
    const binSet = new Set(binCoins.map(normalize));

    // All unique coins
    const allCoins = new Set([...hlSet, ...ligSet, ...astSet, ...extSet, ...binSet]);

    console.log(`  Hyperliquid: ${hlSet.size} | Lighter: ${ligSet.size} | Aster: ${astSet.size} | Extended: ${extSet.size} | Binance: ${binSet.size}`);
    console.log();

    // Count how many exchanges each coin is on
    const coinVenueCount: Array<{ coin: string; venues: string[]; count: number }> = [];
    for (const coin of allCoins) {
      const venues: string[] = [];
      if (hlSet.has(coin)) venues.push("HL");
      if (ligSet.has(coin)) venues.push("LIG");
      if (astSet.has(coin)) venues.push("AST");
      if (extSet.has(coin)) venues.push("EXT");
      if (binSet.has(coin)) venues.push("BIN");
      coinVenueCount.push({ coin, venues, count: venues.length });
    }

    // Sort by venue count descending, then alphabetically
    coinVenueCount.sort((a, b) => b.count - a.count || a.coin.localeCompare(b.coin));

    // Show coins available on all 5 exchanges
    const all5 = coinVenueCount.filter((c) => c.count === 5);
    const any4 = coinVenueCount.filter((c) => c.count === 4);
    const any3 = coinVenueCount.filter((c) => c.count === 3);
    const any2 = coinVenueCount.filter((c) => c.count === 2);

    console.log("=".repeat(100));
    console.log(`  ALL 5 EXCHANGES (${all5.length} coins)`);
    console.log("-".repeat(100));
    for (const c of all5) {
      console.log(`    ${c.coin.padEnd(12)} ${c.venues.join(", ")}`);
    }

    console.log();
    console.log("=".repeat(100));
    console.log(`  4 EXCHANGES (${any4.length} coins)`);
    console.log("-".repeat(100));
    for (const c of any4) {
      console.log(`    ${c.coin.padEnd(12)} ${c.venues.join(", ")}`);
    }

    console.log();
    console.log("=".repeat(100));
    console.log(`  3 EXCHANGES (${any3.length} coins)`);
    console.log("-".repeat(100));
    for (const c of any3) {
      console.log(`    ${c.coin.padEnd(12)} ${c.venues.join(", ")}`);
    }

    console.log();
    console.log("=".repeat(100));
    console.log(`  2 EXCHANGES (${any2.length} coins)`);
    console.log("-".repeat(100));
    for (const c of any2) {
      console.log(`    ${c.coin.padEnd(12)} ${c.venues.join(", ")}`);
    }

    console.log();
    console.log("=".repeat(100));
    console.log(`  SUMMARY: ${all5.length} on all 5 | ${any4.length} on 4 | ${any3.length} on 3 | ${any2.length} on 2 | ${coinVenueCount.filter(c => c.count === 1).length} on 1`);
    console.log("=".repeat(100));
    return;
  }

  if (MODE === "--optimize") {
    const coin = VENUE_A.toUpperCase();
    console.log("=".repeat(90));
    console.log("  BACKTEST OPTIMIZATION (BasisOS Enhanced)");
    console.log("  Tests all strategy/venue combos with risk-adjusted leverage");
    console.log("  Includes rebalancing, objective function scoring, and RLmax per asset");
    console.log("  Perp vs Perp: leverage scaled to asset volatility");
    console.log("=".repeat(90));
    console.log();
    console.log(`  Coin:    ${coin}`);
    console.log(`  Period:  ${DAYS} days`);
    console.log(`  Capital: $${INITIAL_CAPITAL.toLocaleString()}`);
    console.log();
    console.log("  Fetching data...\n");

    const results = await optimizeCoin(coin, DAYS, INITIAL_CAPITAL, (cur, total, combo) => {
      process.stdout.write(`\r  [${cur}/${total}] ${combo.label.padEnd(40)}`);
    });

    process.stdout.write("\r" + " ".repeat(60) + "\r");

    if (results.length === 0) {
      console.log("  No data available. Try a different coin or period.");
      return;
    }

    console.log();
    console.log("=".repeat(110));
    console.log(
      "  " +
      "#".padStart(3) +
      "  " +
      "Strategy".padEnd(14) +
      "Venue Pair".padEnd(28) +
      "Net PnL".padStart(10) +
      "Fees".padStart(8) +
      "Trades".padStart(7) +
      "Win%".padStart(6) +
      "MDD%".padStart(7) +
      "Obj.F".padStart(9) +
      "Lvg".padEnd(12) +
      "Liq".padStart(6)
    );
    console.log("-".repeat(114));

    for (let i = 0; i < Math.min(results.length, 15); i++) {
      const r = results[i];
      const strat = r.combo.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
      const pair = r.combo.label.padEnd(28);
      const pnl = `$${r.netPnl.toFixed(0)}`.padStart(10);
      const fees = `$${r.totalFees.toFixed(0)}`.padStart(8);
      const trades = `${r.result.totalTrades}`.padStart(7);
      const win = `${(r.result.winRate * 100).toFixed(0)}%`.padStart(6);
      const dd = `${r.maxDrawdownPct.toFixed(1)}%`.padStart(7);
      const objF = `${r.objectiveResult.objective.toFixed(4)}`.padStart(9);
      const lvg = `${r.leverageConfig.minLeverage}/${r.leverageConfig.targetLeverage}/${r.leverageConfig.maxLeverage}`.padEnd(12);

      const medal = i === 0 ? " <- BEST" : "";
      const liqCount = r.result.liquidationEvents.length;
      const liqStr = liqCount > 0
        ? `${liqCount}!`.padStart(6)
        : "  -".padStart(6);
      console.log(`  ${(i + 1 + ".").padStart(4)} ${strat.padEnd(14)}${pair}${pnl}${fees}${trades}${win}${dd}${objF}${lvg}${liqStr}${medal}`);
    }

    console.log("-".repeat(114));

    const best = results[0];
    const bestBe = best.result.breakevenHours;
    let bestBeStr: string;
    if (bestBe < 0) bestBeStr = "never";
    else if (bestBe < 24) bestBeStr = `${bestBe} hours`;
    else bestBeStr = `${(bestBe / 24).toFixed(1)} days`;

    console.log();
    console.log(`  BEST: ${best.combo.label}`);
    console.log(`  Strategy:    ${best.combo.strategy === "spot_vs_perp" ? "Spot vs Perp" : "Perp vs Perp"}`);
    console.log(`  Leverage:    ${best.leverageConfig.minLeverage}x min / ${best.leverageConfig.targetLeverage}x target / ${best.leverageConfig.maxLeverage}x max`);
    if (best.riskLeverage) {
      console.log(`  RLmax:       ${best.riskLeverage.rlmax.toFixed(1)}x (from Q99 5m: ${(best.riskLeverage.q99_5m * 100).toFixed(2)}%, Q99 15m: ${(best.riskLeverage.q99_15m * 100).toFixed(2)}%)`);
    }
    console.log(`  Net PnL:     $${best.netPnl.toFixed(2)}`);
    console.log(`  Total Fees:  $${best.totalFees.toFixed(2)}`);
    console.log(`  Funding:     $${(best.result.totalFundingCollected - best.result.totalFundingPaid).toFixed(2)}`);
    console.log(`  Rebalances:  ${best.result.totalRebalances}`);
    console.log(`  Objective F: ${best.objectiveResult.objective.toFixed(6)} (α=${0.5}, β=${0.3})`);
    console.log(`  Avg APY:     ${(best.objectiveResult.avgApy * 100).toFixed(2)}%`);
    console.log(`  DDq5:        ${(best.objectiveResult.ddq5 * 100).toFixed(4)}%`);
    console.log(`  Leverage Δ:  ${best.objectiveResult.leverageAsymmetry.toFixed(1)} (Δmax=${best.objectiveResult.deltaMax.toFixed(1)}, Δmin=${best.objectiveResult.deltaMin.toFixed(1)})`);
    console.log(`  Price Spread PnL: $${best.result.totalPriceSpreadPnl.toFixed(2)}`);
    console.log(`  Avg Price Spread: ${best.result.avgPriceSpreadBps.toFixed(1)} bps | Max: ${best.result.maxPriceSpreadBps.toFixed(1)} bps`);
    console.log(`  Trades:      ${best.result.totalTrades} (skipped ${best.result.skippedDueToPriceSpread} due to price spread)`);
    console.log(`  Win Rate:    ${(best.result.winRate * 100).toFixed(1)}%`);
    console.log(`  Max DD:      ${best.maxDrawdownPct.toFixed(2)}%`);
    console.log(`  Breakeven:   ${bestBeStr}`);
    if (best.result.liquidationEvents.length > 0) {
      console.log(`  LIQUIDATIONS: ${best.result.liquidationEvents.length} events, $${best.result.totalLiquidationLoss.toFixed(0)} lost`);
    } else {
      console.log(`  Liquidations: none (price never breached margin)`);
    }

    // Trade breakdown
    if (best.result.trades.length > 0) {
      console.log();
      console.log("  TRADE BREAKDOWN");
      console.log("  " + "-".repeat(128));
      console.log(
        "  " +
        "#".padStart(3) +
        "  " +
        "Entry".padEnd(18) +
        "Duration".padStart(10) +
        "  " +
        "PnL".padStart(10) +
        "Fees".padStart(9) +
        "Funding".padStart(10) +
        "PriceSprd".padStart(10) +
        "  " +
        "Expected".padStart(10) +
        "Actual".padStart(10) +
        "  " +
        "Diff".padEnd(12) +
        "Liquidated".padEnd(14)
      );
      console.log("  " + "-".repeat(128));

      for (let i = 0; i < best.result.trades.length; i++) {
        const t = best.result.trades[i];
        const entryStr = t.entryTime.toISOString().slice(0, 16).replace("T", " ");

        // Duration in hours
        const entryMs = t.entryTime.getTime();
        const exitMs = t.exitTime?.getTime() ?? Date.now();
        const durationH = Math.round((exitMs - entryMs) / (1000 * 60 * 60));
        let durationStr: string;
        if (durationH < 24) durationStr = `${durationH}h`;
        else durationStr = `${(durationH / 24).toFixed(1)}d`;

        // Format expected breakeven
        const expH = t.expectedBreakevenHours;
        let expStr: string;
        if (expH >= 999 * 8) expStr = "n/a";
        else if (expH < 24) expStr = `${expH}h`;
        else expStr = `${(expH / 24).toFixed(1)}d`;

        // Format actual breakeven
        const actH = t.actualBreakevenHours;
        let actStr: string;
        if (actH < 0) actStr = "never";
        else if (actH < 24) actStr = `${actH}h`;
        else actStr = `${(actH / 24).toFixed(1)}d`;

        // Diff: actual - expected (positive = took longer than expected)
        let diffStr: string;
        if (actH < 0 || expH >= 999 * 8) diffStr = "n/a";
        else {
          const diff = actH - expH;
          if (diff === 0) diffStr = "on time";
          else if (diff > 0) diffStr = `+${diff}h late`;
          else diffStr = `${diff}h early`;
        }

        const pnlStr = `$${t.pnl.toFixed(0)}`;
        const feesStr = `$${t.feesPaid.toFixed(0)}`;
        const fundingNet = t.fundingCollected - t.fundingPaid;
        const fundingStr = `$${fundingNet.toFixed(0)}`;
        const priceSprdStr = `$${t.priceSpreadPnl.toFixed(0)}`;
        const liqStr = t.liquidated
          ? `Leg ${t.liquidatedLeg}! -$${t.liquidationLoss.toFixed(0)}`
          : "no";

        console.log(
          `  ${(i + 1 + ".").padStart(4)} ` +
          `${entryStr.padEnd(18)}` +
          `${durationStr.padStart(10)}  ` +
          `${pnlStr.padStart(10)}` +
          `${feesStr.padStart(9)}` +
          `${fundingStr.padStart(10)}` +
          `${priceSprdStr.padStart(10)}  ` +
          `${expStr.padStart(10)}` +
          `${actStr.padStart(10)}  ` +
          `${diffStr.padEnd(12)}` +
          `${liqStr.padEnd(14)}`
        );
      }
      console.log("  " + "-".repeat(128));
    }

    // Crossover analysis: was another combo better at any point?
    const crossover = analyzeCrossovers(results);
    if (crossover && crossover.periods.length > 0) {
      console.log();
      console.log("  WAS THE WINNER ALWAYS BEST?");
      console.log("  " + "-".repeat(100));
      console.log(`  Winner wasn't #1 for ${crossover.totalHoursBetter}h out of ${crossover.totalHours}h (${crossover.pctTimeNotBest.toFixed(1)}% of the time)`);
      if (crossover.bestChallenger) {
        console.log(`  Most persistent challenger: ${crossover.bestChallenger}`);
      }
      if (crossover.maxAdvantageCombo) {
        const maxAdvStr = crossover.maxAdvantage >= 1000
          ? `$${(crossover.maxAdvantage / 1000).toFixed(1)}k`
          : `$${crossover.maxAdvantage.toFixed(0)}`;
        console.log(`  Biggest challenger edge: ${crossover.maxAdvantageCombo} (+${maxAdvStr} over winner)`);
      }
      console.log();
      console.log("  " + "When".padEnd(6) + "Period".padEnd(20) + "Challenger".padEnd(28) + "Challenger PnL".padStart(15) + "Winner PnL".padStart(13) + "Edge".padStart(12));
      console.log("  " + "-".repeat(100));

      for (const p of crossover.periods) {
        const startStr = p.start.toISOString().slice(0, 16).replace("T", " ");
        const endStr = p.end.toISOString().slice(0, 16).replace("T", " ");
        const periodStr = startStr === endStr ? startStr : `${startStr.slice(5)} → ${endStr.slice(5)}`;
        const edgeStr = p.advantage >= 1000 ? `$${(p.advantage / 1000).toFixed(1)}k` : `$${p.advantage.toFixed(0)}`;
        console.log(
          "  " +
          "".padEnd(6) +
          periodStr.padEnd(20) +
          p.betterCombo.padEnd(28) +
          `$${p.betterPnl.toFixed(0)}`.padStart(15) +
          `$${p.winnerPnl.toFixed(0)}`.padStart(13) +
          `+${edgeStr}`.padStart(12)
        );
      }
      console.log("  " + "-".repeat(100));
    }

    console.log();
    console.log("=".repeat(98));
    return;
  }

  if (MODE === "--multi") {
    const coin = VENUE_A.toUpperCase();
    const MAX_LEGS = 4;
    console.log("=".repeat(100));
    console.log("  MULTI-PERP BASIS TRADING OPTIMIZER");
    console.log("  Tests: 1 Spot vs N Perps (2, 3, 4 legs)");
    console.log("  Compares single-perp vs multi-perp ROI");
    console.log("=".repeat(100));
    console.log();
    console.log(`  Coin:    ${coin}`);
    console.log(`  Period:  ${DAYS} days`);
    console.log(`  Capital: $${INITIAL_CAPITAL.toLocaleString()}`);
    console.log(`  Max Legs: ${MAX_LEGS}`);
    console.log();
    console.log("  Fetching data from all exchanges...\n");

    const results = await optimizeMultiPerp(coin, DAYS, INITIAL_CAPITAL, MAX_LEGS, (cur, total, combo) => {
      process.stdout.write(`\r  [${cur}/${total}] ${combo.label.padEnd(50)}`);
    });

    process.stdout.write("\r" + " ".repeat(70) + "\r");

    if (results.length === 0) {
      console.log("  No data available. Try a different coin or period.");
      return;
    }

    // Group by leg count
    const single = results.filter((r) => r.combo.legCount === 1);
    const two = results.filter((r) => r.combo.legCount === 2);
    const three = results.filter((r) => r.combo.legCount === 3);
    const four = results.filter((r) => r.combo.legCount === 4);

    const printGroup = (label: string, group: MultiPerpOptResult[]) => {
      if (group.length === 0) return;
      const sorted = group.sort((a, b) => b.score - a.score);
      console.log();
      console.log("=".repeat(100));
      console.log(`  ${label} (${sorted.length} combos)`);
      console.log("-".repeat(100));
      console.log(
        "  " +
        "#".padStart(3) + "  " +
        "Venue Combo".padEnd(50) +
        "Net PnL".padStart(10) +
        "Fees".padStart(8) +
        "Trades".padStart(7) +
        "Win%".padStart(6) +
        "MDD%".padStart(7) +
        "Score".padStart(8) +
        "Breach".padStart(8)
      );
      console.log("-".repeat(100));

      for (let i = 0; i < Math.min(sorted.length, 10); i++) {
        const r = sorted[i];
        const label = r.combo.label.padEnd(50);
        const pnl = `$${r.netPnl.toFixed(0)}`.padStart(10);
        const fees = `$${r.totalFees.toFixed(0)}`.padStart(8);
        const trades = `${r.result.totalTrades}`.padStart(7);
        const win = `${(r.result.winRate * 100).toFixed(0)}%`.padStart(6);
        const dd = `${(r.result.maxDrawdownPct * 100).toFixed(1)}%`.padStart(7);
        const score = `${r.score.toFixed(0)}`.padStart(8);
        const be = r.result.breakevenHours;
        let beStr: string;
        if (be < 0) beStr = "never";
        else if (be < 24) beStr = `${be}h`;
        else beStr = `${(be / 24).toFixed(1)}d`;
        const medal = i === 0 ? " <- BEST" : "";
        console.log(`  ${(i + 1 + ".").padStart(4)} ${label}${pnl}${fees}${trades}${win}${dd}${score}${beStr.padStart(8)}${medal}`);
      }
      console.log("-".repeat(100));
    };

    printGroup("SINGLE PERP (1 Spot vs 1 Perp)", single);
    printGroup("TWO PERPS (1 Spot vs 2 Perps)", two);
    printGroup("THREE PERPS (1 Spot vs 3 Perps)", three);
    printGroup("FOUR PERPS (1 Spot vs 4 Perps)", four);

    // Summary comparison
    const bestOf = (group: MultiPerpOptResult[]) => group.sort((a, b) => b.score - a.score)[0];
    const bestSingle = bestOf(single);
    const bestTwo = bestOf(two);
    const bestThree = bestOf(three);
    const bestFour = bestOf(four);

    console.log();
    console.log("=".repeat(100));
    console.log("  SUMMARY: Best per leg count");
    console.log("-".repeat(100));

    const summaryRow = (legs: string, best: MultiPerpOptResult | undefined) => {
      if (!best) return;
      const roi = ((best.netPnl / INITIAL_CAPITAL) * 100).toFixed(2);
      const ann = (best.result.annualizedReturn * 100).toFixed(1);
      console.log(
        `  ${legs.padEnd(12)}` +
        `PnL: $${best.netPnl.toFixed(0).padStart(8)}` +
        `  ROI: ${(roi + "%").padStart(8)}` +
        `  Ann: ${(ann + "%").padStart(7)}` +
        `  Fees: $${best.totalFees.toFixed(0).padStart(6)}` +
        `  Trades: ${String(best.result.totalTrades).padStart(4)}` +
        `  Score: ${best.score.toFixed(0).padStart(8)}` +
        `  ${best.combo.label}`
      );
    };

    summaryRow("1 perp", bestSingle);
    summaryRow("2 perps", bestTwo);
    summaryRow("3 perps", bestThree);
    summaryRow("4 perps", bestFour);

    // Improvement calc
    if (bestSingle && bestFour) {
      const improvement = bestSingle.netPnl > 0
        ? ((bestFour.netPnl - bestSingle.netPnl) / Math.abs(bestSingle.netPnl) * 100).toFixed(1)
        : "n/a";
      const feeIncrease = bestFour.totalFees - bestSingle.totalFees;
      console.log();
      console.log(`  4-perp vs 1-perp improvement: ${improvement}%`);
      console.log(`  Extra fees from 3 additional legs: $${feeIncrease.toFixed(0)}`);
      console.log(`  Net benefit: $${(bestFour.netPnl - bestSingle.netPnl).toFixed(0)}`);
    }

    console.log("=".repeat(100));
    return;
  }

  console.log("=".repeat(118));
  console.log("  DELTA-NEUTRAL BASIS TRADING BACKTEST");
  console.log("  Hyperliquid vs Uniswap (DeFi Llama)");
  console.log("=".repeat(118));
  console.log();

  let marketsToRun: MarketConfig[] = [];

  if (MODE === "--all") {
    marketsToRun = MARKETS;
  } else if (MODE === "--category") {
    const category = args[1];
    marketsToRun = getMarketsByCategory(category);
    if (marketsToRun.length === 0) {
      console.error(`Category "${category}" not found.`);
      process.exit(1);
    }
  } else {
    const market = MARKETS.find((m) => m.hlCoin === MODE.toUpperCase());
    if (!market) {
      console.error(`Coin "${MODE}" not found. Use --list.`);
      process.exit(1);
    }
    marketsToRun = [market];
  }

  console.log(`Period:            ${DAYS} days`);
  console.log(`Initial Capital:   $${INITIAL_CAPITAL.toLocaleString()}`);
  console.log(`Markets:           ${marketsToRun.length}`);
  console.log();

  console.log("=".repeat(118));
  console.log(
    "  " +
    "Coin".padEnd(8) +
    "Name".padEnd(25) +
    "Trades".padStart(6) +
    "Win%".padStart(6) +
    "PnL".padStart(9) +
    "Return".padStart(8) +
    "Ann.%".padStart(8) +
    "MDD".padStart(7) +
    "Sharpe".padStart(7) +
    "Breach".padStart(8)
  );
  console.log("-".repeat(118));

  const results: Array<{ market: MarketConfig; result: any }> = [];

  for (let i = 0; i < marketsToRun.length; i++) {
    const market = marketsToRun[i];
    process.stdout.write(`\r  Processing ${market.hlCoin} (${i + 1}/${marketsToRun.length})...`);
    const res = await runSingleBacktest(market, DAYS, INITIAL_CAPITAL);
    if (res) results.push(res);
  }

  process.stdout.write("\r" + " ".repeat(60) + "\r");

  results.sort((a, b) => b.result.annualizedReturn - a.result.annualizedReturn);

  for (const { market, result } of results) {
    printResult(market, result, INITIAL_CAPITAL);
  }

  console.log("-".repeat(118));

  if (results.length > 0) {
    const totalPnl = results.reduce((s, r) => s + r.result.totalPnl, 0);
    const avgReturn = results.reduce((s, r) => s + r.result.annualizedReturn, 0) / results.length;
    const profitable = results.filter((r) => r.result.totalPnl > 0).length;

    console.log();
    console.log(`  Markets tested: ${results.length}/${marketsToRun.length}`);
    console.log(`  Profitable:     ${profitable}/${results.length}`);
    console.log(`  Total PnL:      $${totalPnl.toFixed(2)}`);
    console.log(`  Avg Ann. Return: ${(avgReturn * 100).toFixed(1)}%`);
  }

  console.log();
  console.log("=".repeat(118));
}

main().catch(console.error);
