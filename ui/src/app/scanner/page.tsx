"use client";

import { useState } from "react";
import { scanCoin } from "@/lib/api";
import { Card, Badge, Spinner, ErrorBox, Input, Button, Stat } from "@/components/UI";

export default function ScannerPage() {
  const [coin, setCoin] = useState("ETH");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleScan = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await scanCoin(coin);
      setData(res);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Funding Rate Scanner</h1>
        <Badge color="blue">Live</Badge>
      </div>

      <Card>
        <div className="flex items-end gap-4">
          <Input label="Coin" value={coin} onChange={setCoin} placeholder="ETH" className="w-40" />
          <Button onClick={handleScan} loading={loading}>Scan All Exchanges</Button>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner />}

      {data && !loading && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <Stat label="Perp Exchanges" value={String(data.perpRates?.length ?? 0)} />
            </Card>
            <Card>
              <Stat label="Spot Exchanges" value={String(data.spotPrices?.length ?? 0)} />
            </Card>
            <Card>
              <Stat
                label="Funding Opps"
                value={String(data.fundingOpportunities?.length ?? 0)}
                color={(data.fundingOpportunities?.length ?? 0) > 0 ? "green" : undefined}
              />
            </Card>
            <Card>
              <Stat label="Scan Time" value={data.timestamp?.slice(11, 19) ?? ""} />
            </Card>
          </div>

          {/* Perp Funding Rates */}
          <Card>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Perp Funding Rates</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted border-b border-card-border">
                    <th className="text-left py-2 pr-4">Exchange</th>
                    <th className="text-right py-2 px-4">Rate</th>
                    <th className="text-right py-2 px-4">bps</th>
                    <th className="text-right py-2 px-4">Status</th>
                    <th className="text-right py-2 pl-4">Last Update</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perpRates?.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-card-border/50">
                      <td className="py-2.5 pr-4 font-medium">{r.name}</td>
                      <td className={`text-right py-2.5 px-4 font-mono ${r.rate >= 0 ? "text-green" : "text-red"}`}>
                        {r.available ? `${(r.rate * 100).toFixed(4)}%` : "N/A"}
                      </td>
                      <td className={`text-right py-2.5 px-4 font-mono ${r.rate >= 0 ? "text-green" : "text-red"}`}>
                        {r.available ? `${(r.rate * 10000).toFixed(2)} bps` : "—"}
                      </td>
                      <td className="text-right py-2.5 px-4">
                        {r.available ? <Badge color="green">OK</Badge> : <Badge color="red">{r.error}</Badge>}
                      </td>
                      <td className="text-right py-2.5 pl-4 text-muted font-mono text-xs">
                        {r.timestamp ? new Date(r.timestamp).toISOString().slice(11, 19) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Spot Prices */}
          <Card>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Spot Prices</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted border-b border-card-border">
                    <th className="text-left py-2 pr-4">Exchange</th>
                    <th className="text-right py-2 px-4">Price</th>
                    <th className="text-right py-2 px-4">Status</th>
                    <th className="text-right py-2 pl-4">Last Update</th>
                  </tr>
                </thead>
                <tbody>
                  {data.spotPrices?.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-card-border/50">
                      <td className="py-2.5 pr-4 font-medium">{r.name}</td>
                      <td className="text-right py-2.5 px-4 font-mono">
                        {r.available ? `$${r.price.toFixed(r.price >= 1 ? 2 : 6)}` : "N/A"}
                      </td>
                      <td className="text-right py-2.5 px-4">
                        {r.available ? <Badge color="green">OK</Badge> : <Badge color="red">{r.error}</Badge>}
                      </td>
                      <td className="text-right py-2.5 pl-4 text-muted font-mono text-xs">
                        {r.timestamp ? new Date(r.timestamp).toISOString().slice(11, 19) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Funding Arb Opportunities */}
          {data.fundingOpportunities?.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Funding Arbitrage Opportunities</h2>
              <div className="space-y-3">
                {data.fundingOpportunities.slice(0, 5).map((opp: any, i: number) => (
                  <div key={i} className="bg-background rounded-lg p-4 border border-card-border/50">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge color="green">LONG</Badge>
                          <span className="font-medium">{opp.longExchange}</span>
                          <span className="text-muted text-xs">earn {(opp.longRate * 100).toFixed(4)}%</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge color="red">SHORT</Badge>
                          <span className="font-medium">{opp.shortExchange}</span>
                          <span className="text-muted text-xs">pay {(opp.shortRate * 100).toFixed(4)}%</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-green font-bold font-mono">+{opp.netBps.toFixed(2)} bps</p>
                        <p className="text-xs text-muted">{opp.breakevenPeriods} periods to breakeven</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Basis Opportunities */}
          {data.basisOpportunities?.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Basis Trade Opportunities</h2>
              <div className="space-y-3">
                {data.basisOpportunities.filter((o: any) => o.netBps > 0).slice(0, 5).map((opp: any, i: number) => (
                  <div key={i} className="bg-background rounded-lg p-4 border border-card-border/50">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium">{opp.perpExchange} ↔ {opp.spotExchange}</p>
                        <p className="text-xs text-muted mt-0.5">
                          {opp.direction === "long_spot_short_perp" ? "Long Spot + Short Perp" : "Long Perp + Short Spot"}
                        </p>
                        <p className="text-xs text-muted">Funding: {(opp.fundingRate * 100).toFixed(4)}% / 8h</p>
                      </div>
                      <div className="text-right">
                        <p className="text-green font-bold font-mono">+{opp.netBps.toFixed(2)} bps</p>
                        <p className="text-xs text-muted">{opp.annualizedPct.toFixed(1)}% APR</p>
                        <p className="text-xs text-muted">{opp.breakevenPeriods} periods breakeven</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
