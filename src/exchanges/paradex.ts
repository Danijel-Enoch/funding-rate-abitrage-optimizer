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

export class ParadexExchange implements PerpExchange {
  info = paradexInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const market = this.mapCoinToMarket(coin);
    if (!market) return [];

    const all: FundingRateEntry[] = [];
    let cursor: string | undefined;

    const fetchPage = async (nextCursor?: string) => {
      let url = `${PARADEX_API}/funding/data?market=${market}&start_timestamp=${startTime}&end_timestamp=${endTime}&page_size=200`;
      if (nextCursor) url += `&next=${nextCursor}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      return res.json() as Promise<any>;
    };

    let data = await fetchPage();
    if (!data || !data.results) return [];

    for (const entry of data.results) {
      all.push({
        timestamp: entry.created_at,
        fundingRate: parseFloat(entry.funding_rate || "0"),
        coin,
      });
    }

    cursor = data.next;
    while (cursor) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        data = await fetchPage(cursor);
      } catch {
        break;
      }
      if (!data || !data.results || data.results.length === 0) break;

      for (const entry of data.results) {
        all.push({
          timestamp: entry.created_at,
          fundingRate: parseFloat(entry.funding_rate || "0"),
          coin,
        });
      }
      cursor = data.next;
    }

    return all;
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
      XAU: "XAU-USD-PERP",
      // ETFs
      SPY: "SPY-USD-PERP", QQQ: "QQQ-USD-PERP",
    };
    return mapping[coin] || `${coin}-USD-PERP`;
  }
}
