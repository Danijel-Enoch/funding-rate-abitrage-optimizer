import { Elysia, t } from "elysia";
import { optimizeCoin } from "../../../src/optimize";

export const optimizeRoutes = new Elysia()
  .post(
    "/api/optimize",
    async ({ body }) => {
      const { coin, days, capital } = body;
      const coinUpper = coin.toUpperCase();

      try {
        const results = await optimizeCoin(coinUpper, days, capital);
        return {
          coin: coinUpper,
          days,
          capital,
          count: results.length,
          results: results.slice(0, 30).map((r) => ({
            label: r.combo.label,
            strategy: r.combo.strategy,
            spotId: r.combo.spotId,
            perpA: r.combo.perpA,
            perpB: r.combo.perpB,
            netPnl: r.netPnl,
            totalFees: r.totalFees,
            apy: r.apy,
            maxDrawdownPct: r.maxDrawdownPct,
            score: r.score,
            totalTrades: r.result.totalTrades,
            winRate: r.result.winRate,
            annualizedReturn: r.result.annualizedReturn,
            sharpeRatio: r.result.sharpeRatio,
            breakevenHours: r.result.breakevenHours,
            objective: r.objectiveResult.objective,
            avgApy: r.objectiveResult.avgApy,
            ddq5: r.objectiveResult.ddq5,
            leverageConfig: r.leverageConfig,
            riskLeverage: r.riskLeverage ? {
              rlmax: r.riskLeverage.rlmax,
              q99_5m: r.riskLeverage.q99_5m,
              q99_15m: r.riskLeverage.q99_15m,
            } : null,
          })),
        };
      } catch (e: any) {
        return { error: e?.message ?? "optimization failed" };
      }
    },
    {
      body: t.Object({
        coin: t.String(),
        days: t.Number({ default: 30 }),
        capital: t.Number({ default: 50000 }),
      }),
    }
  );
