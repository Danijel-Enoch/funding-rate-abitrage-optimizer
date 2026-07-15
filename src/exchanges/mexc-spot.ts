/**
 * MEXC Spot exchange adapter
 * API docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
 */
import type { SpotExchange, ExchangeInfo } from "./types";

const API = "https://api.mexc.com";

export const mexcSpotInfo: ExchangeInfo = {
  id: "mexc-spot",
  name: "MEXC (Spot)",
  type: "spot",
  url: "https://mexc.com",
};

export class MexcSpotExchange implements SpotExchange {
  info = mexcSpotInfo;

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const all: Array<{ timestamp: number; price: number }> = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const url = `${API}/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${endTime}&limit=1000`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data: any[] = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const k of data) {
          all.push({
            timestamp: k[0],
            price: parseFloat(k[1]),
          });
        }
        cursor = data[data.length - 1][0] + 1;
        await Bun.sleep(100);
      } catch {
        break;
      }
    }
    return all;
  }

  async getAvailableSymbols(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/api/v3/exchangeInfo`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.symbols || [])
        .filter((s: any) => s.symbol?.endsWith("USDT") && s.status === "ENABLED")
        .map((s: any) => s.symbol);
    } catch {
      return [];
    }
  }
}
