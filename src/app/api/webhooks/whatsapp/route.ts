import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { applyWhatsAppStatuses } from "@/lib/messaging/service";
import { parseStatusWebhook, verifyWebhookSignature } from "@/lib/messaging/whatsapp";

/** Meta's verification handshake: echo hub.challenge when the verify token matches a connected workspace. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get("hub.mode") !== "subscribe") return new NextResponse("Bad request", { status: 400 });
  const token = p.get("hub.verify_token") ?? "";
  const rows = await db.integrationConnection.findMany({ where: { provider: "WHATSAPP_CLOUD" } });
  const match = rows.some((r) => token.length > 10 && (r.config as { verifyToken?: string } | null)?.verifyToken === token);
  return match ? new NextResponse(p.get("hub.challenge") ?? "", { status: 200 }) : new NextResponse("Forbidden", { status: 403 });
}

/** Delivery status updates. The payload is accepted only with a valid signature from the matching app secret. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return new NextResponse("Too large", { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const phoneIds = new Set<string>();
  for (const e of (payload as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] }).entry ?? [])
    for (const c of e.changes ?? []) if (c.value?.metadata?.phone_number_id) phoneIds.add(c.value.metadata.phone_number_id);

  const rows = await db.integrationConnection.findMany({ where: { provider: "WHATSAPP_CLOUD", encryptedSecret: { not: null } } });
  const signature = request.headers.get("x-hub-signature-256");
  const trusted = rows.some((r) => {
    if (!phoneIds.has(String((r.config as { phoneNumberId?: string } | null)?.phoneNumberId))) return false;
    const secret = (JSON.parse(decryptSecret(r.encryptedSecret!)) as { appSecret?: string }).appSecret;
    return !!secret && verifyWebhookSignature(raw, signature, secret);
  });
  if (!trusted) return new NextResponse("Invalid signature", { status: 401 });
  await applyWhatsAppStatuses(parseStatusWebhook(payload));
  return NextResponse.json({ ok: true });
}
