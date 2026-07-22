"use client";

import { useState } from "react";
import { runOptimize } from "@/lib/api";
import { Card, Badge, Spinner, ErrorBox, Input, Button } from "@/components/UI";

export default function OptimizePage() {
  const [coin, setCoin] = useState("ETH");
  const [days, setDays] = useState("30");
  const [capital, setCapital] = useState("50000");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await runOptimize({ coin, days: +days, capital: +capital });
      setData(res);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Venue Optimizer</h1>
        <Badge color="yellow">CPU Intensive</Badge>
      </div>

      <Card>
        <div className="flex items-end gap-4">
          <Input label="Coin" value={coin} onChange={setCoin} className="w-32" />
          <Input label="Days" value={days} onChange={setDays} type="number" className="w-28" />
          <Input label="Capital ($)" value={capital} onChange={setCapital} type="number" className="w-36" />
          <Button onClick={handleRun} loading={loading} className="h-10">Run Optimization</Button>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && (
        <Card>
          <div className="text-center py-8">
            <Spinner />
            <p className="text-muted text-sm mt-3">Running optimization across all venue combinations...</p>
            <p className="text-muted text-xs mt-1">This may take 1-3 minutes depending on the coin.</p>
          </div>
        </Card>
      )}

      {data && !loading && !data.error && (
        <>
          <Card>
            <p className="text-muted text-sm">
              Tested <span className="text-foreground font-semibold">{data.count}</span> venue combinations for{" "}
              <span className="text-accent font-semibold">{data.coin}</span> over{" "}
              <span className="text-foreground font-semibold">{data.days}</span> days.
            </p>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Top Results</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted border-b border-card-border">
                    <th className="text-left py-2 pr-2">#</th>
                    <th className="text-left py-2 px-2">Strategy</th>
                    <th className="text-left py-2 px-2">Venue Pair</th>
                    <th className="text-right py-2 px-2">Net PnL</th>
                    <th className="text-right py-2 px-2">Fees</th>
                    <th className="text-right py-2 px-2">Trades</th>
                    <th className="text-right py-2 px-2">Win%</th>
                    <th className="text-right py-2 px-2">MDD%</th>
                    <th className="text-right py-2 px-2">Obj F</th>
                    <th className="text-right py-2 px-2">Leverage</th>
                    <th className="text-right py-2 px-2">APY</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r: any, i: number) => (
                    <tr
                      key={i}
                      className={`border-b border-card-border/50 ${i === 0 ? "bg-accent/5" : ""}`}
                    >
                      <td className="py-2.5 pr-2">
                        {i === 0 ? <Badge color="yellow">BEST</Badge> : <span className="text-muted">{i + 1}</span>}
                      </td>
                      <td className="py-2.5 px-2">
                        <Badge color={r.strategy === "spot_vs_perp" ? "blue" : "purple"}>
                          {r.strategy === "spot_vs_perp" ? "Spot/Perp" : "Perp/Perp"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-2 font-medium">{r.label}</td>
                      <td className={`text-right py-2.5 px-2 font-mono ${(r.netPnl ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                        ${(r.netPnl ?? 0).toFixed(0)}
                      </td>
                      <td className="text-right py-2.5 px-2 text-muted font-mono">
                        ${(r.totalFees ?? 0).toFixed(0)}
                      </td>
                      <td className="text-right py-2.5 px-2 font-mono">{r.totalTrades}</td>
                      <td className="text-right py-2.5 px-2 font-mono">{((r.winRate ?? 0) * 100).toFixed(0)}%</td>
                      <td className="text-right py-2.5 px-2 font-mono text-red">
                        {(r.maxDrawdownPct ?? 0).toFixed(1)}%
                      </td>
                      <td className="text-right py-2.5 px-2 font-mono">
                        {(r.objective ?? 0).toFixed(4)}
                      </td>
                      <td className="text-right py-2.5 px-2 font-mono text-xs text-muted">
                        {r.leverageConfig
                          ? `${r.leverageConfig.minLeverage}/${r.leverageConfig.targetLeverage}/${r.leverageConfig.maxLeverage}`
                          : "—"}
                      </td>
                      <td className="text-right py-2.5 px-2 font-mono">
                        {((r.annualizedReturn ?? 0) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
