import { NextResponse } from "next/server";
import { generateReportId, saveReport, listReports } from "@/lib/report-store";
import type { ScanResult } from "@/lib/scanner-engine";

/** POST /api/reports — Save a scan report and return its shareable ID */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { scanResult, repoUrl } = body as { scanResult?: ScanResult; repoUrl?: string };

    if (!scanResult || !repoUrl) {
      return NextResponse.json(
        { error: "Missing 'scanResult' or 'repoUrl' field" },
        { status: 400 },
      );
    }

    const id = generateReportId();
    saveReport(id, scanResult, repoUrl);

    return NextResponse.json({
      id,
      url: `/report/${id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET /api/reports — List recent scan reports */
export async function GET() {
  try {
    const reports = listReports(20);
    return NextResponse.json({ reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list reports";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
