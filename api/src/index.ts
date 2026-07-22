import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { scanRoutes } from "./routes/scan";
import { marketsRoutes } from "./routes/markets";
import { exchangesRoutes } from "./routes/exchanges";
import { backtestRoutes } from "./routes/backtest";
import { optimizeRoutes } from "./routes/optimize";
import { fundingRoutes } from "./routes/funding";
import { correlationRoutes } from "./routes/correlation";

const app = new Elysia()
  .use(cors({ origin: "*" }))
  .use(scanRoutes)
  .use(marketsRoutes)
  .use(exchangesRoutes)
  .use(backtestRoutes)
  .use(optimizeRoutes)
  .use(fundingRoutes)
  .use(correlationRoutes)
  .get("/api/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .listen(3001);

console.log(`BasisOS API running at http://localhost:${app.server?.port}`);

export type App = typeof app;
