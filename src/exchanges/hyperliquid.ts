/**
 * Hyperliquid perpetual exchange adapter
 *
 * Supports both main perp dex (crypto) and HIP-3 dexes (stocks, indices, etc.)
 * HIP-3 assets use format: "dex_name:COIN" (e.g., "xyz:TSLA")
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

  /**
   * Hourly mark price history from candleSnapshot. Needed so an inter-venue
   * basis can be measured against this venue's own prices rather than a
   * substituted series.
   */
  async fetchPrices(
    coin: string,
    startTime: number,
    endTime: number
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const out = new Map<number, number>();
    const WINDOW = 30 * 24 * 3600 * 1000;

    for (let from = startTime; from < endTime; from += WINDOW) {
      const to = Math.min(from + WINDOW, endTime);
      try {
        const res = await fetch(HL_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: { coin, interval: "1h", startTime: from, endTime: to },
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as any[];
        for (const k of data ?? []) {
          const px = parseFloat(k.c);
          if (Number.isFinite(px) && px > 0) out.set(k.t, px);
        }
      } catch {
        continue;
      }
      await Bun.sleep(100);
    }

    return [...out.entries()]
      .map(([timestamp, price]) => ({ timestamp, price }))
      .sort((a, b) => a.timestamp - b.timestamp);
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

  /**
   * Get all available HIP-3 dex names (e.g., "xyz", "nq", etc.)
   */
  async getPerpDexes(): Promise<string[]> {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "perpDexs" }),
    });
    if (!res.ok) throw new Error(`HL API ${res.status}`);
    const data: any[] = await res.json();
    // First element is null (main dex), rest are HIP-3 dexes
    return data
      .filter((d: any) => d !== null && d.name)
      .map((d: any) => d.name);
  }

  /**
   * Get coins from a specific HIP-3 dex (e.g., "xyz" -> ["xyz:TSLA", "xyz:NVDA", ...])
   */
  async getDexCoins(dexName: string): Promise<string[]> {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs", dex: dexName }),
    });
    if (!res.ok) throw new Error(`HL API ${res.status}`);
    const data = await res.json() as any;
    if (!data || !data[0]) return [];
    return (data[0].universe || []).map((a: any) => a.name);
  }

  /**
   * Get ALL coins across main dex + all HIP-3 dexes
   * Returns both "BTC" and "xyz:TSLA" format
   */
  async getAllCoinsWithDexes(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    // Main dex coins
    try {
      const mainCoins = await this.getAvailableCoins();
      result.set("", mainCoins);
    } catch {}

    // HIP-3 dex coins
    try {
      const dexes = await this.getPerpDexes();
      for (const dex of dexes) {
        try {
          const coins = await this.getDexCoins(dex);
          if (coins.length > 0) {
            result.set(dex, coins);
          }
          await Bun.sleep(100);
        } catch {}
      }
    } catch {}

    return result;
  }
}
