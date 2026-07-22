const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function scanCoin(coin: string) {
  return apiFetch(`/api/scan/${coin}`);
}

export function getMarkets() {
  return apiFetch("/api/markets");
}

export function searchMarkets(q: string) {
  return apiFetch(`/api/markets/search?q=${encodeURIComponent(q)}`);
}

export function getExchanges() {
  return apiFetch("/api/exchanges");
}

export function getFees() {
  return apiFetch("/api/exchanges/fees");
}

export function runBacktest(body: {
  coin: string;
  days?: number;
  capital?: number;
  strategy?: string;
  venueA?: string;
  venueB?: string;
}) {
  return apiFetch("/api/backtest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function runOptimize(body: { coin: string; days?: number; capital?: number }) {
  return apiFetch("/api/optimize", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getFundingDuration(days?: number, coins?: string) {
  const params = new URLSearchParams();
  if (days) params.set("days", String(days));
  if (coins) params.set("coins", coins);
  return apiFetch(`/api/funding-duration?${params}`);
}

export function getCorrelation(days?: number, coins?: string) {
  const params = new URLSearchParams();
  if (days) params.set("days", String(days));
  if (coins) params.set("coins", coins);
  return apiFetch(`/api/correlation?${params}`);
}
