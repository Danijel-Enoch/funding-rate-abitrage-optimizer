/**
 * Funding rate normalization.
 *
 * Venues quote funding on different cadences: Deribit and Hyperliquid accrue
 * hourly, most CEXs and Paradex settle every 8 hours. The backtest engine aligns
 * two funding streams by joining them on hourly buckets, which silently drops
 * most points — and understates the hourly venue's carry by 8x — when an hourly
 * stream is paired with an 8-hourly one.
 *
 * Resampling every stream onto a common hourly grid fixes both problems and
 * keeps the total funding over the period exactly unchanged, which is what makes
 * a cross-strategy comparison apples-to-apples.
 */
import type { FundingRateEntry } from "./exchanges/types";

const HOUR = 3600 * 1000;

/** Median spacing between funding events, in whole hours (minimum 1). */
export function detectFundingIntervalHours(rates: FundingRateEntry[]): number {
  if (rates.length < 3) return 8;
  const sorted = [...rates].sort((a, b) => a.timestamp - b.timestamp);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].timestamp - sorted[i - 1].timestamp) / HOUR;
    if (gap > 0 && gap <= 24) gaps.push(gap);
  }
  if (!gaps.length) return 8;
  gaps.sort((a, b) => a - b);
  return Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]));
}

/**
 * Spreads each funding event evenly across the hours it covers, producing one
 * entry per hour. An 8h rate of 0.01% becomes eight hourly rates of 0.00125%,
 * so the summed carry over any window is preserved.
 */
export function resampleFundingHourly(rates: FundingRateEntry[]): FundingRateEntry[] {
  if (rates.length === 0) return [];

  const sorted = [...rates].sort((a, b) => a.timestamp - b.timestamp);
  const interval = detectFundingIntervalHours(sorted);
  if (interval === 1) {
    return sorted.map((r) => ({ ...r, timestamp: Math.floor(r.timestamp / HOUR) * HOUR }));
  }

  const out = new Map<number, FundingRateEntry>();
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const base = Math.floor(r.timestamp / HOUR) * HOUR;

    // Number of hours this event actually covers — use the real gap to the next
    // event where available so exchange downtime does not fabricate carry.
    let span = interval;
    if (i + 1 < sorted.length) {
      const gap = Math.round((sorted[i + 1].timestamp - r.timestamp) / HOUR);
      if (gap > 0 && gap <= interval * 2) span = gap;
    }

    const perHour = r.fundingRate / span;
    for (let h = 0; h < span; h++) {
      const ts = base + h * HOUR;
      out.set(ts, { timestamp: ts, fundingRate: perHour, coin: r.coin });
    }
  }

  return [...out.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Picks the entry bar so that trade direction is set by the prevailing funding
 * regime rather than by one bar's noise.
 *
 * The backtest engine chooses long/short from the funding differential at the
 * moment of entry and, with no exit threshold, holds that direction for the
 * whole run. Funding flips sign hour to hour, so entering on the first available
 * bar makes the result a coin flip — shifting the start by a few hours can turn
 * a year of cash-and-carry from +6% to -34%.
 *
 * This averages the differential over a warmup window and then enters on the
 * first bar after it whose sign agrees. Only data before the entry is used, so
 * the choice stays ex-ante.
 *
 * Returns both series trimmed to the chosen entry, or the originals unchanged if
 * no agreeing bar exists.
 */
export function alignEntryToPrevailingFunding(
  ratesA: FundingRateEntry[],
  ratesB: FundingRateEntry[],
  warmupDays = 7
): { ratesA: FundingRateEntry[]; ratesB: FundingRateEntry[] } {
  if (ratesA.length < 48 || ratesB.length < 48) return { ratesA, ratesB };

  const mapB = new Map(ratesB.map((r) => [Math.floor(r.timestamp / HOUR) * HOUR, r.fundingRate]));
  const start = ratesA[0].timestamp;
  const warmupEnd = start + warmupDays * 24 * HOUR;

  let sum = 0;
  let n = 0;
  for (const a of ratesA) {
    if (a.timestamp >= warmupEnd) break;
    const b = mapB.get(Math.floor(a.timestamp / HOUR) * HOUR);
    if (b === undefined) continue;
    sum += a.fundingRate - b;
    n++;
  }
  if (n === 0 || sum === 0) return { ratesA, ratesB };

  const prevailing = Math.sign(sum);

  // The engine's main loop starts at index 1, so the matching bar has to land
  // there — slice from the bar immediately before it, not from the match itself.
  for (let i = 1; i < ratesA.length; i++) {
    const a = ratesA[i];
    if (a.timestamp < warmupEnd) continue;
    const b = mapB.get(Math.floor(a.timestamp / HOUR) * HOUR);
    if (b === undefined) continue;
    const diff = a.fundingRate - b;
    if (diff !== 0 && Math.sign(diff) === prevailing) {
      const from = ratesA[i - 1].timestamp;
      return {
        ratesA: ratesA.filter((r) => r.timestamp >= from),
        ratesB: ratesB.filter((r) => r.timestamp >= from),
      };
    }
  }

  return { ratesA, ratesB };
}

/** Total funding accrued over the series (sum of per-event rates). */
export function totalFunding(rates: FundingRateEntry[]): number {
  return rates.reduce((s, r) => s + r.fundingRate, 0);
}

/** Annualized funding rate implied by a series, using its actual elapsed span. */
export function annualizedFunding(rates: FundingRateEntry[]): number {
  if (rates.length < 2) return 0;
  const sorted = [...rates].sort((a, b) => a.timestamp - b.timestamp);
  const days = (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / (24 * HOUR);
  if (days <= 0) return 0;
  return (totalFunding(sorted) * 365) / days;
}
