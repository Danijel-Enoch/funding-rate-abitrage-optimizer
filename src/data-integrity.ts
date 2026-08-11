/**
 * Data provenance and validation.
 *
 * The rule this module enforces: a backtest may only consume data that was
 * actually observed from a venue's API over the window being tested. Anything
 * fabricated, extrapolated, or substituted from another source is either
 * rejected or carried with a label that follows it into the results.
 *
 * This exists because the failure mode is silent. A funding adapter that
 * replicates today's rate across a year still returns 8,760 well-formed points;
 * it backtests as a straight line and produces a Sharpe in the hundreds. A
 * missing perp price series quietly replaced by spot prices makes the
 * inter-venue basis look exactly zero. Neither throws. Both change the answer.
 */

export type Provenance =
  /** Read directly from the venue's API for the requested window. */
  | "observed"
  /** Computed from observed data by a documented transform (e.g. resampling). */
  | "derived"
  /** Extrapolated, assumed, or carried from a different window. Never backtestable. */
  | "synthetic";

export interface SeriesMeta {
  /** Venue id, e.g. "deribit". */
  source: string;
  /** API endpoint the data came from. */
  endpoint: string;
  /** The specific field read, e.g. "interest_1h". */
  field: string;
  provenance: Provenance;
  /** Set when provenance is not "observed" — why, in one line. */
  caveat?: string;
  /** When a snapshot was taken, for point-in-time data used across history. */
  observedAt?: number;
}

export type Severity = "fatal" | "warn";

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
}

export interface SeriesStats {
  count: number;
  distinctValues: number;
  spanDays: number;
  requestedDays: number;
  coveragePct: number;
  maxGapHours: number;
  medianGapHours: number;
  outOfRange: number;
  nonFinite: number;
}

export interface ValidationReport {
  label: string;
  meta: SeriesMeta;
  ok: boolean;
  issues: Issue[];
  stats: SeriesStats;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

interface Point {
  timestamp: number;
  value: number;
}

export interface Window {
  start: number;
  end: number;
}

/**
 * Minimum share of the requested window a series must actually span. Below this
 * the series is describing a different period than the one being tested, and
 * comparing it against a full-window series is not meaningful.
 */
const MIN_COVERAGE = 0.9;

/**
 * A real funding or price series varies. If nearly every observation is
 * identical, the adapter is echoing one value rather than reporting history.
 * The threshold is deliberately loose so that genuinely quiet markets pass.
 */
const MIN_DISTINCT_RATIO = 1 / 500;

function analyse(points: Point[], window: Window): SeriesStats {
  const requestedDays = (window.end - window.start) / DAY;
  if (points.length === 0) {
    return {
      count: 0, distinctValues: 0, spanDays: 0, requestedDays,
      coveragePct: 0, maxGapHours: 0, medianGapHours: 0, outOfRange: 0, nonFinite: 0,
    };
  }

  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const spanDays = (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / DAY;

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].timestamp - sorted[i - 1].timestamp) / HOUR);
  }
  gaps.sort((a, b) => a - b);

  // Tolerate one bar of slack at each edge
  const lo = window.start - HOUR;
  const hi = window.end + HOUR;

  return {
    count: sorted.length,
    distinctValues: new Set(sorted.map((p) => p.value.toFixed(12))).size,
    spanDays,
    requestedDays,
    coveragePct: requestedDays > 0 ? spanDays / requestedDays : 0,
    maxGapHours: gaps.length ? gaps[gaps.length - 1] : 0,
    medianGapHours: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0,
    outOfRange: sorted.filter((p) => p.timestamp < lo || p.timestamp > hi).length,
    nonFinite: sorted.filter((p) => !Number.isFinite(p.value) || !Number.isFinite(p.timestamp)).length,
  };
}

function checkCommon(points: Point[], stats: SeriesStats, meta: SeriesMeta): Issue[] {
  const issues: Issue[] = [];

  if (meta.provenance === "synthetic") {
    issues.push({
      code: "synthetic-source",
      severity: "fatal",
      message: `${meta.source} reports ${meta.provenance} data — ${meta.caveat ?? "not observed history"}`,
    });
  }

  if (stats.count === 0) {
    issues.push({ code: "empty", severity: "fatal", message: "no data returned" });
    return issues;
  }

  if (stats.nonFinite > 0) {
    issues.push({
      code: "non-finite",
      severity: "fatal",
      message: `${stats.nonFinite} NaN or infinite values`,
    });
  }

  if (stats.distinctValues <= Math.max(2, stats.count * MIN_DISTINCT_RATIO)) {
    issues.push({
      code: "constant-series",
      severity: "fatal",
      message: `only ${stats.distinctValues} distinct values across ${stats.count} points — the adapter is echoing a single value, not reporting history`,
    });
  }

  if (stats.coveragePct < MIN_COVERAGE) {
    issues.push({
      code: "insufficient-coverage",
      severity: "fatal",
      message: `covers ${stats.spanDays.toFixed(1)}d of the ${stats.requestedDays.toFixed(0)}d requested (${(stats.coveragePct * 100).toFixed(0)}%)`,
    });
  }

  if (stats.outOfRange > 0) {
    issues.push({
      code: "out-of-range",
      severity: "fatal",
      message: `${stats.outOfRange} points fall outside the requested window — the endpoint ignored the time filter`,
    });
  }

  // A gap far above the cadence means missing history rather than a quiet venue
  if (stats.medianGapHours > 0 && stats.maxGapHours > stats.medianGapHours * 24) {
    issues.push({
      code: "large-gap",
      severity: "warn",
      message: `largest gap ${stats.maxGapHours.toFixed(0)}h vs typical ${stats.medianGapHours.toFixed(1)}h`,
    });
  }

  return issues;
}

export function validateFundingSeries(
  label: string,
  rates: Array<{ timestamp: number; fundingRate: number }>,
  meta: SeriesMeta,
  window: Window
): ValidationReport {
  const points = rates.map((r) => ({ timestamp: r.timestamp, value: r.fundingRate }));
  const stats = analyse(points, window);
  const issues = checkCommon(points, stats, meta);

  // Funding is a rate per interval; anything near 100% per settlement is a unit error
  const extreme = points.filter((p) => Math.abs(p.value) > 0.1).length;
  if (extreme > 0) {
    issues.push({
      code: "implausible-rate",
      severity: "fatal",
      message: `${extreme} funding rates above 10% per interval — likely a units mismatch (percent vs decimal)`,
    });
  }

  return { label, meta, ok: !issues.some((i) => i.severity === "fatal"), issues, stats };
}

export function validatePriceSeries(
  label: string,
  prices: Array<{ timestamp: number; price: number }>,
  meta: SeriesMeta,
  window: Window
): ValidationReport {
  const points = prices.map((p) => ({ timestamp: p.timestamp, value: p.price }));
  const stats = analyse(points, window);
  const issues = checkCommon(points, stats, meta);

  if (points.some((p) => p.value <= 0)) {
    issues.push({ code: "non-positive-price", severity: "fatal", message: "prices at or below zero" });
  }

  // A single-print jump of this size is a bad tick, not a market move
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  let jumps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    if (prev > 0 && Math.abs(sorted[i].value / prev - 1) > 0.5) jumps++;
  }
  if (jumps > 0) {
    issues.push({
      code: "price-jump",
      severity: "warn",
      message: `${jumps} single-step moves above 50% — check for bad ticks`,
    });
  }

  return { label, meta, ok: !issues.some((i) => i.severity === "fatal"), issues, stats };
}

/** Fatal issues across a set of reports, for gating a backtest. */
export function fatalIssues(reports: ValidationReport[]): ValidationReport[] {
  return reports.filter((r) => !r.ok);
}

/** True when every series feeding a result was directly observed. */
export function allObserved(reports: ValidationReport[]): boolean {
  return reports.every((r) => r.meta.provenance === "observed");
}

/** One-line provenance summary to attach to a result. */
export function provenanceLabel(reports: ValidationReport[]): string {
  const kinds = new Set(reports.map((r) => r.meta.provenance));
  if (kinds.size === 1 && kinds.has("observed")) return "observed";
  const caveats = reports
    .filter((r) => r.meta.provenance !== "observed" && r.meta.caveat)
    .map((r) => r.meta.caveat!);
  return [...kinds].join("+") + (caveats.length ? ` (${[...new Set(caveats)].join("; ")})` : "");
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
};

export function printReport(reports: ValidationReport[]): void {
  console.log(
    `  ${"Series".padEnd(34)}${"Provenance".padEnd(12)}${"Points".padStart(8)}` +
    `${"Distinct".padStart(10)}${"Span".padStart(9)}${"Cover".padStart(8)}${"Gap".padStart(9)}   Status`
  );

  for (const r of reports) {
    const s = r.stats;
    const status = r.ok
      ? (r.issues.length ? `${C.yellow}pass (warnings)${C.reset}` : `${C.green}pass${C.reset}`)
      : `${C.red}REJECTED${C.reset}`;

    console.log(
      `  ${r.label.slice(0, 33).padEnd(34)}${r.meta.provenance.padEnd(12)}` +
      `${String(s.count).padStart(8)}${String(s.distinctValues).padStart(10)}` +
      `${(s.spanDays.toFixed(0) + "d").padStart(9)}${((s.coveragePct * 100).toFixed(0) + "%").padStart(8)}` +
      `${(s.medianGapHours.toFixed(1) + "h").padStart(9)}   ${status}`
    );

    for (const i of r.issues) {
      const colour = i.severity === "fatal" ? C.red : C.yellow;
      console.log(`      ${colour}${i.severity === "fatal" ? "✗" : "!"} ${i.code}${C.reset}: ${i.message}`);
    }
  }
}
