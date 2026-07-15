# Basis Trading Backtester

Multi-exchange basis trading backtester and arbitrage scanner. Scans funding rate differentials across 11 perp exchanges and 5 spot venues to find profitable basis trades.

## Setup

```bash
bun install
```

## Commands

### Live Scanner

Scans all exchanges in real-time for current funding rates and arbitrage opportunities.

```bash
bun run scan                          # Scan all coins
bun run scan BTC                      # Scan single coin
bun run scan BTC ETH SOL              # Scan multiple coins
bun run scan --size 100000            # Custom account size
bun run scan --leverage 3             # Custom leverage
```

### Backtest (Single Coin)

Backtests a single coin across all venue pairs over a given time period.

```bash
bun run backtest ETH                  # ETH, 30 days, $50k
bun run backtest SOL 7 100000         # SOL, 7 days, $100k
bun run backtest BTC 90 50000         # BTC, 90 days
```

### Backtest (All / Category)

Runs backtests across multiple coins, ranked by return.

```bash
bun run backtest --all 30 50000       # All coins
bun run backtest --category L1 30     # L1 category only
bun run backtest --category DeFi      # DeFi category only
bun run backtest --category Meme      # Meme coins only
bun run backtest --category AI        # AI category only
```

### Optimize (Single Coin)

Runs all venue pairs for a single coin and ranks them.

```bash
bun run optimize ETH                  # Optimize ETH
bun run optimize SOL 7 100000         # SOL, 7 days, $100k
```

### Optimize Markets (24h Scanner)

Scans all markets for the best arbitrage opportunities in the **last 24 hours**. Filters for net profit after fees.

```bash
bun run optimize-markets                              # All coins, >0.1% profit
bun run optimize-markets --min-profit 0.05            # >0.05% profit threshold
bun run optimize-markets --min-profit 1               # >1% profit threshold
bun run optimize-markets --capital 100000             # Custom capital
bun run optimize-markets --category L1                # L1 coins only
bun run optimize-markets --category DeFi              # DeFi coins only
bun run optimize-markets ETH SOL BTC                  # Specific coins
bun run optimize-markets --category L1 --min-profit 0.2  # Combined filters
```

### Correlation Analysis

Analyzes correlation between funding rate duration patterns and backtest profitability.

```bash
bun run correlation                  # Default 30 days
bun run correlation 90               # 90-day analysis
```

### Other Analysis Scripts

```bash
bun run src/funding-duration.ts      # Funding rate streak analysis (30 + 180 days)
bun run src/funding-duration.ts 90   # Custom period
bun run src/analyze-funding.ts       # Funding rate duration stats
bun run src/analyze-funding.ts 90    # Custom period (default 90 days)
```

### List Markets

```bash
bun run list                         # List all available markets
bun run markets                      # Same as list
```

### Interactive TUI

```bash
bun run tui                          # Interactive terminal UI
```

## Supported Exchanges

### Perp Exchanges (11)

| Exchange | Type | Fee (Taker) |
|----------|------|-------------|
| Hyperliquid | CLOB | 3.5 bps |
| Lighter | AMM | 2 bps |
| Aster | CLOB | 4 bps |
| Extended | CLOB | 4 bps |
| Paradex | CLOB | 5.5 bps |
| Nado | CLOB | 5 bps |
| GMX | AMM | 5 bps |
| Binance Perp | CLOB | 4 bps |
| Bybit Perp | CLOB | 5.5 bps |
| OKX Perp | CLOB | 5 bps |
| MEXC Perp | CLOB | 4 bps |

### Spot Exchanges (5)

| Exchange | Type | Fee (Taker) |
|----------|------|-------------|
| Uniswap (DEX) | AMM | ~30 bps |
| Binance Spot | CLOB | 10 bps |
| Bybit Spot | CLOB | 10 bps |
| OKX Spot | CLOB | 10 bps |
| MEXC Spot | CLOB | 10 bps |

## Strategies

### Spot vs Perp
- Long spot + Short perp (collect funding when perp premium)
- Short spot + Long perp (collect funding when perp discount)
- 2x leverage on perp leg

### Perp vs Perp
- Long perp on Exchange A + Short perp on Exchange B
- Profit from funding rate differential between venues
- 3x leverage on both legs

## Output Columns

### Ranking Table (backtest / optimize)

| Column | Description |
|--------|-------------|
| Coin | Ticker symbol |
| Trades | Number of open/close cycles |
| Win% | % of trades that were profitable |
| PnL | Net profit in USD |
| Return | % return on capital |
| Ann.% | Annualized return |
| MDD | Max drawdown % |
| Sharpe | Sharpe ratio |

### Optimization Table (optimize-markets)

| Column | Description |
|--------|-------------|
| Coin | Ticker symbol |
| Strategy | Spot/Perp or Perp/Perp |
| Venue Pair | The two venues being compared |
| Net PnL | Profit after all fees |
| Profit% | Net profit as % of capital |
| APY% | Annualized return |
| Fees | Total fees paid |
| Trades | Number of trades |
| Win% | Win rate |
| Liq | Liquidation events (if any) |

## Markets

80+ coins across categories:
- **L1**: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, DOT, LINK, MATIC, ATOM, LTC, NEAR, APT, SUI, TON, HBAR, etc.
- **L2**: ARB, OP, MATIC, STRK, zkSync, Mantle, Immutable, etc.
- **DeFi**: AAVE, UNI, MKR, LDO, CRV, DYDX, PENDLE, ENA, JUP, Raydium, etc.
- **AI**: FET, RENDER, TAO, NEAR, AKT, WLD, GRT, Ocean, etc.
- **Meme**: DOGE, SHIB, PEPE, WIF, BONK, Floki, Brett, etc.
- **Infra**: LINK, The Graph, Chainlink, MultiversX, etc.
- **RWA**: Ondo, Mantra, Polymesh, etc.
- **GameFi**: Immutable, Gala, Beam, etc.

## File Structure

```
src/
├── index.ts                # CLI entry point (backtest, optimize, list)
├── backtest.ts             # Backtesting engine
├── optimize.ts             # Venue optimization + crossover analysis
├── optimize-markets.ts     # 24h market scanner
├── scanner.ts              # Live funding rate scanner
├── markets.ts              # Market definitions (~80+ coins)
├── correlation.ts          # Funding duration vs profitability analysis
├── funding-duration.ts     # Funding rate streak analysis
├── analyze-funding.ts      # Funding rate duration stats
├── tui.ts                  # Interactive TUI
├── test-flip.ts            # Test flip logic
├── hyperliquid.ts          # Legacy HL client
├── uniswap.ts              # Legacy spot client
└── exchanges/
    ├── types.ts            # Unified exchange interfaces
    ├── index.ts            # Exchange registry
    ├── hyperliquid.ts      # Hyperliquid adapter
    ├── lighter.ts          # Lighter adapter
    ├── aster.ts            # Aster adapter
    ├── extended.ts         # Extended adapter
    ├── paradex.ts          # Paradex adapter
    ├── nado.ts             # Nado adapter
    ├── gmx.ts              # GMX adapter
    ├── binance-perp.ts     # Binance perp adapter
    ├── bybit.ts            # Bybit perp adapter
    ├── okx.ts              # OKX perp adapter
    ├── mexc.ts             # MEXC perp adapter
    ├── binance.ts          # Binance spot adapter (legacy)
    ├── uniswap.ts          # Uniswap/DEX spot adapter
    ├── bybit-spot.ts       # Bybit spot adapter
    ├── okx-spot.ts         # OKX spot adapter
    └── mexc-spot.ts        # MEXC spot adapter
```
