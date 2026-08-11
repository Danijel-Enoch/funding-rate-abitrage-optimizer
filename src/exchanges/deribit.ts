/**
 * Deribit exchange adapter
 * API docs: https://docs.deribit.com/
 *
 * Deribit is one of only two venues in this repo with a real options order book
 * (Paradex is the other), so it is the primary data source for the
 * perp_vs_options strategy: perp funding, mark price history, the DVOL
 * implied-volatility index, and live option chains.
 *
 * API pagination limits discovered empirically:
 *   - get_funding_rate_history      → max 744 records (31 days hourly)
 *   - get_volatility_index_data     → max 1000 records
 *   - get_tradingview_chart_data    → large but paginated here for safety
 */
import type { PerpExchange, FundingRateEntry, ExchangeInfo } from "./types";

const API = "https://www.deribit.com/api/v2";

export const deribitInfo: ExchangeInfo = {
  id: "deribit",
  name: "Deribit",
  type: "perp",
  url: "https://deribit.com",
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

async function rpc(method: string, params: Record<string, string | number | boolean>): Promise<any> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const res = await fetch(`${API}/public/${method}?${qs}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  if (data.error) return null;
  return data.result;
}

/** One row of the DVOL implied-volatility index (VIX-style 30d fair variance strike). */
export interface DvolEntry {
  timestamp: number;
  open: number;   // annualized vol in percent, e.g. 42.37 = 42.37%
  high: number;
  low: number;
  close: number;
}

/** A single option instrument with its live mark. */
export interface OptionQuote {
  instrument: string;
  venue: string;
  coin: string;
  strike: number;
  expiry: number;          // ms timestamp
  type: "C" | "P";
  markPriceUsd: number;    // premium in USD
  bidUsd: number | null;
  askUsd: number | null;
  markIv: number;          // annualized decimal, e.g. 0.6575
  underlyingPrice: number;
  openInterest: number;
}

/** Deribit expiry codes look like "28AUG26" and settle at 08:00 UTC. */
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseDeribitExpiry(code: string): number | null {
  const m = code.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const mon = MONTHS[m[2]];
  if (mon === undefined) return null;
  return Date.UTC(2000 + parseInt(m[3]), mon, parseInt(m[1]), 8, 0, 0);
}

export class DeribitExchange implements PerpExchange {
  info = deribitInfo;

  /**
   * Hourly funding. Deribit accrues funding continuously; `interest_1h` is the
   * funding actually charged over the hour ending at the record timestamp, so
   * summing consecutive records is correct (unlike `interest_8h`, which is a
   * trailing 8h window and would triple-count if summed hourly).
   */
  async fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]> {
    const instrument = this.mapCoinToInstrument(coin);
    const seen = new Map<number, number>();

    // 25-day windows → ~600 hourly records, comfortably under the 744 cap
    const WINDOW = 25 * DAY;
    for (let from = startTime; from < endTime; from += WINDOW) {
      const to = Math.min(from + WINDOW, endTime);
      const result = await rpc("get_funding_rate_history", {
        instrument_name: instrument,
        start_timestamp: from,
        end_timestamp: to,
      });
      if (!Array.isArray(result)) continue;
      for (const r of result) {
        seen.set(r.timestamp, r.interest_1h ?? 0);
      }
      await Bun.sleep(120);
    }

    return [...seen.entries()]
      .map(([timestamp, fundingRate]) => ({ timestamp, fundingRate, coin }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Hourly perp mark price history. */
  async fetchPrices(coin: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const instrument = this.mapCoinToInstrument(coin);
    const seen = new Map<number, number>();

    const WINDOW = 30 * DAY;
    for (let from = startTime; from < endTime; from += WINDOW) {
      const to = Math.min(from + WINDOW, endTime);
      const result = await rpc("get_tradingview_chart_data", {
        instrument_name: instrument,
        start_timestamp: from,
        end_timestamp: to,
        resolution: 60,
      });
      if (!result || result.status !== "ok" || !Array.isArray(result.ticks)) continue;
      for (let i = 0; i < result.ticks.length; i++) {
        seen.set(result.ticks[i], result.close[i]);
      }
      await Bun.sleep(120);
    }

    return [...seen.entries()]
      .map(([timestamp, price]) => ({ timestamp, price }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * DVOL history — Deribit's 30-day implied volatility index, computed the same
   * way as the VIX. DVOL² is the fair strike of a 30-day variance swap, which is
   * exactly the implied leg of the perp_vs_options carry trade.
   *
   * @param resolutionSec 3600 (hourly) or 43200 (12h). Hourly needs ~9 requests/year.
   */
  async fetchDvol(coin: string, startTime: number, endTime: number, resolutionSec = 3600): Promise<DvolEntry[]> {
    const seen = new Map<number, DvolEntry>();

    // Cap is 1000 points per request; stay under it
    const WINDOW = 900 * resolutionSec * 1000;
    for (let from = startTime; from < endTime; from += WINDOW) {
      const to = Math.min(from + WINDOW, endTime);
      const result = await rpc("get_volatility_index_data", {
        currency: coin,
        start_timestamp: from,
        end_timestamp: to,
        resolution: resolutionSec,
      });
      if (!result || !Array.isArray(result.data)) continue;
      for (const [ts, open, high, low, close] of result.data) {
        seen.set(ts, { timestamp: ts, open, high, low, close });
      }
      await Bun.sleep(120);
    }

    return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Live option chain. Deribit options are inverse (coin-margined): quoted
   * prices are in units of the underlying coin, so they are converted to USD here.
   */
  async fetchOptionChain(coin: string): Promise<OptionQuote[]> {
    const result = await rpc("get_book_summary_by_currency", { currency: coin, kind: "option" });
    if (!Array.isArray(result)) return [];

    const out: OptionQuote[] = [];
    for (const r of result) {
      const parts = String(r.instrument_name).split("-");
      if (parts.length !== 4) continue;
      const [, expiryCode, strikeStr, typeStr] = parts;
      const expiry = parseDeribitExpiry(expiryCode);
      const strike = parseFloat(strikeStr);
      if (expiry === null || !isFinite(strike)) continue;
      if (typeStr !== "C" && typeStr !== "P") continue;

      const underlying = r.underlying_price ?? 0;
      if (!underlying) continue;

      out.push({
        instrument: r.instrument_name,
        venue: "deribit",
        coin,
        strike,
        expiry,
        type: typeStr,
        markPriceUsd: (r.mark_price ?? 0) * underlying,
        bidUsd: r.bid_price != null ? r.bid_price * underlying : null,
        askUsd: r.ask_price != null ? r.ask_price * underlying : null,
        markIv: (r.mark_iv ?? 0) / 100,
        underlyingPrice: underlying,
        openInterest: r.open_interest ?? 0,
      });
    }
    return out;
  }

  async getAvailableCoins(): Promise<string[]> {
    const out = new Set<string>();
    for (const currency of ["BTC", "ETH", "SOL", "XRP", "USDC"]) {
      const result = await rpc("get_instruments", { currency, kind: "future", expired: false });
      if (!Array.isArray(result)) continue;
      for (const i of result) {
        const name = String(i.instrument_name);
        if (!name.endsWith("-PERPETUAL")) continue;
        out.add(name.replace("-PERPETUAL", "").replace(/_(USDC|USDT)$/, ""));
      }
    }
    return [...out];
  }

  /** BTC/ETH trade as inverse perps; everything else is USDC-linear. */
  mapCoinToInstrument(coin: string): string {
    if (coin === "BTC" || coin === "ETH") return `${coin}-PERPETUAL`;
    return `${coin}_USDC-PERPETUAL`;
  }
}
