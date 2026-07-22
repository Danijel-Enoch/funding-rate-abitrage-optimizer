"use client";

import { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-card-border rounded-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, color = "blue" }: { children: ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    yellow: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    gray: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border ${colors[color] ?? colors.gray}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const textColor = color === "green" ? "text-green" : color === "red" ? "text-red" : color === "yellow" ? "text-yellow" : "text-foreground";
  return (
    <div>
      <p className="text-xs text-muted uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 font-mono ${textColor}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
      {message}
    </div>
  );
}

export function Input({
  label, value, onChange, placeholder, type = "text", className = "",
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-muted uppercase tracking-wider mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
      />
    </div>
  );
}

export function Select({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-muted uppercase tracking-wider mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Button({
  children, onClick, loading, disabled, variant = "primary", className = "",
}: {
  children: ReactNode; onClick?: () => void; loading?: boolean; disabled?: boolean; variant?: string; className?: string;
}) {
  const styles = variant === "secondary"
    ? "bg-card border border-card-border text-foreground hover:bg-white/5"
    : "bg-accent hover:bg-accent-hover text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {loading ? "Loading..." : children}
    </button>
  );
}
