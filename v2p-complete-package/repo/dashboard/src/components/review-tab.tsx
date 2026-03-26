"use client";

import { useState, useMemo } from "react";
import { buildReviewReport } from "@/lib/review-engine";
import type { ReviewReport, ReviewSection, ReviewIssue } from "@/lib/review-engine";
import { exportMarkdown, exportJSON, exportClipboard } from "@/lib/export-review";

// ---------------------------------------------------------------------------
// Issue Card
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    P0: "bg-[var(--color-accent-red)]/15 text-[var(--color-accent-red)] border-[var(--color-accent-red)]/30",
    P1: "bg-[var(--color-accent-yellow)]/15 text-[var(--color-accent-yellow)] border-[var(--color-accent-yellow)]/30",
    P2: "bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)] border-[var(--color-accent-blue)]/30",
    P3: "bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${colors[severity] ?? colors.P3}`}>
      {severity}
    </span>
  );
}

function IssueCard({ issue }: { issue: ReviewIssue }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-4 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-border-bright)] transition-all">
      <div className="flex items-start gap-3">
        <span className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5">#{issue.number}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge severity={issue.severity} />
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase">{issue.dimension}</span>
          </div>
          <p className="text-sm text-[var(--color-text-primary)] mb-1">{issue.description}</p>
          <p className="text-xs text-[var(--color-text-muted)] font-mono truncate">{issue.file}</p>

          {/* Recommended fix */}
          <div className="mt-3 p-2.5 rounded-md bg-[var(--color-accent-green)]/5 border border-[var(--color-accent-green)]/15">
            <div className="flex items-center gap-1.5 mb-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13.3 4.3L6 11.6 2.7 8.3" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="text-xs font-semibold text-[var(--color-accent-green)]">Recommended</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">{issue.recommendation.label}</p>
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span>human: {issue.recommendation.effort.human}</span>
              <span>CC: {issue.recommendation.effort.cc}</span>
              <span className="text-[var(--color-accent-green)]">{issue.recommendation.completeness}/10</span>
            </div>
          </div>

          {/* Alternatives toggle */}
          {issue.alternatives.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors flex items-center gap-1"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {issue.alternatives.length} alternative{issue.alternatives.length > 1 ? "s" : ""}
            </button>
          )}

          {expanded && (
            <div className="mt-2 space-y-2">
              {issue.alternatives.map((alt, i) => (
                <div key={i} className="p-2 rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-semibold text-[var(--color-text-muted)]">Option {String.fromCharCode(65 + i)}</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)]">{alt.label}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-muted)]">
                    <span>human: {alt.effort.human}</span>
                    <span>CC: {alt.effort.cc}</span>
                    <span>{alt.completeness}/10</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section Component
// ---------------------------------------------------------------------------

function ReviewSectionPanel({ section }: { section: ReviewSection }) {
  const [collapsed, setCollapsed] = useState(false);
  const scoreColor = section.score >= 7 ? "var(--color-accent-green)" : section.score >= 4 ? "var(--color-accent-yellow)" : "var(--color-accent-red)";

  return (
    <div className="mb-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between py-3 group"
      >
        <div className="flex items-center gap-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--color-text-muted)] transition-transform ${collapsed ? "" : "rotate-90"}`}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <h3 className="text-sm font-semibold">{section.name}</h3>
          <span className="text-xs text-[var(--color-text-muted)]">{section.issues.length} issue{section.issues.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: scoreColor }}>{section.score}/10</span>
          <div className="w-16 h-1.5 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${section.score * 10}%`, background: scoreColor }} />
          </div>
        </div>
      </button>

      {!collapsed && (
        <div className="space-y-3 pl-7">
          {section.issues.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] py-2">No issues found. This section passes review.</p>
          ) : (
            section.issues.map((issue) => <IssueCard key={issue.number} issue={issue} />)
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Dropdown
// ---------------------------------------------------------------------------

function ExportButton({ report }: { report: ReviewReport }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExport = (format: "markdown" | "json" | "clipboard") => {
    const safeName = report.project.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (format === "markdown" || format === "json") {
      const content = format === "markdown" ? exportMarkdown(report) : exportJSON(report);
      const mimeType = format === "markdown" ? "text/markdown" : "application/json";
      const ext = format === "markdown" ? "md" : "json";
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vibecheck-review-${safeName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 200);
    } else {
      navigator.clipboard.writeText(exportClipboard(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-border-bright)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {copied ? "Copied!" : "Export"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 py-1 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] shadow-xl">
            <button onClick={() => handleExport("clipboard")} className="w-full px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)]">
              Copy summary to clipboard
            </button>
            <button onClick={() => handleExport("markdown")} className="w-full px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)]">
              Download Markdown report
            </button>
            <button onClick={() => handleExport("json")} className="w-full px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)]">
              Download JSON (CI/CD)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ReviewTab Component
// ---------------------------------------------------------------------------

interface ReviewTabProps {
  scanData: {
    project: string;
    scanned_at: string;
    files_scanned: number;
    total_defects: number;
    overall_readiness: number;
    by_priority: { P0: number; P1: number; P2: number; P3: number };
    by_dimension: Record<string, number>;
    files: Array<{ path: string; defects: number; readiness: number; maturity: string; risk: string }>;
    antifragile: { robustness: number; chaos_resilience: number; production_adaptation: number; total: number; attacks_adapted: number };
    store_checks: { apple: { passed: number; total: number; blocked: string[] }; google: { passed: number; total: number; blocked: string[] } };
  };
}

export function ReviewTab({ scanData }: ReviewTabProps) {
  const report = useMemo(() => {
    return buildReviewReport(scanData as Parameters<typeof buildReviewReport>[0]);
  }, [scanData]);

  const totalIssues = report.engineering.issues.length + report.design.issues.length + report.qa.issues.length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Structured Review</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {totalIssues} issues across 3 review passes with recommended fixes and alternatives
          </p>
        </div>
        <ExportButton report={report} />
      </div>

      {/* Top Actions */}
      {report.topActions.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-3">Top Priority Actions</h3>
          <div className="space-y-2">
            {report.topActions.map((action) => (
              <div key={action.number} className="flex items-center gap-3 text-sm">
                <SeverityBadge severity={action.severity} />
                <span className="text-[var(--color-text-secondary)] flex-1 truncate">{action.description}</span>
                <span className="text-xs text-[var(--color-accent-green)] whitespace-nowrap">{action.recommendation.label.slice(0, 30)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review Sections */}
      <ReviewSectionPanel section={report.engineering} />
      <ReviewSectionPanel section={report.design} />
      <ReviewSectionPanel section={report.qa} />
    </div>
  );
}
