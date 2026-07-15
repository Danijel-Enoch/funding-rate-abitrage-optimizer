/**
 * MEXC Perpetual (Futures) exchange adapter
 * API docs: https://mexcdevelop.github.io/apidocs/contract_v1_en/
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const API = "https://futures.mexc.com";

export const mexcInfo: ExchangeInfo = {
  id: "mexc",
  name: "MEXC",
  type: "perp",
  url: "https://mexc.com",
};

export class MexcExchange implements PerpExchange {
  info = mexcInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const symbol = `${coin}_USDT`;
    const all: FundingRateEntry[] = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const url = `${API}/api/v1/contract/funding_rate/${symbol}/history?startTime=${cursor}&endTime=${endTime}&limit=100`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data = await res.json() as any;
        if (data.code !== 0) break;

        const list = data.data || [];
        if (list.length === 0) break;

        for (const r of list) {
          all.push({
            timestamp: r.createTime,
            fundingRate: parseFloat(r.fundingRate),
            coin,
          });
        }
        cursor = list[list.length - 1].createTime + 1;
        await Bun.sleep(100);
      } catch {
        break;
      }
    }
    return all;
  }

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/api/v1/contract/detail`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      if (data.code !== 0) return [];
      return (data.data || [])
        .filter((c: any) => c.symbol?.endsWith("_USDT") && c.status === 1)
        .map((c: any) => c.symbol.replace("_USDT", ""));
    } catch {
      return [];
    }
  }
}
