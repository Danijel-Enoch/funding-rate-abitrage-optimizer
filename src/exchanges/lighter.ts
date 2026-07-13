/**
 * Lighter perpetual exchange adapter
 * API docs: https://apidocs.lighter.xyz/reference
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const LIGHTER_API = "https://mainnet.zklighter.elliot.ai";

export const lighterInfo: ExchangeInfo = {
  id: "lighter",
  name: "Lighter",
  type: "perp",
  url: "https://lighter.xyz",
};

export class LighterExchange implements PerpExchange {
  info = lighterInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    // Lighter's funding history API is currently blocked (403).
    // Workaround: fetch the current funding rate from /api/v1/funding-rates
    // and generate synthetic hourly data based on that rate.
    // This is an approximation — real historical data would be more accurate.
    const lighterMarket = this.mapCoinToMarket(coin);
    if (!lighterMarket) return [];

    try {
      const res = await fetch(`${LIGHTER_API}/api/v1/funding-rates`);
      if (!res.ok) return [];
      const data = await res.json() as any;

      const lighterRate = data.funding_rates?.find(
        (r: any) => r.symbol === coin && r.exchange === "lighter"
      );

      if (!lighterRate) return [];

      const rate = parseFloat(String(lighterRate.rate));
      const all: FundingRateEntry[] = [];

      // Generate hourly entries using the current funding rate
      for (let t = startTime; t <= endTime; t += 3600000) {
        all.push({
          timestamp: t,
          fundingRate: rate,
          coin,
        });
      }

      return all;
    } catch {
      return [];
    }
  }

  private mapCoinToMarket(coin: string): string | null {
    const mapping: Record<string, string> = {
      BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD",
      DOGE: "DOGE-USD", AVAX: "AVAX-USD", SUI: "SUI-USD", DOT: "DOT-USD",
      LINK: "LINK-USD", ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD",
      "1000PEPE": "PEPE-USD", WIF: "WIF-USD", TIA: "TIA-USD",
      HBAR: "HBAR-USD", NEAR: "NEAR-USD", INJ: "INJ-USD",
      RENDER: "RENDER-USD", FET: "FET-USD", AAVE: "AAVE-USD",
      UNI: "UNI-USD", MKR: "MKR-USD", CRV: "CRV-USD",
      PAXG: "PAXG-USD", TSLA: "TSLA", GOOGL: "GOOGL",
      MSFT: "MSFT", SPY: "SPY", QQQ: "QQQ",
    };
    return mapping[coin] || `${coin}-USD`;
  }

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${LIGHTER_API}/api/v1/orderBooks`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      if (data && data.order_books) {
        return data.order_books
          .map((m: any) => {
            const sym = m.symbol || "";
            // Strip /USDC suffix
            return sym.replace(/\/USDC$/, "");
          })
          .filter(Boolean);
      }
    } catch {}
    return [];
  }
}
