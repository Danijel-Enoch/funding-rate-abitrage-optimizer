/**
 * Binance Perpetual (Futures) exchange adapter
 * API docs: https://binance-docs.github.io/apidocs/futures/en/
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const API = "https://fapi.binance.com";

export const binancePerpInfo: ExchangeInfo = {
  id: "binance-perp",
  name: "Binance Perp",
  type: "perp",
  url: "https://binance.com",
};

export class BinancePerpExchange implements PerpExchange {
  info = binancePerpInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const symbol = `${coin}USDT`;
    const all: FundingRateEntry[] = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const url = `${API}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data: any[] = await res.json();
        if (data.length === 0) break;

        for (const r of data) {
          all.push({
            timestamp: r.fundingTime,
            fundingRate: parseFloat(r.fundingRate),
            coin,
          });
        }
        cursor = data[data.length - 1].fundingTime + 1;
        await Bun.sleep(100);
      } catch {
        break;
      }
    }
    return all;
  }

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/fapi/v1/exchangeInfo`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.symbols || [])
        .filter((s: any) => s.contractType === "PERPETUAL" && s.status === "TRADING")
        .map((s: any) => s.symbol.replace("USDT", ""));
    } catch {
      return [];
    }
  }
}
