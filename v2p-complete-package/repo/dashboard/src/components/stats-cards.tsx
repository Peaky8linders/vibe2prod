"use client";

interface StatsCardsProps {
  scan: {
    files_scanned: number;
    total_defects: number;
    by_priority: { P0: number; P1: number; P2: number; P3: number };
    overall_readiness: number;
  };
}

export function StatsCards({ scan }: StatsCardsProps) {
  const cards = [
    {
      label: "Readiness Score",
      value: `${(scan.overall_readiness * 100).toFixed(0)}%`,
      sub: scan.by_priority.P0 > 0 ? "Capped — P0 open" : "Deploy ready",
      color: scan.overall_readiness >= 0.85 ? "green" : scan.overall_readiness >= 0.6 ? "yellow" : "red",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      label: "Critical Defects",
      value: `${scan.by_priority.P0}`,
      sub: scan.by_priority.P0 === 0 ? "No blockers" : `${scan.by_priority.P0} blocking deploy`,
      color: scan.by_priority.P0 === 0 ? "green" : "red",
      icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    },
    {
      label: "Files Scanned",
      value: `${scan.files_scanned}`,
      sub: `${scan.total_defects} defects found`,
      color: "blue",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    },
    {
      label: "Must Fix",
      value: `${scan.by_priority.P1}`,
      sub: `${scan.by_priority.P2 + scan.by_priority.P3} should fix`,
      color: scan.by_priority.P1 > 10 ? "yellow" : "green",
      icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    },
  ];

  const colorMap: Record<string, string> = {
    green: "var(--color-accent-green)",
    red: "var(--color-accent-red)",
    yellow: "var(--color-accent-yellow)",
    blue: "var(--color-accent-blue)",
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="p-5 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-border-bright)] transition-all group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">{card.label}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${colorMap[card.color]}15` }}>
              <svg className="w-4 h-4" style={{ color: colorMap[card.color] }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold tracking-tight" style={{ color: colorMap[card.color] }}>{card.value}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
