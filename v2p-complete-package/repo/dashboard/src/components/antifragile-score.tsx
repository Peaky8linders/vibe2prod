"use client";

interface AntifragileData {
  robustness: number;
  chaos_resilience: number;
  production_adaptation: number;
  total: number;
  attacks_adapted: number;
}

export function AntifragileScore({ data }: { data: AntifragileData }) {
  return (
    <div className="space-y-6">
      {/* Hero badge */}
      <div className="relative rounded-xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-accent-green)]/10 via-[var(--color-accent-blue)]/5 to-[var(--color-accent-purple)]/10" />
        <div className="relative p-8 border border-[var(--color-accent-green)]/20 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[var(--color-accent-green)] uppercase tracking-widest mb-2">Antifragility Score</p>
              <div className="flex items-baseline gap-3">
                <span className="text-6xl font-bold bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)] bg-clip-text text-transparent">
                  {data.total}
                </span>
                <span className="text-2xl text-[var(--color-text-muted)]">/ 100</span>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                <span className="text-[var(--color-accent-green)] font-semibold">{data.attacks_adapted}</span> attacks adapted
              </p>
            </div>
            <div className="w-32 h-32 relative">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-border)" strokeWidth="4" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-accent-green)" strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 42}`} strokeDashoffset={`${2 * Math.PI * 42 * (1 - data.total / 100)}`}
                  className="score-ring" style={{ filter: "drop-shadow(0 0 8px var(--color-accent-green))" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-12 h-12 text-[var(--color-accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Three components */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ComponentCard
          label="Robustness"
          value={data.robustness}
          max={40}
          description="Static hardening: defects found and fixed"
          color="var(--color-accent-blue)"
          icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
        <ComponentCard
          label="Chaos Resilience"
          value={data.chaos_resilience}
          max={30}
          description="Adversarial probes survived"
          color="var(--color-accent-yellow)"
          icon="M13 10V3L4 14h7v7l9-11h-7z"
        />
        <ComponentCard
          label="Production Adaptation"
          value={data.production_adaptation}
          max={30}
          description="Real-world signals converted to improvements"
          color="var(--color-accent-purple)"
          icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </div>

      {/* Taleb quote */}
      <div className="p-5 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] text-center">
        <p className="text-sm text-[var(--color-text-secondary)] italic">
          &ldquo;Wind extinguishes a candle and energizes fire. You want to be the fire and wish for the wind.&rdquo;
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-2">— Nassim Nicholas Taleb, Antifragile</p>
      </div>
    </div>
  );
}

function ComponentCard({ label, value, max, description, color, icon }: {
  label: string; value: number; max: number; description: string; color: string; icon: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="p-5 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-3xl font-bold" style={{ color }}>{value}</span>
        <span className="text-sm text-[var(--color-text-muted)]">/ {max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--color-bg-primary)] overflow-hidden mb-2">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
    </div>
  );
}
