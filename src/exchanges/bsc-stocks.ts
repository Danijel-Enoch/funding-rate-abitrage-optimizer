/**
 * BSC Tokenized Stocks Adapter
 *
 * Fetches real stock prices as a proxy for BSC tokenized stocks
 * (bStocks, Ondo, xStocks). These track 1:1 with real stock prices.
 *
 * Used for the "spot leg" of the basis trade:
 *   Long tokenized stock on BSC (spot) + Short stock perp on Hyperliquid/Lighter
 *
 * Stock prices are fetched from Yahoo Finance (free, no auth).
 */

import type { SpotExchange, ExchangeInfo } from "./types";

export const bscStocksInfo: ExchangeInfo = {
  id: "bsc-stocks",
  name: "BSC Tokenized Stocks",
  type: "spot",
  url: "https://pancakeswap.finance/stocks",
};

// Tokenized stocks available on BSC (bStocks + Ondo)
// Contract addresses on BNB Chain (BEP-20)
export interface BscStockToken {
  ticker: string;          // Underlying stock ticker (e.g., TSLA)
  bscSymbol: string;       // On-chain symbol (e.g., TSLAB for bStocks, TSLAon for Ondo)
  contractAddress: string; // BEP-20 contract address
  issuer: "bstocks" | "ondo" | "xstocks";
  name: string;            // Human-readable name
  hyperliquidTicker: string; // Ticker on Hyperliquid perp
  lighterTicker: string | null; // Ticker on Lighter perp (null if not available)
}

export const BSC_STOCK_TOKENS: BscStockToken[] = [
  // === Mega Cap Tech ===
  {
    ticker: "TSLA", bscSymbol: "TSLAB",
    contractAddress: "0x5b1910eaad6450e50f816082aa078c41f10c292f",
    issuer: "bstocks", name: "Tesla",
    hyperliquidTicker: "TSLA", lighterTicker: "TSLA",
  },
  {
    ticker: "NVDA", bscSymbol: "NVDAB",
    contractAddress: "0xde1a951c1028902430dd0f85e25df853532fa523",
    issuer: "bstocks", name: "NVIDIA",
    hyperliquidTicker: "NVDA", lighterTicker: null,
  },
  {
    ticker: "AAPL", bscSymbol: "AAPL",
    contractAddress: "0x0cdE6936d305d5B34667fC46425E852efd73559a",
    issuer: "ondo", name: "Apple",
    hyperliquidTicker: "AAPL", lighterTicker: null,
  },
  {
    ticker: "MSFT", bscSymbol: "MSFTB",
    contractAddress: "0x277fdd3d6cdc8123b88ff78af805a1fef2ed02a0",
    issuer: "bstocks", name: "Microsoft",
    hyperliquidTicker: "MSFT", lighterTicker: "MSFT",
  },
  {
    ticker: "GOOGL", bscSymbol: "GOOGL",
    contractAddress: "0x0000000000000000000000000000000000000000", // placeholder - use Ondo
    issuer: "ondo", name: "Alphabet",
    hyperliquidTicker: "GOOGL", lighterTicker: "GOOGL",
  },
  {
    ticker: "AMZN", bscSymbol: "AMZN",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Amazon",
    hyperliquidTicker: "AMZN", lighterTicker: null,
  },
  {
    ticker: "META", bscSymbol: "METAB",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "bstocks", name: "Meta Platforms",
    hyperliquidTicker: "META", lighterTicker: null,
  },
  {
    ticker: "NFLX", bscSymbol: "NFLX",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Netflix",
    hyperliquidTicker: "NFLX", lighterTicker: null,
  },

  // === Semiconductors / AI ===
  {
    ticker: "AMD", bscSymbol: "AMDB",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "bstocks", name: "AMD",
    hyperliquidTicker: "AMD", lighterTicker: null,
  },
  {
    ticker: "MU", bscSymbol: "MUB",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "bstocks", name: "Micron Technology",
    hyperliquidTicker: "MU", lighterTicker: null,
  },
  {
    ticker: "INTC", bscSymbol: "INTCB",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "bstocks", name: "Intel",
    hyperliquidTicker: "INTC", lighterTicker: null,
  },
  {
    ticker: "ORCL", bscSymbol: "ORCL",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Oracle",
    hyperliquidTicker: "ORCL", lighterTicker: null,
  },
  {
    ticker: "AVGO", bscSymbol: "AVGO",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Broadcom",
    hyperliquidTicker: "AVGO", lighterTicker: null,
  },
  {
    ticker: "ARM", bscSymbol: "ARM",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "ARM Holdings",
    hyperliquidTicker: "ARM", lighterTicker: null,
  },
  {
    ticker: "TSM", bscSymbol: "TSM",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Taiwan Semiconductor",
    hyperliquidTicker: "TSM", lighterTicker: null,
  },
  {
    ticker: "CRWV", bscSymbol: "CRWV",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "CoreWeave",
    hyperliquidTicker: "CRWV", lighterTicker: null,
  },

  // === Crypto-Adjacent ===
  {
    ticker: "COIN", bscSymbol: "COIN",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Coinbase",
    hyperliquidTicker: "COIN", lighterTicker: null,
  },
  {
    ticker: "MSTR", bscSymbol: "MSTRB",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "bstocks", name: "MicroStrategy",
    hyperliquidTicker: "MSTR", lighterTicker: null,
  },
  {
    ticker: "HOOD", bscSymbol: "HOOD",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "Robinhood",
    hyperliquidTicker: "HOOD", lighterTicker: null,
  },
  {
    ticker: "PLTR", bscSymbol: "PLTRB",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "bstocks", name: "Palantir",
    hyperliquidTicker: "PLTR", lighterTicker: null,
  },

  // === Other ===
  {
    ticker: "SPCX", bscSymbol: "SPCX",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "SpaceX",
    hyperliquidTicker: "SPCX", lighterTicker: null,
  },
  {
    ticker: "SPY", bscSymbol: "SPY",
    contractAddress: "0x0000000000000000000000000000000000000000",
    issuer: "ondo", name: "S&P 500 ETF",
    hyperliquidTicker: "SP500", lighterTicker: "SPY",
  },
  {
    ticker: "QQQ", bscSymbol: "QQQB",
    contractAddress: "0x0cdE6936d305d5B34667fC46425E852efd73559a",
    issuer: "bstocks", name: "Nasdaq 100 ETF",
    hyperliquidTicker: "QQQ", lighterTicker: "QQQ",
  },
];

/**
 * Get stock ticker for a Hyperliquid perp ticker
 */
export function hlTickerToStockTicker(hlTicker: string): string | null {
  const match = BSC_STOCK_TOKENS.find(
    (t) => t.hyperliquidTicker === hlTicker
  );
  return match?.ticker ?? null;
}

/**
 * Get all Hyperliquid perp tickers that have BSC spot equivalents
 */
export function getMatchedHLTickers(): string[] {
  return BSC_STOCK_TOKENS.map((t) => t.hyperliquidTicker);
}

/**
 * Get all Lighter perp tickers that have BSC spot equivalents
 */
export function getMatchedLighterTickers(): string[] {
  return BSC_STOCK_TOKENS
    .filter((t) => t.lighterTicker !== null)
    .map((t) => t.lighterTicker!);
}

/**
 * Look up a stock by its Hyperliquid perp ticker
 */
export function findByHLTicker(hlTicker: string): BscStockToken | undefined {
  return BSC_STOCK_TOKENS.find((t) => t.hyperliquidTicker === hlTicker);
}

/**
 * Look up a stock by its underlying ticker (e.g., TSLA)
 */
export function findByTicker(ticker: string): BscStockToken | undefined {
  return BSC_STOCK_TOKENS.find(
    (t) => t.ticker === ticker.toUpperCase()
  );
}

/**
 * Fetch historical stock prices from Yahoo Finance.
 * These represent the spot price for the tokenized stock on BSC.
 */
export async function fetchStockPrices(
  ticker: string,
  startTime: number,
  endTime: number,
): Promise<Array<{ timestamp: number; price: number }>> {
  const period1 = Math.floor(startTime / 1000);
  const period2 = Math.floor(endTime / 1000);

  // Yahoo Finance chart API (no auth needed)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1h&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      // Fallback: try Yahoo v7 download endpoint
      return fetchStockPricesV7(ticker, startTime, endTime);
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
    return fetchStockPricesV7(ticker, startTime, endTime);
  }
}

/**
 * Fallback: Yahoo Finance v7 historical download
 */
async function fetchStockPricesV7(
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
    const lines = text.split("\n").slice(1); // skip header
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

/**
 * BSC Tokenized Stocks adapter implementing SpotExchange interface.
 * Uses real stock prices as proxy (bStocks track 1:1).
 */
export class BscStocksExchange implements SpotExchange {
  info = bscStocksInfo;

  async fetchPrices(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const ticker = symbol.replace("USDT", "").replace("USD", "").replace("on", "");
    return fetchStockPrices(ticker, startTime, endTime);
  }

  async getAvailableSymbols(): Promise<string[]> {
    return BSC_STOCK_TOKENS.map((t) => `${t.ticker}USDT`);
  }
}
