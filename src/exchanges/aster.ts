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

  /** Hourly mark price history from klines, for measuring this venue's own basis. */
  async fetchPrices(
    coin: string,
    startTime: number,
    endTime: number
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const symbol = `${coin}USDT`;
    const out = new Map<number, number>();
    let cursor = startTime;

    while (cursor < endTime) {
      try {
        const res = await fetch(
          `${ASTER_API}/fapi/v1/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${endTime}&limit=1000`,
          { signal: AbortSignal.timeout(20000) }
        );
        if (!res.ok) break;
        const data = (await res.json()) as any[][];
        if (!data?.length) break;

        for (const k of data) {
          const px = parseFloat(k[4]);
          if (Number.isFinite(px) && px > 0) out.set(k[0], px);
        }
        cursor = data[data.length - 1][0] + 1;
      } catch {
        break;
      }
      await Bun.sleep(100);
    }

    return [...out.entries()]
      .map(([timestamp, price]) => ({ timestamp, price }))
      .sort((a, b) => a.timestamp - b.timestamp);
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
