import { getReport } from "@/lib/report-store";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReportContent } from "./report-content";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return { title: "Report Not Found — VibeCheck" };
  const report = getReport(id);
  if (!report) return { title: "Report Not Found — VibeCheck" };

  const readiness = Math.round(report.scanResult.overall_readiness * 100);
  return {
    title: `VibeCheck Report: ${report.scanResult.project} — ${readiness}% Production Ready`,
    description: `Security scan found ${report.scanResult.total_defects} defects across ${report.scanResult.files_scanned} files. ${report.scanResult.by_priority.P0} critical (P0) issues.`,
    openGraph: {
      title: `VibeCheck: ${report.scanResult.project} — ${readiness}% Ready`,
      description: `${report.scanResult.total_defects} defects found. ${report.scanResult.by_priority.P0} critical issues.`,
      type: "website",
    },
  };
}

export default async function ReportPage({ params }: PageProps) {
  const { id } = await params;

  if (!/^[a-f0-9-]{36}$/.test(id)) notFound();

  const report = getReport(id);
  if (!report) notFound();

  return <ReportContent report={report} />;
}
