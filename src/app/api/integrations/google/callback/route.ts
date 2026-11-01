import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { getSession, hasRole } from "@/lib/auth";
import { saveCredentials } from "@/lib/integrations";
import { reportError } from "@/lib/log";
import { GoogleAuthError, exchangeCode } from "@/lib/messaging/google-oauth";

const back = (request: NextRequest, q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, request.url));

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasRole(session, "ADMIN")) return back(request, "error=forbidden");
  const jar = await cookies();
  const stored = jar.get("google_oauth_state")?.value ?? "";
  jar.delete("google_oauth_state");
  const [state, workspaceId, purpose = "gmail"] = stored.split(".");
  const got = request.nextUrl.searchParams.get("state") ?? "";
  const valid = state && got.length === state.length && timingSafeEqual(Buffer.from(got), Buffer.from(state)) && workspaceId === session.workspace.id;
  if (!valid) return back(request, "error=oauth_state");
  const error = request.nextUrl.searchParams.get("error");
  if (error) return back(request, `error=${error === "access_denied" ? "oauth_denied" : "oauth_failed"}`);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back(request, "error=oauth_failed");
  try {
    const t = await exchangeCode(session.workspace.id, code);
    if (purpose === "gsc") {
      // Read-only Search Console access; the properties are chosen per website on the prospect page.
      if (!t.scope.includes("webmasters.readonly")) return back(request, "error=oauth_scope_gsc");
      await saveCredentials(session.workspace.id, "SEARCH_CONSOLE", { secret: { refreshToken: t.refreshToken }, accountLabel: t.email, config: {} });
      return back(request, "connected=gsc");
    }
    if (!t.scope.includes("gmail.compose")) return back(request, "error=oauth_scope");
    await saveCredentials(session.workspace.id, "GMAIL_OAUTH", { secret: { refreshToken: t.refreshToken }, accountLabel: t.email, config: {} });
    return back(request, "connected=gmail");
  } catch (e) {
    await reportError("google-oauth", e instanceof GoogleAuthError ? new Error(e.message) : e);
    return back(request, "error=oauth_failed");
  }
}
