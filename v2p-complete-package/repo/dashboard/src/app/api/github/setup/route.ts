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

  console.log(`[vibecheck-setup] Installation callback: action=${setupAction}, id=${installationId}`);

  // Redirect to setup page with success indicator
  return NextResponse.redirect(new URL("/setup/github?success=true", request.url));
}
