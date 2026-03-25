"use client";

import { clsx } from "clsx";

interface FileEntry {
  path: string;
  defects: number;
  readiness: number;
  maturity: "hardened" | "mostly-clean" | "needs-work" | "critical";
  risk: "low" | "medium" | "high";
}

const MATURITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  hardened: { bg: "bg-[var(--color-accent-green)]/10", text: "text-[var(--color-accent-green)]", label: "Hardened" },
  "mostly-clean": { bg: "bg-[var(--color-accent-blue)]/10", text: "text-[var(--color-accent-blue)]", label: "Mostly Clean" },
  "needs-work": { bg: "bg-[var(--color-accent-yellow)]/10", text: "text-[var(--color-accent-yellow)]", label: "Needs Work" },
  critical: { bg: "bg-[var(--color-accent-red)]/10", text: "text-[var(--color-accent-red)]", label: "Critical" },
};

export function FileList({ files }: { files: FileEntry[] }) {
  const sorted = [...files].sort((a, b) => a.readiness - b.readiness);

  return (
    <div className="rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] overflow-hidden">
      <div className="p-5 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold">File-by-File Analysis</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">{files.length} files scanned, sorted by readiness</p>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {sorted.map((file) => {
          const style = MATURITY_STYLES[file.maturity] ?? MATURITY_STYLES["needs-work"]!;
          const pct = Math.round(file.readiness * 100);
          return (
            <div key={file.path} className="px-5 py-3.5 flex items-center justify-between hover:bg-[var(--color-bg-card-hover)] transition-colors group">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <svg className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-mono truncate">{file.path}</span>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {file.defects > 0 && (
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">{file.defects} defects</span>
                )}
                <div className="w-24 h-1.5 rounded-full bg-[var(--color-bg-primary)] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: pct >= 85 ? "var(--color-accent-green)" : pct >= 60 ? "var(--color-accent-yellow)" : "var(--color-accent-red)",
                    }}
                  />
                </div>
                <span className="text-xs font-mono w-10 text-right" style={{
                  color: pct >= 85 ? "var(--color-accent-green)" : pct >= 60 ? "var(--color-accent-yellow)" : "var(--color-accent-red)",
                }}>{pct}%</span>
                <span className={clsx("px-2 py-0.5 rounded text-[10px] font-semibold uppercase", style.bg, style.text)}>
                  {style.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
