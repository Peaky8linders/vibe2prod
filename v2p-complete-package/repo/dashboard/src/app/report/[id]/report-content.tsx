"use client";

import { ScoreRing } from "@/components/score-ring";
import { DefectChart } from "@/components/defect-chart";
import { StatsCards } from "@/components/stats-cards";
import { FileList } from "@/components/file-list";
import type { ReportData } from "@/lib/report-store";
import { Logo } from "@/components/logo";

function safeGitHubUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" ? url : null;
  } catch {
    return null;
  }
}

export function ReportContent({ report }: { report: ReportData }) {
  const { scanResult, repoUrl: rawRepoUrl, createdAt } = report;
  const repoUrl = safeGitHubUrl(rawRepoUrl);
  const readiness = Math.round(scanResult.overall_readiness * 100);
  const scanDate = new Date(createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-sm text-[var(--color-text-secondary)]">Security Report</span>
          </div>
          <a
            href="/"
            className="px-4 py-2 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
          >
            Scan Your Repo
          </a>
        </div>
      </header>

      {/* Report Header */}
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-2">
          <h1 className="text-2xl font-bold">{scanResult.project}</h1>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
            readiness >= 85 ? "bg-green-500/10 text-green-400" :
            readiness >= 60 ? "bg-yellow-500/10 text-yellow-400" :
            "bg-red-500/10 text-red-400"
          }`}>
            {readiness}% Production Ready
          </span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
          <span>Scanned {scanDate}</span>
          <span className="text-[var(--color-border)]">&middot;</span>
          {repoUrl ? (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-text-secondary)] transition-colors"
            >
              {repoUrl.replace("https://github.com/", "")}
            </a>
          ) : (
            <span>{rawRepoUrl}</span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 pb-16">
        {/* Score + Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="flex justify-center">
            <ScoreRing score={readiness} label="Production Readiness" />
          </div>
          <div className="lg:col-span-2">
            <StatsCards scan={scanResult} />
          </div>
        </div>

        {/* Defect Chart */}
        {Object.keys(scanResult.by_dimension).length > 0 && (
          <div className="mb-8 p-6 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
            <h2 className="text-lg font-semibold mb-4">Defects by Dimension</h2>
            <DefectChart byDimension={scanResult.by_dimension} />
          </div>
        )}

        {/* File List */}
        {scanResult.files.length > 0 && (
          <div className="p-6 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
            <h2 className="text-lg font-semibold mb-4">
              Files Analyzed ({scanResult.files_scanned})
            </h2>
            <FileList files={scanResult.files} />
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 text-center">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Want VibeCheck to autonomously fix these defects while you sleep?
          </p>
          <a
            href="/#pricing"
            className="inline-flex px-6 py-3 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
          >
            Start Free Trial
          </a>
        </div>
      </div>
    </div>
  );
}
