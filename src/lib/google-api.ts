import "server-only";
import { getCredentials, type Provider } from "./integrations";
import { GoogleAuthError, accessTokenFor } from "./messaging/google-oauth";

/** An access token for one of the Google connections (Calendar, Drive, reply detection), or null when not connected. */
export async function googleToken(workspaceId: string, provider: Extract<Provider, "GMAIL_REPLIES" | "GOOGLE_CALENDAR" | "GOOGLE_DRIVE">, fetchImpl: typeof fetch = fetch) {
  const c = await getCredentials<{ refreshToken: string }>(workspaceId, provider);
  if (!c || c.status !== "CONNECTED" || !c.secret.refreshToken) return null;
  try {
    return await accessTokenFor(workspaceId, c.secret.refreshToken, fetchImpl);
  } catch (e) {
    if (e instanceof GoogleAuthError) throw new GoogleApiError(`${e.message} Reconnect it on the Integrations page.`);
    throw e;
  }
}

export class GoogleApiError extends Error {}

/** JSON call to a Google API with a bearer token; Google's own message is passed on. */
export async function googleJson<T>(tok: string, url: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { authorization: `Bearer ${tok}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403 && /has not been used|is disabled/i.test(msg)) throw new GoogleApiError(`This Google API is not enabled in your Google Cloud project: ${msg}`);
    throw new GoogleApiError(`Google: ${msg}`);
  }
  return json;
}
