/**
 * Options pricing and volatility maths for the perp_vs_options strategy.
 *
 * Conventions used throughout:
 *   - Vol is annualized decimal (0.42 = 42%), matching DVOL/100 and Paradex mark_iv.
 *   - Time to expiry T is in years.
 *   - Risk-free rate is taken as 0. Crypto options are quoted off the forward and
 *     the perp itself carries the financing via funding, so discounting at a
 *     separate rate would double-count the carry the strategy is trying to measure.
 *   - Greeks are per 1 unit of underlying. Vega is per 1.00 of vol (100 vol points).
 */

import type { OptionQuote } from "./exchanges/deribit";

export const YEAR_HOURS = 365 * 24;
export const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Abramowitz & Stegun 7.1.26 error function → standard normal CDF. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp((-x * x) / 2);
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;   // per 1.00 vol
  theta: number;  // per year
}

/**
 * Black-Scholes with zero rates. Returns price and greeks for one unit of
 * underlying notional (i.e. one coin).
 */
export function blackScholes(
  S: number,
  K: number,
  T: number,
  sigma: number,
  type: "C" | "P"
): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const intrinsic = type === "C" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: type === "C" ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, vega: 0, theta: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vega = S * normPdf(d1) * sqrtT;
  const theta = (-S * normPdf(d1) * sigma) / (2 * sqrtT);

  if (type === "C") {
    return { price: S * normCdf(d1) - K * normCdf(d2), delta: normCdf(d1), gamma, vega, theta };
  }
  return { price: K * normCdf(-d2) - S * normCdf(-d1), delta: normCdf(d1) - 1, gamma, vega, theta };
}

/** Greeks of a long ATM straddle (one call + one put at the same strike). */
export function straddleGreeks(S: number, K: number, T: number, sigma: number): Greeks {
  const c = blackScholes(S, K, T, sigma, "C");
  const p = blackScholes(S, K, T, sigma, "P");
  return {
    price: c.price + p.price,
    delta: c.delta + p.delta,
    gamma: c.gamma + p.gamma,
    vega: c.vega + p.vega,
    theta: c.theta + p.theta,
  };
}

/**
 * Annualized realized volatility from a series of prices sampled at a fixed
 * interval. Close-to-close estimator, zero-mean (standard for vol trading —
 * a variance swap pays on Σr², not on variance about the sample mean).
 */
export function realizedVol(prices: number[], samplesPerYear: number): number {
  if (prices.length < 2) return 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= 0 || prices[i - 1] <= 0) continue;
    const r = Math.log(prices[i] / prices[i - 1]);
    sumSq += r * r;
    n++;
  }
  if (n === 0) return 0;
  return Math.sqrt((sumSq / n) * samplesPerYear);
}

/** Rolling realized vol series aligned to the input price series. */
export function rollingRealizedVol(
  prices: Array<{ timestamp: number; price: number }>,
  windowSamples: number,
  samplesPerYear: number
): Array<{ timestamp: number; vol: number }> {
  const out: Array<{ timestamp: number; vol: number }> = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < windowSamples) {
      out.push({ timestamp: prices[i].timestamp, vol: 0 });
      continue;
    }
    const window = prices.slice(i - windowSamples, i + 1).map((p) => p.price);
    out.push({ timestamp: prices[i].timestamp, vol: realizedVol(window, samplesPerYear) });
  }
  return out;
}

// ── Put-call parity / conversion arbitrage ──

export interface SyntheticForward {
  venue: string;
  coin: string;
  expiry: number;
  strike: number;
  tYears: number;
  callMid: number;
  putMid: number;
  /** Forward implied by the option market: F = K + (C - P) at zero rates. */
  forward: number;
  underlyingPrice: number;
  /** Annualized carry implied by the option market vs its own underlying. */
  impliedCarryApr: number;
}

/**
 * Extracts the option-implied forward for the strike nearest the underlying,
 * for each expiry in a chain. This is the "options leg" of a perp/option
 * conversion: long put + short call at K is a synthetic short forward at F.
 */
export function extractSyntheticForwards(chain: OptionQuote[], now = Date.now()): SyntheticForward[] {
  const byExpiry = new Map<number, OptionQuote[]>();
  for (const q of chain) {
    if (q.expiry <= now) continue;
    const list = byExpiry.get(q.expiry) ?? [];
    list.push(q);
    byExpiry.set(q.expiry, list);
  }

  const out: SyntheticForward[] = [];
  for (const [expiry, quotes] of byExpiry) {
    const underlying = quotes[0].underlyingPrice;
    const calls = new Map<number, OptionQuote>();
    const puts = new Map<number, OptionQuote>();
    for (const q of quotes) (q.type === "C" ? calls : puts).set(q.strike, q);

    // Nearest strike that has both a call and a put quoted
    let bestStrike: number | null = null;
    for (const strike of calls.keys()) {
      if (!puts.has(strike)) continue;
      if (bestStrike === null || Math.abs(strike - underlying) < Math.abs(bestStrike - underlying)) {
        bestStrike = strike;
      }
    }
    if (bestStrike === null) continue;

    const call = calls.get(bestStrike)!;
    const put = puts.get(bestStrike)!;
    const callMid = mid(call);
    const putMid = mid(put);
    if (callMid <= 0 || putMid <= 0) continue;

    const tYears = (expiry - now) / YEAR_MS;
    if (tYears <= 0) continue;

    const forward = bestStrike + (callMid - putMid);
    out.push({
      venue: call.venue,
      coin: call.coin,
      expiry,
      strike: bestStrike,
      tYears,
      callMid,
      putMid,
      forward,
      underlyingPrice: underlying,
      impliedCarryApr: (forward / underlying - 1) / tYears,
    });
  }
  return out.sort((a, b) => a.expiry - b.expiry);
}

function mid(q: OptionQuote): number {
  if (q.bidUsd != null && q.askUsd != null && q.bidUsd > 0 && q.askUsd > 0) {
    return (q.bidUsd + q.askUsd) / 2;
  }
  return q.markPriceUsd;
}

export interface ConversionArb {
  venue: string;
  coin: string;
  expiry: number;
  strike: number;
  tYears: number;
  perpPrice: number;
  optionForward: number;
  /** Gross locked-in edge, in bps of notional, before funding on the perp leg. */
  basisBps: number;
  /** basisBps annualized over the tenor. */
  grossApr: number;
  /** Funding the perp leg is expected to pay (negative) or earn (positive), annualized. */
  expectedFundingApr: number;
  /** grossApr + expectedFundingApr - round-trip costs. */
  netApr: number;
  direction: "long_perp_short_synthetic" | "short_perp_long_synthetic";
}

/**
 * Perp vs options conversion arbitrage.
 *
 * If the option-implied forward F sits above the perp mark, you buy the perp and
 * sell the synthetic forward (short call + long put at K). At expiry the options
 * settle against the same index the perp tracks, so (F - perpPrice) is locked in
 * on day one. The remaining P&L is the funding carried on the perp leg, which is
 * why this belongs in the same comparison as the funding strategies.
 */
export function findConversionArbs(
  forwards: SyntheticForward[],
  perpPrice: number,
  currentFundingRate: number,
  fundingIntervalHours: number,
  roundTripCostBps: number
): ConversionArb[] {
  const fundingApr = (currentFundingRate * (YEAR_HOURS / fundingIntervalHours));

  return forwards.map((f) => {
    const basisBps = ((f.forward - perpPrice) / perpPrice) * 10000;
    const basisApr = (basisBps / 10000) / f.tYears;
    const costApr = (roundTripCostBps / 10000) / f.tYears;

    // Both directions must be evaluated. The basis sign alone does not decide:
    // when the perp's funding is larger than the basis, the profitable trade is
    // to short the perp and buy the synthetic forward even though F > perp.
    //   long perp  + short synthetic → earn the basis, pay the funding
    //   short perp + long synthetic  → pay the basis, earn the funding
    const netLong = basisApr - fundingApr - costApr;
    const netShort = -basisApr + fundingApr - costApr;
    const goLong = netLong >= netShort;

    return {
      venue: f.venue,
      coin: f.coin,
      expiry: f.expiry,
      strike: f.strike,
      tYears: f.tYears,
      perpPrice,
      optionForward: f.forward,
      basisBps,
      grossApr: goLong ? basisApr : -basisApr,
      expectedFundingApr: goLong ? -fundingApr : fundingApr,
      netApr: goLong ? netLong : netShort,
      direction: (goLong ? "long_perp_short_synthetic" : "short_perp_long_synthetic") as ConversionArb["direction"],
    };
  }).sort((a, b) => b.netApr - a.netApr);
}
