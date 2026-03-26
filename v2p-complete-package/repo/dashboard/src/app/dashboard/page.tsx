"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { ScoreRing } from "@/components/score-ring";
import { DefectChart } from "@/components/defect-chart";
import { FileList } from "@/components/file-list";
import { StoreChecklist } from "@/components/store-checklist";
import { Header } from "@/components/header";
import { StatsCards } from "@/components/stats-cards";
import { AntifragileScore } from "@/components/antifragile-score";
import { ActionPrompts } from "@/components/action-prompts";
import { ReviewTab } from "@/components/review-tab";
import { ScanProgress } from "@/components/scan-progress";

interface ScanData {
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
}

function mapApiScanToLocal(d: Record<string, unknown>): ScanData {
  return {
    project: (d.project_path as string)?.split(/[/\\]/).pop() ?? (d.project as string) ?? "project",
    scanned_at: (d.scanned_at as string) ?? new Date().toISOString(),
    files_scanned: (d.files_scanned as number) ?? 0,
    total_defects: (d.total_defects as number) ?? 0,
    overall_readiness: (d.overall_readiness as number) ?? 0,
    by_priority: ((d.summary as Record<string, unknown>)?.by_priority ?? d.by_priority ?? { P0: 0, P1: 0, P2: 0, P3: 0 }) as ScanData["by_priority"],
    by_dimension: ((d.summary as Record<string, unknown>)?.by_dimension ?? d.by_dimension ?? {}) as Record<string, number>,
    files: ((d.files as Array<Record<string, unknown>>) ?? []).map((f) => ({
      path: (f.relative_path as string) ?? (f.path as string) ?? "",
      defects: Array.isArray(f.defects) ? f.defects.length : (f.defects as number) ?? 0,
      readiness: (f.readiness_score as number) ?? (f.readiness as number) ?? 0,
      maturity: (f.maturity as string) ?? "needs-work",
      risk: (f.risk_level as string) ?? (f.risk as string) ?? "medium",
    })),
    antifragile: (d.antifragile as ScanData["antifragile"]) ?? { robustness: 0, chaos_resilience: 0, production_adaptation: 0, total: 0, attacks_adapted: 0 },
    store_checks: (d.store_checks as ScanData["store_checks"]) ?? { apple: { passed: 0, total: 0, blocked: [] }, google: { passed: 0, total: 0, blocked: [] } },
  };
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "files" | "review" | "store" | "antifragile">("overview");
  const [scan, setScan] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // 1. Try sessionStorage (from landing page scan)
    const stored = sessionStorage.getItem("vibecheck-scan");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setScan(mapApiScanToLocal(data));
        setLoading(false);
        return;
      } catch { /* fall through */ }
    }

    // 2. Try file-based API (existing scan-e2e-result.json)
    fetch("/api/scan")
      .then((r) => r.json())
      .then((res) => {
        if (res.source === "scan" && res.data) {
          setScan(mapApiScanToLocal(res.data));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleRescan = async () => {
    const repoUrl = sessionStorage.getItem("vibecheck-repo-url");
    if (!repoUrl) { router.push("/"); return; }

    setRescanning(true);
    try {
      const res = await fetch("/api/scan/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repoUrl }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        sessionStorage.setItem("vibecheck-scan", JSON.stringify(json.data));
        setScan(mapApiScanToLocal(json.data));
      }
    } catch { /* network error — keep current scan data */ }
    setRescanning(false);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg-primary)]">
        <ScanProgress stage={2} repoName="Loading..." />
      </div>
    );
  }

  // Rescanning state
  if (rescanning) {
    const repoUrl = typeof window !== "undefined" ? sessionStorage.getItem("vibecheck-repo-url") ?? "" : "";
    const repoName = repoUrl.split("/").pop() ?? "project";
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg-primary)]">
        <ScanProgress stage={3} repoName={repoName} />
      </div>
    );
  }

  // Empty state — no scan results
  if (!scan) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] flex items-center justify-center mx-auto mb-6">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">No scan results yet</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6">
            Scan a GitHub repository to see production readiness results here.
          </p>
          <a
            href="/"
            className="inline-flex px-6 py-3 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
          >
            Scan a Repository
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header scan={scan} onRescan={handleRescan} onNewScan={() => router.push("/")} />
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "overview" && (
            <>
              <StatsCards scan={scan} />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                  <ScoreRing score={scan.overall_readiness} label="Production Readiness" />
                </div>
                <div className="lg:col-span-2">
                  <DefectChart byDimension={scan.by_dimension} />
                </div>
              </div>
              <ActionPrompts />
            </>
          )}
          {activeTab === "files" && <FileList files={scan.files as Array<{ path: string; defects: number; readiness: number; maturity: "critical" | "needs-work" | "mostly-clean" | "hardened"; risk: "high" | "medium" | "low" }>} />}
          {activeTab === "review" && <ReviewTab scanData={scan} />}
          {activeTab === "store" && <StoreChecklist checks={scan.store_checks} />}
          {activeTab === "antifragile" && <AntifragileScore data={scan.antifragile} />}
        </main>
      </div>
    </div>
  );
}
