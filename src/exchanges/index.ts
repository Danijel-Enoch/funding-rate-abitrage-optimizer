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
import { BinanceSpotExchange } from "./binance";
import { UniswapSpotExchange } from "./uniswap";

export const hyperliquid = new HyperliquidExchange();
export const lighter = new LighterExchange();
export const aster = new AsterExchange();
export const extended = new ExtendedExchange();
export const paradex = new ParadexExchange();
export const nado = new NadoExchange();
export const gmx = new GmxExchange();
export const binanceSpot = new BinanceSpotExchange();
export const uniswapSpot = new UniswapSpotExchange();

export const perpExchanges: PerpExchange[] = [hyperliquid, lighter, aster, extended, paradex, nado, gmx];
export const spotExchanges: SpotExchange[] = [binanceSpot, uniswapSpot];

export function getPerpExchange(id: string): PerpExchange | undefined {
  return perpExchanges.find((e) => e.info.id === id);
}

export function getSpotExchange(id: string): SpotExchange | undefined {
  return spotExchanges.find((e) => e.info.id === id);
}
