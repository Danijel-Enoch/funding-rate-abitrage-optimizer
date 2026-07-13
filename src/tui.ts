/**
 * Interactive TUI for basis trading backtest
 */
import { createInterface } from "readline";
import { perpExchanges, spotExchanges } from "./exchanges";
import { optimizeCoin, getAllCombos, isTraditionalAsset } from "./optimize";
import { MARKETS, TRADITIONAL_MARKETS, getCategories, getMarketsByCategory, type MarketConfig } from "./markets";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise((r) => rl.question(q, r));
}

function clear() {
  if (process.stdout.isTTY) process.stdout.write("\x1B[2J\x1B[H");
}

function banner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║          BASIS TRADING BACKTESTER — MULTI-EXCHANGE                      ║
║  Spot: Binance, Uniswap                                                 ║
║  Perp: Hyperliquid, Lighter, Aster, Extended, Paradex, Nado, GMX        ║
║  Assets: Crypto, Stocks, Commodities, ETFs                              ║
╚══════════════════════════════════════════════════════════════════════════╝`);
}

function divider() {
  console.log("─".repeat(65));
}

function pickNum(prompt: string, count: number): Promise<number> {
  return (async () => {
    while (true) {
      const n = parseInt(await ask(prompt));
      if (n >= 1 && n <= count) return n - 1;
      console.log(`  Enter 1-${count}.`);
    }
  })();
}

// ─── Optimize Mode ──────────────────────────────────────────

async function runOptimize() {
  clear();
  banner();
  console.log("\n  BACKTEST OPTIMIZATION");
  console.log("  Tests all strategy/venue combos, ranks by PnL with minimal drawdown");
  console.log("  Includes taker/maker fees and bid-ask spread costs\n");

  // Pick coin
  console.log("  Common coins:");
  const common = ["ETH", "BTC", "SOL", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT", "SUI", "ARB", "OP", "INJ", "NEAR", "PEPE", "WIF", "FET", "TIA", "ENA", "PENDLE"];
  const cols = 5;
  for (let i = 0; i < common.length; i += cols) {
    console.log("    " + common.slice(i, i + cols).map((c) => c.padEnd(10)).join(""));
  }
  const coin = (await ask("\n  Coin: ")).toUpperCase().trim();

  // Params
  const daysStr = await ask("  Period (days) [30]: ");
  const days = parseInt(daysStr) || 30;

  const capStr = await ask("  Capital ($) [50000]: ");
  const capital = parseFloat(capStr) || 50000;

  // Show what will be tested
  const combos = getAllCombos();
  console.log(`\n  Testing ${combos.length} venue combinations for ${coin}...`);
  console.log("  This may take a minute.\n");

  const results = await optimizeCoin(coin, days, capital, (cur, total, combo) => {
    process.stdout.write(`\r  [${cur}/${total}] ${combo.label.padEnd(40)}`);
  });

  process.stdout.write("\r" + " ".repeat(60) + "\r");

  if (results.length === 0) {
    console.log("  No valid results. Check if data is available for this coin.\n");
    await ask("  Press Enter...");
    return;
  }

  // Display results
  clear();
  banner();
  console.log(`\n  OPTIMIZATION RESULTS — ${coin} (${days} days, $${capital.toLocaleString()})\n`);
  console.log("  Ranked by: Net PnL - Drawdown Penalty (favors high profit, low risk)\n`);
  divider();
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
    "Score".padStart(8)
  );
  divider();

  for (let i = 0; i < Math.min(results.length, 20); i++) {
    const r = results[i];
    const strat = r.combo.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
    const pair = r.combo.label.padEnd(28);
    const pnl = `$${r.netPnl.toFixed(0)}`.padStart(10);
    const fees = `$${r.totalFees.toFixed(0)}`.padStart(8);
    const trades = `${r.result.totalTrades}`.padStart(7);
    const win = `${(r.result.winRate * 100).toFixed(0)}%`.padStart(6);
    const dd = `${r.maxDrawdownPct.toFixed(1)}%`.padStart(7);
    const negFlag = r.exitOnNegative ? " exit-neg" : "";

    const medal = i === 0 ? " <-- BEST" : "";
    console.log(`  ${(i + 1 + ".").padStart(4)} ${strat.padEnd(14)}${pair}${pnl}${fees}${trades}${win}${dd}${medal}${negFlag}`);
  }

  divider();

  // Best result details
  const best = results[0];
  console.log(`\n  BEST: ${best.combo.label}`);
  console.log(`  Strategy:      ${best.combo.strategy === "spot_vs_perp" ? "Spot vs Perp (2x perp)" : "Perp vs Perp (3x both)"}`);
  console.log(`  Net PnL:       $${best.netPnl.toFixed(2)}`);
  console.log(`  Total Fees:    $${best.totalFees.toFixed(2)}`);
  console.log(`  Funding Gross: $${(best.result.totalFundingCollected - best.result.totalFundingPaid).toFixed(2)}`);
  console.log(`  Trades:        ${best.result.totalTrades}`);
  console.log(`  Win Rate:      ${(best.result.winRate * 100).toFixed(1)}%`);
  console.log(`  Max Drawdown:  ${best.maxDrawdownPct.toFixed(2)}%`);
  console.log(`  Score:         ${best.score.toFixed(2)}`);

  console.log("\n  Press Enter to return to menu...");
  await ask("");
}

// ─── Single Backtest Mode ───────────────────────────────────

async function runSingleBacktest() {
  clear();
  banner();
  console.log("\n  SINGLE BACKTEST\n");

  // Strategy
  console.log("  [1] Spot vs Perp    — Long spot + Short perp (or vice versa)");
  console.log("  [2] Perp vs Perp    — Long perp A + Short perp B\n");
  const stratN = await pickNum("  Strategy: ", 2);
  const strategy = stratN === 0 ? "spot_vs_perp" : "perp_vs_perp";

  // Venue A
  clear();
  banner();
  if (strategy === "spot_vs_perp") {
    console.log("\n  VENUE A — Spot side (hold spot position)\n");
    spotExchanges.forEach((e, i) => console.log(`  [${i + 1}] ${e.info.name}`));
    const n = await pickNum("\n  Choice: ", spotExchanges.length);
    var venueAId = spotExchanges[n].info.id;
  } else {
    console.log("\n  VENUE A — Perp exchange\n");
    perpExchanges.forEach((e, i) => console.log(`  [${i + 1}] ${e.info.name}`));
    const n = await pickNum("\n  Choice: ", perpExchanges.length);
    var venueAId = perpExchanges[n].info.id;
  }

  // Venue B
  clear();
  banner();
  console.log("\n  VENUE B — Perp exchange\n");
  const filtered = perpExchanges.filter((e) => e.info.id !== venueAId);
  filtered.forEach((e, i) => console.log(`  [${i + 1}] ${e.info.name}`));
  const n = await pickNum("\n  Choice: ", filtered.length);
  const venueBId = filtered[n].info.id;

  // Coin
  clear();
  banner();
  console.log("\n  COIN\n");
  const coin = (await ask("  Symbol (e.g. ETH, BTC): ")).toUpperCase().trim();

  // Params
  const days = parseInt(await ask("  Days [30]: ")) || 30;
  const capital = parseFloat(await ask("  Capital ($) [50000]: ")) || 50000;

  // Run
  clear();
  banner();
  console.log(`\n  Running ${strategy === "spot_vs_perp" ? "Spot vs Perp" : "Perp vs Perp"}...`);
  console.log(`  ${venueAId} vs ${venueBId} | ${coin} | ${days} days\n`);

  // Import and run
  const { optimizeCoin } = await import("./optimize");
  const results = await optimizeCoin(coin, days, capital);

  // Find matching result
  const match = results.find(
    (r) =>
      r.combo.perpA === venueAId &&
      r.combo.perpB === venueBId &&
      r.combo.strategy === strategy
  );

  if (!match) {
    console.log("  No data available for this combination.");
    await ask("  Press Enter...");
    return;
  }

  const r = match.result;
  divider();
  console.log("\n  RESULTS\n");
  console.log(`  Total Trades:      ${r.totalTrades}`);
  console.log(`  Win Rate:          ${(r.winRate * 100).toFixed(1)}%`);
  console.log(`  Total PnL:         $${r.totalPnl.toFixed(2)}`);
  console.log(`  Return:            ${((r.totalPnl / capital) * 100).toFixed(2)}%`);
  console.log(`  APY:               ${(r.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`  Sharpe:            ${r.sharpeRatio.toFixed(2)}`);
  console.log(`  Max Drawdown:      ${(r.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Avg Funding A:     ${(r.avgFundingRateA * 100).toFixed(4)}%`);
  console.log(`  Avg Funding B:     ${(r.avgFundingRateB * 100).toFixed(4)}%`);
  divider();
  console.log("\n  Press Enter...");
  await ask("");
}

// ─── Bulk Optimize Mode ─────────────────────────────────────

async function runBulkOptimize() {
  clear();
  banner();
  console.log("\n  BULK OPTIMIZATION — Find best market across all coins\n");

  console.log("  Select category:");
  const cats = getCategories();
  cats.forEach((c, i) => {
    const count = getMarketsByCategory(c).length;
    console.log(`  [${i + 1}] ${c} (${count} coins)`);
  });
  console.log(`  [${cats.length + 1}] Stocks (${TRADITIONAL_MARKETS.filter(m => m.category === "Stocks").length})`);
  console.log(`  [${cats.length + 2}] Commodities (${TRADITIONAL_MARKETS.filter(m => m.category === "Commodities").length})`);
  console.log(`  [${cats.length + 3}] ETFs (${TRADITIONAL_MARKETS.filter(m => m.category === "ETFs").length})`);
  console.log(`  [${cats.length + 4}] ALL (crypto + traditional)`);

  const totalOptions = cats.length + 4;
  const catN = await pickNum("\n  Choice: ", totalOptions);

  let coins: string[];
  if (catN < cats.length) {
    coins = getMarketsByCategory(cats[catN]).map((m) => m.hlCoin);
  } else if (catN === cats.length) {
    coins = TRADITIONAL_MARKETS.filter(m => m.category === "Stocks").map(m => m.hlCoin);
  } else if (catN === cats.length + 1) {
    coins = TRADITIONAL_MARKETS.filter(m => m.category === "Commodities").map(m => m.hlCoin);
  } else if (catN === cats.length + 2) {
    coins = TRADITIONAL_MARKETS.filter(m => m.category === "ETFs").map(m => m.hlCoin);
  } else {
    coins = [...MARKETS, ...TRADITIONAL_MARKETS].map((m) => m.hlCoin);
  }

  const days = parseInt(await ask("  Days [30]: ")) || 30;
  const capital = parseFloat(await ask("  Capital ($) [50000]: ")) || 50000;

  console.log(`\n  Testing ${coins.length} coins across all venue combos...`);
  console.log("  This will take a while.\n");

  const allResults: Array<{ coin: string; best: any }> = [];

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    process.stdout.write(`\r  [${i + 1}/${coins.length}] ${coin.padEnd(10)}`);

    try {
      const results = await optimizeCoin(coin, days, capital);
      if (results.length > 0 && results[0].apy > 0) {
        allResults.push({ coin, best: results[0] });
      }
    } catch {}
  }

  process.stdout.write("\r" + " ".repeat(60) + "\r");

  // Sort by APY
  allResults.sort((a, b) => b.best.apy - a.best.apy);

  clear();
  banner();
  console.log(`\n  TOP MARKETS BY APY (${days} days, $${capital.toLocaleString()})\n`);
  divider();
  console.log(
    "  " +
    "#".padStart(3) +
    "  " +
    "Coin".padEnd(10) +
    "Strategy".padEnd(14) +
    "Venue Pair".padEnd(28) +
    "APY".padStart(8) +
    "PnL".padStart(10) +
    "Trades".padStart(7) +
    "Win%".padStart(6)
  );
  divider();

  for (let i = 0; i < Math.min(allResults.length, 25); i++) {
    const { coin, best } = allResults[i];
    const strat = best.combo.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp";
    const pair = best.combo.label.padEnd(28);
    const apy = `${best.apy.toFixed(1)}%`.padStart(8);
    const pnl = `$${best.totalPnl.toFixed(0)}`.padStart(10);
    const trades = `${best.trades}`.padStart(7);
    const win = `${best.winRate.toFixed(0)}%`.padStart(6);

    const medal = i === 0 ? " 🥇" : i === 1 ? " 🥈" : i === 2 ? " 🥉" : "   ";
    console.log(`  ${(i + 1 + ".").padStart(4)} ${coin.padEnd(10)}${strat.padEnd(14)}${pair}${apy}${pnl}${trades}${win}${medal}`);
  }

  divider();
  console.log(`\n  Total profitable: ${allResults.length}/${coins.length}`);
  console.log("\n  Press Enter...");
  await ask("");
}

// ─── Market Availability ───────────────────────────────────

async function runMarketAvailability() {
  clear();
  banner();
  console.log("\n  MARKET AVAILABILITY ACROSS EXCHANGES\n");
  console.log("  Fetching available coins from each exchange...\n");

  const { hyperliquid } = await import("./exchanges/hyperliquid");
  const { lighter } = await import("./exchanges/lighter");
  const { aster } = await import("./exchanges/aster");
  const { extended } = await import("./exchanges/extended");
  const { binanceSpot } = await import("./exchanges/index");

  const [hlCoins, ligCoins, astCoins, extCoins, binCoins] = await Promise.all([
    hyperliquid.getAvailableCoins().catch(() => [] as string[]),
    lighter.getAvailableCoins().catch(() => [] as string[]),
    aster.getAvailableCoins().catch(() => [] as string[]),
    extended.getAvailableCoins().catch(() => [] as string[]),
    binanceSpot.getAvailableSymbols().catch(() => [] as string[]),
  ]);

  const normalize = (s: string) => s.replace(/USDT$/, "").replace(/\/USDC$/, "").toUpperCase();

  const hlSet = new Set(hlCoins.map(normalize));
  const ligSet = new Set(ligCoins.map(normalize));
  const astSet = new Set(astCoins.map(normalize));
  const extSet = new Set(extCoins.map(normalize));
  const binSet = new Set(binCoins.map(normalize));

  const allCoins = new Set([...hlSet, ...ligSet, ...astSet, ...extSet, ...binSet]);

  console.log(`  HL: ${hlSet.size} | Lighter: ${ligSet.size} | Aster: ${astSet.size} | Extended: ${extSet.size} | Binance: ${binSet.size}\n`);

  const coinData: Array<{ coin: string; venues: string[]; count: number }> = [];
  for (const coin of allCoins) {
    const venues: string[] = [];
    if (hlSet.has(coin)) venues.push("HL");
    if (ligSet.has(coin)) venues.push("LIG");
    if (astSet.has(coin)) venues.push("AST");
    if (extSet.has(coin)) venues.push("EXT");
    if (binSet.has(coin)) venues.push("BIN");
    coinData.push({ coin, venues, count: venues.length });
  }

  coinData.sort((a, b) => b.count - a.count || a.coin.localeCompare(b.coin));

  const all5 = coinData.filter((c) => c.count === 5);
  const any4 = coinData.filter((c) => c.count === 4);
  const any3 = coinData.filter((c) => c.count === 3);

  divider();
  console.log(`  ALL 5 EXCHANGES (${all5.length} coins):`);
  divider();
  for (const c of all5) {
    console.log(`    ${c.coin.padEnd(12)} ${c.venues.join(", ")}`);
  }

  console.log();
  divider();
  console.log(`  4 EXCHANGES (${any4.length} coins):`);
  divider();
  for (const c of any4) {
    console.log(`    ${c.coin.padEnd(12)} ${c.venues.join(", ")}`);
  }

  console.log();
  divider();
  console.log(`  3 EXCHANGES (${any3.length} coins):`);
  divider();
  const cols = 4;
  for (let i = 0; i < any3.length; i += cols) {
    const row = any3.slice(i, i + cols);
    console.log("    " + row.map((c) => `${c.coin}(${c.venues.join("")})`.padEnd(25)).join(""));
  }

  console.log();
  divider();
  console.log(`  Total: ${all5.length} on all 5 | ${any4.length} on 4 | ${any3.length} on 3 | ${coinData.filter(c => c.count <= 2).length} on 1-2`);
  divider();

  console.log("\n  Press Enter to return to menu...");
  await ask("");
}

// ─── Main Menu ──────────────────────────────────────────────

async function main() {
  while (true) {
    clear();
    banner();
    console.log("\n  MAIN MENU\n");
    console.log("  [1] Optimize       — Find best strategy/venue for a coin");
    console.log("  [2] Bulk Optimize  — Find best market across all coins");
    console.log("  [3] Single Backtest — Run one specific combo");
    console.log("  [4] Market Availability — See which coins are on all exchanges");
    console.log("  [5] List Markets   — Show all available markets");
    console.log("  [6] Exit\n");

    const n = await pickNum("  Choice: ", 6);

    switch (n) {
      case 0: await runOptimize(); break;
      case 1: await runBulkOptimize(); break;
      case 2: await runSingleBacktest(); break;
      case 3: await runMarketAvailability(); break;
      case 4:
        clear();
        banner();
        console.log("\n  Available markets by category:\n");
        for (const cat of getCategories()) {
          const ms = getMarketsByCategory(cat);
          console.log(`  ${cat} (${ms.length}): ${ms.map((m) => m.hlCoin).join(", ")}`);
        }
        console.log(`\n  Total: ${MARKETS.length} markets`);
        console.log("\n  Press Enter...");
        await ask("");
        break;
      case 4:
        console.log("\n  Goodbye!");
        rl.close();
        return;
    }
  }
}

main().catch(console.error).finally(() => rl.close());
