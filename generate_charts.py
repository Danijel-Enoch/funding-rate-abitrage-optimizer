import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import numpy as np

# Set style
plt.style.use('seaborn-v0_8-darkgrid')
plt.rcParams['figure.figsize'] = (12, 6)
plt.rcParams['font.size'] = 11

# Date range
months = ['Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025',
          'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025',
          'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026']

dates = [datetime(2025, i+1, 1) if i < 12 else datetime(2026, i-11, 1) for i in range(18)]

# Data for each strategy
aero_rewards = [2.1, 2.3, 1.9, 2.5, 2.8, 2.2, 2.6, 2.4, 2.0, 2.7, 3.0, 2.5, 2.8, 2.6, 2.4, 2.9, 3.1, 2.7]
aero_bribes = [1.8, 2.1, 1.5, 2.8, 3.2, 2.5, 3.0, 2.7, 2.2, 3.1, 3.5, 2.8, 3.2, 2.9, 2.6, 3.3, 3.6, 3.0]
aero_funding = [0.9, 1.1, 0.7, 1.3, 1.8, 1.2, 1.5, 1.4, 1.0, 1.6, 2.0, 1.3, 1.7, 1.5, 1.2, 1.8, 2.1, 1.4]
aero_net = [3.0, 3.3, 2.7, 4.0, 4.2, 3.5, 4.1, 3.7, 3.2, 4.2, 4.5, 4.0, 4.3, 4.0, 3.8, 4.4, 4.6, 4.3]

stocks_div = [0.4]*18
stocks_defi = [0.7, 0.8, 0.6, 0.9, 1.0, 0.8, 0.9, 0.7, 0.6, 0.8, 1.0, 0.9, 0.8, 0.7, 0.9, 1.0, 1.1, 0.9]
stocks_hedge = [0.3, 0.3, 0.2, 0.4, 0.4, 0.3, 0.4, 0.3, 0.2, 0.3, 0.4, 0.3, 0.3, 0.3, 0.4, 0.4, 0.5, 0.3]
stocks_net = [0.8, 0.9, 0.8, 0.9, 1.0, 0.9, 0.9, 0.8, 0.8, 0.9, 1.0, 1.0, 0.9, 0.8, 0.9, 1.0, 1.0, 1.0]

funding_earned = [2.8, 3.1, 2.2, 3.5, 4.0, 2.9, 3.3, 2.7, 2.1, 3.4, 3.8, 3.0, 3.2, 2.8, 2.5, 3.6, 4.1, 3.1]
funding_fees = [0.2]*18
funding_net = [2.6, 2.9, 2.0, 3.3, 3.8, 2.7, 3.1, 2.5, 1.9, 3.2, 3.6, 2.8, 3.0, 2.6, 2.3, 3.4, 3.9, 2.9]

stable_spread = [0.3, 0.2, 0.4, 0.3, 0.2, 0.3, 0.4, 0.3, 0.2, 0.3, 0.4, 0.3, 0.3, 0.2, 0.3, 0.4, 0.3, 0.3]
stable_yield = [0.8, 0.9, 0.7, 1.0, 1.1, 0.9, 1.0, 0.8, 0.7, 0.9, 1.1, 1.0, 0.9, 0.8, 1.0, 1.1, 1.2, 1.0]
stable_net = [1.1, 1.1, 1.1, 1.3, 1.3, 1.2, 1.4, 1.1, 0.9, 1.2, 1.5, 1.3, 1.2, 1.0, 1.3, 1.5, 1.5, 1.3]

# Calculate cumulative yields
aero_cum = np.cumsum(aero_net)
stocks_cum = np.cumsum(stocks_net)
funding_cum = np.cumsum(funding_net)
stable_cum = np.cumsum(stable_net)

# Chart 1: Aerodrome Strategy Breakdown
fig, ax = plt.subplots(figsize=(14, 7))
x = np.arange(len(months))
width = 0.25

bars1 = ax.bar(x - width, aero_rewards, width, label='Voting Rewards', color='#2E86AB')
bars2 = ax.bar(x, aero_bribes, width, label='Bribes', color='#A23B72')
bars3 = ax.bar(x + width, aero_funding, width, label='Funding Cost', color='#F18F01')

ax.set_xlabel('Month', fontsize=12)
ax.set_ylabel('Yield (%)', fontsize=12)
ax.set_title('Aerodrome veToken Strategy: Monthly Breakdown', fontsize=14, fontweight='bold')
ax.set_xticks(x)
ax.set_xticklabels(months, rotation=45, ha='right')
ax.legend()
ax.grid(axis='y', alpha=0.3)

plt.tight_layout()
plt.savefig('/Users/deboraholamide/funding-test/chart_aerodrome.png', dpi=150, bbox_inches='tight')
plt.close()

# Chart 2: Stocks Strategy Breakdown
fig, ax = plt.subplots(figsize=(14, 7))
x = np.arange(len(months))
width = 0.25

bars1 = ax.bar(x - width, stocks_div, width, label='Stock Dividends', color='#2E86AB')
bars2 = ax.bar(x, stocks_defi, width, label='DeFi Yield', color='#A23B72')
bars3 = ax.bar(x + width, stocks_hedge, width, label='Hedge Cost', color='#F18F01')

ax.set_xlabel('Month', fontsize=12)
ax.set_ylabel('Yield (%)', fontsize=12)
ax.set_title('Stocks Delta Neutral Strategy: Monthly Breakdown', fontsize=14, fontweight='bold')
ax.set_xticks(x)
ax.set_xticklabels(months, rotation=45, ha='right')
ax.legend()
ax.grid(axis='y', alpha=0.3)

plt.tight_layout()
plt.savefig('/Users/deboraholamide/funding-test/chart_stocks.png', dpi=150, bbox_inches='tight')
plt.close()

# Chart 3: Funding Rate Arbitrage
fig, ax = plt.subplots(figsize=(14, 7))
x = np.arange(len(months))
width = 0.25

bars1 = ax.bar(x - width, funding_earned, width, label='Funding Earned', color='#2E86AB')
bars2 = ax.bar(x, funding_fees, width, label='Trading Fees', color='#F18F01')
bars3 = ax.bar(x + width, funding_net, width, label='Net Yield', color='#28A745')

ax.set_xlabel('Month', fontsize=12)
ax.set_ylabel('Yield (%)', fontsize=12)
ax.set_title('Funding Rate Arbitrage: Monthly Breakdown', fontsize=14, fontweight='bold')
ax.set_xticks(x)
ax.set_xticklabels(months, rotation=45, ha='right')
ax.legend()
ax.grid(axis='y', alpha=0.3)

plt.tight_layout()
plt.savefig('/Users/deboraholamide/funding-test/chart_funding.png', dpi=150, bbox_inches='tight')
plt.close()

# Chart 4: Stablecoin Basis Trading
fig, ax = plt.subplots(figsize=(14, 7))
x = np.arange(len(months))
width = 0.25

bars1 = ax.bar(x - width, stable_spread, width, label='Spread Captured', color='#2E86AB')
bars2 = ax.bar(x, stable_yield, width, label='Yield Earned', color='#A23B72')
bars3 = ax.bar(x + width, stable_net, width, label='Net Yield', color='#28A745')

ax.set_xlabel('Month', fontsize=12)
ax.set_ylabel('Yield (%)', fontsize=12)
ax.set_title('Stablecoin Basis Trading: Monthly Breakdown', fontsize=14, fontweight='bold')
ax.set_xticks(x)
ax.set_xticklabels(months, rotation=45, ha='right')
ax.legend()
ax.grid(axis='y', alpha=0.3)

plt.tight_layout()
plt.savefig('/Users/deboraholamide/funding-test/chart_stablecoin.png', dpi=150, bbox_inches='tight')
plt.close()

# Chart 5: Cumulative Yield Comparison
fig, ax = plt.subplots(figsize=(14, 7))

ax.plot(dates, aero_cum, marker='o', linewidth=2, label='Aerodrome veToken', color='#2E86AB')
ax.plot(dates, funding_cum, marker='s', linewidth=2, label='Funding Rate Arb', color='#A23B72')
ax.plot(dates, stable_cum, marker='^', linewidth=2, label='Stablecoin Basis', color='#F18F01')
ax.plot(dates, stocks_cum, marker='D', linewidth=2, label='Stocks Delta Neutral', color='#28A745')

ax.set_xlabel('Date', fontsize=12)
ax.set_ylabel('Cumulative Yield (%)', fontsize=12)
ax.set_title('Delta Neutral Strategies: Cumulative Yield Comparison', fontsize=14, fontweight='bold')
ax.legend()
ax.grid(alpha=0.3)
ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
plt.xticks(rotation=45)

plt.tight_layout()
plt.savefig('/Users/deboraholamide/funding-test/chart_cumulative.png', dpi=150, bbox_inches='tight')
plt.close()

# Chart 6: Risk vs Return Scatter
fig, ax = plt.subplots(figsize=(10, 8))

strategies = ['Aerodrome\nveToken', 'Stocks\nDelta Neutral', 'Funding Rate\nArb', 'Stablecoin\nBasis']
annualized_yields = [45.9, 10.8, 34.3, 14.5]
risk_scores = [6, 3, 5, 3]  # 1-10 scale
colors = ['#2E86AB', '#28A745', '#A23B72', '#F18F01']

scatter = ax.scatter(risk_scores, annualized_yields, s=300, c=colors, alpha=0.8, edgecolors='black', linewidth=2)

for i, txt in enumerate(strategies):
    ax.annotate(txt, (risk_scores[i], annualized_yields[i]), 
                textcoords="offset points", xytext=(0,15), ha='center', fontsize=10)

ax.set_xlabel('Risk Level (1-10)', fontsize=12)
ax.set_ylabel('Annualized Yield (%)', fontsize=12)
ax.set_title('Risk vs Return: Delta Neutral Strategies', fontsize=14, fontweight='bold')
ax.set_xlim(0, 10)
ax.set_ylim(0, 55)
ax.grid(alpha=0.3)

plt.tight_layout()
plt.savefig('/Users/deboraholamide/funding-test/chart_risk_return.png', dpi=150, bbox_inches='tight')
plt.close()

print("All charts generated successfully!")
