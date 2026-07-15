/**
 * Exchange registry - all available exchanges
 */
import type { PerpExchange, SpotExchange } from "./types";
import { HyperliquidExchange } from "./hyperliquid";
import { LighterExchange } from "./lighter";
import { AsterExchange } from "./aster";
import { ExtendedExchange } from "./extended";
import { ParadexExchange } from "./paradex";
import { NadoExchange } from "./nado";
import { GmxExchange } from "./gmx";
import { BinancePerpExchange } from "./binance-perp";
import { BybitExchange } from "./bybit";
import { OkxExchange } from "./okx";
import { MexcExchange } from "./mexc";
import { BinanceSpotExchange } from "./binance";
import { UniswapSpotExchange } from "./uniswap";
import { BybitSpotExchange } from "./bybit-spot";
import { OkxSpotExchange } from "./okx-spot";
import { MexcSpotExchange } from "./mexc-spot";
import { BscStocksExchange } from "./bsc-stocks";
import { UniswapStocksExchange } from "./uniswap-stocks";

// Perp exchanges
export const hyperliquid = new HyperliquidExchange();
export const lighter = new LighterExchange();
export const aster = new AsterExchange();
export const extended = new ExtendedExchange();
export const paradex = new ParadexExchange();
export const nado = new NadoExchange();
export const gmx = new GmxExchange();
export const binancePerp = new BinancePerpExchange();
export const bybit = new BybitExchange();
export const okx = new OkxExchange();
export const mexc = new MexcExchange();

// Spot exchanges
export const binanceSpot = new BinanceSpotExchange();
export const uniswapSpot = new UniswapSpotExchange();
export const bybitSpot = new BybitSpotExchange();
export const okxSpot = new OkxSpotExchange();
export const mexcSpot = new MexcSpotExchange();

export const perpExchanges: PerpExchange[] = [
  hyperliquid, lighter, aster, extended, paradex, nado, gmx,
  binancePerp, bybit, okx, mexc,
];
export const bscStocks = new BscStocksExchange();
export const uniswapStocks = new UniswapStocksExchange();
export const spotExchanges: SpotExchange[] = [
  binanceSpot, uniswapSpot, bybitSpot, okxSpot, mexcSpot, bscStocks, uniswapStocks,
];

export function getPerpExchange(id: string): PerpExchange | undefined {
  return perpExchanges.find((e) => e.info.id === id);
}

export function getSpotExchange(id: string): SpotExchange | undefined {
  return spotExchanges.find((e) => e.info.id === id);
}
