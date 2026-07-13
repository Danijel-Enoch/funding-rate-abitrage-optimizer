# Basis Trading Backtester

Multi-exchange basis trading backtester supporting **Spot vs Perp** and **Perp vs Perp** strategies across Hyperliquid, Lighter, Aster, Extended, and Binance.

## Strategies

### Spot vs Perp
- Long spot + Short perp (collect funding when perp premium)
- Short spot + Long perp (collect funding when perp discount)
- Venues: Binance Spot vs any perp exchange

### Perp vs Perp
- Long perp on Exchange A + Short perp on Exchange B
- Profit from funding rate differential between venues
- Example: Long on Hyperliquid + Short on Lighter

## Supported Exchanges

| Exchange | Type | Markets |
|----------|------|---------|
| Hyperliquid | Perp | 230+ |
| Lighter | Perp | 40+ (crypto + RWA) |
| Aster | Perp | 50+ |
| Extended | Perp | 100+ |
| Binance | Spot | 690+ |

## Setup

```bash
bun install
```

## Usage

### TUI Mode (Interactive)
```bash
bun run tui
# or
bun run src/tui.ts
```

The TUI will guide you through:
1. Select strategy (Spot vs Perp / Perp vs Perp)
2. Select Venue A (spot or perp exchange)
3. Select Venue B (perp exchange)
4. Select coin/market
5. Set parameters (days, capital, threshold, max spread)

### CLI Mode

```bash
# Single market
bun run src/index.ts ETH 30 50000

# All markets
bun run src/index.ts --all 30 50000

# By category
bun run src/index.ts --category L1 30 50000
bun run src/index.ts --category DeFi 30 50000
bun run src/index.ts --category Meme 30 50000
bun run src/index.ts --category AI 30 50000

# List all markets
bun run src/index.ts --list
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--days` | 30 | Backtest period in days |
| `--capital` | 50000 | Initial capital in USD |
| `--threshold` | 0.00001 | Min funding rate to enter (0.001%) |
| `--maxSpread` | 100 | Max spread in bps (1%) |

## Files

```
src/
├── tui.ts                  # Interactive TUI
├── index.ts                # CLI entry point
├── backtest.ts             # Backtesting engine
├── markets.ts              # Market definitions (201 markets)
├── hyperliquid.ts          # Legacy HL client
├── uniswap.ts              # Legacy spot client
└── exchanges/
    ├── types.ts            # Unified exchange interface
    ├── index.ts            # Exchange registry
    ├── hyperliquid.ts      # Hyperliquid adapter
    ├── lighter.ts          # Lighter adapter
    ├── aster.ts            # Aster adapter
    ├── extended.ts         # Extended adapter
    └── binance.ts          # Binance spot adapter
```

## Example Output

```
==============================================================================
  DELTA-NEUTRAL BASIS TRADING BACKTEST
  Hyperliquid vs Binance Spot
==============================================================================

  Coin    Name                     Trades  Win%      PnL  Return   Ann.%    MDD Sharpe
------------------------------------------------------------------------------
  TRUMP   Official Trump              29   69%$     724   1.45%   19.1%   0.1%   18.1
  ZRO     LayerZero                   13   92%$     506   1.01%   13.0%   0.0%   31.2
  GAS     NeoGas                      28   79%$     372   0.74%    9.4%   0.1%   19.1
  ETHFI   ether.fi                     4  100%$     354   0.71%    9.0%   0.0%   57.9
  ADA     Cardano                     54   83%$     294   0.59%    7.4%   0.0%   22.2
  ...
```
