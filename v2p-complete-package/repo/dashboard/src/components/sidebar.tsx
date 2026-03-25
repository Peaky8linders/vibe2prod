"use client";

import { clsx } from "clsx";

type Tab = "overview" | "files" | "store" | "antifragile";

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "files", label: "File Analysis", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "store", label: "Store Ready", icon: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { id: "antifragile", label: "Antifragile", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
];

export function Sidebar({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  return (
    <aside className="w-64 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-accent-green)] to-[var(--color-accent-cyan)] flex items-center justify-center">
            <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">VibeCheck</h1>
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-widest">Production Hardening</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              activeTab === item.id
                ? "bg-[var(--color-accent-green)]/10 text-[var(--color-accent-green)] glow-green"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card)]"
            )}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Bottom CTA */}
      <div className="p-4 border-t border-[var(--color-border)]">
        <div className="p-3 rounded-lg bg-gradient-to-br from-[var(--color-accent-green)]/5 to-[var(--color-accent-blue)]/5 border border-[var(--color-accent-green)]/20">
          <p className="text-xs font-medium text-[var(--color-accent-green)]">Pro Tip</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Run <code className="text-[var(--color-accent-cyan)] font-mono">vibecheck scan:e2e</code> to get live results here.</p>
        </div>
      </div>
    </aside>
  );
}
