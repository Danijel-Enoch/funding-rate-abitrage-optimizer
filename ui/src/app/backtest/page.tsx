"use client";

import { useState } from "react";
import { runBacktest } from "@/lib/api";
import { Card, Badge, Spinner, ErrorBox, Input, Button, Select } from "@/components/UI";

export default function BacktestPage() {
  const [coin, setCoin] = useState("ETH");
  const [days, setDays] = useState("30");
  const [capital, setCapital] = useState("50000");
  const [strategy, setStrategy] = useState("spot_vs_perp");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await runBacktest({ coin, days: +days, capital: +capital, strategy });
      setData(res);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const pnl = data?.result?.totalPnl ?? 0;
  const ret = data?.result?.annualizedReturn ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Backtest Engine</h1>
      </div>

      <Card>
        <div className="grid grid-cols-5 gap-4 items-end">
          <Input label="Coin" value={coin} onChange={setCoin} placeholder="ETH" />
          <Input label="Days" value={days} onChange={setDays} type="number" />
          <Input label="Capital ($)" value={capital} onChange={setCapital} type="number" />
          <Select
            label="Strategy"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: "spot_vs_perp", label: "Spot vs Perp" },
              { value: "perp_vs_perp", label: "Perp vs Perp" },
            ]}
          />
          <Button onClick={handleRun} loading={loading} className="h-10">Run Backtest</Button>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner />}

      {data && !loading && !data.error && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-6 gap-4">
            <Card>
              <p className="text-xs text-muted uppercase tracking-wider">Net PnL</p>
              <p className={`text-2xl font-bold font-mono mt-1 ${pnl >= 0 ? "text-green" : "text-red"}`}>
                ${pnl.toFixed(0)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted uppercase tracking-wider">Annual Return</p>
              <p className={`text-2xl font-bold font-mono mt-1 ${ret >= 0 ? "text-green" : "text-red"}`}>
                {(ret * 100).toFixed(1)}%
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted uppercase tracking-wider">Win Rate</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {((data.result.winRate ?? 0) * 100).toFixed(0)}%
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted uppercase tracking-wider">Max Drawdown</p>
              <p className="text-2xl font-bold font-mono mt-1 text-red">
                {((data.result.maxDrawdownPct ?? 0) * 100).toFixed(1)}%
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted uppercase tracking-wider">Sharpe</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {(data.result.sharpeRatio ?? 0).toFixed(2)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted uppercase tracking-wider">Trades</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {data.result.totalTrades ?? 0}
              </p>
            </Card>
          </div>

          {/* PnL History Chart */}
          {data.result.pnlHistory?.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">PnL History</h2>
              <PnLChart history={data.result.pnlHistory} timestamps={data.result.timestamps} />
            </Card>
          )}

          {/* Trades Table */}
          {data.result.trades?.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Trade Log</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted border-b border-card-border">
                      <th className="text-left py-2 pr-4">#</th>
                      <th className="text-left py-2 px-4">Entry</th>
                      <th className="text-right py-2 px-4">Duration</th>
                      <th className="text-right py-2 px-4">PnL</th>
                      <th className="text-right py-2 px-4">Fees</th>
                      <th className="text-right py-2 px-4">Funding</th>
                      <th className="text-right py-2 px-4">Spread</th>
                      <th className="text-right py-2 pl-4">Breakeven</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.result.trades.map((t: any, i: number) => {
                      const entry = t.entryTime ? new Date(t.entryTime).toISOString().slice(0, 16).replace("T", " ") : "—";
                      const exitMs = t.exitTime ? new Date(t.exitTime).getTime() : Date.now();
                      const durH = Math.round((exitMs - new Date(t.entryTime).getTime()) / 3600000);
                      const dur = durH < 24 ? `${durH}h` : `${(durH / 24).toFixed(1)}d`;
                      const netFunding = (t.fundingCollected ?? 0) - (t.fundingPaid ?? 0);
                      const beH = t.actualBreakevenHours;
                      const beStr = beH < 0 ? "never" : beH < 24 ? `${beH}h` : `${(beH / 24).toFixed(1)}d`;

                      return (
                        <tr key={i} className="border-b border-card-border/50">
                          <td className="py-2.5 pr-4 text-muted">{i + 1}</td>
                          <td className="py-2.5 px-4 font-mono text-xs">{entry}</td>
                          <td className="text-right py-2.5 px-4">{dur}</td>
                          <td className={`text-right py-2.5 px-4 font-mono ${(t.pnl ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                            ${(t.pnl ?? 0).toFixed(0)}
                          </td>
                          <td className="text-right py-2.5 px-4 text-muted font-mono">
                            ${(t.feesPaid ?? 0).toFixed(0)}
                          </td>
                          <td className={`text-right py-2.5 px-4 font-mono ${netFunding >= 0 ? "text-green" : "text-red"}`}>
                            ${netFunding.toFixed(0)}
                          </td>
                          <td className="text-right py-2.5 px-4 text-muted font-mono">
                            {(t.spreadBps ?? 0).toFixed(1)} bps
                          </td>
                          <td className="text-right py-2.5 pl-4 font-mono text-xs">{beStr}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PnLChart({ history, timestamps }: { history: number[]; timestamps: number[] }) {
  const [RechartsComponents, setRecharts] = useState<any>(null);

  useState(() => {
    import("recharts").then((m) =>
      setRecharts({ LineChart: m.LineChart, Line: m.Line, XAxis: m.XAxis, YAxis: m.YAxis, Tooltip: m.Tooltip, ResponsiveContainer: m.ResponsiveContainer, CartesianGrid: m.CartesianGrid })
    );
  });

  if (!RechartsComponents) return <Spinner />;
  const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } = RechartsComponents;

  const chartData = history.map((pnl, i) => ({
    time: timestamps[i] ? new Date(timestamps[i]).toLocaleDateString() : i,
    pnl: Number(pnl.toFixed(2)),
  }));

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickFormatter={(v: number) => `$${v}`} />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [`$${v.toFixed(2)}`, "PnL"]}
          />
          <Line type="monotone" dataKey="pnl" stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
