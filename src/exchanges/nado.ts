/**
 * Nado perpetual exchange adapter (Ink L2, by Kraken)
 * API docs: https://docs.nado.xyz
 * Supports: Crypto, FX, Commodities, Stocks
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const NADO_GATEWAY = "https://gateway.prod.nado.xyz/v1";
const NADO_ARCHIVE = "https://archive.prod.nado.xyz/v1";

export const nadoInfo: ExchangeInfo = {
  id: "nado",
  name: "Nado",
  type: "perp",
  url: "https://nado.xyz",
};

export class NadoExchange implements PerpExchange {
  info = nadoInfo;

  private productCache: Map<string, number> | null = null;

  private async loadProducts(): Promise<Map<string, number>> {
    if (this.productCache) return this.productCache;

    const map = new Map<string, number>();
    try {
      const res = await fetch(`${NADO_GATEWAY}/symbols`);
      if (!res.ok) return map;
      const data = await res.json() as any[];

      for (const p of data) {
        if (p.type !== "perp") continue;
        // BTC-PERP -> BTC, ETH-PERP -> ETH, XAG-PERP -> XAG
        const sym: string = p.symbol || "";
        const coin = sym.replace(/-PERP$/, "").replace("kPEPE", "PEPE");
        map.set(coin, p.product_id);
      }
    } catch {
      return map;
    }

    this.productCache = map;
    return map;
  }

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const products = await this.loadProducts();
    const productId = products.get(coin.toUpperCase()) ?? null;
    if (!productId) return [];

    const all: FundingRateEntry[] = [];

    try {
      let cursor = Math.floor(startTime / 1000);

      while (true) {
        const res = await fetch(NADO_ARCHIVE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            funding_rate_history: {
              product_id: productId,
              start_time: cursor,
              end_time: Math.floor(endTime / 1000),
              limit: 1000,
            },
          }),
        });

        if (!res.ok) break;
        const data = await res.json() as any;
        const rates = data.funding_rates || [];
        if (rates.length === 0) break;

        for (const entry of rates) {
          const ts = parseInt(entry.timestamp) * 1000;
          if (ts > endTime) return all;

          // funding_rate_x18 is realized hourly rate * 10^18
          const rate = parseFloat(entry.funding_rate_x18 || "0") / 1e18;
          all.push({
            timestamp: ts,
            fundingRate: rate,
            coin,
          });
        }

        // Paginate: use last timestamp + 1
        const lastTs = parseInt(rates[rates.length - 1].timestamp);
        cursor = lastTs + 1;
        if (rates.length < 1000) break;
      }
    } catch {
      return all;
    }

    return all;
  }

  async getAvailableCoins(): Promise<string[]> {
    const products = await this.loadProducts();
    return Array.from(products.keys()).sort();
  }
}
