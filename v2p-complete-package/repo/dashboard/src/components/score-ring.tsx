"use client";

export function ScoreRing({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score * circumference);
  const color = pct >= 85 ? "var(--color-accent-green)" : pct >= 60 ? "var(--color-accent-yellow)" : "var(--color-accent-red)";
  const grade = pct >= 90 ? "A" : pct >= 75 ? "B" : pct >= 60 ? "C" : pct >= 40 ? "D" : "F";

  return (
    <div className="p-6 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] flex flex-col items-center">
      <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-4">{label}</p>
      <div className="relative w-40 h-40">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          {/* Background ring */}
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--color-border)" strokeWidth="6" />
          {/* Score ring */}
          <circle
            cx="50" cy="50" r="45" fill="none"
            stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="score-ring"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold" style={{ color }}>{pct}%</span>
          <span className="text-lg font-semibold text-[var(--color-text-muted)]">Grade {grade}</span>
        </div>
      </div>
      <div className="mt-4 flex gap-4 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent-green)]" /> Hardened
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent-yellow)]" /> Needs Work
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent-red)]" /> Critical
        </span>
      </div>
    </div>
  );
}
