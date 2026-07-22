"use client";

import { useState, useEffect } from "react";
import { getExchanges } from "@/lib/api";
import { Card, Badge, Spinner, ErrorBox } from "@/components/UI";

export default function ExchangesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getExchanges()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Exchanges</h1>

      <Card>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Perpetual Exchanges ({data?.perp?.length})</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.perp?.map((ex: any) => (
            <div key={ex.id} className="bg-background rounded-lg p-4 border border-card-border/50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{ex.name}</h3>
                <Badge color="blue">Perp</Badge>
              </div>
              <a href={ex.url} target="_blank" rel="noopener" className="text-xs text-accent hover:underline">
                {ex.url}
              </a>
              {ex.fees && (
                <div className="mt-2 text-xs text-muted space-y-0.5">
                  <p>Taker: {ex.fees.takerFeeBps} bps | Maker: {ex.fees.makerFeeBps} bps</p>
                  <p>Spread: ~{ex.fees.avgSpreadBps} bps</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Spot Exchanges ({data?.spot?.length})</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.spot?.map((ex: any) => (
            <div key={ex.id} className="bg-background rounded-lg p-4 border border-card-border/50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{ex.name}</h3>
                <Badge color="green">Spot</Badge>
              </div>
              <a href={ex.url} target="_blank" rel="noopener" className="text-xs text-accent hover:underline">
                {ex.url}
              </a>
              {ex.fees && (
                <div className="mt-2 text-xs text-muted space-y-0.5">
                  <p>Taker: {ex.fees.takerFeeBps} bps | Maker: {ex.fees.makerFeeBps} bps</p>
                  <p>Spread: ~{ex.fees.avgSpreadBps} bps</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
