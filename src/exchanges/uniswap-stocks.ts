/**
 * Uniswap BSC Tokenized Stocks Adapter
 *
 * Discovers and prices tokenized stocks on Uniswap V3 (BSC) and PancakeSwap (BSC).
 * Supports bStocks, Ondo, xStocks tokenized equities.
 *
 * Strategy: Long tokenized stock on Uniswap/PancakeSwap (spot) + Short stock perp on Hyperliquid/Lighter
 *
 * Pool discovery via DeFi Llama API. Prices via Yahoo Finance (1:1 tracking proxy).
 */

import type { SpotExchange, ExchangeInfo } from "./types";

export const uniswapStocksInfo: ExchangeInfo = {
  id: "uniswap-stocks",
  name: "Uniswap BSC Stocks",
  type: "spot",
  url: "https://app.uniswap.org",
};

// ── BSC Chain IDs ──

export const BSC_CHAIN_ID = 56;
export const UNISWAP_BSC_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
export const PANCAKESWAP_BSC_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";

// ── Tokenized Stock Registry ──

export interface TokenizedStock {
  ticker: string;             // Underlying stock ticker
  name: string;               // Human-readable name
  chain: "bsc";
  dex: "uniswap" | "pancakeswap" | "both";
  tokens: TokenInfo[];
  hyperliquidTicker: string;  // Perp ticker on Hyperliquid
  lighterTicker: string | null; // Perp ticker on Lighter
  category: "mega" | "semi" | "crypto" | "etf" | "space" | "other";
}

export interface TokenInfo {
  symbol: string;             // On-chain token symbol
  address: string;            // BEP-20 contract address
  issuer: "bstocks" | "ondo" | "xstocks" | "rex" | "backed";
  decimals: number;
}

// ── Known Tokenized Stocks on BSC ──

export const TOKENIZED_STOCKS: TokenizedStock[] = [
  // === Mega Cap Tech ===
  {
    ticker: "TSLA", name: "Tesla", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "TSLA", lighterTicker: "TSLA",
    tokens: [
      { symbol: "TSLAB", address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", issuer: "bstocks", decimals: 18 },
      { symbol: "TSLAon", address: "0x0000000000000000000000000000000000000001", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "NVDA", name: "NVIDIA", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "NVDA", lighterTicker: null,
    tokens: [
      { symbol: "NVDAB", address: "0xde1a951c1028902430dd0f85e25df853532fa523", issuer: "bstocks", decimals: 18 },
      { symbol: "NVDAon", address: "0x0000000000000000000000000000000000000002", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "AAPL", name: "Apple", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "AAPL", lighterTicker: null,
    tokens: [
      { symbol: "AAPLon", address: "0x0cdE6936d305d5B34667fC46425E852efd73559a", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "MSFT", name: "Microsoft", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "MSFT", lighterTicker: "MSFT",
    tokens: [
      { symbol: "MSFTB", address: "0x277fdd3d6cdc8123b88ff78af805a1fef2ed02a0", issuer: "bstocks", decimals: 18 },
      { symbol: "MSFTon", address: "0x0000000000000000000000000000000000000003", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "GOOGL", name: "Alphabet", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "GOOGL", lighterTicker: "GOOGL",
    tokens: [
      { symbol: "GOOGLon", address: "0x0000000000000000000000000000000000000004", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "AMZN", name: "Amazon", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "AMZN", lighterTicker: null,
    tokens: [
      { symbol: "AMZNon", address: "0x0000000000000000000000000000000000000005", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "META", name: "Meta Platforms", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "META", lighterTicker: null,
    tokens: [
      { symbol: "METAB", address: "0x0000000000000000000000000000000000000006", issuer: "bstocks", decimals: 18 },
    ],
  },
  {
    ticker: "NFLX", name: "Netflix", chain: "bsc", dex: "both", category: "mega",
    hyperliquidTicker: "NFLX", lighterTicker: null,
    tokens: [
      { symbol: "NFLXon", address: "0x0000000000000000000000000000000000000007", issuer: "ondo", decimals: 18 },
    ],
  },

  // === Semiconductors / AI ===
  {
    ticker: "AMD", name: "AMD", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "AMD", lighterTicker: null,
    tokens: [
      { symbol: "AMDB", address: "0x0000000000000000000000000000000000000008", issuer: "bstocks", decimals: 18 },
    ],
  },
  {
    ticker: "MU", name: "Micron Technology", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "MU", lighterTicker: null,
    tokens: [
      { symbol: "MUB", address: "0x0000000000000000000000000000000000000009", issuer: "bstocks", decimals: 18 },
    ],
  },
  {
    ticker: "INTC", name: "Intel", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "INTC", lighterTicker: null,
    tokens: [
      { symbol: "INTCB", address: "0x000000000000000000000000000000000000000a", issuer: "bstocks", decimals: 18 },
    ],
  },
  {
    ticker: "AVGO", name: "Broadcom", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "AVGO", lighterTicker: null,
    tokens: [
      { symbol: "AVGOon", address: "0x000000000000000000000000000000000000000b", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "ARM", name: "ARM Holdings", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "ARM", lighterTicker: null,
    tokens: [
      { symbol: "ARMon", address: "0x000000000000000000000000000000000000000c", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "TSM", name: "Taiwan Semiconductor", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "TSM", lighterTicker: null,
    tokens: [
      { symbol: "TSMon", address: "0x000000000000000000000000000000000000000d", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "CRWV", name: "CoreWeave", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "CRWV", lighterTicker: null,
    tokens: [
      { symbol: "CRWVon", address: "0x000000000000000000000000000000000000000e", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "ORCL", name: "Oracle", chain: "bsc", dex: "both", category: "semi",
    hyperliquidTicker: "ORCL", lighterTicker: null,
    tokens: [
      { symbol: "ORCLon", address: "0x000000000000000000000000000000000000000f", issuer: "ondo", decimals: 18 },
    ],
  },

  // === Crypto-Adjacent ===
  {
    ticker: "COIN", name: "Coinbase", chain: "bsc", dex: "both", category: "crypto",
    hyperliquidTicker: "COIN", lighterTicker: null,
    tokens: [
      { symbol: "COINon", address: "0x0000000000000000000000000000000000000010", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "MSTR", name: "MicroStrategy", chain: "bsc", dex: "both", category: "crypto",
    hyperliquidTicker: "MSTR", lighterTicker: null,
    tokens: [
      { symbol: "MSTRB", address: "0x0000000000000000000000000000000000000011", issuer: "bstocks", decimals: 18 },
    ],
  },
  {
    ticker: "HOOD", name: "Robinhood", chain: "bsc", dex: "both", category: "crypto",
    hyperliquidTicker: "HOOD", lighterTicker: null,
    tokens: [
      { symbol: "HOODon", address: "0x0000000000000000000000000000000000000012", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "PLTR", name: "Palantir", chain: "bsc", dex: "both", category: "crypto",
    hyperliquidTicker: "PLTR", lighterTicker: null,
    tokens: [
      { symbol: "PLTRB", address: "0x0000000000000000000000000000000000000013", issuer: "bstocks", decimals: 18 },
    ],
  },

  // === Space / Other ===
  {
    ticker: "SPCX", name: "SpaceX", chain: "bsc", dex: "both", category: "space",
    hyperliquidTicker: "SPCX", lighterTicker: null,
    tokens: [
      { symbol: "SPCXon", address: "0x0000000000000000000000000000000000000014", issuer: "ondo", decimals: 18 },
    ],
  },

  // === ETFs ===
  {
    ticker: "SPY", name: "S&P 500 ETF", chain: "bsc", dex: "both", category: "etf",
    hyperliquidTicker: "SP500", lighterTicker: "SPY",
    tokens: [
      { symbol: "SPYon", address: "0x0000000000000000000000000000000000000015", issuer: "ondo", decimals: 18 },
    ],
  },
  {
    ticker: "QQQ", name: "Nasdaq 100 ETF", chain: "bsc", dex: "both", category: "etf",
    hyperliquidTicker: "QQQ", lighterTicker: "QQQ",
    tokens: [
      { symbol: "QQQB", address: "0x0cdE6936d305d5B34667fC46425E852efd73559a", issuer: "bstocks", decimals: 18 },
    ],
  },
];

// ── Pool Discovery via DeFi Llama ──

export interface DiscoveredPool {
  chain: string;
  project: string;
  symbol: string;
  poolAddress: string;
  tokenAddress: string;
  tvl: number;
  volume24h: number;
  price: number;
}

/**
 * Discover tokenized stock pools on BSC via DeFi Llama.
 * Searches for pools matching known stock tickers.
 */
export async function discoverStockPools(): Promise<DiscoveredPool[]> {
  const pools: DiscoveredPool[] = [];
  const stockTickers = TOKENIZED_STOCKS.map((s) => s.ticker.toLowerCase());

  try {
    // DeFi Llama pools endpoint - gets all pools on BSC
    const res = await fetch("https://yields.llama.fi/pools");
    if (!res.ok) return pools;

    const data = await res.json() as any;
    const allPools = data?.data || [];

    // Filter for BSC pools with stock-related tokens
    for (const pool of allPools) {
      if (pool.chain !== "Binance") continue;

      const symbol = (pool.symbol || "").toUpperCase();
      const project = (pool.project || "").toLowerCase();

      // Check if this pool contains a tokenized stock
      const isStockPool = stockTickers.some(
        (ticker) => symbol.includes(ticker) || symbol.includes(`${ticker}B`) || symbol.includes(`${ticker}ON`)
      );

      // Also check for known issuers
      const isKnownIssuer = ["bstocks", "ondo", "xstocks", "rex", "backed"].some(
        (issuer) => project.includes(issuer) || symbol.toLowerCase().includes(issuer)
      );

      if (isStockPool || isKnownIssuer) {
        pools.push({
          chain: pool.chain,
          project: pool.project,
          symbol: pool.symbol,
          poolAddress: pool.pool,
          tokenAddress: pool.underlyingTokens?.[0] || "",
          tvl: pool.tvlUsd || 0,
          volume24h: pool.volumeUsd24h || 0,
          price: pool.price || 0,
        });
      }
    }
  } catch (e) {
    // DeFi Llama may be rate-limited
  }

  return pools.sort((a, b) => b.tvl - a.tvl);
}

/**
 * Discover stock pools on Uniswap specifically (BSC chain).
 */
export async function discoverUniswapStockPools(): Promise<DiscoveredPool[]> {
  const allPools = await discoverStockPools();
  return allPools.filter(
    (p) => p.project.toLowerCase().includes("uniswap") || p.project.toLowerCase().includes("pancakeswap")
  );
}

// ── Price Fetching ──

/**
 * Fetch historical stock prices from Yahoo Finance.
 * Used as proxy for BSC tokenized stock prices (1:1 tracking).
 */
export async function fetchStockPriceHistory(
  ticker: string,
  startTime: number,
  endTime: number,
): Promise<Array<{ timestamp: number; price: number }>> {
  const period1 = Math.floor(startTime / 1000);
  const period2 = Math.floor(endTime / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1h&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      return fetchStockPricesFallback(ticker, startTime, endTime);
    }

    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close;
    if (!timestamps || !closes) return [];

    const prices: Array<{ timestamp: number; price: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        prices.push({
          timestamp: timestamps[i] * 1000,
          price: closes[i],
        });
      }
    }

    return prices;
  } catch {
    return fetchStockPricesFallback(ticker, startTime, endTime);
  }
}

/**
 * Fallback: Yahoo Finance v7 historical download
 */
async function fetchStockPricesFallback(
  ticker: string,
  startTime: number,
  endTime: number,
): Promise<Array<{ timestamp: number; price: number }>> {
  const period1 = Math.floor(startTime / 1000);
  const period2 = Math.floor(endTime / 1000);
  const url = `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=${period1}&period2=${period2}&interval=1h&events=history`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.split("\n").slice(1);
    const prices: Array<{ timestamp: number; price: number }> = [];

    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length >= 5) {
        const dateStr = parts[0];
        const close = parseFloat(parts[4]);
        if (!isNaN(close) && dateStr) {
          const ts = new Date(dateStr).getTime();
          if (!isNaN(ts)) {
            prices.push({ timestamp: ts, price: close });
          }
        }
      }
    }

    return prices.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

// ── SpotExchange Implementation ──

export class UniswapStocksExchange implements SpotExchange {
  info = uniswapStocksInfo;

  async fetchPrices(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const ticker = symbol.replace("USDT", "").replace("USD", "").replace("on", "").replace("B", "");
    return fetchStockPriceHistory(ticker, startTime, endTime);
  }

  async getAvailableSymbols(): Promise<string[]> {
    return TOKENIZED_STOCKS.map((s) => `${s.ticker}USDT`);
  }

  /**
   * Get all tokenized stocks with their DEX availability
   */
  getStockRegistry(): TokenizedStock[] {
    return TOKENIZED_STOCKS;
  }

  /**
   * Find a stock by ticker
   */
  findStock(ticker: string): TokenizedStock | undefined {
    return TOKENIZED_STOCKS.find((s) => s.ticker === ticker.toUpperCase());
  }

  /**
   * Get stocks available on a specific DEX
   */
  getStocksByDex(dex: "uniswap" | "pancakeswap" | "both"): TokenizedStock[] {
    return TOKENIZED_STOCKS.filter((s) => s.dex === dex || s.dex === "both");
  }

  /**
   * Get stocks by category
   */
  getStocksByCategory(category: string): TokenizedStock[] {
    return TOKENIZED_STOCKS.filter((s) => s.category === category);
  }

  /**
   * Get the best token for a stock (preferring the one with highest TVL)
   */
  getBestToken(stock: TokenizedStock): TokenInfo {
    // Prefer bstocks (more liquid), then ondo, then others
    const order = ["bstocks", "ondo", "xstocks", "rex", "backed"];
    for (const issuer of order) {
      const token = stock.tokens.find((t) => t.issuer === issuer);
      if (token) return token;
    }
    return stock.tokens[0];
  }
}

// ── Helper Functions ──

/**
 * Look up a tokenized stock by its Hyperliquid perp ticker
 */
export function findByHLTicker(hlTicker: string): TokenizedStock | undefined {
  return TOKENIZED_STOCKS.find((s) => s.hyperliquidTicker === hlTicker);
}

/**
 * Look up a tokenized stock by its Lighter perp ticker
 */
export function findByLighterTicker(lighterTicker: string): TokenizedStock | undefined {
  return TOKENIZED_STOCKS.find((s) => s.lighterTicker === lighterTicker);
}

/**
 * Get all Hyperliquid perp tickers that have BSC spot equivalents
 */
export function getMatchedHLTickers(): string[] {
  return TOKENIZED_STOCKS.map((s) => s.hyperliquidTicker);
}

/**
 * Get all Lighter perp tickers that have BSC spot equivalents
 */
export function getMatchedLighterTickers(): string[] {
  return TOKENIZED_STOCKS
    .filter((s) => s.lighterTicker !== null)
    .map((s) => s.lighterTicker!);
}

/**
 * Get all available stock categories
 */
export function getStockCategories(): string[] {
  return [...new Set(TOKENIZED_STOCKS.map((s) => s.category))];
}

/**
 * Get stocks by multiple categories
 */
export function getStocksByCategories(categories: string[]): TokenizedStock[] {
  return TOKENIZED_STOCKS.filter((s) => categories.includes(s.category));
}
