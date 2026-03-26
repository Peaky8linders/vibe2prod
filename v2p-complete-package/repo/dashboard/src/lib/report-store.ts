/**
 * lib/report-store.ts — Filesystem-based report storage
 *
 * Stores scan reports as JSON files in .reports/ for shareable URLs.
 * Simple, no-database v1 implementation. Migrate to KV/DB at scale.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScanResult } from "./scanner-engine";

const REPORTS_DIR = path.join(process.cwd(), ".reports");

// ID validation: only alphanumeric and hyphens (prevents path traversal)
const VALID_ID = /^[a-f0-9-]{36}$/;

export interface ReportData {
  id: string;
  repoUrl: string;
  createdAt: string;
  scanResult: ScanResult;
}

export interface ReportSummary {
  id: string;
  repoUrl: string;
  createdAt: string;
  project: string;
  readiness: number;
  totalDefects: number;
  filesScanned: number;
}

function ensureDir(): void {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

export function generateReportId(): string {
  return randomUUID();
}

export function saveReport(id: string, scanResult: ScanResult, repoUrl: string): void {
  if (!VALID_ID.test(id)) throw new Error("Invalid report ID format");
  ensureDir();

  const report: ReportData = {
    id,
    repoUrl,
    createdAt: new Date().toISOString(),
    scanResult,
  };

  const filePath = path.join(REPORTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
}

export function getReport(id: string): ReportData | null {
  if (!VALID_ID.test(id)) return null;

  const filePath = path.join(REPORTS_DIR, `${id}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ReportData;
  } catch {
    return null;
  }
}

export function listReports(limit = 20): ReportSummary[] {
  ensureDir();

  let files: string[];
  try {
    files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  // Read and parse all reports, sort by date desc
  const summaries: ReportSummary[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(REPORTS_DIR, file), "utf-8");
      const report = JSON.parse(raw) as ReportData;
      summaries.push({
        id: report.id,
        repoUrl: report.repoUrl,
        createdAt: report.createdAt,
        project: report.scanResult.project,
        readiness: report.scanResult.overall_readiness,
        totalDefects: report.scanResult.total_defects,
        filesScanned: report.scanResult.files_scanned,
      });
    } catch {
      // Skip corrupted files
    }
  }

  summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return summaries.slice(0, limit);
}
