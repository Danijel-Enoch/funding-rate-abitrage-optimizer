import { Elysia } from "elysia";
import { MARKETS, TRADITIONAL_MARKETS, getCategories, getMarketsByCategory } from "../../../src/markets";

export const marketsRoutes = new Elysia()
  .get("/api/markets", () => {
    const categories = getCategories();
    return {
      crypto: Object.fromEntries(categories.map((c) => [c, getMarketsByCategory(c)])),
      traditional: Object.fromEntries(
        [...new Set(TRADITIONAL_MARKETS.map((m) => m.category))].map((c) => [
          c,
          TRADITIONAL_MARKETS.filter((m) => m.category === c),
        ])
      ),
      totalCrypto: MARKETS.length,
      totalTraditional: TRADITIONAL_MARKETS.length,
    };
  })
  .get("/api/markets/search", ({ query }: { query: { q?: string } }) => {
    const q = (query.q ?? "").toLowerCase();
    if (!q) return { results: [...MARKETS, ...TRADITIONAL_MARKETS].slice(0, 50) };
    const all = [...MARKETS, ...TRADITIONAL_MARKETS];
    return {
      results: all.filter(
        (m) =>
          m.hlCoin.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.binanceSymbol.toLowerCase().includes(q)
      ),
    };
  });
