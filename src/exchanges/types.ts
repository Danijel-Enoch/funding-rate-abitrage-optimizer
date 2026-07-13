/**
 * Unified exchange interface for all perp DEX funding rate adapters
 */

export interface FundingRateEntry {
  timestamp: number;   // ms
  fundingRate: number; // decimal, e.g. 0.0001 = 0.01%
  coin: string;
}

export interface ExchangeInfo {
  id: string;
  name: string;
  type: "perp" | "spot";
  url: string;
}

export interface PerpExchange {
  info: ExchangeInfo;
  fetchFundingRates(coin: string, startTime: number, endTime: number): Promise<FundingRateEntry[]>;
  getAvailableCoins(): Promise<string[]>;
}

export interface SpotExchange {
  info: ExchangeInfo;
  fetchPrices(symbol: string, startTime: number, endTime: number): Promise<Array<{ timestamp: number; price: number }>>;
  getAvailableSymbols(): Promise<string[]>;
}
