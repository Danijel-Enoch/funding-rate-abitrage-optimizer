import { Elysia, t } from "elysia";
import { perpExchanges, spotExchanges } from "../../../src/exchanges";
import { EXCHANGE_FEES } from "../../../src/backtest";
import type { PerpExchange, SpotExchange } from "../../../src/exchanges/types";

const FETCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const FUNDING_PERIOD_HOURS = 8;
const SPOT_FEE_PCT = 0.2;

async function fetchLatestRate(exchange: PerpExchange, coin: string) {
  const now = Date.now();
  const startTime = now - FETCH_WINDOW_MS;
  try {
    const rates = await Promise.race([
      exchange.fetchFundingRates(coin, startTime, now),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
    if (rates.length === 0) {
      return { exchange: exchange.info.id, name: exchange.info.name, rate: 0, timestamp: 0, available: false, error: "no data" };
    }
    const latest = rates[rates.length - 1];
    return { exchange: exchange.info.id, name: exchange.info.name, rate: latest.fundingRate, timestamp: latest.timestamp, available: true };
  } catch (e: any) {
    return { exchange: exchange.info.id, name: exchange.info.name, rate: 0, timestamp: 0, available: false, error: e?.message ?? "unknown" };
  }
}

async function fetchLatestSpotPrice(exchange: SpotExchange, coin: string) {
  const now = Date.now();
  const startTime = now - FETCH_WINDOW_MS;
  const symbol = `${coin}USDT`;
  try {
    const prices = await Promise.race([
      exchange.fetchPrices(symbol, startTime, now),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
    if (prices.length === 0) {
      return { exchange: exchange.info.id, name: exchange.info.name, price: 0, timestamp: 0, available: false, error: "no data" };
    }
    const latest = prices[prices.length - 1];
    return { exchange: exchange.info.id, name: exchange.info.name, price: latest.price, timestamp: latest.timestamp, available: true };
  } catch (e: any) {
    return { exchange: exchange.info.id, name: exchange.info.name, price: 0, timestamp: 0, available: false, error: e?.message ?? "unknown" };
  }
}

function findFundingOpportunities(rates: { exchange: string; name: string; rate: number; timestamp: number; available: boolean }[]) {
  const available = rates.filter((r) => r.available);
  const opps: any[] = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const a = available[i];
      const b = available[j];
      const feeA = EXCHANGE_FEES[a.exchange] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 3 };
      const feeB = EXCHANGE_FEES[b.exchange] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 3 };
      const feeCost = (feeA.takerFeeBps + feeB.takerFeeBps) * 2 + feeA.avgSpreadBps + feeB.avgSpreadBps;

      const spread1 = (a.rate - b.rate) * 10000;
      const net1 = spread1 - feeCost;
      if (net1 > 0) {
        opps.push({ longExchange: a.name, shortExchange: b.name, longRate: a.rate, shortRate: b.rate, spreadBps: spread1, netBps: net1, feeCostBps: feeCost, breakevenPeriods: Math.ceil(feeCost / spread1) });
      }
      const spread2 = (b.rate - a.rate) * 10000;
      const net2 = spread2 - feeCost;
      if (net2 > 0) {
        opps.push({ longExchange: b.name, shortExchange: a.name, longRate: b.rate, shortRate: a.rate, spreadBps: spread2, netBps: net2, feeCostBps: feeCost, breakevenPeriods: Math.ceil(feeCost / spread2) });
      }
    }
  }
  opps.sort((a: any, b: any) => b.netBps - a.netBps);
  return opps;
}

function findSpotOpportunities(prices: { exchange: string; name: string; price: number; timestamp: number; available: boolean }[]) {
  const available = prices.filter((p) => p.available);
  const opps: any[] = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const a = available[i];
      const b = available[j];
      const [buyer, seller] = a.price < b.price ? [a, b] : [b, a];
      const spreadPct = ((seller.price - buyer.price) / buyer.price) * 100;
      const netPct = spreadPct - SPOT_FEE_PCT;
      if (netPct > 0) {
        opps.push({ buyExchange: buyer.name, sellExchange: seller.name, buyPrice: buyer.price, sellPrice: seller.price, spreadPct, netPct, feeCostPct: SPOT_FEE_PCT });
      }
    }
  }
  opps.sort((a: any, b: any) => b.netPct - a.netPct);
  return opps;
}

function calcBasisOpportunities(perpRates: any[], spotPrices: any[]) {
  const availPerp = perpRates.filter((r) => r.available);
  const availSpot = spotPrices.filter((p) => p.available);
  if (availPerp.length === 0 || availSpot.length === 0) return [];
  const opps: any[] = [];
  for (const perp of availPerp) {
    for (const spot of availSpot) {
      const perpFee = EXCHANGE_FEES[perp.exchange] ?? { takerFeeBps: 4, makerFeeBps: 1, avgSpreadBps: 3 };
      const perpLegBps = perpFee.takerFeeBps * 2 + perpFee.avgSpreadBps;
      const spotLegBps = 5 * 2 + 2;
      const totalFeeBps = perpLegBps + spotLegBps;
      const rateBps = perp.rate * 10000;
      const netBps = Math.abs(rateBps) - totalFeeBps;
      const periodsPerYear = (365 * 24) / FUNDING_PERIOD_HOURS;
      const annualizedPct = (netBps / 10000) * periodsPerYear * 100;
      const direction = perp.rate >= 0 ? "long_spot_short_perp" : "long_perp_short_spot";
      opps.push({ perpExchange: perp.name, spotExchange: spot.name, fundingRate: perp.rate, direction, netBps, annualizedPct, spotFeeBps: spotLegBps, perpFeeBps: perpLegBps, breakevenPeriods: Math.abs(rateBps) > 0 ? Math.ceil(totalFeeBps / Math.abs(rateBps)) : Infinity });
    }
  }
  opps.sort((a: any, b: any) => b.netBps - a.netBps);
  return opps;
}

export const scanRoutes = new Elysia()
  .get("/api/scan/:coin", async ({ params: { coin } }) => {
    const coinUpper = coin.toUpperCase();
    const [perpResults, spotResults] = await Promise.all([
      Promise.all(perpExchanges.map((ex) => fetchLatestRate(ex, coinUpper))),
      Promise.all(spotExchanges.map((ex) => fetchLatestSpotPrice(ex, coinUpper))),
    ]);
    return {
      coin: coinUpper,
      timestamp: new Date().toISOString(),
      spotPrices: spotResults,
      perpRates: perpResults,
      fundingOpportunities: findFundingOpportunities(perpResults),
      spotOpportunities: findSpotOpportunities(spotResults),
      basisOpportunities: calcBasisOpportunities(perpResults, spotResults),
    };
  }, { params: t.Object({ coin: t.String() }) });
