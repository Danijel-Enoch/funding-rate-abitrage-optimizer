/**
 * Lighter spot price adapter
 * Uses the candles endpoint to get OHLCV data from Lighter perp mid prices
 * Dynamically resolves market_id from the orderBooks endpoint
 */
import type { SpotExchange, ExchangeInfo } from "./types";

const LIGHTER_API = "https://mainnet.zklighter.elliot.ai";

export const lighterSpotInfo: ExchangeInfo = {
  id: "lighter-spot",
  name: "Lighter (Perp Mid)",
  type: "spot",
  url: "https://lighter.xyz",
};

export class LighterSpotExchange implements SpotExchange {
  info = lighterSpotInfo;

  private marketIdCache: Map<string, number> | null = null;

  private async getMarketIdMap(): Promise<Map<string, number>> {
    if (this.marketIdCache) return this.marketIdCache;

    try {
      const res = await fetch(`${LIGHTER_API}/api/v1/orderBooks`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return new Map();
      const data = await res.json() as any;
      const map = new Map<string, number>();
      if (data?.order_books) {
        for (const ob of data.order_books) {
          if (ob.symbol && ob.market_id !== undefined) {
            map.set(ob.symbol.toUpperCase(), ob.market_id);
          }
        }
      }
      this.marketIdCache = map;
      return map;
    } catch {
      return new Map();
    }
  }

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const base = symbol.replace("USDT", "").replace("USD", "").replace("/", "");
    const marketMap = await this.getMarketIdMap();

    // Try exact match, then with common suffixes
    let marketId = marketMap.get(base);
    if (marketId === undefined) {
      // Try common Lighter symbol formats
      for (const suffix of ["-USD", "/USDC", ""]) {
        marketId = marketMap.get(`${base}${suffix}`);
        if (marketId !== undefined) break;
      }
    }
    if (marketId === undefined) {
      // Fallback: try the symbol as-is
      marketId = marketMap.get(symbol);
    }
    if (marketId === undefined) return [];

    const all: Array<{ timestamp: number; price: number }> = [];

    // Lighter candles endpoint returns up to 500 candles per call, paginate in 21-day chunks
    const chunkMs = 21 * 24 * 3600 * 1000;
    let chunkStart = startTime;

    while (chunkStart < endTime) {
      const chunkEnd = Math.min(chunkStart + chunkMs, endTime);

      try {
        const url = `${LIGHTER_API}/api/v1/candles?market_id=${marketId}&resolution=1h&start_timestamp=${chunkStart}&end_timestamp=${chunkEnd}&count_back=500`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) { chunkStart = chunkEnd; continue; }
        const data = await res.json() as any;
        if (data.code !== 200 || !data.c) { chunkStart = chunkEnd; continue; }

        for (const candle of data.c) {
          const ts = candle.t;
          const close = candle.c;
          if (ts && close && close > 0) {
            all.push({ timestamp: ts, price: close });
          }
        }
      } catch {}

      chunkStart = chunkEnd;
      await Bun.sleep(100);
    }

    return all;
  }

  async getAvailableSymbols(): Promise<string[]> {
    const marketMap = await this.getMarketIdMap();
    return Array.from(marketMap.keys());
  }
}
