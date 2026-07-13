/**
 * Hyperliquid Funding Rate API Client
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 */

const HL_API_URL = "https://api.hyperliquid.xyz/info";

export interface FundingRate {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

export interface AssetContext {
  dayNtlVlm: string;
  funding: string;
  impactPxs: string[];
  markPx: string;
  midPx: string;
  openInterest: string;
  oraclePx: string;
  premium: string;
  prevDayPx: string;
}

/**
 * Fetch historical funding rates for a coin
 * Returns max 500 entries per call - paginate for larger ranges
 */
export async function fetchFundingRates(
  coin: string,
  startTime: number,
  endTime?: number
): Promise<FundingRate[]> {
  const body: Record<string, unknown> = {
    type: "fundingHistory",
    coin,
    startTime,
  };

  if (endTime) {
    body.endTime = endTime;
  }

  const response = await fetch(HL_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid API error: ${response.status}`);
  }

  return response.json() as Promise<FundingRate[]>;
}

/**
 * Fetch all funding rates in a time range with pagination
 */
export async function fetchAllFundingRates(
  coin: string,
  startTime: number,
  endTime: number
): Promise<FundingRate[]> {
  const allRates: FundingRate[] = [];
  let currentStart = startTime;

  while (currentStart < endTime) {
    const rates = await fetchFundingRates(coin, currentStart, endTime);
    if (rates.length === 0) break;

    allRates.push(...rates);

    // Move past the last timestamp
    currentStart = rates[rates.length - 1].time + 1;

    // Respect rate limits
    await Bun.sleep(100);
  }

  return allRates;
}

/**
 * Fetch current mark and oracle prices for all assets
 */
export async function fetchAssetContexts(): Promise<Map<string, AssetContext>> {
  const response = await fetch(HL_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid API error: ${response.status}`);
  }

  const [meta, contexts] = await response.json() as [any, AssetContext[]];
  const assetMap = new Map<string, AssetContext>();

  for (let i = 0; i < meta.universe.length; i++) {
    assetMap.set(meta.universe[i].name, contexts[i]);
  }

  return assetMap;
}
