"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { ScoreRing } from "@/components/score-ring";
import { DefectChart } from "@/components/defect-chart";
import { FileList } from "@/components/file-list";
import { StoreChecklist } from "@/components/store-checklist";
import { Header } from "@/components/header";
import { StatsCards } from "@/components/stats-cards";
import { AntifragileScore } from "@/components/antifragile-score";
import { ActionPrompts } from "@/components/action-prompts";

// Demo data — in production, this comes from scan-e2e-result.json
const DEMO_SCAN = {
  project: "my-vibe-app",
  scanned_at: new Date().toISOString(),
  files_scanned: 47,
  total_defects: 23,
  overall_readiness: 0.88,
  by_priority: { P0: 0, P1: 8, P2: 12, P3: 3 },
  by_dimension: {
    security: 6,
    "error-handling": 5,
    "input-validation": 4,
    observability: 5,
    "data-integrity": 3,
  },
  files: [
    { path: "src/api/auth.ts", defects: 4, readiness: 0.62, maturity: "needs-work" as const, risk: "high" as const },
    { path: "src/api/payments.ts", defects: 3, readiness: 0.71, maturity: "needs-work" as const, risk: "medium" as const },
    { path: "src/api/users.ts", defects: 2, readiness: 0.82, maturity: "mostly-clean" as const, risk: "medium" as const },
    { path: "src/middleware/cors.ts", defects: 1, readiness: 0.88, maturity: "mostly-clean" as const, risk: "low" as const },
    { path: "src/db/queries.ts", defects: 2, readiness: 0.75, maturity: "needs-work" as const, risk: "medium" as const },
    { path: "src/utils/crypto.ts", defects: 0, readiness: 1.0, maturity: "hardened" as const, risk: "low" as const },
    { path: "src/config/env.ts", defects: 1, readiness: 0.88, maturity: "mostly-clean" as const, risk: "low" as const },
    { path: "src/services/email.ts", defects: 0, readiness: 1.0, maturity: "hardened" as const, risk: "low" as const },
  ],
  antifragile: {
    robustness: 35,
    chaos_resilience: 22,
    production_adaptation: 18,
    total: 75,
    attacks_adapted: 89,
  },
  store_checks: {
    apple: { passed: 7, total: 12, blocked: ["Privacy policy missing", "No data deletion endpoint", "Debug code detected", "Missing App Transport Security", "No crash reporting"] },
    google: { passed: 9, total: 11, blocked: ["Missing privacy policy link", "No data safety section"] },
  },
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "files" | "store" | "antifragile">("overview");
  const [scan, setScan] = useState(DEMO_SCAN);
  const [dataSource, setDataSource] = useState<"loading" | "scan" | "demo" | "error">("loading");

  useEffect(() => {
    fetch("/api/scan")
      .then((r) => r.json())
      .then((res) => {
        if (res.source === "scan" && res.data) {
          // Map scan-e2e-result.json to dashboard format
          const d = res.data;
          setScan({
            project: d.project_path?.split(/[/\\]/).pop() ?? "project",
            scanned_at: d.scanned_at ?? new Date().toISOString(),
            files_scanned: d.files_scanned ?? 0,
            total_defects: d.total_defects ?? 0,
            overall_readiness: d.overall_readiness ?? 0,
            by_priority: d.summary?.by_priority ?? { P0: 0, P1: 0, P2: 0, P3: 0 },
            by_dimension: d.summary?.by_dimension ?? {},
            files: (d.files ?? []).map((f: Record<string, unknown>) => ({
              path: f.relative_path as string,
              defects: (f.defects as unknown[])?.length ?? 0,
              readiness: (f.readiness_score as number) ?? 0,
              maturity: (f.maturity as string) ?? "needs-work",
              risk: (f.risk_level as string) ?? "medium",
            })),
            antifragile: DEMO_SCAN.antifragile,
            store_checks: DEMO_SCAN.store_checks,
          });
          setDataSource("scan");
        } else {
          setDataSource("demo");
        }
      })
      .catch(() => setDataSource("demo"));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header scan={scan} />
        {dataSource === "demo" && (
          <div className="mx-6 mt-3 p-3 rounded-lg bg-[var(--color-accent-yellow)]/10 border border-[var(--color-accent-yellow)]/30 text-xs text-[var(--color-accent-yellow)]">
            Showing demo data. Run <code className="font-mono bg-[var(--color-bg-primary)] px-1 rounded">vibecheck scan:e2e --path ../your-project --report</code> then refresh to see real results.
          </div>
        )}
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
          {activeTab === "files" && <FileList files={scan.files} />}
          {activeTab === "store" && <StoreChecklist checks={scan.store_checks} />}
          {activeTab === "antifragile" && <AntifragileScore data={scan.antifragile} />}
        </main>
      </div>
    </div>
  );
}
