/**
 * GMX perpetual exchange adapter (Arbitrum/Avalanche)
 * API docs: https://docs.gmx.io
 * Supports: Crypto only
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const GMX_API = "https://arbitrum.gmxapi.io/v1";

export const gmxInfo: ExchangeInfo = {
  id: "gmx",
  name: "GMX",
  type: "perp",
  url: "https://gmx.io",
};

export class GmxExchange implements PerpExchange {
  info = gmxInfo;

  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const token = this.mapCoinToToken(coin);
    if (!token) return [];

    const all: FundingRateEntry[] = [];

    try {
      // GMX /rates returns array of markets, each with ratesSnapshots
      const res = await fetch(`${GMX_API}/rates?token=${token}`);
      if (!res.ok) return [];
      const data = await res.json() as any;

      if (Array.isArray(data)) {
        // Find the market with the most snapshots
        let snapshots: any[] = [];
        for (const market of data) {
          if (market.ratesSnapshots && market.ratesSnapshots.length > snapshots.length) {
            snapshots = market.ratesSnapshots;
          }
        }

        for (const entry of snapshots) {
          const ts = entry.timestamp;
          if (!ts) continue;
          const timestamp = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
          if (timestamp < startTime || timestamp > endTime) continue;

          // GMX stores per-second funding rates with 30 decimal precision
          // Convert to per-hour rate for our hourly backtest
          const rateStr = entry.fundingRateShort || entry.fundingRateLong || "0";
          const rate = (parseFloat(rateStr) / 1e30) * 3600;
          all.push({
            timestamp,
            fundingRate: rate,
            coin,
          });
        }
      }
    } catch {
      return [];
    }

    return all;
  }

  async getAvailableCoins(): Promise<string[]> {
    try {
      const res = await fetch(`${GMX_API}/markets`);
      if (!res.ok) return [];
      const data = await res.json() as any[];

      if (!Array.isArray(data)) return [];

      const coins = new Set<string>();
      for (const m of data) {
        if (m.isSpotOnly || !m.isListed) continue;
        const sym: string = m.symbol || "";
        // Extract coin name from "ETH/USD [WETH-WETH]" -> "ETH"
        const match = sym.match(/^([A-Z0-9]+)\/USD/);
        if (match) {
          coins.add(match[1]);
        }
      }
      return Array.from(coins).sort();
    } catch {
      return [];
    }
  }

  private mapCoinToToken(coin: string): string | null {
    // Most coins use their symbol directly; BTC maps to WBTC on GMX
    const mapping: Record<string, string> = {
      BTC: "WBTC",
    };
    return mapping[coin.toUpperCase()] || coin.toUpperCase();
  }
}
