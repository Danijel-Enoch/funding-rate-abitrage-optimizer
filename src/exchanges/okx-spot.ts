/**
 * OKX Spot exchange adapter
 * API docs: https://www.okx.com/docs-v5/en/
 */
import type { SpotExchange, ExchangeInfo } from "./types";

const API = "https://www.okx.com";

export const okxSpotInfo: ExchangeInfo = {
  id: "okx-spot",
  name: "OKX (Spot)",
  type: "spot",
  url: "https://okx.com",
};

export class OkxSpotExchange implements SpotExchange {
  info = okxSpotInfo;

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const instId = `${symbol.replace("USDT", "")}-USDT`;
    const all: Array<{ timestamp: number; price: number }> = [];
    let after = "";

    while (true) {
      let url = `${API}/api/v5/market/candles?instId=${instId}&bar=1H&limit=100`;
      if (after) url += `&after=${after}`;
      else url += `&after=${endTime}`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data = await res.json() as any;
        if (data.code !== "0") break;

        const list = data.data || [];
        if (list.length === 0) break;

        for (const k of list) {
          const ts = parseInt(k[0]);
          if (ts < startTime) return all;
          all.push({
            timestamp: ts,
            price: parseFloat(k[1]),
          });
        }

        after = list[list.length - 1][0];
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
      const res = await fetch(`${API}/api/v5/public/instruments?instType=SPOT`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.data || [])
        .filter((i: any) => i.state === "live" && i.instId?.endsWith("-USDT"))
        .map((i: any) => i.instId);
    } catch {
      return [];
    }
  }
}
