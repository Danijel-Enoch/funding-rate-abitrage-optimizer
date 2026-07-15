/**
 * Test position flipping vs holding — HL vs Extended (has actual differential flips)
 * Compares: no-flip, exit-on-negative, flip at various thresholds
 */

const { perpExchanges } = require("./exchanges/index");
const { runBacktest, EXCHANGE_FEES } = require("./backtest");

const TEST_COINS = ["TRUMP", "DOGE", "SUI", "NEAR", "ARB", "ETH", "BTC", "AVAX", "XRP", "TIA"];
const DAYS = 30;
const CAPITAL = 50000;

async function fetchRates(exchange, coin, days) {
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  try {
    return await Promise.race([
      exchange.fetchFundingRates(coin, start, end),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
    ]);
  } catch {
    return [];
  }
}

async function testCombo(coin, venueA, ratesA, ratesB, feeA, feeB) {
  const configs = [
    { label: "No flip (hold)", flip: { enabled: false } },
    { label: "Exit on negative", flip: { enabled: false }, exitOnNegativeFunding: true },
    { label: "Flip @ 6h,1.2x", flip: { enabled: true, flipThresholdHours: 6, minGainMultiple: 1.2, flipCooldownHours: 3 } },
    { label: "Flip @ 12h,1.5x", flip: { enabled: true, flipThresholdHours: 12, minGainMultiple: 1.5, flipCooldownHours: 6 } },
    { label: "Flip @ 24h,1.5x", flip: { enabled: true, flipThresholdHours: 24, minGainMultiple: 1.5, flipCooldownHours: 6 } },
    { label: "Flip @ 12h,1.2x", flip: { enabled: true, flipThresholdHours: 12, minGainMultiple: 1.2, flipCooldownHours: 6 } },
  ];

  console.log(`\n  ${coin} — HL vs Extended (${ratesA.length}h data)`);
  console.log("  " + "─".repeat(95));

  for (const cfg of configs) {
    const result = runBacktest(ratesA, ratesB, {
      initialCapital: CAPITAL,
      strategy: "perp_vs_perp",
      venueA,
      venueB: "extended",
      feeA,
      feeB,
      perpLeverageA: 3,
      perpLeverageB: 3,
      useMakerFees: false,
      fundingThreshold: 0.00001,
      maxSpreadBps: 100,
      ...cfg,
    });

    const pnl = result.totalPnl;
    const dd = result.maxDrawdownPct * 100;
    const score = pnl - dd * 1000;
    const flips = result.totalFlips;
    const flipCost = result.flipCostPaid;
    const negHrs = result.avgNegativeFundingHours.toFixed(1);
    const trades = result.totalTrades;

    console.log(
      `  ${cfg.label.padEnd(22)} PnL: $${pnl.toFixed(2).padStart(10)} | MDD: ${dd.toFixed(2).padStart(5)}% | Trades: ${trades.toString().padStart(3)} | Flips: ${flips.toString().padStart(3)} | FlipCost: $${flipCost.toFixed(2).padStart(8)} | NegHrs: ${negHrs.padStart(5)} | Score: ${score.toFixed(2).padStart(10)}`
    );
  }
}

async function main() {
  console.log("=".repeat(95));
  console.log("  POSITION FLIP TEST — HL vs Extended (actual differential flips)");
  console.log("=".repeat(95));
  console.log(`  Capital: $${CAPITAL} | Leverage: 3x both sides | Period: ${DAYS}d`);

  const hl = perpExchanges.find((e) => e.info.id === "hyperliquid");
  const ext = perpExchanges.find((e) => e.info.id === "extended");

  for (const coin of TEST_COINS) {
    console.log(`\n  Fetching ${coin}...`);
    const [ratesHL, ratesExt] = await Promise.all([
      fetchRates(hl, coin, DAYS),
      fetchRates(ext, coin, DAYS),
    ]);

    if (ratesHL.length < 10 || ratesExt.length < 10) {
      console.log(`  Skipping ${coin} — insufficient data (HL: ${ratesHL.length}, Ext: ${ratesExt.length})`);
      continue;
    }

    await testCombo(coin, "hyperliquid", ratesHL, ratesExt, EXCHANGE_FEES.hyperliquid, EXCHANGE_FEES.extended);
  }

  console.log("\n" + "=".repeat(95));
  console.log("  DONE");
}

main().catch(console.error);
