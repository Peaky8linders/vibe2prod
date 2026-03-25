"use client";

const DIMENSION_COLORS: Record<string, string> = {
  security: "var(--color-accent-red)",
  "error-handling": "var(--color-accent-yellow)",
  "input-validation": "var(--color-accent-blue)",
  observability: "var(--color-accent-purple)",
  "data-integrity": "var(--color-accent-cyan)",
};

const DIMENSION_ICONS: Record<string, string> = {
  security: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  "error-handling": "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  "input-validation": "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  observability: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
  "data-integrity": "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
};

export function DefectChart({ byDimension }: { byDimension: Record<string, number> }) {
  const maxCount = Math.max(...Object.values(byDimension), 1);

  return (
    <div className="p-6 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
      <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-6">Defects by Dimension</p>
      <div className="space-y-4">
        {Object.entries(byDimension).map(([dim, count]) => {
          const pct = (count / maxCount) * 100;
          const color = DIMENSION_COLORS[dim] ?? "var(--color-accent-blue)";
          const icon = DIMENSION_ICONS[dim] ?? "";
          return (
            <div key={dim} className="group">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                  </svg>
                  <span className="text-sm font-medium capitalize">{dim.replace(/-/g, " ")}</span>
                </div>
                <span className="text-sm font-mono font-semibold" style={{ color }}>{count}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--color-bg-primary)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}40` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
