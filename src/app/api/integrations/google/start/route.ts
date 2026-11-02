import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { buildAuthUrl, googleClient, isGooglePurpose, signState, type GooglePurpose } from "@/lib/messaging/google-oauth";

/**
 * Starts Google sign-in for Gmail (default) or Search Console (?for=gsc). The state is signed and
 * names the workspace, user and purpose, so the sign-in can finish in the system browser too.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!hasRole(session, "ADMIN")) return NextResponse.redirect(new URL("/integrations?error=forbidden", request.url));
  const client = await googleClient(session.workspace.id);
  if (!client) return NextResponse.redirect(new URL("/integrations?error=google_not_configured", request.url));
  const asked = request.nextUrl.searchParams.get("for");
  const purpose: GooglePurpose = isGooglePurpose(asked) ? asked : "gmail";
  return NextResponse.redirect(buildAuthUrl(signState({ w: session.workspace.id, u: session.user.id, p: purpose }), client, purpose));
}
