import "server-only";

/**
 * Google OAuth 2.0 for the official Gmail API. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
 * from a Google Cloud project (OAuth consent screen + Web client with the redirect URI below).
 * Scope gmail.compose allows creating drafts and sending — nothing else in the mailbox.
 */

export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.compose"];

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "EXCHANGE_FAILED" | "REVOKED" | "API_ERROR" | "RATE_LIMITED",
  ) {
    super(message);
  }
}

export function googleOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/google/callback`;
}

export function buildAuthUrl(state: string) {
  if (!googleOAuthConfigured()) throw new GoogleAuthError("Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", "NOT_CONFIGURED");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) {
    if (body.error === "invalid_grant") throw new GoogleAuthError("Google access was revoked or expired. Reconnect Gmail.", "REVOKED");
    throw new GoogleAuthError(`Google token request failed: ${body.error_description ?? body.error ?? res.status}`, "EXCHANGE_FAILED");
  }
  return body;
}

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() }, fetchImpl);
  if (!t.refresh_token) throw new GoogleAuthError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.", "EXCHANGE_FAILED");
  const info = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } });
  const user = (await info.json().catch(() => ({}))) as { email?: string };
  return { refreshToken: t.refresh_token, accessToken: t.access_token, email: user.email ?? null, scope: t.scope ?? "" };
}

export async function accessTokenFor(refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return (await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }, fetchImpl)).access_token;
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

export async function gmailSend(refreshToken: string, rawMime: Buffer, fetchImpl: typeof fetch = fetch) {
  const token = await accessTokenFor(refreshToken, fetchImpl);
  const r = await gmailCall("messages/send", token, { raw: rawMime.toString("base64url") }, fetchImpl);
  return r.id!;
}

export async function gmailCreateDraft(refreshToken: string, rawMime: Buffer, fetchImpl: typeof fetch = fetch) {
  const token = await accessTokenFor(refreshToken, fetchImpl);
  const r = await gmailCall("drafts", token, { message: { raw: rawMime.toString("base64url") } }, fetchImpl);
  return r.id!;
}

export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch) {
  await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}
