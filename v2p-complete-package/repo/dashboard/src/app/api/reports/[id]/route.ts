import { NextResponse } from "next/server";
import { getReport } from "@/lib/report-store";

/** GET /api/reports/[id] — Retrieve a specific scan report */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Validate ID format (UUID only — prevents path traversal)
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Invalid report ID" }, { status: 400 });
  }

  const report = getReport(id);
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json(report);
}
