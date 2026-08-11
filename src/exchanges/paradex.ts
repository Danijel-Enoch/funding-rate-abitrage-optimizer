/**
 * Paradex perpetual exchange adapter (Starknet)
 * API docs: https://docs.paradex.trade
 * Supports: Crypto, Stocks, Commodities, FX
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const PARADEX_API = "https://api.prod.paradex.trade/v1";

export const paradexInfo: ExchangeInfo = {
  id: "paradex",
  name: "Paradex",
  type: "perp",
  url: "https://paradex.trade",
};

/**
 * Paradex publishes a funding snapshot roughly every 5 seconds, and the public
 * /funding/data endpoint ignores start_timestamp/end_timestamp entirely: it
 * always returns the newest records and only walks backwards through the `next`
 * cursor. A year of history is therefore ~6.3M records (~31,500 sequential
 * pages), which is not retrievable in practice.
 *
 * The walk below is bounded and decimated so it terminates. Callers doing long
 * lookbacks should check PARADEX_MAX_FUNDING_HISTORY_DAYS and fall back to a
 * venue with real historical funding (Deribit and Hyperliquid both serve a full
 * year of hourly funding).
 */
export const PARADEX_MAX_FUNDING_HISTORY_DAYS = 2;

export class ParadexExchange implements PerpExchange {
  info = paradexInfo;

  /** Public funding history is limited — see PARADEX_MAX_FUNDING_HISTORY_DAYS. */
  readonly maxFundingHistoryDays = PARADEX_MAX_FUNDING_HISTORY_DAYS;

  async fetchFundingRates(
    coin: string,
    startTime: number,
    endTime: number,
    opts: { sampleIntervalHours?: number; maxPages?: number } = {}
  ): Promise<FundingRateEntry[]> {
    const market = this.mapCoinToMarket(coin);
    if (!market) return [];

    const sampleMs = (opts.sampleIntervalHours ?? 8) * 3600 * 1000;
    const maxPages = opts.maxPages ?? 200;

    const fetchPage = async (nextCursor?: string) => {
      let url = `${PARADEX_API}/funding/data?market=${market}&page_size=200`;
      if (nextCursor) url += `&next=${nextCursor}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      return res.json() as Promise<any>;
    };

    // Keep at most one sample per bucket, walking newest → oldest
    const byBucket = new Map<number, FundingRateEntry>();
    let cursor: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;

    for (let page = 0; page < maxPages; page++) {
      let data: any;
      try {
        data = await fetchPage(cursor);
      } catch {
        break;
      }
      if (!data?.results?.length) break;

      for (const entry of data.results) {
        const ts = entry.created_at;
        if (ts < oldestSeen) oldestSeen = ts;
        if (ts > endTime || ts < startTime) continue;
        const bucket = Math.floor(ts / sampleMs) * sampleMs;
        if (byBucket.has(bucket)) continue;
        // funding_rate_8h is the settled 8h rate; funding_rate is instantaneous
        byBucket.set(bucket, {
          timestamp: bucket,
          fundingRate: parseFloat(entry.funding_rate_8h || entry.funding_rate || "0"),
          coin,
        });
      }

      if (oldestSeen <= startTime) break;
      cursor = data.next;
      if (!cursor) break;
      await new Promise((r) => setTimeout(r, 60));
    }

    return [...byBucket.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Hourly price history. Unlike /funding/data, klines honours the time range. */
  async fetchPrices(
    coin: string,
    startTime: number,
    endTime: number
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const market = this.mapCoinToMarket(coin);
    if (!market) return [];

    const out = new Map<number, number>();
    const WINDOW = 30 * 24 * 3600 * 1000;

    for (let from = startTime; from < endTime; from += WINDOW) {
      const to = Math.min(from + WINDOW, endTime);
      try {
        const res = await fetch(
          `${PARADEX_API}/markets/klines?symbol=${market}&resolution=60&start_at=${from}&end_at=${to}`,
          { signal: AbortSignal.timeout(20000) }
        );
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        for (const k of data.results ?? []) {
          // [ts, open, high, low, close, volume]
          out.set(k[0], k[4]);
        }
      } catch {
        continue;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    return [...out.entries()]
      .map(([timestamp, price]) => ({ timestamp, price }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${PARADEX_API}/markets`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.results || [])
        .filter((m: any) => m.status === "active")
        .map((m: any) => {
          // Strip -USD or -USD-PERP suffix
          const sym = m.symbol || m.name || "";
          return sym.replace(/-USD-PERP$/, "").replace(/-USD$/, "").replace(/-USDC$/, "");
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private mapCoinToMarket(coin: string): string | null {
    // Paradex uses formats like BTC-USD-PERP, GOOGL-USD-PERP, XAU-USD-PERP
    const mapping: Record<string, string> = {
      BTC: "BTC-USD-PERP", ETH: "ETH-USD-PERP", SOL: "SOL-USD-PERP",
      DOGE: "DOGE-USD-PERP", XRP: "XRP-USD-PERP", ADA: "ADA-USD-PERP",
      AVAX: "AVAX-USD-PERP", LINK: "LINK-USD-PERP", DOT: "DOT-USD-PERP",
      SUI: "SUI-USD-PERP", ARB: "ARB-USD-PERP", OP: "OP-USD-PERP",
      NEAR: "NEAR-USD-PERP", INJ: "INJ-USD-PERP", AAVE: "AAVE-USD-PERP",
      UNI: "UNI-USD-PERP", CRV: "CRV-USD-PERP", ENA: "ENA-USD-PERP",
      PENDLE: "PENDLE-USD-PERP", WIF: "WIF-USD-PERP", TIA: "TIA-USD-PERP",
      RENDER: "RENDER-USD-PERP", FET: "FET-USD-PERP",
      // Stocks
      AAPL: "AAPL-USD-PERP", GOOGL: "GOOGL-USD-PERP", AMZN: "AMZN-USD-PERP",
      META: "META-USD-PERP", MSFT: "MSFT-USD-PERP", NVDA: "NVDA-USD-PERP",
      TSLA: "TSLA-USD-PERP", AMD: "AMD-USD-PERP", NFLX: "NFLX-USD-PERP",
      // Commodities
      XAU: "XAU-USD-PERP", XAG: "XAG-USD-PERP", WTI: "WTI-USD-PERP",
      // ETFs
      SPY: "SPY-USD-PERP", QQQ: "QQQ-USD-PERP",
    };
    return mapping[coin] || `${coin}-USD-PERP`;
  }
}
