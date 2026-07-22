"use client";

import { useState } from "react";
import { scanCoin, getMarkets } from "@/lib/api";
import { Card, Badge, Spinner, ErrorBox, Input, Button, Stat } from "@/components/UI";
import Link from "next/link";

export default function DashboardPage() {
  const [coin, setCoin] = useState("ETH");
  const [scanData, setScanData] = useState<any>(null);
  const [marketData, setMarketData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleScan = async () => {
    setLoading(true);
    setError("");
    try {
      const [scan, markets] = await Promise.all([scanCoin(coin), getMarkets()]);
      setScanData(scan);
      setMarketData(markets);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted mt-1">BasisOS Multi-Exchange Basis Trading Platform</p>
        </div>
        <Badge color="green">Connected</Badge>
      </div>

      <Card>
        <div className="flex items-end gap-4">
          <Input label="Quick Scan" value={coin} onChange={setCoin} placeholder="ETH" className="w-40" />
          <Button onClick={handleScan} loading={loading}>Scan Now</Button>
          <div className="flex gap-2 ml-auto">
            <Link href="/scanner" className="text-sm text-accent hover:underline">Full Scanner →</Link>
            <Link href="/backtest" className="text-sm text-accent hover:underline ml-4">Run Backtest →</Link>
          </div>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner />}

      {scanData && !loading && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <Stat label="Perp Exchanges" value={String(scanData.perpRates?.length ?? 0)} />
            </Card>
            <Card>
              <Stat label="Spot Exchanges" value={String(scanData.spotPrices?.length ?? 0)} />
            </Card>
            <Card>
              <Stat
                label="Funding Arb Opps"
                value={String(scanData.fundingOpportunities?.length ?? 0)}
                color={(scanData.fundingOpportunities?.length ?? 0) > 0 ? "green" : undefined}
              />
            </Card>
            <Card>
              <Stat
                label="Basis Opps"
                value={String(scanData.basisOpportunities?.filter((o: any) => o.netBps > 0)?.length ?? 0)}
                color={(scanData.basisOpportunities?.filter((o: any) => o.netBps > 0)?.length ?? 0) > 0 ? "green" : undefined}
              />
            </Card>
          </div>

          {/* Funding Rates Summary */}
          <Card>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Perp Funding Rates — {coin}</h2>
            <div className="grid grid-cols-3 gap-3">
              {scanData.perpRates?.filter((r: any) => r.available).map((r: any, i: number) => (
                <div key={i} className="bg-background rounded-lg p-3 border border-card-border/50 flex justify-between items-center">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className={`font-mono font-bold text-sm ${r.rate >= 0 ? "text-green" : "text-red"}`}>
                    {(r.rate * 100).toFixed(4)}%
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Top Opportunity */}
          {scanData.fundingOpportunities?.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Best Funding Opportunity</h2>
              <div className="bg-green/5 rounded-lg p-4 border border-green/20">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-3">
                      <Badge color="green">LONG {scanData.fundingOpportunities[0].longExchange}</Badge>
                      <span className="text-muted">+</span>
                      <Badge color="red">SHORT {scanData.fundingOpportunities[0].shortExchange}</Badge>
                    </div>
                    <p className="text-xs text-muted mt-2">
                      Earn {(scanData.fundingOpportunities[0].longRate * 100).toFixed(4)}% / Pay {(scanData.fundingOpportunities[0].shortRate * 100).toFixed(4)}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green font-mono">
                      +{scanData.fundingOpportunities[0].netBps.toFixed(2)} bps
                    </p>
                    <p className="text-xs text-muted">per 8h period</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Market Count */}
          {marketData && (
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <p className="text-xs text-muted uppercase tracking-wider">Crypto Markets</p>
                <p className="text-3xl font-bold mt-1">{marketData.totalCrypto}</p>
              </Card>
              <Card>
                <p className="text-xs text-muted uppercase tracking-wider">Stocks / ETFs / Commodities</p>
                <p className="text-3xl font-bold mt-1">{marketData.totalTraditional}</p>
              </Card>
            </div>
          )}
        </>
      )}

      {!scanData && !loading && (
        <Card className="text-center py-12">
          <p className="text-muted text-sm">Enter a coin and click <strong>Scan Now</strong> to get started.</p>
          <div className="flex justify-center gap-2 mt-4">
            {["BTC", "ETH", "SOL", "DOGE", "PEPE", "SUI"].map((c) => (
              <button
                key={c}
                onClick={() => { setCoin(c); }}
                className="px-3 py-1 bg-background border border-card-border rounded-md text-sm text-muted hover:text-foreground hover:border-accent/50 transition-colors"
              >
                {c}
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
