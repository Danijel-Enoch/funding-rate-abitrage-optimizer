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
