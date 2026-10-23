import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp helpers.
 * - Click-to-chat (wa.me) opens WhatsApp with a pre-filled message; the person presses Send. No API.
 * - The official WhatsApp Business Platform (Cloud API) sends approved template messages from a
 *   registered business number. Business-initiated messages outside a 24-hour customer service
 *   window must use an approved template.
 * Unofficial WhatsApp Web automation is deliberately not supported.
 */

export const GRAPH_VERSION = "v21.0";

/** Digits only with country code, as WhatsApp expects (no "+", no leading zeros). */
export function toWaNumber(phone: string): string | null {
  const t = phone.trim();
  let digits = t.replace(/\D/g, "");
  if (t.startsWith("00")) digits = digits.slice(2);
  if (!t.startsWith("+") && !t.startsWith("00")) return null; // national numbers are ambiguous without a country code
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function clickToChatUrl(phone: string, text: string) {
  const n = toWaNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "INVALID_NUMBER" | "TOKEN" | "PERMISSION" | "TEMPLATE" | "WINDOW" | "RATE_LIMITED" | "UNDELIVERABLE" | "MEDIA" | "OUTAGE" | "OTHER",
    readonly recovery: string,
  ) {
    super(message);
  }
}

/** Maps Graph API errors (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) to clear recovery steps. */
export function mapGraphError(e: { code?: number; error_subcode?: number; message?: string; error_data?: { details?: string } }): WhatsAppError {
  const code = e.code ?? 0;
  const msg = e.error_data?.details ?? e.message ?? "Unknown WhatsApp error";
  if (code === 190) return new WhatsAppError("The WhatsApp access token has expired or is invalid.", "TOKEN", "Create a new permanent (System User) token in Meta Business Settings and save it on the Integrations page.");
  if (code === 10 || code === 200 || code === 3) return new WhatsAppError("The token does not have permission to send messages.", "PERMISSION", "Grant whatsapp_business_messaging and whatsapp_business_management to the System User and regenerate the token.");
  if (code === 131030 || code === 131026 || code === 131021) return new WhatsAppError(`The recipient cannot receive this message: ${msg}`, "UNDELIVERABLE", "Check the number is correct, has WhatsApp, and (for test numbers) is on your allowed recipient list.");
  if (code === 131047) return new WhatsAppError("More than 24 hours have passed since the customer last messaged you.", "WINDOW", "Send an approved template message instead of free text.");
  if (code === 132000 || code === 132001 || code === 132005 || code === 132007 || code === 132012) return new WhatsAppError(`Template problem: ${msg}`, "TEMPLATE", "Check the template name, language code and number of variables match the approved template in WhatsApp Manager.");
  if (code === 131052 || code === 131053) return new WhatsAppError(`The attachment could not be used: ${msg}`, "MEDIA", "Make sure the proposal share link is public (not expired) and the PDF is under 100 MB.");
  if (code === 4 || code === 80007 || code === 130429 || code === 131056) return new WhatsAppError("WhatsApp rate limit reached.", "RATE_LIMITED", "Wait a few minutes and try again.");
  if (code === 1 || code === 2 || code === 131000 || code === 131016) return new WhatsAppError("WhatsApp is temporarily unavailable.", "OUTAGE", "Try again later; check the Meta status page if it persists.");
  return new WhatsAppError(msg.slice(0, 300), "OTHER", "Check the integration settings and Meta's error details.");
}

export type CloudConfig = { phoneNumberId: string; templateName: string; templateLanguage: string; bodyParams: string[]; headerDocument: boolean; graphBase?: string };

/**
 * Sends an approved template. `bodyParams` are already-rendered values for {{1}}, {{2}}…; if the
 * template has a document header, the proposal PDF is attached by public link.
 */
export async function sendTemplateMessage(
  token: string,
  cfg: CloudConfig,
  to: string,
  values: { bodyParams: string[]; documentUrl?: string | null; documentFilename?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const n = toWaNumber(to);
  if (!n) throw new WhatsAppError("The WhatsApp number must include the country code (e.g. +92…).", "INVALID_NUMBER", "Edit the contact and add the international code.");
  const components: unknown[] = [];
  if (cfg.headerDocument) {
    if (!values.documentUrl) throw new WhatsAppError("This template needs the proposal PDF, but there is no active share link.", "MEDIA", "Create a share link on the proposal page first.");
    components.push({ type: "header", parameters: [{ type: "document", document: { link: values.documentUrl, filename: values.documentFilename ?? "proposal.pdf" } }] });
  }
  if (values.bodyParams.length) components.push({ type: "body", parameters: values.bodyParams.map((text) => ({ type: "text", text: text.slice(0, 1000) })) });
  const base = cfg.graphBase ?? `https://graph.facebook.com/${GRAPH_VERSION}`;
  let res: Response;
  try {
    res = await fetchImpl(`${base}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: n, type: "template", template: { name: cfg.templateName, language: { code: cfg.templateLanguage }, components } }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new WhatsAppError(`Could not reach WhatsApp: ${(e as Error).message}`, "OUTAGE", "Check your internet connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: Parameters<typeof mapGraphError>[0] };
  if (!res.ok || body.error) throw mapGraphError(body.error ?? { message: `HTTP ${res.status}` });
  const id = body.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp did not return a message id.", "OTHER", "Try again; if it repeats, check the integration.");
  return id;
}

export async function testCloudConnection(token: string, phoneNumberId: string, fetchImpl: typeof fetch = fetch, graphBase = `https://graph.facebook.com/${GRAPH_VERSION}`) {
  const res = await fetchImpl(`${graphBase}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: Parameters<typeof mapGraphError>[0] };
  if (!res.ok || body.error) throw mapGraphError(body.error ?? { message: `HTTP ${res.status}` });
  return `${body.verified_name ?? "WhatsApp Business"} (${body.display_phone_number ?? phoneNumberId})`;
}

/** Validates Meta's X-Hub-Signature-256 header for webhook payloads. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type StatusUpdate = { messageId: string; status: "SENT" | "DELIVERED" | "READ" | "FAILED"; error?: string; timestamp?: Date };

export function parseStatusWebhook(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { statuses?: { id: string; status: string; timestamp?: string; errors?: { title?: string; message?: string }[] }[] } }[] }[] })?.entry ?? [];
  for (const e of entries)
    for (const c of e.changes ?? [])
      for (const s of c.value?.statuses ?? []) {
        const status = s.status?.toUpperCase();
        if (status === "SENT" || status === "DELIVERED" || status === "READ" || status === "FAILED") {
          out.push({ messageId: s.id, status, error: s.errors?.map((x) => x.message ?? x.title).join("; "), timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000) : undefined });
        }
      }
  return out;
}
