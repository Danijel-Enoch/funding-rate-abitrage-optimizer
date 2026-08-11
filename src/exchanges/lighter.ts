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

/**
 * Lighter's funding history endpoint returns 403, so there is no historical
 * funding to read. An earlier version of this adapter papered over that by
 * fetching the current rate and replicating it across every hour of the
 * requested window. That produced a constant series which still looked
 * well-formed — 8,760 points, correct shape — and backtested as a straight line
 * with a Sharpe in the hundreds. On ETH it pinned funding at -63% APR for a year
 * and made a fabricated strategy the top result.
 *
 * fetchFundingRates now returns nothing for historical windows rather than
 * inventing them. The current rate is still available via fetchCurrentFundingRate
 * for live scanning, where it is a real observation about right now.
 */
export const LIGHTER_HAS_FUNDING_HISTORY = false;

export class LighterExchange implements PerpExchange {
  info = lighterInfo;

  /** No historical funding is retrievable from this venue — see the note above. */
  readonly hasFundingHistory = false;

  /**
   * Always empty: Lighter publishes no funding history. Returning [] rather than
   * a reconstructed series keeps callers from silently backtesting an invention.
   */
  async fetchFundingRates(_coin: string, _startTime: number, _endTime: number): Promise<FundingRateEntry[]> {
    return [];
  }

  /**
   * The venue's current funding rate — a real observation, valid only for now.
   * Safe for live scanning; not a substitute for history.
   */
  async fetchCurrentFundingRate(coin: string): Promise<FundingRateEntry | null> {
    if (!this.mapCoinToMarket(coin)) return null;

    try {
      const res = await fetch(`${LIGHTER_API}/api/v1/funding-rates`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;

      const entry = data.funding_rates?.find(
        (r: any) => r.symbol === coin && r.exchange === "lighter"
      );
      if (!entry) return null;

      const rate = parseFloat(String(entry.rate));
      if (!Number.isFinite(rate)) return null;

      return { timestamp: Date.now(), fundingRate: rate, coin };
    } catch {
      return null;
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
