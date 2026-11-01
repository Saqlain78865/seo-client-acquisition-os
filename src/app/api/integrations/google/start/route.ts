import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSession, hasRole } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { buildAuthUrl, googleClient, type GooglePurpose } from "@/lib/messaging/google-oauth";

/**
 * Starts Google sign-in for Gmail (default) or Search Console (?for=gsc). A random state is kept in
 * an httpOnly cookie with the workspace and purpose, to stop CSRF and mix-ups.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!hasRole(session, "ADMIN")) return NextResponse.redirect(new URL("/integrations?error=forbidden", request.url));
  const client = await googleClient(session.workspace.id);
  if (!client) return NextResponse.redirect(new URL("/integrations?error=google_not_configured", request.url));
  const purpose: GooglePurpose = request.nextUrl.searchParams.get("for") === "gsc" ? "gsc" : "gmail";
  const state = randomToken(24);
  (await cookies()).set("google_oauth_state", `${state}.${session.workspace.id}.${purpose}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/integrations/google", maxAge: 600 });
  return NextResponse.redirect(buildAuthUrl(state, client, purpose));
}
