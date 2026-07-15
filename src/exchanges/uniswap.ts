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
    // Use CoinGecko for reliable hourly price data
    const coinId = this.symbolToCoinGeckoId(symbol);
    if (!coinId) {
      // Fallback to DeFi Llama
      return this.fetchFromDeFiLlama(symbol, startTime, endTime);
    }

    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${Math.floor(startTime / 1000)}&to=${Math.floor(endTime / 1000)}`;
    const res = await fetch(url);
    if (!res.ok) return this.fetchFromDeFiLlama(symbol, startTime, endTime);
    const data = await res.json() as any;
    if (!data.prices?.length) return [];

    return data.prices.map((p: [number, number]) => ({
      timestamp: p[0],
      price: p[1],
    }));
  }

  private async fetchFromDeFiLlama(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>> {
    const coinId = this.symbolToCoinId(symbol);
    if (!coinId) return [];

    const allPrices: Array<{ timestamp: number; price: number }> = [];
    const chunkMs = 168 * 3600 * 1000;
    let chunkStart = startTime;

    while (chunkStart < endTime) {
      const chunkEnd = Math.min(chunkStart + chunkMs, endTime);
      const spanHours = Math.ceil((chunkEnd - chunkStart) / (3600 * 1000)) + 1;
      const url = `https://coins.llama.fi/chart/${coinId}?start=${Math.floor(chunkEnd / 1000)}&span=${spanHours}&period=1h`;
      try {
        const res = await fetch(url);
        if (!res.ok) { chunkStart = chunkEnd; continue; }
        const data = await res.json() as any;
        const coinData = data.coins?.[coinId];
        if (coinData?.prices) {
          for (const p of coinData.prices) {
            const ts = p.timestamp * 1000;
            if (ts >= startTime && ts <= endTime) {
              allPrices.push({ timestamp: ts, price: p.price });
            }
          }
        }
      } catch {}
      chunkStart = chunkEnd;
    }

    const seen = new Map<number, number>();
    for (const p of allPrices) seen.set(p.timestamp, p.price);
    return Array.from(seen.entries())
      .map(([timestamp, price]) => ({ timestamp, price }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private symbolToCoinGeckoId(symbol: string): string | null {
    const base = symbol.replace("USDT", "").replace("USD", "");
    const map: Record<string, string> = {
      BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
      DOGE: "dogecoin", XRP: "ripple", ADA: "cardano",
      AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot",
      MATIC: "matic-network", UNI: "uniswap", AAVE: "aave",
      CRV: "curve-dao-token", LDO: "lido-dao", SUSHI: "sushi",
      COMP: "compound-governance-token", MKR: "maker", SNX: "havven",
      INJ: "injective-protocol", NEAR: "near", SUI: "sui",
      APT: "aptos", OP: "optimism", ARB: "arbitrum",
      PEPE: "pepe", SHIB: "shiba-inu", WIF: "dogwifhat",
      BONK: "bonk", FIL: "filecoin",
    };
    return map[base] || null;
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
