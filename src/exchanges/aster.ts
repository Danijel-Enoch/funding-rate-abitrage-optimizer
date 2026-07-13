/**
 * Aster perpetual exchange adapter
 * API docs: https://github.com/asterdex/api-docs
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const ASTER_API = "https://fapi.asterdex.com";

export const asterInfo: ExchangeInfo = {
  id: "aster",
  name: "Aster",
  type: "perp",
  url: "https://aster.exchange",
};

export class AsterExchange implements PerpExchange {
  info = asterInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const symbol = `${coin}USDT`;
    const all: FundingRateEntry[] = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const url = `${ASTER_API}/fapi/v3/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
      try {
        const res = await fetch(url);
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
      const res = await fetch(`${ASTER_API}/fapi/v3/exchangeInfo`);
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
