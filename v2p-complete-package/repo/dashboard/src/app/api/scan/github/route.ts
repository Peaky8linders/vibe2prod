import { NextResponse } from "next/server";
import { fetchAndScanRepo, parseGitHubUrl } from "@/lib/scanner-engine";

export const maxDuration = 60; // Allow up to 60s for large repos

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = body?.url;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing 'url' field" }, { status: 400 });
    }

    // Validate it's a GitHub URL
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid GitHub URL. Expected: https://github.com/owner/repo" },
        { status: 400 },
      );
    }

    const result = await fetchAndScanRepo(url);
    return NextResponse.json({ source: "github", data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
