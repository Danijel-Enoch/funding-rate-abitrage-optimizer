import { Elysia, t } from "elysia";
import { HyperliquidExchange } from "../../../src/exchanges/hyperliquid";
import { UniswapSpotExchange } from "../../../src/exchanges/uniswap";
import { BinanceSpotExchange } from "../../../src/exchanges/binance";
import { runBacktest, type BacktestConfig } from "../../../src/backtest";
import { MARKETS } from "../../../src/markets";
import type { FundingRateEntry } from "../../../src/exchanges/types";

const hl = new HyperliquidExchange();
const uniSpot = new UniswapSpotExchange();
const binanceSpot = new BinanceSpotExchange();

const COINS = [
  "BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX", "LINK", "SUI",
  "ARB", "OP", "NEAR", "INJ", "TIA", "FET", "RENDER", "TAO",
  "ENA", "AAVE", "UNI", "MKR", "PENDLE", "LDO",
  "PEPE", "WIF", "BONK", "TRUMP",
  "HYPE", "BERA", "EIGEN",
];

function analyzeDuration(rates: FundingRateEntry[]) {
  if (rates.length < 10) return null;
  rates.sort((a, b) => a.timestamp - b.timestamp);
  let positiveHrs = 0, negativeHrs = 0, longestPos = 0, longestNeg = 0;
  let curType: "pos" | "neg" | null = null, curLen = 0;
  for (const r of rates) {
    if (r.fundingRate >= 0) {
      positiveHrs++;
      if (curType === "pos") curLen++;
      else { if (curType === "neg") { longestNeg = Math.max(longestNeg, curLen); } curType = "pos"; curLen = 1; }
    } else {
      negativeHrs++;
      if (curType === "neg") curLen++;
      else { if (curType === "pos") { longestPos = Math.max(longestPos, curLen); } curType = "neg"; curLen = 1; }
    }
  }
  if (curType === "pos") longestPos = Math.max(longestPos, curLen);
  else longestNeg = Math.max(longestNeg, curLen);
  const total = positiveHrs + negativeHrs;
  return { positivePct: total > 0 ? positiveHrs / total : 0, longestPos, longestNeg };
}

export const correlationRoutes = new Elysia()
  .get("/api/correlation", async ({ query }: { query: { days?: string; coins?: string } }) => {
    const days = parseInt(query.days ?? "30");
    const coinList = query.coins ? query.coins.split(",").map((c) => c.toUpperCase()) : COINS;
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;

    const dataPoints: any[] = [];

    for (const coin of coinList) {
      const market = MARKETS.find((m) => m.hlCoin === coin);
      if (!market) continue;

      try {
        const [ratesA, pricesBinance, pricesHL] = await Promise.all([
          Promise.race([
            hl.fetchFundingRates(coin, startTime, endTime),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
          ]).catch(() => [] as FundingRateEntry[]),
          Promise.race([
            binanceSpot.fetchPrices(market.binanceSymbol, startTime, endTime),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
          ]).catch(() => []),
          Promise.race([
            uniSpot.fetchPrices(market.binanceSymbol, startTime, endTime),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
          ]).catch(() => []),
        ]);

        if (ratesA.length === 0) continue;

        const duration = analyzeDuration(ratesA);
        if (!duration) continue;

        const ratesB = ratesA.map((r) => ({ ...r, fundingRate: 0, coin: "spot" }));
        const priceDataA = pricesBinance.length > 0 ? pricesBinance : pricesHL;
        const priceDataB = pricesHL.length > 0 ? pricesHL : pricesBinance;

        const btResult = runBacktest(ratesA, ratesB, {
          initialCapital: 50000,
          strategy: "spot_vs_perp",
          fundingThreshold: 0.00001,
          maxSpreadBps: 50,
          maxPositionSize: 25000,
          venueA: "binance",
          venueB: "hyperliquid",
          priceDataA,
          priceDataB,
        });

        dataPoints.push({
          coin,
          category: market.category,
          duration,
          profitability: {
            totalPnl: btResult.totalPnl,
            annualizedReturn: btResult.annualizedReturn,
            winRate: btResult.winRate,
            maxDrawdownPct: btResult.maxDrawdownPct,
            sharpeRatio: btResult.sharpeRatio,
            totalFees: btResult.totalFees,
            totalTrades: btResult.totalTrades,
          },
        });
      } catch {
        // skip
      }
    }

    // Compute Pearson correlation
    function pearson(xs: number[], ys: number[]): number {
      if (xs.length < 3) return 0;
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) {
        const xi = xs[i] - mx;
        const yi = ys[i] - my;
        num += xi * yi;
        dx += xi * xi;
        dy += yi * yi;
      }
      return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
    }

    const positivePcts = dataPoints.map((d) => d.duration.positivePct);
    const pnls = dataPoints.map((d) => d.profitability.totalPnl);
    const annReturns = dataPoints.map((d) => d.profitability.annualizedReturn);
    const sharpes = dataPoints.map((d) => d.profitability.sharpeRatio);

    return {
      days,
      count: dataPoints.length,
      correlations: {
        positivePct_vs_pnl: pearson(positivePcts, pnls),
        positivePct_vs_annualReturn: pearson(positivePcts, annReturns),
        positivePct_vs_sharpe: pearson(positivePcts, sharpes),
      },
      dataPoints,
    };
  }, {
    query: t.Object({
      days: t.Optional(t.String()),
      coins: t.Optional(t.String()),
    }),
  });
