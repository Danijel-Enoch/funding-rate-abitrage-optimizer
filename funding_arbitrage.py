#!/usr/bin/env python3
"""Funding Rate Arbitrage Scanner

Scans funding rates across multiple exchanges for a specific market
and identifies arbitrage opportunities.
"""

import ccxt
import sys
from datetime import datetime, timezone


EXCHANGES = {
    "binance": ccxt.binance,
    "bybit": ccxt.bybit,
    "okx": ccxt.okx,
    "bitget": ccxt.bitget,
    "gate": ccxt.gate,
}

# Minimum spread (as percentage) to consider it an arbitrage opportunity
# This accounts for trading fees (~0.04% per side = 0.08% round trip)
MIN_SPREAD_PCT = 0.1


def get_funding_rate(exchange_id: str, symbol: str) -> dict | None:
    """Fetch the current funding rate from an exchange."""
    try:
        exchange_class = EXCHANGES[exchange_id]
        exchange = exchange_class({"enableRateLimit": True})
        exchange.load_markets()

        if symbol not in exchange.markets:
            print(f"  [{exchange_id}] Symbol {symbol} not found, skipping.")
            return None

        ticker = exchange.fetch_funding_rate(symbol)
        rate = ticker.get("fundingRate", 0)
        next_time = ticker.get("fundingTimestamp")
        next_time_str = (
            datetime.fromtimestamp(next_time / 1000, tz=timezone.utc).strftime("%H:%M UTC")
            if next_time
            else "N/A"
        )

        return {
            "exchange": exchange_id,
            "symbol": symbol,
            "funding_rate": rate,
            "funding_rate_pct": round(rate * 100, 6),
            "next_funding": next_time_str,
        }
    except Exception as e:
        print(f"  [{exchange_id}] Error: {e}")
        return None


def find_arbitrage(symbol: str) -> None:
    """Scan all exchanges and find funding rate arbitrage opportunities."""
    print(f"\n{'='*60}")
    print(f"  Funding Rate Arbitrage Scanner")
    print(f"  Market: {symbol}")
    print(f"  Time: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"{'='*60}\n")

    results = []
    for exch_id in EXCHANGES:
        print(f"  Fetching from {exch_id}...")
        data = get_funding_rate(exch_id, symbol)
        if data:
            results.append(data)

    if len(results) < 2:
        print("\n  Not enough exchange data to compare. Exiting.")
        return

    # Display rates table
    print(f"\n{'Exchange':<12} {'Rate':>10} {'Rate %':>10} {'Next Funding':>14}")
    print(f"{'-'*12} {'-'*10} {'-'*10} {'-'*14}")
    for r in sorted(results, key=lambda x: x["funding_rate"]):
        print(
            f"{r['exchange']:<12} {r['funding_rate']:>10.6f} "
            f"{r['funding_rate_pct']:>9.4f}% {r['next_funding']:>14}"
        )

    # Find max spread
    rates = [r["funding_rate"] for r in results]
    min_rate = min(rates)
    max_rate = max(rates)
    spread = max_rate - min_rate
    spread_pct = spread * 100

    min_exchange = next(r for r in results if r["funding_rate"] == min_rate)["exchange"]
    max_exchange = next(r for r in results if r["funding_rate"] == max_rate)["exchange"]

    print(f"\n{'='*60}")
    print(f"  Spread: {spread_pct:.4f}% (min: {min_rate*100:.4f}% | max: {max_rate*100:.4f}%)")
    print(f"  Lowest rate:  {min_exchange}")
    print(f"  Highest rate: {max_exchange}")

    if spread_pct >= MIN_SPREAD_PCT:
        print(f"\n  >>> ARBITRAGE OPPORTUNITY FOUND <<<")
        print(f"  Strategy:")
        print(f"    1. GO LONG  on {min_exchange}  (pay {min_rate*100:.4f}%)")
        print(f"    2. GO SHORT on {max_exchange} (earn {max_rate*100:.4f}%)")
        print(f"    3. Net profit per funding period: ~{spread_pct:.4f}%")
        print(f"       (after ~0.08% round-trip fees)")
    else:
        print(f"\n  NOT ARBITRAGE")
        print(f"  Spread {spread_pct:.4f}% is below the {MIN_SPREAD_PCT}% threshold.")

    print(f"{'='*60}\n")


if __name__ == "__main__":
    market = sys.argv[1] if len(sys.argv) > 1 else "BTC/USDT:USDT"
    find_arbitrage(market)
