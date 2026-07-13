/**
 * Extended perpetual exchange adapter (Starknet)
 * API docs: https://api.docs.extended.exchange/
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const EXTENDED_API = "https://api.starknet.extended.exchange";

export const extendedInfo: ExchangeInfo = {
  id: "extended",
  name: "Extended",
  type: "perp",
  url: "https://extended.exchange",
};

export class ExtendedExchange implements PerpExchange {
  info = extendedInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const market = `${coin}-USD`;
    const all: FundingRateEntry[] = [];
    let cursor: string | undefined;

    const fetchPage = async (nextCursor?: string) => {
      let url = `${EXTENDED_API}/api/v1/info/${market}/funding?startTime=${startTime}&endTime=${endTime}`;
      if (nextCursor) url += `&cursor=${nextCursor}`;

      const res = await fetch(url, {
        headers: { "User-Agent": "BasisBacktest/1.0" },
      });
      if (!res.ok) return null;
      return res.json() as Promise<any>;
    };

    let data = await fetchPage();
    if (!data || !data.data) return [];

    for (const entry of data.data) {
      const ts = entry.T || entry.timestamp || entry.time;
      const rate = entry.f || entry.fundingRate || entry.rate;
      if (ts && rate !== undefined) {
        all.push({
          timestamp: typeof ts === "number" ? ts : new Date(ts).getTime(),
          fundingRate: parseFloat(String(rate)),
          coin,
        });
      }
    }

    return all;
  }

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${EXTENDED_API}/api/v1/info/markets`, {
        headers: { "User-Agent": "BasisBacktest/1.0" },
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.data || [])
        .filter((m: any) => m.type === "PERPETUAL" && m.status === "ACTIVE")
        .map((m: any) => m.name.replace("-USD", ""));
    } catch {
      return [];
    }
  }
}
