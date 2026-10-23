import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, hasRole } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { buildAuthUrl, googleOAuthConfigured } from "@/lib/messaging/google-oauth";

/** Starts Google sign-in for Gmail. A random state is kept in an httpOnly cookie to stop CSRF. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!hasRole(session, "ADMIN")) return NextResponse.redirect(new URL("/integrations?error=forbidden", request.url));
  if (!googleOAuthConfigured()) return NextResponse.redirect(new URL("/integrations?error=google_not_configured", request.url));
  const state = randomToken(24);
  (await cookies()).set("google_oauth_state", `${state}.${session.workspace.id}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/integrations/google", maxAge: 600 });
  return NextResponse.redirect(buildAuthUrl(state));
}
