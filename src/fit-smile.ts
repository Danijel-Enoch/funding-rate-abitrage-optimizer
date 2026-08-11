#!/usr/bin/env bun
/**
 * Fits the volatility smile from a live Deribit option chain and writes it to
 * data/smile.json with the timestamp it was observed.
 *
 * The iron fly (options_vs_options) needs wing volatilities, but DVOL only
 * publishes the ATM level — no historical surface exists on any public endpoint.
 * Rather than hardcode plausible-looking constants, this reads a real chain and
 * records exactly when it was read, so any result computed from it carries a
 * date and can be refitted or invalidated.
 *
 * Model, quadratic in standardized moneyness m = ln(K/F) / (σ_atm · √T):
 *
 *     σ(m) / σ_atm = 1 + skew · m + curvature · m²
 *
 * Usage:
 *   bun run fit-smile              # fit BTC and ETH, write data/smile.json
 *   bun run fit-smile --print      # fit and show the residuals, write nothing
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { deribit } from "./exchanges/index";
import { YEAR_MS } from "./options";

const OUT_DIR = join(import.meta.dir, "..", "data");
const OUT_FILE = join(OUT_DIR, "smile.json");

/** Target tenor to fit, in days. 30 matches the DVOL index the level comes from. */
const TARGET_TENOR_DAYS = 30;

/** Only fit strikes with real two-sided interest; deep wings are model marks. */
const MAX_ABS_MONEYNESS = 2.5;

export interface FittedSmile {
  skew: number;
  curvature: number;
  atmIv: number;
  /** Root-mean-square residual of the fit, in vol ratio units. */
  rmse: number;
  points: number;
  expiry: number;
  tenorDays: number;
  observedAt: number;
  source: string;
}

export interface SmileFile {
  fittedAt: number;
  model: string;
  coins: Record<string, FittedSmile>;
}

/** Least-squares fit of y = 1 + a·m + b·m² (intercept pinned at ATM by construction). */
function fitQuadratic(pts: Array<{ m: number; y: number }>): { skew: number; curvature: number; rmse: number } {
  // Minimise Σ(1 + a·m + b·m² − y)². Let r = y − 1, solve the 2x2 normal equations.
  let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
  for (const { m, y } of pts) {
    const r = y - 1;
    const m2 = m * m;
    s11 += m * m;
    s12 += m * m2;
    s22 += m2 * m2;
    t1 += m * r;
    t2 += m2 * r;
  }

  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) < 1e-12) return { skew: 0, curvature: 0, rmse: Infinity };

  const skew = (t1 * s22 - t2 * s12) / det;
  const curvature = (t2 * s11 - t1 * s12) / det;

  let sse = 0;
  for (const { m, y } of pts) {
    const pred = 1 + skew * m + curvature * m * m;
    sse += (pred - y) ** 2;
  }

  return { skew, curvature, rmse: Math.sqrt(sse / pts.length) };
}

export async function fitSmileForCoin(coin: string, verbose = false): Promise<FittedSmile | null> {
  const chain = await deribit.fetchOptionChain(coin);
  if (!chain.length) return null;

  const now = Date.now();
  const expiries = [...new Set(chain.map((c) => c.expiry))].filter((e) => e > now);
  if (!expiries.length) return null;

  // Expiry closest to the DVOL tenor
  const targetMs = TARGET_TENOR_DAYS * 86400000;
  const expiry = expiries.reduce((a, b) =>
    Math.abs(b - now - targetMs) < Math.abs(a - now - targetMs) ? b : a
  );

  const quotes = chain.filter((c) => c.expiry === expiry && c.markIv > 0);
  if (quotes.length < 8) return null;

  const forward = quotes[0].underlyingPrice;
  const tYears = (expiry - now) / YEAR_MS;
  if (tYears <= 0) return null;

  // ATM vol anchors the ratio
  const atm = quotes.reduce((a, b) =>
    Math.abs(b.strike - forward) < Math.abs(a.strike - forward) ? b : a
  );
  const atmIv = atm.markIv;
  if (!(atmIv > 0)) return null;

  const sd = atmIv * Math.sqrt(tYears);
  const pts = quotes
    .map((q) => ({ m: Math.log(q.strike / forward) / sd, y: q.markIv / atmIv }))
    .filter((p) => Number.isFinite(p.m) && Number.isFinite(p.y) && Math.abs(p.m) <= MAX_ABS_MONEYNESS);

  if (pts.length < 8) return null;

  const { skew, curvature, rmse } = fitQuadratic(pts);

  if (verbose) {
    console.log(`\n${coin}  expiry ${new Date(expiry).toISOString().slice(0, 10)}  ` +
      `${(tYears * 365).toFixed(1)}d  F=${forward.toFixed(0)}  ATM IV=${(atmIv * 100).toFixed(1)}%`);
    console.log(`  fit: skew=${skew.toFixed(4)} curvature=${curvature.toFixed(4)} rmse=${rmse.toFixed(4)} over ${pts.length} strikes`);
    console.log(`  ${"m".padStart(7)}${"actual".padStart(9)}${"fitted".padStart(9)}${"resid".padStart(9)}`);
    for (const target of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      const near = pts.reduce((a, b) => (Math.abs(b.m - target) < Math.abs(a.m - target) ? b : a));
      const pred = 1 + skew * near.m + curvature * near.m * near.m;
      console.log(`  ${near.m.toFixed(2).padStart(7)}${near.y.toFixed(3).padStart(9)}${pred.toFixed(3).padStart(9)}${(pred - near.y).toFixed(4).padStart(9)}`);
    }
  }

  return {
    skew, curvature, atmIv, rmse,
    points: pts.length,
    expiry,
    tenorDays: tYears * 365,
    observedAt: now,
    source: "deribit /public/get_book_summary_by_currency (mark_iv)",
  };
}

async function main() {
  const verbose = process.argv.includes("--print");
  const dryRun = verbose;

  console.log("Fitting volatility smile from live Deribit chains");
  console.log("model: sigma(m)/sigma_atm = 1 + skew*m + curvature*m^2");

  const coins: Record<string, FittedSmile> = {};
  for (const coin of ["BTC", "ETH"]) {
    const fit = await fitSmileForCoin(coin, verbose);
    if (!fit) {
      console.log(`  ${coin}: no usable chain — skipped`);
      continue;
    }
    coins[coin] = fit;
    if (!verbose) {
      console.log(`  ${coin}: skew=${fit.skew.toFixed(4)} curvature=${fit.curvature.toFixed(4)} ` +
        `rmse=${fit.rmse.toFixed(4)} (${fit.points} strikes, ${fit.tenorDays.toFixed(0)}d expiry)`);
    }
  }

  if (!Object.keys(coins).length) {
    console.error("No smiles fitted — nothing written.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--print given: nothing written.");
    return;
  }

  const file: SmileFile = {
    fittedAt: Date.now(),
    model: "sigma(m)/sigma_atm = 1 + skew*m + curvature*m^2, m = ln(K/F)/(sigma_atm*sqrt(T))",
    coins,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(file, null, 2));
  console.log(`\nWrote ${OUT_FILE}`);
  console.log("Results using this smile are tagged with its observation date.");
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
