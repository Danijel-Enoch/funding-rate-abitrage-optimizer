/**
 * Hyperliquid spot price adapter
 * Uses the candleSnapshot endpoint to get OHLCV data from Hyperliquid perp mid prices
 */
import type { SpotExchange, ExchangeInfo } from "./types";

const HL_API = "https://api.hyperliquid.xyz/info";

export const hyperliquidSpotInfo: ExchangeInfo = {
  id: "hyperliquid-spot",
  name: "Hyperliquid (Perp Mid)",
  type: "spot",
  url: "https://hyperliquid.xyz",
};

export class HyperliquidSpotExchange implements SpotExchange {
  info = hyperliquidSpotInfo;

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const coin = symbol.replace("USDT", "").replace("USD", "");
    const all: Array<{ timestamp: number; price: number }> = [];

    // HL candleSnapshot returns up to ~500 candles per call, paginate in 7-day chunks
    const chunkMs = 7 * 24 * 3600 * 1000;
    let chunkStart = startTime;

    while (chunkStart < endTime) {
      const chunkEnd = Math.min(chunkStart + chunkMs, endTime);

      try {
        const res = await fetch(HL_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: { coin, interval: "1h", startTime: chunkStart, endTime: chunkEnd },
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) { chunkStart = chunkEnd; continue; }
        const data: any[] = await res.json();
        if (!Array.isArray(data)) { chunkStart = chunkEnd; continue; }

        for (const c of data) {
          const ts = c.t;
          const close = parseFloat(c.c);
          if (ts && !isNaN(close) && close > 0) {
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
    try {
      const res = await fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const [meta] = await res.json() as any[];
      return (meta.universe || []).map((a: any) => `${a.name}USDT`);
    } catch {
      return [];
    }
  }
}
