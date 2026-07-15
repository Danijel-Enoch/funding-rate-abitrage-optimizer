/**
 * OKX Perpetual (SWAP) exchange adapter
 * API docs: https://www.okx.com/docs-v5/en/
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const API = "https://www.okx.com";

export const okxInfo: ExchangeInfo = {
  id: "okx",
  name: "OKX",
  type: "perp",
  url: "https://okx.com",
};

export class OkxExchange implements PerpExchange {
  info = okxInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const instId = `${coin}-USDT-SWAP`;
    const all: FundingRateEntry[] = [];
    let before = "";

    while (true) {
      let url = `${API}/api/v5/public/funding-rate-history?instId=${instId}&limit=100`;
      if (before) url += `&before=${before}`;
      // OKX uses milliseconds but the parameter names are confusing
      // `before` = cursor (return data older than this timestamp)
      // We need to paginate backwards from now

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        const data = await res.json() as any;
        if (data.code !== "0") break;

        const list = data.data || [];
        if (list.length === 0) break;

        for (const r of list) {
          const ts = parseInt(r.fundingTime);
          if (ts < startTime) return all;
          if (ts > endTime) continue;
          all.push({
            timestamp: ts,
            fundingRate: parseFloat(r.fundingRate),
            coin,
          });
        }

        before = list[list.length - 1].fundingTime;
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
      const res = await fetch(`${API}/api/v5/public/instruments?instType=SWAP`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.data || [])
        .filter((i: any) => i.state === "live" && i.instId?.endsWith("-USDT-SWAP"))
        .map((i: any) => i.instId.replace("-USDT-SWAP", ""));
    } catch {
      return [];
    }
  }
}
