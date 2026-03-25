import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export async function GET() {
  // Look for scan results in the parent repo's reports directory
  const searchPaths = [
    resolve(process.cwd(), "..", "reports", "scan-e2e-result.json"),
    resolve(process.cwd(), "reports", "scan-e2e-result.json"),
    resolve(process.cwd(), "..", "..", "reports", "scan-e2e-result.json"),
  ];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf-8"));
        return NextResponse.json({ source: "scan", data });
      } catch {
        return NextResponse.json({ source: "error", error: "Failed to parse scan results" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ source: "demo", data: null });
}
