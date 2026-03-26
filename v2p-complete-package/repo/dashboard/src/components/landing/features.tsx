const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    title: "Deep Scan",
    description: "8 dimensions. Finds what linters miss.",
    color: "var(--color-accent-blue)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    title: "Auto-Fix",
    description: "One fix per commit. Reverts on failure.",
    color: "var(--color-accent-green)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: "Chaos Testing",
    description: "Fuzzing, auth probes, injection replay.",
    color: "var(--color-accent-yellow)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Security Gates",
    description: "No secrets, no PII. Binary pass/fail.",
    color: "var(--color-accent-red)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    title: "Compliance",
    description: "SHA-256 evidence chain per fix.",
    color: "var(--color-accent-purple)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: "Antifragile Score",
    description: "Gets stronger from every attack.",
    color: "var(--color-accent-cyan)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: "Performance",
    description: "N+1 queries, sync blocking, leaks.",
    color: "var(--color-accent-green)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    title: "Observability",
    description: "Tracing, health checks, error tracking.",
    color: "var(--color-accent-blue)",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: "API Contracts",
    description: "Validation, versioning, breaking changes.",
    color: "var(--color-accent-yellow)",
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">
            Everything you need to ship{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)]">
              production-grade
            </span>{" "}
            code
          </h2>
          <p className="text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Security scanners tell you what&apos;s broken. VibeCheck fixes it — then makes your code stronger from every attack.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group p-4 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-border-bright)] hover:bg-[var(--color-bg-card-hover)] transition-all"
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}
                >
                  {f.icon}
                </div>
                <h3 className="text-sm font-semibold">{f.title}</h3>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed pl-[38px]">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
