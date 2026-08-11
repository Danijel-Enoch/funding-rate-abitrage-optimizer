/**
 * Paradex options adapter (Starknet)
 * API docs: https://docs.paradex.trade
 *
 * Paradex is the second venue in this repo with a live options order book.
 * Unlike Deribit, Paradex options are USDC-settled, so marks are already in USD.
 * The summary endpoint also publishes exchange-computed greeks, mark IV, and a
 * forward rate per instrument, which is used to cross-check put-call parity.
 */
import type { OptionQuote } from "./deribit";
import type { ExchangeInfo } from "./types";

const API = "https://api.prod.paradex.trade/v1";

export const paradexOptionsInfo: ExchangeInfo = {
  id: "paradex-options",
  name: "Paradex (Options)",
  type: "perp",
  url: "https://paradex.trade",
};

interface ParadexMarketMeta {
  symbol: string;
  base_currency: string;
  asset_kind: string;
  option_type?: string;      // "PUT" | "CALL"
  strike_price?: string;
  expiry_at?: number;
}

/** Greeks published by Paradex alongside the mark. */
export interface ParadexGreeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

export interface ParadexOptionQuote extends OptionQuote {
  greeks: ParadexGreeks;
  forwardRate: number;
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) return null;
  return res.json();
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

export class ParadexOptionsExchange {
  info = paradexOptionsInfo;

  /**
   * Live option chain for a coin. Joins /markets (contract metadata: strike,
   * expiry, option type) with /markets/summary (marks, IV, greeks).
   */
  async fetchOptionChain(coin: string): Promise<ParadexOptionQuote[]> {
    const [marketsRes, summaryRes] = await Promise.all([
      get("/markets"),
      get("/markets/summary?market=ALL"),
    ]);

    const metas: ParadexMarketMeta[] = marketsRes?.results ?? [];
    const summaries: any[] = summaryRes?.results ?? [];
    if (!metas.length || !summaries.length) return [];

    const metaBySymbol = new Map<string, ParadexMarketMeta>();
    for (const m of metas) {
      if (m.asset_kind === "OPTION" && m.base_currency === coin) metaBySymbol.set(m.symbol, m);
    }

    const out: ParadexOptionQuote[] = [];
    for (const s of summaries) {
      const meta = metaBySymbol.get(s.symbol);
      if (!meta) continue;

      const strike = num(meta.strike_price);
      const expiry = meta.expiry_at ?? 0;
      const underlying = num(s.underlying_price);
      if (!strike || !expiry || !underlying) continue;

      const g = s.greeks ?? {};
      out.push({
        instrument: s.symbol,
        venue: "paradex",
        coin,
        strike,
        expiry,
        type: meta.option_type === "PUT" ? "P" : "C",
        markPriceUsd: num(s.mark_price),
        bidUsd: s.bid ? num(s.bid) : null,
        askUsd: s.ask ? num(s.ask) : null,
        markIv: num(s.mark_iv),
        underlyingPrice: underlying,
        openInterest: num(s.open_interest),
        greeks: {
          delta: num(g.delta),
          gamma: num(g.gamma),
          vega: num(g.vega),
          theta: num(g.theta),
        },
        forwardRate: num(s.forward_rate),
      });
    }
    return out.sort((a, b) => a.expiry - b.expiry || a.strike - b.strike);
  }

  /** Current perp mark and funding rate, used as the hedge leg for a Paradex options trade. */
  async fetchPerpMark(coin: string): Promise<{ markPrice: number; fundingRate: number } | null> {
    const res = await get(`/markets/summary?market=${coin}-USD-PERP`);
    const r = res?.results?.[0];
    if (!r) return null;
    return { markPrice: num(r.mark_price), fundingRate: num(r.funding_rate) };
  }

  async getAvailableOptionCoins(): Promise<string[]> {
    const res = await get("/markets");
    const metas: ParadexMarketMeta[] = res?.results ?? [];
    return [...new Set(metas.filter((m) => m.asset_kind === "OPTION").map((m) => m.base_currency))];
  }
}
