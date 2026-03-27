"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/logo";

function SetupContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success") === "true";

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Logo />
          <span className="text-sm text-[var(--color-text-secondary)]">GitHub Setup</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        {success ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--color-accent-green)]/10 border border-[var(--color-accent-green)]/20 flex items-center justify-center mx-auto mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-3">VibeCheck installed!</h1>
            <p className="text-[var(--color-text-secondary)] mb-8 max-w-md mx-auto">
              VibeCheck will now scan every pull request for security defects and post results as check runs. Critical issues (P0) will block merge.
            </p>
            <a
              href="/dashboard"
              className="inline-flex px-6 py-3 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
            >
              Go to Dashboard
            </a>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-3">Install VibeCheck on GitHub</h1>
            <p className="text-[var(--color-text-secondary)] mb-8 max-w-lg">
              Add VibeCheck to your repositories and get automatic security scanning on every pull request.
            </p>

            {/* What it does */}
            <div className="space-y-4 mb-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                What happens
              </h2>
              <div className="grid gap-3">
                {[
                  { icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", title: "Security scan on every PR", desc: "Detects hardcoded secrets, missing RLS, SQL injection, auth gaps, and 50+ defect patterns" },
                  { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", title: "Check run with pass/fail", desc: "P0 findings block merge. P1 findings show as warnings. Clean PRs pass automatically." },
                  { icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z", title: "Inline PR comments", desc: "Findings appear as review comments on the exact lines where issues were detected." },
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="flex gap-3 p-4 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
                    <svg className="w-5 h-5 mt-0.5 text-[var(--color-accent-green)] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={icon} />
                    </svg>
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Permissions */}
            <div className="mb-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
                Permissions required
              </h2>
              <div className="p-4 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-sm space-y-2">
                <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Repository contents</span><span className="text-[var(--color-text-muted)]">Read</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Pull requests</span><span className="text-[var(--color-text-muted)]">Read & Write</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Checks</span><span className="text-[var(--color-text-muted)]">Read & Write</span></div>
              </div>
            </div>

            {/* Install button */}
            <a
              href={process.env.NEXT_PUBLIC_GITHUB_APP_URL ?? "https://github.com/apps/vibecheck-security/installations/new"}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Install VibeCheck on GitHub
            </a>
          </>
        )}
      </main>
    </div>
  );
}

export default function GitHubSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-bg-primary)]" />}>
      <SetupContent />
    </Suspense>
  );
}
