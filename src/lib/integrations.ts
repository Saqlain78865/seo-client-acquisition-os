import "server-only";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Integration credentials live encrypted in IntegrationConnection.encryptedSecret and are only
 * decrypted on the server at the moment they are used. Non-secret settings go in `config`.
 */

export const PROVIDERS = {
  GMAIL_SMTP: { name: "Gmail (App Password)", group: "Email" },
  GMAIL_OAUTH: { name: "Gmail (Google sign-in / Gmail API)", group: "Email" },
  SMTP: { name: "Other email (SMTP)", group: "Email" },
  WHATSAPP_CLOUD: { name: "WhatsApp Business Platform (Cloud API)", group: "WhatsApp" },
  GEMINI: { name: "Google Gemini (AI writing)", group: "AI" },
  PAGESPEED: { name: "PageSpeed Insights", group: "Research" },
  PLACES: { name: "Google Places (Business Profile data)", group: "Research" },
} as const;
export type Provider = keyof typeof PROVIDERS;

export type ConnectionView = {
  provider: Provider;
  status: "NOT_CONFIGURED" | "CONNECTED" | "ERROR" | "DISCONNECTED";
  accountLabel: string | null;
  config: Record<string, unknown>;
  lastTestedAt: Date | null;
  lastError: string | null;
  hasSecret: boolean;
};

/** Safe for the browser: never includes secrets. */
export async function listConnections(workspaceId: string): Promise<Record<Provider, ConnectionView>> {
  const rows = await db.integrationConnection.findMany({ where: { workspaceId } });
  const out = {} as Record<Provider, ConnectionView>;
  for (const p of Object.keys(PROVIDERS) as Provider[]) {
    const r = rows.find((x) => x.provider === p);
    out[p] = {
      provider: p,
      status: (r?.status as ConnectionView["status"]) ?? "NOT_CONFIGURED",
      accountLabel: r?.accountLabel ?? null,
      config: (r?.config as Record<string, unknown>) ?? {},
      lastTestedAt: r?.lastTestedAt ?? null,
      lastError: r?.lastError ?? null,
      hasSecret: !!r?.encryptedSecret,
    };
  }
  return out;
}

export async function getCredentials<T extends Record<string, string>>(workspaceId: string, provider: Provider): Promise<{ secret: T; config: Record<string, unknown>; accountLabel: string | null; status: string } | null> {
  const r = await db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  if (!r?.encryptedSecret || r.status === "DISCONNECTED") return null;
  return { secret: JSON.parse(decryptSecret(r.encryptedSecret)) as T, config: (r.config as Record<string, unknown>) ?? {}, accountLabel: r.accountLabel, status: r.status };
}

export async function saveCredentials(workspaceId: string, provider: Provider, input: { secret?: Record<string, string>; config?: Record<string, unknown>; accountLabel?: string | null; status?: ConnectionView["status"] }) {
  const data = {
    ...(input.secret ? { encryptedSecret: encryptSecret(JSON.stringify(input.secret)) } : {}),
    ...(input.config ? { config: input.config as object } : {}),
    ...(input.accountLabel !== undefined ? { accountLabel: input.accountLabel } : {}),
    status: input.status ?? "CONNECTED",
    lastError: null,
  };
  return db.integrationConnection.upsert({
    where: { workspaceId_provider: { workspaceId, provider } },
    create: { workspaceId, provider, ...data },
    update: data,
  });
}

export async function recordTest(workspaceId: string, provider: Provider, ok: boolean, error?: string, accountLabel?: string) {
  await db.integrationConnection.update({
    where: { workspaceId_provider: { workspaceId, provider } },
    data: { lastTestedAt: new Date(), status: ok ? "CONNECTED" : "ERROR", lastError: ok ? null : (error ?? "Test failed").slice(0, 500), ...(accountLabel ? { accountLabel } : {}), ...(ok ? { lastSyncAt: new Date() } : {}) },
  });
}

/** Removes stored credentials entirely (the row stays so history shows it was disconnected). */
export async function disconnect(workspaceId: string, provider: Provider) {
  await db.integrationConnection.updateMany({
    where: { workspaceId, provider },
    data: { encryptedSecret: null, status: "DISCONNECTED", lastError: null },
  });
}

/** Workspace key first, then environment variable. */
export type ApiKeyProvider = "GEMINI" | "PAGESPEED" | "PLACES";

export async function getApiKey(workspaceId: string | null, provider: ApiKeyProvider): Promise<string | null> {
  if (workspaceId) {
    const c = await getCredentials<{ apiKey: string }>(workspaceId, provider);
    if (c?.secret.apiKey) return c.secret.apiKey;
  }
  const env = { GEMINI: process.env.GEMINI_API_KEY, PAGESPEED: process.env.PAGESPEED_API_KEY, PLACES: process.env.GOOGLE_PLACES_API_KEY }[provider]?.trim();
  if (env) return env;
  // A Google Cloud key often serves several Google APIs: the PageSpeed key is tried for Places too.
  return provider === "PLACES" ? getApiKey(workspaceId, "PAGESPEED") : null;
}
