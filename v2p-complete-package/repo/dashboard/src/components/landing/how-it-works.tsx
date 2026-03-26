const STEPS = [
  {
    step: "1",
    title: "Paste your repo",
    description: "Drop a GitHub URL. Public repos scan instantly — no install, no config.",
    code: "github.com/your-org/your-app",
    color: "var(--color-accent-blue)",
  },
  {
    step: "2",
    title: "Get your report",
    description: "Deep scan across security, performance, observability, and 5 more dimensions.",
    code: "8 scanners \u00b7 file-by-file analysis",
    color: "var(--color-accent-green)",
  },
  {
    step: "3",
    title: "Fix & ship",
    description: "Review defects, apply autonomous fixes, and ship production-grade code.",
    code: "npx vibecheck harden",
    color: "var(--color-accent-purple)",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Production-ready in{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)]">
              three steps
            </span>
          </h2>
          <p className="text-[var(--color-text-secondary)] text-lg max-w-xl mx-auto">
            No config files. No CI/CD changes. Just point VibeCheck at your project and let it work.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map((s, i) => (
            <div key={s.step} className="relative">
              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div className="hidden md:block absolute top-10 left-[calc(50%+60px)] w-[calc(100%-120px)] h-px bg-gradient-to-r from-[var(--color-border-bright)] to-[var(--color-border)]" />
              )}

              <div className="text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold"
                  style={{
                    background: `color-mix(in srgb, ${s.color} 15%, transparent)`,
                    color: s.color,
                    border: `1px solid color-mix(in srgb, ${s.color} 30%, transparent)`,
                  }}
                >
                  {s.step}
                </div>
                <h3 className="text-xl font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-[var(--color-text-secondary)] mb-4 max-w-xs mx-auto">{s.description}</p>
                <div className="inline-block px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] font-mono text-sm text-[var(--color-text-secondary)]">
                  {s.code}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
