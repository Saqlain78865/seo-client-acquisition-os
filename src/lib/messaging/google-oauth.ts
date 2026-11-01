import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google OAuth 2.0 for the official Gmail and Search Console APIs. The OAuth client (Client ID +
 * Client Secret of a Google Cloud "Web application" client) is saved encrypted on the Integrations
 * page, or comes from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Each connection asks for one narrow
 * permission: gmail.compose (drafts and sending) or webmasters.readonly (read Search Console).
 */

export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.compose"];
export const SEARCH_CONSOLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"];
export type GoogleClient = { id: string; secret: string };
export type GooglePurpose = "gmail" | "gsc";

/**
 * Sign-in state signed with the app's key. In the desktop app Google sign-in runs in the system
 * browser (Google blocks sign-in inside embedded app windows), where the app's cookies do not
 * exist — so the state itself carries who started it, and expires after 15 minutes.
 */
export type OAuthState = { w: string; u: string; p: GooglePurpose };
const stateKey = () => createHmac("sha256", process.env.ENCRYPTION_KEY ?? "").update("google-oauth-state").digest();

export function signState(s: OAuthState) {
  const body = Buffer.from(JSON.stringify({ ...s, e: Date.now() + 15 * 60_000, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${createHmac("sha256", stateKey()).update(body).digest("base64url")}`;
}

export function readState(state: string): OAuthState | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", stateKey()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState & { e: number };
    return s.e > Date.now() && (s.p === "gmail" || s.p === "gsc") ? { w: s.w, u: s.u, p: s.p } : null;
  } catch {
    return null;
  }
}

/** The OAuth client saved for the workspace, else the one from the environment. */
export async function googleClient(workspaceId: string): Promise<GoogleClient | null> {
  const { getCredentials } = await import("../integrations");
  const saved = await getCredentials<{ clientId: string; clientSecret: string }>(workspaceId, "GOOGLE_OAUTH_APP");
  if (saved?.secret.clientId && saved.secret.clientSecret) return { id: saved.secret.clientId, secret: saved.secret.clientSecret };
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

async function requireClient(workspaceId: string) {
  const c = await googleClient(workspaceId);
  if (!c) throw new GoogleAuthError("Google sign-in is not set up: add the OAuth Client ID and Secret on the Integrations page.", "NOT_CONFIGURED");
  return c;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "EXCHANGE_FAILED" | "REVOKED" | "API_ERROR" | "RATE_LIMITED",
  ) {
    super(message);
  }
}


export function redirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/google/callback`;
}

export function buildAuthUrl(state: string, client: GoogleClient, purpose: GooglePurpose = "gmail") {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", client.id);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", (purpose === "gsc" ? SEARCH_CONSOLE_SCOPES : GMAIL_SCOPES).join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(client: GoogleClient, params: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) {
    if (body.error === "invalid_grant") throw new GoogleAuthError("Google access was revoked or expired. Reconnect it on the Integrations page.", "REVOKED");
    throw new GoogleAuthError(`Google token request failed: ${body.error_description ?? body.error ?? res.status}`, "EXCHANGE_FAILED");
  }
  return body;
}

export async function exchangeCode(workspaceId: string, code: string, fetchImpl: typeof fetch = fetch) {
  const t = await tokenRequest(await requireClient(workspaceId), { code, grant_type: "authorization_code", redirect_uri: redirectUri() }, fetchImpl);
  if (!t.refresh_token) throw new GoogleAuthError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.", "EXCHANGE_FAILED");
  const info = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } });
  const user = (await info.json().catch(() => ({}))) as { email?: string };
  return { refreshToken: t.refresh_token, accessToken: t.access_token, email: user.email ?? null, scope: t.scope ?? "" };
}

export async function accessTokenFor(workspaceId: string, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return (await tokenRequest(await requireClient(workspaceId), { refresh_token: refreshToken, grant_type: "refresh_token" }, fetchImpl)).access_token;
}

async function gmailCall(path: string, accessToken: string, body: unknown, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: { id?: string }; error?: { message?: string; status?: string } };
  if (res.status === 401) throw new GoogleAuthError("Gmail access expired or was revoked. Reconnect Gmail.", "REVOKED");
  if (res.status === 429) throw new GoogleAuthError("Gmail sending limit reached. Try again later.", "RATE_LIMITED");
  if (!res.ok) throw new GoogleAuthError(`Gmail API error: ${json.error?.message ?? res.status}`, "API_ERROR");
  return json;
}

export async function gmailSend(workspaceId: string, refreshToken: string, rawMime: Buffer, fetchImpl: typeof fetch = fetch) {
  const token = await accessTokenFor(workspaceId, refreshToken, fetchImpl);
  const r = await gmailCall("messages/send", token, { raw: rawMime.toString("base64url") }, fetchImpl);
  return r.id!;
}

export async function gmailCreateDraft(workspaceId: string, refreshToken: string, rawMime: Buffer, fetchImpl: typeof fetch = fetch) {
  const token = await accessTokenFor(workspaceId, refreshToken, fetchImpl);
  const r = await gmailCall("drafts", token, { message: { raw: rawMime.toString("base64url") } }, fetchImpl);
  return r.id!;
}

export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch) {
  await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}
