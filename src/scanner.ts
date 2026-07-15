/**
 * Funding Rate & Price Opportunity Scanner
 *
 * Fetches current funding rates (perp exchanges) and spot prices (spot exchanges)
 * for a given coin and checks for arbitrage opportunities across all venues.
 *
 * Usage: bun run src/scanner.ts [COIN]
 * Example: bun run src/scanner.ts BTC
 */

import { perpExchanges, spotExchanges } from "./exchanges";
import { EXCHANGE_FEES } from "./backtest";
import type { PerpExchange, SpotExchange } from "./exchanges/types";

// ── Types ──────────────────────────────────────────────────────────────

interface ExchangeRate {
  exchange: string;
  name: string;
  rate: number;
  timestamp: number;
  available: boolean;
  error?: string;
}

interface SpotPrice {
  exchange: string;
  name: string;
  price: number;
  timestamp: number;
  available: boolean;
  error?: string;
}

interface FundingArbOpportunity {
  longExchange: string;
  shortExchange: string;
  longRate: number;
  shortRate: number;
  spreadBps: number;
  netBps: number;
  feeCostBps: number;
  breakevenPeriods: number;
}

interface SpotArbOpportunity {
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  netPct: number;
  feeCostPct: number;
}

interface BasisOpportunity {
  perpExchange: string;
  perpName: string;
  spotExchange: string;
  spotName: string;
  fundingRate: number;
  direction: "long_spot_short_perp" | "long_perp_short_spot";
  netBps: number;
  annualizedPct: number;
  spotFeeBps: number;
  perpFeeBps: number;
  breakevenPeriods: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const FETCH_WINDOW_MS = 2 * 60 * 60 * 1000; // last 2 hours
const FUNDING_PERIOD_HOURS = 8;
// Spot round-trip fee estimate: ~0.1% per side (taker) = 0.2% round-trip
const SPOT_FEE_PCT = 0.2;

// Account sizing (set via CLI)
let ACCOUNT_SIZE = 0;    // 0 = don't show dollar amounts
let LEVERAGE = 1;

// ── Perp: Fetch Latest Funding Rate ────────────────────────────────────

async function fetchLatestRate(
  exchange: PerpExchange,
  coin: string
): Promise<ExchangeRate> {
  const now = Date.now();
  const startTime = now - FETCH_WINDOW_MS;

  try {
    const rates = await Promise.race([
      exchange.fetchFundingRates(coin, startTime, now),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000)
      ),
    ]);

    if (rates.length === 0) {
      return {
        exchange: exchange.info.id,
        name: exchange.info.name,
        rate: 0,
        timestamp: 0,
        available: false,
        error: "no data returned",
      };
    }

    const latest = rates[rates.length - 1];
    return {
      exchange: exchange.info.id,
      name: exchange.info.name,
      rate: latest.fundingRate,
      timestamp: latest.timestamp,
      available: true,
    };
  } catch (e: any) {
    return {
      exchange: exchange.info.id,
      name: exchange.info.name,
      rate: 0,
      timestamp: 0,
      available: false,
      error: e?.message ?? "unknown error",
    };
  }
}

// ── Spot: Fetch Latest Price ───────────────────────────────────────────

function coinToSpotSymbol(coin: string, exchangeId: string): string {
  if (exchangeId === "uniswap") return `${coin}USDT`;
  return `${coin}USDT`;
}

async function fetchLatestSpotPrice(
  exchange: SpotExchange,
  coin: string
): Promise<SpotPrice> {
  const now = Date.now();
  const startTime = now - FETCH_WINDOW_MS;
  const symbol = coinToSpotSymbol(coin, exchange.info.id);

  try {
    const prices = await Promise.race([
      exchange.fetchPrices(symbol, startTime, now),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000)
      ),
    ]);

    if (prices.length === 0) {
      return {
        exchange: exchange.info.id,
        name: exchange.info.name,
        price: 0,
        timestamp: 0,
        available: false,
        error: "no data returned",
      };
    }

    const latest = prices[prices.length - 1];
    return {
      exchange: exchange.info.id,
      name: exchange.info.name,
      price: latest.price,
      timestamp: latest.timestamp,
      available: true,
    };
  } catch (e: any) {
    return {
      exchange: exchange.info.id,
      name: exchange.info.name,
      price: 0,
      timestamp: 0,
      available: false,
      error: e?.message ?? "unknown error",
    };
  }
}

// ── Arbitrage Detection ────────────────────────────────────────────────

function calcPerpFeeCostBps(exchangeA: string, exchangeB: string): number {
  const feeA = EXCHANGE_FEES[exchangeA] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 3 };
  const feeB = EXCHANGE_FEES[exchangeB] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 3 };
  const tradingFees = (feeA.takerFeeBps + feeB.takerFeeBps) * 2;
  const spreadCosts = feeA.avgSpreadBps + feeB.avgSpreadBps;
  return tradingFees + spreadCosts;
}

function findFundingOpportunities(rates: ExchangeRate[]): FundingArbOpportunity[] {
  const available = rates.filter((r) => r.available);
  const opps: FundingArbOpportunity[] = [];

  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const a = available[i];
      const b = available[j];
      const feeCost = calcPerpFeeCostBps(a.exchange, b.exchange);

      const spread1 = a.rate - b.rate;
      const net1 = spread1 * 10000 - feeCost;
      const spreadBps1 = spread1 * 10000;
      const breakeven1 = spreadBps1 > 0 ? Math.ceil(feeCost / spreadBps1) : Infinity;
      if (net1 > 0) {
        opps.push({
          longExchange: a.exchange,
          shortExchange: b.exchange,
          longRate: a.rate,
          shortRate: b.rate,
          spreadBps: spreadBps1,
          netBps: net1,
          feeCostBps: feeCost,
          breakevenPeriods: breakeven1,
        });
      }

      const spread2 = b.rate - a.rate;
      const net2 = spread2 * 10000 - feeCost;
      const spreadBps2 = spread2 * 10000;
      const breakeven2 = spreadBps2 > 0 ? Math.ceil(feeCost / spreadBps2) : Infinity;
      if (net2 > 0) {
        opps.push({
          longExchange: b.exchange,
          shortExchange: a.exchange,
          longRate: b.rate,
          shortRate: a.rate,
          spreadBps: spreadBps2,
          netBps: net2,
          feeCostBps: feeCost,
          breakevenPeriods: breakeven2,
        });
      }
    }
  }

  opps.sort((a, b) => b.netBps - a.netBps);
  return opps;
}

function findSpotOpportunities(prices: SpotPrice[]): SpotArbOpportunity[] {
  const available = prices.filter((p) => p.available);
  const opps: SpotArbOpportunity[] = [];

  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const a = available[i];
      const b = available[j];

      // Buy on cheaper, sell on more expensive
      const [buyer, seller] = a.price < b.price ? [a, b] : [b, a];
      const spreadPct = ((seller.price - buyer.price) / buyer.price) * 100;
      const netPct = spreadPct - SPOT_FEE_PCT;

      if (netPct > 0) {
        opps.push({
          buyExchange: buyer.exchange,
          sellExchange: seller.exchange,
          buyPrice: buyer.price,
          sellPrice: seller.price,
          spreadPct,
          netPct,
          feeCostPct: SPOT_FEE_PCT,
        });
      }
    }
  }

  opps.sort((a, b) => b.netPct - a.netPct);
  return opps;
}

// ── Basis: Spot vs Perp Opportunities ──────────────────────────────────

// Spot fee model (approximate, for CEX spot trading)
const SPOT_TAKER_FEE_BPS = 5;   // 0.05% taker
const SPOT_SPREAD_BPS = 2;      // ~2 bps avg spread

function calcBasisOpportunities(
  perpRates: ExchangeRate[],
  spotPrices: SpotPrice[]
): BasisOpportunity[] {
  const availPerp = perpRates.filter((r) => r.available);
  const availSpot = spotPrices.filter((p) => p.available);
  if (availPerp.length === 0 || availSpot.length === 0) return [];

  const opps: BasisOpportunity[] = [];

  for (const perp of availPerp) {
    for (const spot of availSpot) {
      const perpFee = EXCHANGE_FEES[perp.exchange] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 3 };
      // Perp leg round-trip: entry taker + exit taker + spread crossing
      const perpLegBps = perpFee.takerFeeBps * 2 + perpFee.avgSpreadBps;
      // Spot leg round-trip: entry taker + exit taker + spread crossing
      const spotLegBps = SPOT_TAKER_FEE_BPS * 2 + SPOT_SPREAD_BPS;
      const totalFeeBps = perpLegBps + spotLegBps;

      const rateBps = perp.rate * 10000;
      // Net per period = funding earned - round-trip fees amortized
      // Fees are paid once on entry/exit; funding is collected each period
      // Show net after one period of funding minus full round-trip fees
      const netBps = Math.abs(rateBps) - totalFeeBps;
      const absRateBps = Math.abs(rateBps);
      const breakevenPeriods = absRateBps > 0 ? Math.ceil(totalFeeBps / absRateBps) : Infinity;

      const periodsPerYear = (365 * 24) / FUNDING_PERIOD_HOURS;
      const annualizedPct = (netBps / 10000) * periodsPerYear * 100;

      const direction = perp.rate >= 0
        ? "long_spot_short_perp" as const
        : "long_perp_short_spot" as const;

      opps.push({
        perpExchange: perp.exchange,
        perpName: perp.name,
        spotExchange: spot.exchange,
        spotName: spot.name,
        fundingRate: perp.rate,
        direction,
        netBps,
        annualizedPct,
        spotFeeBps: spotLegBps,
        perpFeeBps: perpLegBps,
        breakevenPeriods,
      });
    }
  }

  opps.sort((a, b) => b.netBps - a.netBps);
  return opps;
}

// ── Formatting ─────────────────────────────────────────────────────────

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

function formatPrice(price: number): string {
  return price >= 1 ? `$${price.toFixed(2)}` : `$${price.toFixed(6)}`;
}

function formatTimestamp(ts: number): string {
  if (ts === 0) return "N/A";
  return new Date(ts).toISOString().slice(11, 19) + " UTC";
}

// ── Main Scan ──────────────────────────────────────────────────────────

async function scan(coin: string) {
  const notional = ACCOUNT_SIZE * LEVERAGE;
  const sizing = ACCOUNT_SIZE > 0 ? ` | $${ACCOUNT_SIZE.toLocaleString()} × ${LEVERAGE}x = $${notional.toLocaleString()}` : "";

  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║       Opportunity Scanner — ${coin.padEnd(17)}║`);
  console.log(`  ║  ${new Date().toISOString().slice(0, 19)} UTC${" ".repeat(23)}║`);
  if (ACCOUNT_SIZE > 0) {
    console.log(`  ║  Account: $${ACCOUNT_SIZE.toLocaleString()} | Leverage: ${LEVERAGE}x${" ".repeat(Math.max(0, 22 - ACCOUNT_SIZE.toLocaleString().length - String(LEVERAGE).length))}║`);
  }
  console.log(`  ╚══════════════════════════════════════════════╝`);

  // ── Fetch everything in parallel ──────────────────────────────────
  const [perpResults, spotResults] = await Promise.all([
    Promise.all(perpExchanges.map((ex) => fetchLatestRate(ex, coin))),
    Promise.all(spotExchanges.map((ex) => fetchLatestSpotPrice(ex, coin))),
  ]);

  // ── Section 1: Spot Prices ────────────────────────────────────────
  console.log(`\n  ┌─── SPOT PRICES ───────────────────────────────┐`);
  console.log(
    `  │ ${"Exchange".padEnd(18)} ${"Price".padStart(12)} ${"Last Update".padStart(18)} │`
  );
  console.log(`  │ ${"─".repeat(18)} ${"─".repeat(12)} ${"─".repeat(18)} │`);

  for (const r of spotResults) {
    if (!r.available) {
      console.log(
        `  │ ${r.name.padEnd(18)} ${"N/A".padStart(12)} ${("err: " + (r.error ?? "")).slice(0, 18).padStart(18)} │`
      );
    } else {
      console.log(
        `  │ ${r.name.padEnd(18)} ${formatPrice(r.price).padStart(12)} ${formatTimestamp(r.timestamp).padStart(18)} │`
      );
    }
  }

  // Spot arbitrage
  const spotOpps = findSpotOpportunities(spotResults);
  const availSpot = spotResults.filter((r) => r.available);

  if (availSpot.length >= 2 && spotOpps.length > 0) {
    console.log(`  │                                    │`);
    console.log(`  │  SPOT ARBITRAGE OPPORTUNITIES:     │`);
    for (const opp of spotOpps.slice(0, 3)) {
      const buyName = spotResults.find((s) => s.exchange === opp.buyExchange)?.name ?? opp.buyExchange;
      const sellName = spotResults.find((s) => s.exchange === opp.sellExchange)?.name ?? opp.sellExchange;
      console.log(`  │  BUY  ${buyName.padEnd(14)} @ ${formatPrice(opp.buyPrice).padStart(10)} │`);
      console.log(`  │  SELL ${sellName.padEnd(14)} @ ${formatPrice(opp.sellPrice).padStart(10)} │`);
      console.log(`  │  Spread: ${opp.spreadPct.toFixed(4)}% | Net: +${opp.netPct.toFixed(4)}% (after ${opp.feeCostPct}% fees) │`);
      console.log(`  │                                    │`);
    }
  } else {
    if (availSpot.length >= 2) {
      const spotPrices = availSpot.map((r) => r.price);
      const maxDiff = Math.max(...spotPrices) - Math.min(...spotPrices);
      const minPrice = Math.min(...spotPrices);
      const maxDiffPct = ((maxDiff / minPrice) * 100).toFixed(4);
      console.log(`  │                                    │`);
      console.log(`  │  NOT ARBITRAGE                     │`);
      console.log(`  │  Max spread: ${maxDiffPct}% (below ${SPOT_FEE_PCT}% fee) │`);
    } else {
      console.log(`  │                                    │`);
      console.log(`  │  Need 2+ spot sources to compare   │`);
    }
  }
  console.log(`  └────────────────────────────────────┘`);

  // ── Section 2: Perp Funding Rates ────────────────────────────────
  console.log(`\n  ┌─── PERP FUNDING RATES ────────────────────────┐`);
  console.log(
    `  │ ${"Exchange".padEnd(14)} ${"Rate".padStart(10)} ${"bps".padStart(8)} ${"Last Update".padStart(18)} │`
  );
  console.log(`  │ ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(18)} │`);

  for (const r of perpResults) {
    if (!r.available) {
      console.log(
        `  │ ${r.name.padEnd(14)} ${"N/A".padStart(10)} ${"N/A".padStart(8)} ${("err: " + (r.error ?? "")).slice(0, 18).padStart(18)} │`
      );
    } else {
      const bps = (r.rate * 10000).toFixed(2);
      console.log(
        `  │ ${r.name.padEnd(14)} ${formatRate(r.rate).padStart(10)} ${(bps + " bps").padStart(8)} ${formatTimestamp(r.timestamp).padStart(18)} │`
      );
    }
  }

  // Funding arbitrage
  const availPerp = perpResults.filter((r) => r.available);
  const fundingOpps = findFundingOpportunities(perpResults);

  if (availPerp.length >= 2 && fundingOpps.length > 0) {
    console.log(`  │                                    │`);
    console.log(`  │  FUNDING ARB OPPORTUNITIES:         │`);
    for (const opp of fundingOpps.slice(0, 3)) {
      const longName = perpResults.find((p) => p.exchange === opp.longExchange)?.name ?? opp.longExchange;
      const shortName = perpResults.find((p) => p.exchange === opp.shortExchange)?.name ?? opp.shortExchange;
      const apr = ((opp.netBps / 10000) * (365 * 24 / FUNDING_PERIOD_HOURS) * 100).toFixed(1);
      const hours = opp.breakevenPeriods * FUNDING_PERIOD_HOURS;
      console.log(`  │  LONG  ${longName.padEnd(14)} (earn ${formatRate(opp.longRate)})     │`);
      console.log(`  │  SHORT ${shortName.padEnd(14)} (pay  ${formatRate(opp.shortRate)})     │`);
      console.log(`  │  Net: +${opp.netBps.toFixed(2)} bps/period | ~${apr}% APR       │`);
      console.log(`  │  Fees paid back in ${opp.breakevenPeriods} periods (${hours}h)                │`);
      if (ACCOUNT_SIZE > 0) {
        const profitPerPeriod = (notional * opp.netBps) / 10000;
        const totalFeesDollar = (notional * opp.feeCostBps) / 10000;
        const profitPerYear = profitPerPeriod * (365 * 24 / FUNDING_PERIOD_HOURS);
        console.log(`  │  Notional: $${notional.toLocaleString()} | Fees: $${totalFeesDollar.toFixed(2)}           │`);
        console.log(`  │  Profit: $${profitPerPeriod.toFixed(2)}/period | ~$${profitPerYear.toFixed(0)}/year            │`);
      }
      console.log(`  │                                    │`);
    }
  } else {
    if (availPerp.length >= 2) {
      const rates = availPerp.map((r) => r.rate);
      const maxSpread = Math.max(...rates) - Math.min(...rates);
      const maxBps = (maxSpread * 10000).toFixed(2);
      // Find the pair with the largest spread to calculate breakeven
      let bestPairBps = 0;
      let bestPairFee = 0;
      for (let i = 0; i < availPerp.length; i++) {
        for (let j = i + 1; j < availPerp.length; j++) {
          const spread = Math.abs(availPerp[i].rate - availPerp[j].rate) * 10000;
          const fee = calcPerpFeeCostBps(availPerp[i].exchange, availPerp[j].exchange);
          if (spread > bestPairBps) { bestPairBps = spread; bestPairFee = fee; }
        }
      }
      const breakeven = bestPairBps > 0 ? Math.ceil(bestPairFee / bestPairBps) : Infinity;
      const breakevenH = breakeven * FUNDING_PERIOD_HOURS;
      console.log(`  │                                    │`);
      console.log(`  │  NOT ARBITRAGE                     │`);
      console.log(`  │  Max spread: ${maxBps} bps (below fee threshold) │`);
      console.log(`  │  At current spread: ~${breakeven} periods (${breakevenH}h) to recover fees  │`);
    } else {
      console.log(`  │                                    │`);
      console.log(`  │  Need 2+ perp sources to compare   │`);
    }
  }
  console.log(`  └────────────────────────────────────┘`);

  // ── Section 3: Basis Trading (Spot vs Perp) ─────────────────────
  const basisOpps = calcBasisOpportunities(perpResults, spotResults);
  const hasBasisData = availPerp.length > 0 && availSpot.length > 0;

  console.log(`\n  ┌─── BASIS TRADING (SPOT VS PERP) ──────────────┐`);

  if (!hasBasisData) {
    console.log(`  │  Need both spot and perp data to evaluate      │`);
    console.log(`  └────────────────────────────────────┘\n`);
    return;
  }

  // Show implied basis for each perp
  console.log(
    `  │ ${"Perp".padEnd(14)} ${"Funding".padStart(10)} ${"Implied".padStart(10)} ${"Annualized".padStart(12)} │`
  );
  console.log(
    `  │ ${" ".padEnd(14)} ${"(per 8h)".padStart(10)} ${"Basis".padStart(10)} ${"Return".padStart(12)} │`
  );
  console.log(`  │ ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(12)} │`);

  const periodsPerYear = (365 * 24) / FUNDING_PERIOD_HOURS;
  for (const perp of availPerp) {
    const rateBps = perp.rate * 10000;
    const annPct = (perp.rate * periodsPerYear * 100).toFixed(1);
    const premDisc = perp.rate >= 0 ? "premium" : "discount";
    console.log(
      `  │ ${perp.name.padEnd(14)} ${formatRate(perp.rate).padStart(10)} ${(rateBps.toFixed(2) + " bps").padStart(10)} ${(annPct + "% " + premDisc).padStart(12)} │`
    );
  }

  // Best basis opportunities
  if (basisOpps.length > 0 && basisOpps[0].netBps > 0) {
    console.log(`  │                                    │`);
    console.log(`  │  BASIS TRADE OPPORTUNITIES:         │`);

    const profitable = basisOpps.filter((o) => o.netBps > 0);
    for (const opp of profitable.slice(0, 3)) {
      const isLongSpot = opp.direction === "long_spot_short_perp";
      const strategy = isLongSpot
        ? `Long spot + Short perp`
        : `Long perp + Short spot`;
      const fundingLabel = isLongSpot ? "earn" : "pay";
      const hours = opp.breakevenPeriods * FUNDING_PERIOD_HOURS;
      const totalFees = opp.spotFeeBps + opp.perpFeeBps;

      console.log(`  │  ${strategy}                         │`);
      console.log(`  │    Spot:  ${opp.spotName.padEnd(20)}                  │`);
      console.log(`  │    Perp:  ${opp.perpName.padEnd(20)}                  │`);
      console.log(`  │    Funding: ${fundingLabel} ${formatRate(opp.fundingRate)} per 8h             │`);
      console.log(`  │    Fees: spot ${opp.spotFeeBps} bps + perp ${opp.perpFeeBps} bps = ${totalFees} bps  │`);
      console.log(`  │    Net: +${opp.netBps.toFixed(2)} bps/period | ~${opp.annualizedPct.toFixed(1)}% APR     │`);
      console.log(`  │    Fees paid back in ${opp.breakevenPeriods} periods (${hours}h)           │`);
      if (ACCOUNT_SIZE > 0) {
        const profitPerPeriod = (notional * opp.netBps) / 10000;
        const totalFeesDollar = (notional * totalFees) / 10000;
        const profitPerYear = profitPerPeriod * (365 * 24 / FUNDING_PERIOD_HOURS);
        console.log(`  │    Notional: $${notional.toLocaleString()} | Fees: $${totalFeesDollar.toFixed(2)}          │`);
        console.log(`  │    Profit: $${profitPerPeriod.toFixed(2)}/period | ~$${profitPerYear.toFixed(0)}/year          │`);
      }
      console.log(`  │                                    │`);
    }
  } else {
    // Find closest to profitable
    const best = basisOpps[0];
    if (best) {
      const totalFees = best.spotFeeBps + best.perpFeeBps;
      const absRateBps = Math.abs(best.fundingRate) * 10000;
      const breakeven = absRateBps > 0 ? Math.ceil(totalFees / absRateBps) : Infinity;
      const breakevenH = breakeven * FUNDING_PERIOD_HOURS;
      console.log(`  │                                    │`);
      console.log(`  │  NOT PROFITABLE AFTER FEES          │`);
      console.log(`  │  Best candidate: ${best.perpName} vs ${best.spotName}  │`);
      console.log(`  │  Net: ${best.netBps.toFixed(2)} bps/period (fees exceed funding)  │`);
      console.log(`  │  Breakeven: ${breakeven} periods (${breakevenH}h) at current rate  │`);
      console.log(`  │                                    │`);
    } else {
      console.log(`  │                                    │`);
      console.log(`  │  NOT PROFITABLE AFTER FEES          │`);
      console.log(`  │  No basis trade opportunities.      │`);
      console.log(`  │                                    │`);
    }
  }

  console.log(`  └────────────────────────────────────┘\n`);
}

// ── CLI ────────────────────────────────────────────────────────────────

// Parse args: bun run src/scanner.ts BTC --size 10000 --leverage 3
const positionalArgs: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--size" && process.argv[i + 1]) {
    ACCOUNT_SIZE = parseFloat(process.argv[i + 1]);
    i++;
  } else if (process.argv[i] === "--leverage" && process.argv[i + 1]) {
    LEVERAGE = parseFloat(process.argv[i + 1]);
    i++;
  } else {
    positionalArgs.push(process.argv[i]);
  }
}

const coin = positionalArgs[0]?.toUpperCase() ?? "BTC";
scan(coin);
