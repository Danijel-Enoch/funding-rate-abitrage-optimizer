"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/scanner", label: "Scanner", icon: "🔍" },
  { href: "/backtest", label: "Backtest", icon: "📈" },
  { href: "/optimize", label: "Optimize", icon: "⚡" },
  { href: "/markets", label: "Markets", icon: "🪙" },
  { href: "/exchanges", label: "Exchanges", icon: "🏦" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 bg-card border-r border-card-border flex flex-col z-50">
      <div className="p-5 border-b border-card-border">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-accent">Basis</span>OS
        </h1>
        <p className="text-xs text-muted mt-0.5">Basis Trading Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-foreground hover:bg-white/5"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-card-border text-xs text-muted">
        API: localhost:3001
      </div>
    </aside>
  );
}
