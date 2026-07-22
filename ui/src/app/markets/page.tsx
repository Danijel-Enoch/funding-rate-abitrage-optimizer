"use client";

import { useState, useEffect } from "react";
import { getMarkets, searchMarkets } from "@/lib/api";
import { Card, Badge, Spinner, ErrorBox, Input } from "@/components/UI";

export default function MarketsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [view, setView] = useState<"crypto" | "traditional">("crypto");

  useEffect(() => {
    getMarkets()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const categories = view === "crypto"
    ? ["All", ...Object.keys(data?.crypto ?? {})]
    : ["All", ...Object.keys(data?.traditional ?? {})];

  const markets = view === "crypto"
    ? Object.values(data?.crypto ?? {}).flat()
    : Object.values(data?.traditional ?? {}).flat();

  const filtered = (markets as any[])
    ?.filter((m: any) => activeCategory === "All" || m.category === activeCategory)
    ?.filter((m: any) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return m.hlCoin.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Markets</h1>
        <div className="flex gap-1 ml-4">
          <button
            onClick={() => setView("crypto")}
            className={`px-3 py-1 rounded-md text-sm ${view === "crypto" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            Crypto ({data?.totalCrypto})
          </button>
          <button
            onClick={() => setView("traditional")}
            className={`px-3 py-1 rounded-md text-sm ${view === "traditional" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            Stocks/ETFs ({data?.totalTraditional})
          </button>
        </div>
      </div>

      <Card>
        <Input label="" value={search} onChange={setSearch} placeholder="Search by coin, name, or symbol..." />
      </Card>

      <div className="flex gap-2 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeCategory === cat
                ? "bg-accent text-white"
                : "bg-card border border-card-border text-muted hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-b border-card-border">
                <th className="text-left py-2 pr-4">Coin</th>
                <th className="text-left py-2 px-4">Name</th>
                <th className="text-left py-2 px-4">Symbol</th>
                <th className="text-left py-2 px-4">Category</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((m: any, i: number) => (
                <tr key={i} className="border-b border-card-border/50 hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-4 font-mono font-semibold text-accent">{m.hlCoin}</td>
                  <td className="py-2.5 px-4">{m.name}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-muted">{m.binanceSymbol}</td>
                  <td className="py-2.5 px-4">
                    <Badge color={getCategoryColor(m.category)}>{m.category}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-4">{filtered?.length} markets</p>
      </Card>
    </div>
  );
}

function getCategoryColor(cat: string): string {
  const map: Record<string, string> = {
    L1: "blue", L2: "purple", DeFi: "green", AI: "yellow",
    Meme: "red", Infra: "gray", Gaming: "purple", Oracle: "blue",
    Stocks: "green", Commodities: "yellow", ETFs: "blue",
  };
  return map[cat] ?? "gray";
}
