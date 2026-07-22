import { Elysia, t } from "elysia";
import { HyperliquidExchange } from "../../../src/exchanges/hyperliquid";
import { UniswapSpotExchange } from "../../../src/exchanges/uniswap";
import { BinanceSpotExchange } from "../../../src/exchanges/binance";
import { runBacktest, EXCHANGE_FEES, type BacktestConfig, type StrategyType } from "../../../src/backtest";
import { MARKETS } from "../../../src/markets";

const hl = new HyperliquidExchange();
const spot = new UniswapSpotExchange();
const binanceSpot = new BinanceSpotExchange();

export const backtestRoutes = new Elysia()
  .post(
    "/api/backtest",
    async ({ body }) => {
      const { coin, days, capital, strategy, venueA, venueB } = body;
      const coinUpper = coin.toUpperCase();
      const market = MARKETS.find((m) => m.hlCoin === coinUpper);
      if (!market) return { error: `Coin "${coinUpper}" not found` };

      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;

      try {
        const ratesA = await Promise.race([
          hl.fetchFundingRates(market.hlCoin, startTime, endTime),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("HL timeout")), 20000)),
        ]);

        const [pricesHL, pricesBinance] = await Promise.all([
          Promise.race([
            spot.fetchPrices(market.binanceSymbol, startTime, endTime),
            new Promise<Array<{ timestamp: number; price: number }>>((_, rej) => setTimeout(() => rej(new Error("Spot timeout")), 20000)),
          ]).catch(() => []),
          Promise.race([
            binanceSpot.fetchPrices(market.binanceSymbol, startTime, endTime),
            new Promise<Array<{ timestamp: number; price: number }>>((_, rej) => setTimeout(() => rej(new Error("Binance timeout")), 20000)),
          ]).catch(() => []),
        ]);

        if (ratesA.length === 0) return { error: "No funding data available" };

        const ratesB = ratesA.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
        const priceDataA = pricesBinance.length > 0 ? pricesBinance : pricesHL;
        const priceDataB = pricesHL.length > 0 ? pricesHL : pricesBinance;

        const config: Partial<BacktestConfig> = {
          initialCapital: capital,
          strategy: (strategy as StrategyType) ?? "spot_vs_perp",
          fundingThreshold: 0.00001,
          maxSpreadBps: 50,
          maxPositionSize: capital * 0.5,
          venueA: venueA ?? "binance",
          venueB: venueB ?? "hyperliquid",
          priceDataA,
          priceDataB,
        };

        const result = runBacktest(ratesA, ratesB, config);
        return {
          coin: coinUpper,
          market,
          config: { days, capital, strategy: config.strategy, venueA: config.venueA, venueB: config.venueB },
          result: {
            totalPnl: result.totalPnl,
            totalFees: result.totalFees,
            totalTrades: result.totalTrades,
            winRate: result.winRate,
            maxDrawdown: result.maxDrawdown,
            maxDrawdownPct: result.maxDrawdownPct,
            sharpeRatio: result.sharpeRatio,
            annualizedReturn: result.annualizedReturn,
            breakevenHours: result.breakevenHours,
            totalFundingCollected: result.totalFundingCollected,
            totalFundingPaid: result.totalFundingPaid,
            avgSpreadBps: result.avgSpreadBps,
            avgPriceSpreadBps: result.avgPriceSpreadBps,
            maxPriceSpreadBps: result.maxPriceSpreadBps,
            totalPriceSpreadPnl: result.totalPriceSpreadPnl,
            totalRebalances: result.totalRebalances,
            liquidationEvents: result.liquidationEvents,
            trades: result.trades.map((t) => ({
              entryTime: t.entryTime,
              exitTime: t.exitTime,
              pnl: t.pnl,
              feesPaid: t.feesPaid,
              fundingCollected: t.fundingCollected,
              fundingPaid: t.fundingPaid,
              spreadBps: t.spreadBps,
              status: t.status,
              liquidated: t.liquidated,
              liquidationLoss: t.liquidationLoss,
              expectedBreakevenHours: t.expectedBreakevenHours,
              actualBreakevenHours: t.actualBreakevenHours,
            })),
            pnlHistory: result.pnlHistory,
            timestamps: result.timestamps,
          },
        };
      } catch (e: any) {
        return { error: e?.message ?? "backtest failed" };
      }
    },
    {
      body: t.Object({
        coin: t.String(),
        days: t.Number({ default: 30 }),
        capital: t.Number({ default: 50000 }),
        strategy: t.Optional(t.String()),
        venueA: t.Optional(t.String()),
        venueB: t.Optional(t.String()),
      }),
    }
  );
