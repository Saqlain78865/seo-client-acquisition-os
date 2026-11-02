import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCredentials } from "@/lib/integrations";
import { reportError } from "@/lib/log";
import { GOOGLE_PURPOSES, GoogleAuthError, exchangeCode, readState } from "@/lib/messaging/google-oauth";

const MESSAGES: Record<string, string> = {
  "connected=gsc": "Search Console is connected (read-only).",
  "connected=gmail": "Gmail is connected through Google sign-in.",
  "connected=replies": "Reply detection is on: LeadLift reads your inbox only to spot replies from prospects.",
  "connected=calendar": "Google Calendar is connected: follow-ups are added with a reminder.",
  "connected=drive": "Google Drive is connected: a backup is saved there every day.",
  "error=oauth_scope_other": "The permission was not granted. Tick its checkbox on Google's consent screen and try again.",
  "error=forbidden": "Only owners and admins can connect Google.",
  "error=oauth_state": "This sign-in link expired or could not be verified. Start again from LeadLift → Integrations.",
  "error=oauth_denied": "Google access was not granted.",
  "error=oauth_scope": "Gmail permission was not granted. Tick the Gmail checkbox on Google's consent screen.",
  "error=oauth_scope_gsc": "Search Console permission was not granted. Tick the Search Console checkbox on Google's consent screen.",
  "error=oauth_failed": "Google sign-in failed. Please try again.",
};

/**
 * Google returns here after sign-in. Inside the app (a session is present) the user goes back to
 * Integrations; in the system browser (desktop app) a short page says to return to LeadLift.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  const done = (q: string) => {
    if (session) return NextResponse.redirect(new URL(`/integrations?${q}`, request.url));
    const ok = q.startsWith("connected");
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LeadLift</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:Segoe UI,Arial,sans-serif;background:#f4f6fb;color:#0f172a">
<div style="max-width:420px;padding:32px;border-radius:16px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.08);text-align:center">
<div style="font-size:40px">${ok ? "✅" : "⚠️"}</div><h1 style="font-size:20px;margin:12px 0 6px">${ok ? "Connected" : "Not connected"}</h1>
<p style="color:#475569;margin:0">${MESSAGES[q] ?? "Something went wrong."}</p>
<p style="color:#64748b;font-size:14px;margin-top:16px">You can close this tab and return to LeadLift${ok ? " — open Integrations or the prospect page to continue" : ""}.</p></div></body></html>`;
    return new NextResponse(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  };

  const state = readState(request.nextUrl.searchParams.get("state") ?? "");
  if (!state || (session && session.workspace.id !== state.w)) return done("error=oauth_state");
  // The signed state names who started the sign-in; that person must still be an owner or admin there.
  const admin = await db.workspaceMembership.findFirst({ where: { userId: state.u, workspaceId: state.w, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } });
  if (!admin) return done("error=forbidden");
  const error = request.nextUrl.searchParams.get("error");
  if (error) return done(`error=${error === "access_denied" ? "oauth_denied" : "oauth_failed"}`);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done("error=oauth_failed");
  try {
    const t = await exchangeCode(state.w, code);
    if (state.p === "gsc") {
      // Read-only Search Console access; the properties are chosen per website on the prospect page.
      if (!t.scope.includes("webmasters.readonly")) return done("error=oauth_scope_gsc");
      await saveCredentials(state.w, "SEARCH_CONSOLE", { secret: { refreshToken: t.refreshToken }, accountLabel: t.email, config: {} });
      return done("connected=gsc");
    }
    if (state.p !== "gmail") {
      const p = GOOGLE_PURPOSES[state.p];
      if (!t.scope.split(" ").includes(p.scope)) return done("error=oauth_scope_other");
      await saveCredentials(state.w, p.provider, { secret: { refreshToken: t.refreshToken }, accountLabel: t.email, config: {} });
      return done(`connected=${state.p}`);
    }
    if (!t.scope.includes("gmail.compose")) return done("error=oauth_scope");
    await saveCredentials(state.w, "GMAIL_OAUTH", { secret: { refreshToken: t.refreshToken }, accountLabel: t.email, config: {} });
    return done("connected=gmail");
  } catch (e) {
    await reportError("google-oauth", e instanceof GoogleAuthError ? new Error(e.message) : e);
    return done("error=oauth_failed");
  }
}
