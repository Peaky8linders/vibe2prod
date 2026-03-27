/**
 * api/github/setup/route.ts — GitHub App installation callback
 *
 * Handles the redirect after a user installs the VibeCheck GitHub App.
 */

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");

  // Validate required params from GitHub callback
  if (!installationId || !setupAction) {
    return NextResponse.redirect(new URL("/setup/github?error=missing_params", url.origin));
  }

  // Use url.origin for redirect base to prevent host-header open redirect
  return NextResponse.redirect(
    new URL(`/setup/github?success=true&installation_id=${encodeURIComponent(installationId)}`, url.origin),
  );
}
