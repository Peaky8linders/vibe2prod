"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getTrialStatus, recordScan } from "@/lib/scan-limits";

export function Hero() {
  const [score, setScore] = useState(0);
  const [repoUrl, setRepoUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [trialInfo, setTrialInfo] = useState<ReturnType<typeof getTrialStatus> | null>(null);
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setScore(88), 300);
    setTrialInfo(getTrialStatus());
    return () => clearTimeout(timer);
  }, []);

  const handleScan = useCallback(async () => {
    if (!repoUrl.trim()) return;
    if (!/github\.com\/[^/]+\/[^/\s]+/.test(repoUrl)) {
      setError("Please enter a valid GitHub URL (e.g., https://github.com/owner/repo)");
      return;
    }

    // Check trial limits
    const status = getTrialStatus();
    if (!status.canScan) {
      setShowUpgrade(true);
      setError(
        status.trialExpired
          ? "Your 7-day free trial has ended. For deeper, LLM-powered scans and autonomous fixes, check out our Pro plan."
          : `You've used all ${status.maxPerDay} free scans for today. For unlimited scans with LLM-powered analysis, upgrade to Pro.`
      );
      return;
    }

    setError("");
    setShowUpgrade(false);
    setScanning(true);

    try {
      const res = await fetch("/api/scan/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repoUrl }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Scan failed. Please try again.");
        setScanning(false);
        return;
      }

      // Record the scan immediately after successful API response
      recordScan();
      setTrialInfo(getTrialStatus());

      // Store results and navigate to dashboard
      sessionStorage.setItem("vibecheck-scan", JSON.stringify(json.data));
      sessionStorage.setItem("vibecheck-repo-url", repoUrl);
      router.push("/dashboard");
    } catch {
      setError("Network error. Please check your connection and try again.");
      setScanning(false);
    }
  }, [repoUrl, router]);

  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  return (
    <section className="relative overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32">
      {/* Grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse,rgba(34,197,94,0.08),transparent_70%)]" />

      <div className="relative max-w-6xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-16">
        {/* Left: copy */}
        <div className="flex-1 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-secondary)] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green)] pulse-live" />
            Now in public beta
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6">
            Your code doesn&apos;t just{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)]">
              survive
            </span>{" "}
            attacks.
            <br />
            It gets{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent-cyan)] to-[var(--color-accent-purple)]">
              stronger
            </span>{" "}
            from them.
          </h1>

          <p className="text-lg text-[var(--color-text-secondary)] max-w-xl mb-8 mx-auto lg:mx-0">
            VibeCheck scans your codebase, finds production defects, and autonomously fixes them — while you sleep. Antifragile security for teams that ship fast.
          </p>

          {/* GitHub URL input */}
          <div className="max-w-xl mx-auto lg:mx-0">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => { setRepoUrl(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                disabled={scanning}
                className="flex-1 px-4 py-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-green)] disabled:opacity-50 transition-colors"
              />
              <button
                onClick={handleScan}
                disabled={scanning || !repoUrl.trim()}
                className="px-6 py-3 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {scanning ? "Scanning..." : "Scan Now"}
              </button>
            </div>
            {error && (
              <div className="mt-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {error}
                </p>
                {showUpgrade && (
                  <a
                    href="#pricing"
                    className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-md bg-[var(--color-accent-green)]/10 border border-[var(--color-accent-green)]/20 text-[var(--color-accent-green)] text-xs font-medium hover:bg-[var(--color-accent-green)]/20 transition-colors"
                  >
                    View subscription plans
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
                  </a>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
              <span>Public repos only</span>
              {trialInfo && !trialInfo.trialExpired && (
                <>
                  <span className="text-[var(--color-border)]">&middot;</span>
                  <span>
                    {trialInfo.maxPerDay - trialInfo.scansToday} of {trialInfo.maxPerDay} free scans left today
                  </span>
                  <span className="text-[var(--color-border)]">&middot;</span>
                  <span>{trialInfo.trialDaysLeft} days left in trial</span>
                </>
              )}
              {trialInfo?.trialExpired && (
                <>
                  <span className="text-[var(--color-border)]">&middot;</span>
                  <span className="text-[var(--color-accent-yellow)]">
                    Trial ended &mdash; <a href="#pricing" className="underline hover:no-underline">upgrade for unlimited scans</a>
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-3 justify-center lg:justify-start mt-2">
            <a
              href="#how-it-works"
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              How It Works &darr;
            </a>
            <span className="text-[var(--color-text-muted)]">&middot;</span>
            <a
              href="#pricing"
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              View Pricing
            </a>
          </div>
        </div>

        {/* Right: animated score ring */}
        <div className="relative flex-shrink-0">
          <div className="w-56 h-56 sm:w-64 sm:h-64 relative">
            {/* Glow */}
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.15),transparent_70%)]" />
            <svg viewBox="0 0 120 120" className="w-full h-full">
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="4"
              />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="var(--color-accent-green)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 60 60)"
                className="transition-all duration-[1.5s] ease-out"
              />
              <text x="60" y="55" textAnchor="middle" className="fill-[var(--color-text-primary)] text-[28px] font-bold" style={{ fontFamily: "'Inter', sans-serif" }}>
                {score}%
              </text>
              <text x="60" y="72" textAnchor="middle" className="fill-[var(--color-text-secondary)] text-[8px]" style={{ fontFamily: "'Inter', sans-serif" }}>
                Production Ready
              </text>
            </svg>
          </div>

          {/* Floating badges */}
          <div className="absolute -top-2 -right-2 px-2.5 py-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-accent-green)] hero-float-badge" style={{ animationDelay: "0s" }}>
            0 P0 defects
          </div>
          <div className="absolute -bottom-2 -left-4 px-2.5 py-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-accent-cyan)] hero-float-badge" style={{ animationDelay: "0.5s" }}>
            47 files scanned
          </div>
          <div className="absolute top-1/2 -right-8 px-2.5 py-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-accent-purple)] hero-float-badge" style={{ animationDelay: "1s" }}>
            Antifragile: 75
          </div>
        </div>
      </div>
    </section>
  );
}
