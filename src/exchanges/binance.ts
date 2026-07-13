/**
 * Binance spot exchange adapter
 */
import type { SpotExchange, ExchangeInfo } from "./types";

const BINANCE_API = "https://api.binance.com/api/v3";

export const binanceInfo: ExchangeInfo = {
  id: "binance",
  name: "Binance (Spot)",
  type: "spot",
  url: "https://binance.com",
};

export class BinanceSpotExchange implements SpotExchange {
  info = binanceInfo;

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const all: Array<{ timestamp: number; price: number }> = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const url = `${BINANCE_API}/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${endTime}&limit=1000`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance API ${res.status}`);
      const data: any[][] = await res.json();
      if (data.length === 0) break;

      for (const k of data) {
        all.push({ timestamp: k[0], price: parseFloat(k[1]) });
      }
      cursor = data[data.length - 1][0] + 1;
      await Bun.sleep(100);
    }
    return all;
  }

  async getAvailableSymbols(): Promise<string[]> {
    const res = await fetch(`${BINANCE_API}/exchangeInfo`);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.symbols
      .filter((s: any) => s.symbol.endsWith("USDT") && s.status === "TRADING")
      .map((s: any) => s.symbol);
  }
}
