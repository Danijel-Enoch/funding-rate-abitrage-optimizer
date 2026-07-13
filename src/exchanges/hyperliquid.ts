/**
 * Hyperliquid perpetual exchange adapter
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const HL_API = "https://api.hyperliquid.xyz/info";

export const hyperliquidInfo: ExchangeInfo = {
  id: "hyperliquid",
  name: "Hyperliquid",
  type: "perp",
  url: "https://hyperliquid.xyz",
};

export class HyperliquidExchange implements PerpExchange {
  info = hyperliquidInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const all: FundingRateEntry[] = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const res = await fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fundingHistory", coin, startTime: cursor, endTime }),
      });
      if (!res.ok) throw new Error(`HL API ${res.status}`);
      const data: any[] = await res.json();
      if (data.length === 0) break;

      for (const r of data) {
        all.push({ timestamp: r.time, fundingRate: parseFloat(r.fundingRate), coin: r.coin });
      }
      cursor = data[data.length - 1].time + 1;
      await Bun.sleep(100);
    }
    return all;
  }

  async getAvailableCoins(): Promise<string[]> {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    if (!res.ok) throw new Error(`HL API ${res.status}`);
    const [meta] = await res.json() as any[];
    return meta.universe.map((a: any) => a.name);
  }
}
