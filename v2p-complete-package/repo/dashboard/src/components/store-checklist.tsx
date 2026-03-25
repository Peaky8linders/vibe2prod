"use client";

interface StoreChecks {
  apple: { passed: number; total: number; blocked: string[] };
  google: { passed: number; total: number; blocked: string[] };
}

export function StoreChecklist({ checks }: { checks: StoreChecks }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <StoreCard
        name="Apple App Store"
        icon="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 21.99 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 21.99C7.79 22.03 6.8 20.68 5.96 19.47C4.25 16.99 2.97 12.51 4.7 9.46C5.56 7.93 7.13 6.98 8.82 6.96C10.1 6.94 11.29 7.82 12.05 7.82C12.81 7.82 14.25 6.75 15.79 6.92C16.42 6.95 18.24 7.17 19.39 8.89C19.29 8.95 17.24 10.13 17.26 12.62C17.29 15.6 19.88 16.54 19.91 16.55C19.88 16.62 19.51 17.92 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"
        checks={checks.apple}
        gradient="from-gray-400 to-gray-600"
      />
      <StoreCard
        name="Google Play Store"
        icon="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.302 1.331-2.968 1.72-2.35-2.35 3.016-2.701zM5.864 2.658L16.8 8.992l-2.302 2.302L5.864 2.658z"
        checks={checks.google}
        gradient="from-green-500 to-blue-500"
      />
    </div>
  );
}

function StoreCard({ name, icon, checks, gradient }: {
  name: string;
  icon: string;
  checks: { passed: number; total: number; blocked: string[] };
  gradient: string;
}) {
  const pct = Math.round((checks.passed / checks.total) * 100);
  const isReady = checks.blocked.length === 0;

  return (
    <div className="rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] overflow-hidden">
      <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center`}>
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d={icon} />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{name}</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{checks.passed}/{checks.total} checks passed</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-[11px] font-semibold ${
          isReady
            ? "bg-[var(--color-accent-green)]/15 text-[var(--color-accent-green)] border border-[var(--color-accent-green)]/30"
            : "bg-[var(--color-accent-yellow)]/15 text-[var(--color-accent-yellow)] border border-[var(--color-accent-yellow)]/30"
        }`}>
          {isReady ? "READY" : `${checks.blocked.length} ISSUES`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="px-5 pt-4">
        <div className="h-2 rounded-full bg-[var(--color-bg-primary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${pct}%`,
              backgroundColor: pct >= 90 ? "var(--color-accent-green)" : pct >= 70 ? "var(--color-accent-yellow)" : "var(--color-accent-red)",
            }}
          />
        </div>
        <p className="text-right text-xs text-[var(--color-text-muted)] mt-1">{pct}% compliant</p>
      </div>

      {/* Blocked items */}
      {checks.blocked.length > 0 && (
        <div className="p-5 space-y-2">
          {checks.blocked.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[var(--color-accent-red)]/5 border border-[var(--color-accent-red)]/10">
              <svg className="w-4 h-4 text-[var(--color-accent-red)] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-xs text-[var(--color-text-secondary)]">{item}</span>
            </div>
          ))}
        </div>
      )}

      {/* Passed items (collapsed) */}
      {checks.passed > 0 && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 text-xs text-[var(--color-accent-green)]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {checks.passed} checks passed
          </div>
        </div>
      )}
    </div>
  );
}
