/**
 * Bybit Perpetual exchange adapter
 * API docs: https://bybit-exchange.github.io/docs/v5/
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const API = "https://api.bybit.com";

export const bybitInfo: ExchangeInfo = {
  id: "bybit",
  name: "Bybit",
  type: "perp",
  url: "https://bybit.com",
};

export class BybitExchange implements PerpExchange {
  info = bybitInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const symbol = `${coin}USDT`;
    const all: FundingRateEntry[] = [];
    let cursor: string | undefined;

    while (true) {
      let url = `${API}/v5/market/funding/history?category=linear&symbol=${symbol}&startTime=${startTime}&endTime=${endTime}&limit=200`;
      if (cursor) url += `&cursor=${cursor}`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data = await res.json() as any;
        if (data.retCode !== 0) break;

        const list = data.result?.list || [];
        if (list.length === 0) break;

        for (const r of list) {
          all.push({
            timestamp: parseInt(r.fundingRateTimestamp),
            fundingRate: parseFloat(r.fundingRate),
            coin,
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

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/v5/market/tickers?category=linear`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.result?.list || [])
        .filter((t: any) => t.symbol?.endsWith("USDT"))
        .map((t: any) => t.symbol.replace("USDT", ""));
    } catch {
      return [];
    }
  }
}
