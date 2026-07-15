# Basis Trading Backtester

Multi-exchange basis trading backtester and arbitrage scanner. Scans funding rate differentials across 11 perp exchanges and 7 spot venues to find profitable basis trades — including tokenized stocks on BSC via Uniswap/PancakeSwap with HIP-3 perps on Hyperliquid.

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

### Basket Optimization (Multi-Coin)

Finds the best venue pair for a basket of crypto tokens.

```bash
bun run basket BTC ETH SOL                  # Specific coins
bun run basket --category L1                # All L1 coins
bun run basket --category DeFi              # All DeFi coins
bun run basket BTC ETH --min-profit 0.5     # Filter by min profit
bun run basket --strategy spot_vs_perp      # Spot vs perp only
```

### Stock Basket Optimization

Finds the best venue pair for tokenized stocks. Long stock on Uniswap/PancakeSwap (BSC) + Short stock perp on Hyperliquid HIP-3 or Lighter.

```bash
bun run stocks TSLA NVDA AAPL               # Specific stocks
bun run stocks --all                        # All available stocks
bun run stocks --category mega              # Mega cap tech
bun run stocks --category semi              # Semiconductors
bun run stocks --category crypto            # Crypto-adjacent (COIN, MSTR, HOOD, PLTR)
bun run stocks --category etf               # ETFs (SPY, QQQ)
bun run stocks --category space             # Space (SPCX)
bun run stocks --spot uniswap               # Uniswap BSC only
bun run stocks --spot pancakeswap           # PancakeSwap BSC only
bun run stocks --spot all                   # All spot venues (default)
bun run stocks --discover                   # Discover pools on Uniswap BSC
bun run stocks --days 30 --capital 100000   # Custom period and capital
bun run stocks TSLA --hl-map TSLA:TSLAUSD   # Manual HL ticker override
```

**How it works:**
1. Discovers tokenized stocks on BSC (bStocks, Ondo) via Uniswap V3 / PancakeSwap
2. Fetches funding rates from Hyperliquid HIP-3 stock perps (`xyz:TSLA`, `xyz:NVDA`, etc.) and Lighter
3. Tests every combination: `{Uniswap|PancakeSwap|BSC Stocks} × {Hyperliquid|Lighter} × {exit-on-neg|hold}`
4. Ranks by total PnL, outputs action plan with winners/losers

**Supported stocks:** TSLA, NVDA, AAPL, MSFT, GOOGL, AMZN, META, NFLX, AMD, MU, INTC, AVGO, ARM, TSM, CRWV, ORCL, COIN, MSTR, HOOD, PLTR, SPCX, SPY, QQQ

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

| Exchange | Type | Fee (Taker) | Notes |
|----------|------|-------------|-------|
| Hyperliquid | CLOB | 3.5 bps | Main dex (crypto) + HIP-3 dexes (stocks, indices) |
| Lighter | AMM | 2 bps | Stock perps available |
| Aster | CLOB | 4 bps | |
| Extended | CLOB | 4 bps | |
| Paradex | CLOB | 5.5 bps | |
| Nado | CLOB | 5 bps | |
| GMX | AMM | 5 bps | |
| Binance Perp | CLOB | 4 bps | |
| Bybit Perp | CLOB | 5.5 bps | |
| OKX Perp | CLOB | 5 bps | |
| MEXC Perp | CLOB | 4 bps | |

### Spot Exchanges (7)

| Exchange | Type | Fee (Taker) | Notes |
|----------|------|-------------|-------|
| Uniswap (DEX) | AMM | ~30 bps | Crypto via CoinGecko/DeFi Llama |
| Uniswap BSC Stocks | AMM | ~5 bps | Tokenized stocks (bStocks, Ondo) |
| PancakeSwap BSC | AMM | ~2.5 bps | Tokenized stocks (bStocks, Ondo) |
| Binance Spot | CLOB | 10 bps | |
| Bybit Spot | CLOB | 10 bps | |
| OKX Spot | CLOB | 10 bps | |
| MEXC Spot | CLOB | 10 bps | |

## Strategies

### Spot vs Perp
- Long spot + Short perp (collect funding when perp premium)
- Short spot + Long perp (collect funding when perp discount)
- 2x leverage on perp leg

### Perp vs Perp
- Long perp on Exchange A + Short perp on Exchange B
- Profit from funding rate differential between venues
- 3x leverage on both legs

### Tokenized Stock Basis (Stock Basket)
- Long tokenized stock on BSC DEX (Uniswap/PancakeSwap) + Short stock perp on Hyperliquid HIP-3 or Lighter
- Real stock prices (Yahoo Finance) as proxy for BSC tokenized stocks (1:1 tracking)
- HIP-3 assets: `xyz:TSLA`, `xyz:NVDA`, `xyz:SPCX`, etc.

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

### Stock Basket Output

| Section | Description |
|---------|-------------|
| Top Venue Pairs | All combos ranked by total PnL |
| Best Venue | Winner with full stats |
| Per-Stock Breakdown | Individual stock PnL, Sharpe, fees, funding |
| Spot Venue Comparison | Uniswap vs PancakeSwap vs BSC Stocks |
| Hyperliquid vs Lighter | Perp venue comparison |
| Action Plan | Trade list + skip list + where to buy |

## Markets

### Crypto (180+)

- **L1**: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, DOT, LINK, MATIC, ATOM, LTC, NEAR, APT, SUI, TON, HBAR, etc.
- **L2**: ARB, OP, MATIC, STRK, zkSync, Mantle, Immutable, etc.
- **DeFi**: AAVE, UNI, MKR, LDO, CRV, DYDX, PENDLE, ENA, JUP, Raydium, etc.
- **AI**: FET, RENDER, TAO, NEAR, AKT, WLD, GRT, Ocean, etc.
- **Meme**: DOGE, SHIB, PEPE, WIF, BONK, Floki, Brett, etc.
- **Infra**: LINK, The Graph, Chainlink, MultiversX, etc.
- **RWA**: Ondo, Mantra, Polymesh, etc.
- **GameFi**: Immutable, Gala, Beam, etc.

### Tokenized Stocks (23)

| Ticker | Name | Category | Hyperliquid | Lighter | BSC Tokens |
|--------|------|----------|-------------|---------|------------|
| TSLA | Tesla | Mega Cap | `xyz:TSLA` | TSLA | TSLAB, TSLAon |
| NVDA | NVIDIA | Mega Cap | `xyz:NVDA` | - | NVDAB, NVDAon |
| AAPL | Apple | Mega Cap | `xyz:AAPL` | - | AAPLon |
| MSFT | Microsoft | Mega Cap | `xyz:MSFT` | MSFT | MSFTB, MSFTon |
| GOOGL | Alphabet | Mega Cap | `xyz:GOOGL` | GOOGL | GOOGLon |
| AMZN | Amazon | Mega Cap | `xyz:AMZN` | - | AMZNon |
| META | Meta | Mega Cap | `xyz:META` | - | METAB |
| NFLX | Netflix | Mega Cap | `xyz:NFLX` | - | NFLXon |
| AMD | AMD | Semi | `xyz:AMD` | - | AMDB |
| MU | Micron | Semi | `xyz:MU` | - | MUB |
| INTC | Intel | Semi | `xyz:INTC` | - | INTCB |
| AVGO | Broadcom | Semi | `xyz:AVGO` | - | AVGOon |
| ARM | ARM | Semi | `xyz:ARM` | - | ARMon |
| TSM | TSMC | Semi | `xyz:TSM` | - | TSMon |
| CRWV | CoreWeave | Semi | `xyz:CRWV` | - | CRWVon |
| ORCL | Oracle | Semi | `xyz:ORCL` | - | ORCLon |
| COIN | Coinbase | Crypto | `xyz:COIN` | - | COINon |
| MSTR | MicroStrategy | Crypto | `xyz:MSTR` | - | MSTRB |
| HOOD | Robinhood | Crypto | `xyz:HOOD` | - | HOODon |
| PLTR | Palantir | Crypto | `xyz:PLTR` | - | PLTRB |
| SPCX | SpaceX | Space | `xyz:SPCX` | - | SPCXon |
| SPY | S&P 500 | ETF | `xyz:SP500` | SPY | SPYon |
| QQQ | Nasdaq 100 | ETF | `xyz:QQQ` | QQQ | QQQB |

## File Structure

```
src/
├── index.ts                # CLI entry point (backtest, optimize, list)
├── backtest.ts             # Backtesting engine
├── optimize.ts             # Venue optimization + crossover analysis
├── optimize-basket.ts      # Multi-coin basket venue pair optimizer
├── optimize-stocks.ts      # Stock basket venue pair optimizer
├── optimize-markets.ts     # 24h market scanner
├── scanner.ts              # Live funding rate scanner
├── markets.ts              # Market definitions (~180+ crypto + 50 traditional)
├── correlation.ts          # Funding duration vs profitability analysis
├── funding-duration.ts     # Funding rate streak analysis
├── analyze-funding.ts      # Funding rate duration stats
├── tui.ts                  # Interactive TUI
├── test-flip.ts            # Test flip logic
├── hyperliquid.ts          # Legacy HL client
├── uniswap.ts              # Legacy spot client
└── exchanges/
    ├── types.ts            # Unified exchange interfaces
    ├── index.ts            # Exchange registry (11 perp + 7 spot)
    ├── hyperliquid.ts      # Hyperliquid adapter (main + HIP-3 dexes)
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
    ├── binance.ts          # Binance spot adapter
    ├── uniswap.ts          # Uniswap/DEX spot adapter (crypto)
    ├── uniswap-stocks.ts   # Uniswap BSC tokenized stocks adapter
    ├── bsc-stocks.ts       # BSC tokenized stocks registry
    ├── bybit-spot.ts       # Bybit spot adapter
    ├── okx-spot.ts         # OKX spot adapter
    └── mexc-spot.ts        # MEXC spot adapter
```
