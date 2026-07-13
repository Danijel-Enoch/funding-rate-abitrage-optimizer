/**
 * Spot Price Client
 * Uses Binance API for historical klines (free, no auth required)
 * Docs: https://binance-docs.github.io/apidocs/spot/en/
 */

export interface SpotPrice {
  timestamp: number;
  price: number;
}

/**
 * Fetch historical hourly prices from Binance
 * Max 1000 candles per request, paginate for longer ranges
 */
export async function getHistoricalPrices(
  symbol: string,
  days: number = 30
): Promise<SpotPrice[]> {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  const allPrices: SpotPrice[] = [];
  let currentStart = startTime;

  while (currentStart < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${currentStart}&endTime=${endTime}&limit=1000`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}: ${await response.text()}`);
    }

    const data: any[][] = await response.json();
    if (data.length === 0) break;

    // Each kline: [openTime, open, high, low, close, volume, closeTime, ...]
    for (const kline of data) {
      allPrices.push({
        timestamp: kline[0], // openTime in milliseconds
        price: parseFloat(kline[1]), // open price
      });
    }

    // Move to next batch
    currentStart = data[data.length - 1][0] + 1;

    // Small delay to respect rate limits
    await Bun.sleep(100);
  }

  return allPrices;
}

/**
 * Fetch current spot price
 */
export async function getCurrentPrice(symbol: string): Promise<number> {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }
  const data = await response.json();
  return parseFloat(data.price);
}
