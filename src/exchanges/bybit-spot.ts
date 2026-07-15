/**
 * Bybit Spot exchange adapter
 * API docs: https://bybit-exchange.github.io/docs/v5/
 */
import type { SpotExchange, ExchangeInfo } from "./types";

const API = "https://api.bybit.com";

export const bybitSpotInfo: ExchangeInfo = {
  id: "bybit-spot",
  name: "Bybit (Spot)",
  type: "spot",
  url: "https://bybit.com",
};

export class BybitSpotExchange implements SpotExchange {
  info = bybitSpotInfo;

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const all: Array<{ timestamp: number; price: number }> = [];
    let cursor: string | undefined;

    while (true) {
      let url = `${API}/v5/market/kline?category=spot&symbol=${symbol}&interval=60&start=${startTime}&end=${endTime}&limit=200`;
      if (cursor) url += `&cursor=${cursor}`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data = await res.json() as any;
        if (data.retCode !== 0) break;

        const list = data.result?.list || [];
        if (list.length === 0) break;

        for (const k of list) {
          all.push({
            timestamp: parseInt(k[0]),
            price: parseFloat(k[1]),
          });
        }

        cursor = data.result?.nextCursor;
        if (!cursor || cursor === "0" || cursor === "") break;
        await Bun.sleep(100);
      } catch {
        break;
      }
    }

    all.sort((a, b) => a.timestamp - b.timestamp);
    return all;
  }

  async getAvailableSymbols(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/v5/market/tickers?category=spot`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.result?.list || [])
        .map((t: any) => t.symbol)
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
