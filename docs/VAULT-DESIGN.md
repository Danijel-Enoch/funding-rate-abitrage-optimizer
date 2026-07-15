# Basis Trading Vault Design Guide

## Table of Contents
1. [Vault Architecture](#1-vault-architecture)
2. [Vault Types](#2-vault-types)
3. [Strategy Selection](#3-strategy-selection)
4. [Negative Funding Rate Protection](#4-negative-funding-rate-protection)
5. [Fee Management](#5-fee-management)
6. [Risk Framework](#6-risk-framework)
7. [Implementation Roadmap](#7-implementation-roadmap)

---

## 1. Vault Architecture

### Core Concept
A basis trading vault captures the **funding rate spread** between two correlated assets. The strategy is delta-neutral: you go long on one venue and short on another, so price movements cancel out — you only profit from the funding rate differential.

```
┌─────────────────────────────────────────────────────┐
│                   VAULT FUND                        │
│                  (User Deposits)                     │
└─────────────────┬───────────────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌─────────┐              ┌─────────┐
│  LEG A  │              │  LEG B  │
│  (Long) │              │ (Short) │
│ 50% cap │              │ 50% cap │
└─────────┘              └─────────┘
    │                           │
    ▼                           ▼
 Exchange A              Exchange B
 (e.g., Binance)        (e.g., Hyperliquid)
```

### Vault Lifecycle
```
1. Deposit  →  2. Deploy Capital  →  3. Collect Funding  →  4. Rebalance/Exit
     ↑                                                           │
     └───────────────────── 5. Withdraw ←────────────────────────┘
```

### Key Components
| Component | Description |
|-----------|-------------|
| **Manager** | Decides when to enter/exit, which venues, position sizes |
| **Executor** | Places orders on exchanges via API |
| **Risk Engine** | Monitors drawdown, funding rates, liquidation risk |
| **Fee Reserve** | Holds buffer for trading fees and gas costs |
| **Accounting** | Tracks PnL, fees, funding, and user shares |

---

## 2. Vault Types

### Vault 1: Stable Vault (Stocks & ETFs)

**Assets:** AAPL, GOOGL, AMZN, META, MSFT, NVDA, TSLA, AMD, AVGO, SPY, QQQ

**Characteristics:**
- Lower volatility → smaller funding rate swings
- Lower liquidation risk
- More predictable funding patterns
- Stock market hours = limited funding collection windows

**Recommended Exchanges:**
- **Long (Spot):** Binance (xStocks or tokenized stocks)
- **Short (Perp):** Paradex, Nado (both support stock perps)

**Strategy Config:**
```typescript
const stableVaultConfig = {
  strategy: "spot_vs_perp",
  perpLeverage: 2,        // Conservative leverage
  fundingThreshold: 0.000005,  // Lower threshold (stocks have smaller rates)
  maxSpreadBps: 50,
  maxPositionSize: capital * 0.3,  // 30% per position
  exitOnNegativeFunding: false,    // Hold through short negative periods
  rebalanceThreshold: 0.0001,      // Rebalance when rate drifts 0.01%
  feeReservePct: 0.05,             // 5% reserve for fees
  maxDrawdownPct: 0.03,            // 3% max drawdown before de-risk
};
```

**Expected Performance:**
- APY: 5-15% (conservative)
- Max Drawdown: 1-3%
- Win Rate: 55-65%
- Funding Rate Range: 0.001% - 0.01% per hour

---

### Vault 2: Yellow Vault (BTC, ETH, SOL, AAVE)

**Assets:** BTC, ETH, SOL, AAVE

**Characteristics:**
- Higher volatility → larger funding rate swings
- Most liquid markets across exchanges
- Best funding rate differentials
- 24/7 markets = continuous funding collection

**Recommended Exchanges:**
- **Leg A:** Hyperliquid (best liquidity, low fees)
- **Leg B:** Lighter, Extended, or GMX (different fee structure)
- **Spot Leg:** Binance

**Strategy Config:**
```typescript
const yellowVaultConfig = {
  strategy: "perp_vs_perp",  // or spot_vs_perp
  perpLeverageA: 3,
  perpLeverageB: 3,
  fundingThreshold: 0.00001,
  maxSpreadBps: 100,
  maxPositionSize: capital * 0.4,
  exitOnNegativeFunding: false,
  rebalanceThreshold: 0.0002,
  feeReservePct: 0.05,
  maxDrawdownPct: 0.05,      // 5% max drawdown
  // Multi-coin allocation
  allocation: {
    BTC: 0.35,  // 35% of vault
    ETH: 0.35,  // 35% of vault
    SOL: 0.20,  // 20% of vault
    AAVE: 0.10, // 10% of vault
  },
};
```

**Expected Performance:**
- APY: 15-40%
- Max Drawdown: 3-8%
- Win Rate: 50-60%
- Funding Rate Range: 0.005% - 0.05% per hour

---

### Vault 3: Meme Vault (TRUMP, PEPE, SHIBA)

**Assets:** TRUMP, PEPE, SHIBA (+ other meme coins as available)

**Characteristics:**
- Extremely high volatility → massive funding rate spikes
- Lower liquidity → higher spreads
- Unpredictable funding patterns
- Potential for 100%+ APY during hype cycles
- Higher risk of exchange issues

**Recommended Exchanges:**
- **Perp A:** Hyperliquid (most meme pairs)
- **Perp B:** GMX, Nado (different liquidity pools)
- **Spot:** Binance (for meme pairs)

**Strategy Config:**
```typescript
const memeVaultConfig = {
  strategy: "perp_vs_perp",
  perpLeverageA: 2,        // Lower leverage due to volatility
  perpLeverageB: 2,
  fundingThreshold: 0.0001,   // Higher threshold (bigger rates)
  maxSpreadBps: 200,
  maxPositionSize: capital * 0.2,  // Smaller positions
  exitOnNegativeFunding: true,     // Exit quickly on negative
  rebalanceThreshold: 0.0005,
  feeReservePct: 0.10,             // 10% reserve (higher fees)
  maxDrawdownPct: 0.10,            // 10% max drawdown
  allocation: {
    TRUMP: 0.40,
    PEPE: 0.35,
    SHIBA: 0.25,
  },
};
```

**Expected Performance:**
- APY: 30-150%+ (highly variable)
- Max Drawdown: 8-20%
- Win Rate: 40-55%
- Funding Rate Range: 0.01% - 0.2% per hour

---

## 3. Strategy Selection

### When to Use Each Strategy

| Condition | Spot vs Perp | Perp vs Perp |
|-----------|--------------|--------------|
| **Liquid spot market** | ✅ Best | ⚠️ OK |
| **Spot illiquid/expensive** | ❌ Avoid | ✅ Best |
| **Cross-exchange arb** | ❌ Avoid | ✅ Best |
| **Stock/ETF trading** | ✅ Best | ⚠️ Limited |
| **Meme coins** | ⚠️ Limited pairs | ✅ Best |
| **Fee-sensitive** | ✅ Lower fees | ⚠️ Double fees |

### Venue Pair Selection Rules

**Rule 1: Never use the same exchange for both legs**
```typescript
// ❌ BAD: Same exchange
venueA: "hyperliquid", venueB: "hyperliquid"

// ✅ GOOD: Different exchanges
venueA: "hyperliquid", venueB: "lighter"
```

**Rule 2: Prefer exchanges with opposite fee structures**
```typescript
// High taker + Low maker vs Low taker + High maker
// Example: Hyperliquid (3.5/1.0) vs Lighter (2.0/0.0)
```

**Rule 3: Check liquidity before choosing**
```typescript
// Only use venues where the asset has sufficient volume
// to avoid slippage on entry/exit
```

---

## 4. Negative Funding Rate Protection

This is the **#1 risk** to basis trading vaults. Here's how to protect against it:

### The Problem
```
Day 1:  ETH funding = +0.01%/hr  → You collect $50
Day 2:  ETH funding = +0.008%/hr → You collect $40
Day 3:  ETH funding = -0.02%/hr  → You PAY $100
Day 4:  ETH funding = -0.01%/hr  → You PAY $50
Day 5:  ETH funding = +0.005%/hr → You collect $25

Total collected: $115
Total paid: $150
Net: -$35 + fees = -$85
```

### Solution 1: Dynamic Exit Thresholds

Don't just exit when funding hits 0 — exit when it **crosses a dynamic threshold**:

```typescript
function shouldExitOnNegative(
  currentRate: number,
  avgRate: number,
  holdingPeriod: number,
  cumulativePnl: number,
  config: VaultConfig
): boolean {
  // Rule 1: Exit if funding is negative for 3+ consecutive hours
  if (consecutiveNegativeHours >= 3) return true;

  // Rule 2: Exit if cumulative negative funding exceeds 2x average positive
  if (cumulativeNegativeFunding > avgPositiveFunding * 2) return true;

  // Rule 3: Exit if holding period exceeds maximum
  if (holdingPeriod > maxHoldingPeriod) return true;

  // Rule 4: Exit if PnL drops below -1% of position size
  if (cumulativePnl / positionSize < -0.01) return true;

  // Rule 5: Exit if funding rate is declining rapidly
  if (rateDeclining3Hours && currentRate < 0) return true;

  return false;
}
```

### Solution 2: Funding Rate Momentum Filter

Only enter when funding rate is **accelerating upward**, not just positive:

```typescript
function shouldEnter(rates: number[], config: VaultConfig): boolean {
  const recentRates = rates.slice(-6); // Last 6 hours

  // Check 1: Current rate is positive
  if (recentRates[recentRates.length - 1] <= 0) return false;

  // Check 2: Rate is above moving average (momentum)
  const ma6 = average(recentRates);
  if (recentRates[recentRates.length - 1] < ma6 * 0.8) return false;

  // Check 3: No sharp decline in last 3 hours
  const last3 = recentRates.slice(-3);
  const decline = (last3[0] - last3[2]) / last3[0];
  if (decline > 0.3) return false; // More than 30% decline

  // Check 4: Rate is above minimum threshold
  if (recentRates[recentRates.length - 1] < config.minFundingRate) return false;

  return true;
}
```

### Solution 3: Cumulative Funding Tracker

Track the **total funding collected vs paid** over the position lifetime:

```typescript
interface PositionTracker {
  entryTime: number;
  cumulativeFundingCollected: number;
  cumulativeFundingPaid: number;
  fundingRateHistory: number[];
  maxNegativeStreak: number;
  currentNegativeStreak: number;
}

function updateTracker(tracker: PositionTracker, currentRate: number) {
  if (currentRate >= 0) {
    tracker.cumulativeFundingCollected += currentRate * positionSize;
    tracker.currentNegativeStreak = 0;
  } else {
    tracker.cumulativeFundingPaid += Math.abs(currentRate) * positionSize;
    tracker.currentNegativeStreak++;
    tracker.maxNegativeStreak = Math.max(
      tracker.maxNegativeStreak,
      tracker.currentNegativeStreak
    );
  }
  tracker.fundingRateHistory.push(currentRate);
}

// Exit rules based on tracker
function checkExit(tracker: PositionTracker, config: VaultConfig): boolean {
  // Rule: Net funding has been negative for too long
  const netFunding = tracker.cumulativeFundingCollected - tracker.cumulativeFundingPaid;
  const netFundingPct = netFunding / positionSize;

  // If we've collected less than we've paid in negative periods
  if (netFundingPct < -config.maxNegativeFundingPct) return true;

  // If negative streak exceeds allowed max
  if (tracker.maxNegativeStreak > config.maxNegativeStreakHours) return true;

  return false;
}
```

### Solution 4: Re-entry Cost Analysis

Before re-entering after an exit, calculate if the **expected profit exceeds re-entry costs**:

```typescript
function shouldReEnter(
  currentRate: number,
  historicalRates: number[],
  config: VaultConfig
): boolean {
  // Calculate expected hourly profit
  const expectedHourlyProfit = currentRate * positionSize;

  // Calculate re-entry cost (entry + exit fees)
  const reEntryCost = calculateEntryExitCost(config);

  // Calculate how many hours to break even
  const breakEvenHours = reEntryCost / expectedHourlyProfit;

  // Only re-enter if expected holding period > break-even + buffer
  const expectedHoldingPeriod = estimateHoldingPeriod(historicalRates);
  const buffer = 1.5; // 50% buffer

  if (expectedHoldingPeriod > breakEvenHours * buffer) {
    return true;
  }

  return false;
}
```

### Solution 5: Multi-Timeframe Funding Analysis

Don't just look at hourly rates — analyze funding across multiple timeframes:

```typescript
function analyzeFundingHealth(rates: number[]): {
  hourlyTrend: "up" | "down" | "flat";
  dailyTrend: "up" | "down" | "flat";
  volatility: "low" | "medium" | "high";
  recommendation: "enter" | "hold" | "exit" | "wait";
} {
  const hourly = rates.slice(-1);       // Current hour
  const daily = rates.slice(-24);       // Last 24 hours
  const weekly = rates.slice(-168);     // Last 7 days

  const hourlyMA = average(hourly);
  const dailyMA = average(daily);
  const weeklyMA = average(weekly);

  const hourlyTrend = hourlyMA > dailyMA * 1.1 ? "up" :
                      hourlyMA < dailyMA * 0.9 ? "down" : "flat";

  const dailyTrend = dailyMA > weeklyMA * 1.05 ? "up" :
                     dailyMA < weeklyMA * 0.95 ? "down" : "flat";

  const volatility = stdDev(daily) / dailyMA > 0.5 ? "high" :
                     stdDev(daily) / dailyMA > 0.2 ? "medium" : "low";

  let recommendation: "enter" | "hold" | "exit" | "wait";

  if (hourlyTrend === "up" && dailyTrend === "up") {
    recommendation = "enter";
  } else if (hourlyTrend === "down" && dailyTrend === "down") {
    recommendation = "exit";
  } else if (hourlyTrend === "flat" && dailyTrend === "up") {
    recommendation = "hold";
  } else {
    recommendation = "wait";
  }

  return { hourlyTrend, dailyTrend, volatility, recommendation };
}
```

---

## 5. Fee Management

### Fee Structure Analysis

| Exchange | Taker Fee | Maker Fee | Spread | Best For |
|----------|-----------|-----------|--------|----------|
| Hyperliquid | 3.5 bps | 1.0 bps | 2.0 bps | High-frequency |
| Lighter | 2.0 bps | 0.0 bps | 3.0 bps | Maker orders |
| Aster | 4.0 bps | 1.0 bps | 5.0 bps | — |
| Extended | 2.0 bps | 0.0 bps | 4.0 bps | Maker orders |
| Paradex | 5.0 bps | 2.0 bps | 3.0 bps | Stocks/ETFs |
| Nado | 4.0 bps | 1.0 bps | 4.0 bps | Stocks/Commodities |
| GMX | 5.0 bps | 0.0 bps | 3.0 bps | Meme coins |
| Binance | 4.0 bps | 1.0 bps | 1.0 bps | Spot |
| Uniswap | 5.0 bps | 5.0 bps | 5.0 bps | DeFi |

### Break-Even Analysis

For a position to be profitable, the funding rate must exceed the round-trip fee cost:

```
Round-trip cost = (Entry Fee A + Exit Fee A + Entry Fee B + Exit Fee B + Spread A + Spread B)

Example: Hyperliquid vs Lighter
= (3.5 + 3.5 + 2.0 + 2.0 + 2.0 + 3.0) bps
= 16 bps = 0.16%

At 2x leverage on both sides:
= 0.16% × 2 = 0.32% of capital per round trip

To break even in 1 hour:
Need funding rate differential > 0.32% / 1 hour = 0.0032%

To profit in 24 hours:
Need funding rate differential > 0.32% / 24 = 0.000133% per hour
```

### Fee Optimization Strategies

**Strategy 1: Use Maker Orders When Possible**
```typescript
// Switch to maker orders during low-volatility periods
const useMaker = volatility < 0.1 && !urgentRebalance;
const fee = useMaker ? exchange.makerFee : exchange.takerFee;
```

**Strategy 2: Batch Rebalancing**
```typescript
// Don't rebalance every hour — batch rebalancing
const REBALANCE_INTERVAL = 4; // hours
const shouldRebalance = currentHour % REBALANCE_INTERVAL === 0;
```

**Strategy 3: Fee Reserve Management**
```typescript
// Keep 5-10% of capital as fee reserve
const feeReserve = capital * 0.05;
const deployableCapital = capital - feeReserve;

// Refill reserve from profits
if (totalPnl > 0 && feeReserve < capital * 0.03) {
  feeReserve += totalPnl * 0.1; // 10% of profits go to reserve
}
```

**Strategy 4: Optimal Holding Period**
```typescript
// Calculate optimal holding period based on fees
function optimalHoldingPeriod(
  avgFundingRate: number,
  roundTripCostBps: number,
  leverage: number
): number {
  // Cost per hour of holding (depreciation of entry/exit cost)
  const costPerHour = roundTripCostBps / 10000 * leverage;

  // Funding collected per hour
  const fundingPerHour = avgFundingRate * leverage;

  // Optimal: hold until marginal cost > marginal benefit
  // For flat rates: hold as long as funding > 0
  // For declining rates: exit when rate < costPerHour

  return Math.max(1, Math.floor(costPerHour / fundingPerHour));
}
```

---

## 6. Risk Framework

### Position Sizing Rules

```typescript
function calculatePositionSize(
  vaultCapital: number,
  numAssets: number,
  fundingRate: number,
  volatility: number,
  config: VaultConfig
): number {
  // Base allocation per asset
  const baseAllocation = vaultCapital / numAssets;

  // Adjust for funding rate strength
  const fundingMultiplier = Math.min(1.5, Math.max(0.5,
    fundingRate / config.avgFundingRate
  ));

  // Adjust for volatility (reduce in high vol)
  const volatilityMultiplier = Math.min(1.0, Math.max(0.5,
    1 - (volatility - config.avgVolatility) / config.avgVolatility
  ));

  // Final position size
  const positionSize = baseAllocation
    * fundingMultiplier
    * volatilityMultiplier
    * config.leverage;

  // Cap at max position size
  return Math.min(positionSize, config.maxPositionSize);
}
```

### Drawdown Protection

```typescript
interface RiskManager {
  maxDrawdownPct: number;     // 5% max drawdown
  currentDrawdownPct: number;
  deRiskThreshold: number;    // Start de-risking at 3%
  stopLossThreshold: number;  // Force exit at 5%

  checkRisk(equity: number, peak: number): "normal" | "derisk" | "stop" {
    const drawdown = (peak - equity) / peak;

    if (drawdown >= this.stopLossThreshold) return "stop";
    if (drawdown >= this.deRiskThreshold) return "derisk";
    return "normal";
  }

  adjustPositions(risk: "normal" | "derisk" | "stop"): PositionAdjustment {
    switch (risk) {
      case "stop":
        return { action: "close_all", reduceBy: 1.0 };
      case "derisk":
        return { action: "reduce", reduceBy: 0.5 };
      case "normal":
        return { action: "maintain", reduceBy: 0 };
    }
  }
}
```

### Correlation Monitoring

```typescript
// Monitor correlation between legs
function checkCorrelation(legAPriceHistory: number[], legBPriceHistory: number[]): {
  correlation: number;
  isHealthy: boolean;
} {
  const correlation = pearsonCorrelation(legAPriceHistory, legBPriceHistory);

  // For basis trading, we WANT high correlation
  // If correlation drops, the hedge is breaking down
  return {
    correlation,
    isHealthy: correlation > 0.9, // 90%+ correlation is healthy
  };
}

// If correlation drops below threshold, consider closing
if (!correlationHealth.isHealthy) {
  console.warn("Correlation dropped below 90% — hedge may be ineffective");
  // Option 1: Close position
  // Option 2: Reduce position size
  // Option 3: Switch to better-correlated pair
}
```

---

## 7. Implementation Roadmap

### Phase 1: Basic Vault (Week 1-2)
- [ ] Single asset vault (ETH only)
- [ ] Basic entry/exit logic
- [ ] Fee tracking
- [ ] Simple negative funding exit

### Phase 2: Multi-Asset Vaults (Week 3-4)
- [ ] Implement Stable, Yellow, Meme vaults
- [ ] Asset allocation logic
- [ ] Cross-asset rebalancing

### Phase 3: Advanced Risk Management (Week 5-6)
- [ ] Dynamic exit thresholds
- [ ] Funding rate momentum analysis
- [ ] Drawdown protection
- [ ] Re-entry cost analysis

### Phase 4: Production Ready (Week 7-8)
- [ ] Real-time monitoring dashboard
- [ ] Alert system for abnormal conditions
- [ ] Automated rebalancing
- [ ] Performance reporting

---

## Appendix: Quick Reference

### Vault Comparison

| Vault | Assets | Leverage | Expected APY | Max DD | Risk Level |
|-------|--------|----------|--------------|--------|------------|
| Stable | Stocks, ETFs | 2x | 5-15% | 1-3% | Low |
| Yellow | BTC, ETH, SOL, AAVE | 3x | 15-40% | 3-8% | Medium |
| Meme | TRUMP, PEPE, SHIBA | 2x | 30-150%+ | 8-20% | High |

### Key Metrics to Monitor
- **Funding Rate Spread:** > 0.001% per hour to enter
- **Cumulative Funding:** Track collected vs paid
- **Drawdown:** Exit if > max threshold
- **Correlation:** Maintain > 90% between legs
- **Fee Ratio:** Funding earned / Fees paid > 3x

### Emergency Procedures
1. **Flash Crash:** Immediate de-risk to 50%
2. **Exchange Outage:** Switch to backup venue
3. **Negative Funding > 24hrs:** Close all positions
4. **Drawdown > 5%:** Pause new entries
