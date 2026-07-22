import { Elysia } from "elysia";
import { perpExchanges, spotExchanges } from "../../../src/exchanges";
import { EXCHANGE_FEES } from "../../../src/backtest";

export const exchangesRoutes = new Elysia()
  .get("/api/exchanges", () => {
    return {
      perp: perpExchanges.map((e) => ({
        id: e.info.id,
        name: e.info.name,
        type: e.info.type,
        url: e.info.url,
        fees: EXCHANGE_FEES[e.info.id] ?? null,
      })),
      spot: spotExchanges.map((e) => ({
        id: e.info.id,
        name: e.info.name,
        type: e.info.type,
        url: e.info.url,
        fees: EXCHANGE_FEES[e.info.id] ?? null,
      })),
    };
  })
  .get("/api/exchanges/fees", () => {
    return { fees: EXCHANGE_FEES };
  });
