/**
 * Uniswap spot price adapter
 * Uses DeFi Llama aggregated DEX prices (includes Uniswap)
 */
import type { SpotExchange, ExchangeInfo } from "./types";

export const uniswapInfo: ExchangeInfo = {
  id: "uniswap",
  name: "Uniswap (DEX)",
  type: "spot",
  url: "https://uniswap.org",
};

export class UniswapSpotExchange implements SpotExchange {
  info = uniswapInfo;

  async fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    // Map symbol to DeFi Llama coin ID
    const coinId = this.symbolToCoinId(symbol);
    if (!coinId) throw new Error(`Unknown symbol: ${symbol}`);

    const url = `https://coins.llama.fi/chart/${coinId}?start=${Math.floor(startTime / 1000)}&period=1h`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`DeFi Llama API ${res.status}`);
    const data = await res.json() as any;

    const coinData = data.coins?.[coinId];
    if (!coinData?.prices) return [];

    return coinData.prices.map((p: any) => ({
      timestamp: p.timestamp * 1000,
      price: p.price,
    }));
  }

  async getAvailableSymbols(): Promise<string[]> {
    return ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "MATICUSDT", "UNIUSDT", "AAVEUSDT", "CRVUSDT", "LDOUSDT", "SUSHIUSDT", "COMPUSDT", "MKRUSDT", "SNXUSDT", "INJUSDT", "NEARUSDT", "SUIUSDT", "APTUSDT", "OPUSDT", "ARBUSDT"];
  }

  private symbolToCoinId(symbol: string): string | null {
    const base = symbol.replace("USDT", "").replace("USD", "");
    const map: Record<string, string> = {
      BTC: "coingecko:bitcoin", ETH: "coingecko:ethereum", SOL: "coingecko:solana",
      DOGE: "coingecko:dogecoin", XRP: "coingecko:ripple", ADA: "coingecko:cardano",
      AVAX: "coingecko:avalanche-2", LINK: "coingecko:chainlink", DOT: "coingecko:polkadot",
      MATIC: "coingecko:matic-network", UNI: "coingecko:uniswap", AAVE: "coingecko:aave",
      CRV: "coingecko:curve-dao-token", LDO: "coingecko:lido-dao", SUSHI: "coingecko:sushi",
      COMP: "coingecko:compound-governance-token", MKR: "coingecko:maker", SNX: "coingecko:havven",
      INJ: "coingecko:injective-protocol", NEAR: "coingecko:near", SUI: "coingecko:sui",
      APT: "coingecko:aptos", OP: "coingecko:optimism", ARB: "coingecko:arbitrum",
      PEPE: "coingecko:pepe", SHIB: "coingecko:shiba-inu", WIF: "coingecko:dogwifhat",
      BONK: "coingecko:bonk", FIL: "coingecko:filecoin", ICP: "coingecko:internet-computer",
      HBAR: "coingecko:hedera-hashgraph", ALGO: "coingecko:algorand", XLM: "coingecko:stellar",
      ATOM: "coingecko:cosmos", ETC: "coingecko:ethereum-classic", TRX: "coingecko:tron",
      LTC: "coingecko:litecoin", BCH: "coingecko:bitcoin-cash", TON: "coingecko:the-open-network",
      SEI: "coingecko sei", RENDER: "coingecko:render-token", FET: "coingecko:fetch-ai",
      TIA: "coingecko:celestia", PYTH: "coingecko:pyth-network", JUP: "coingecko:jupiter-exchange-solana",
      WLD: "coingecko:worldcoin-wld", PENDLE: "coingecko:pendle", ONDO: "coingecko:ondo-finance",
      PAXG: "coingecko:pax-gold", DYDX: "coingecko:dydx-chain", ENA: "coingecko:ethena",
      ENS: "coingecko:ethereum-name-service", ZRO: "coingecko:layerzero",
    };
    return map[base] || `coingecko:${base.toLowerCase()}`;
  }
}
