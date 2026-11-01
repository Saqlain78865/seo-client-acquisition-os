"use server";

import { GbpError, findPlace } from "@/lib/research/gbp";
import { geminiModel } from "@/lib/ai/provider";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { disconnect, getCredentials, recordTest, saveCredentials, type Provider } from "@/lib/integrations";
import { EmailError, verifySmtp } from "@/lib/messaging/email";
import { revokeToken } from "@/lib/messaging/google-oauth";
import { runPageSpeed } from "@/lib/research/pagespeed";

export type IntegrationState = { ok?: boolean; message?: string; error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

function fail(e: unknown): IntegrationState {
  if (e instanceof ForbiddenError) return { error: "Only owners and admins can manage integrations." };
  if (e instanceof EmailError || e instanceof Error) return { error: e.message };
  return { error: "Something went wrong." };
}

const done = (message: string): IntegrationState => {
  revalidatePath("/integrations");
  return { ok: true, message };
};

// ───────────── Email ─────────────

const gmailSchema = z.object({
  user: z.string().trim().toLowerCase().email("Enter your Gmail address"),
  // Google shows App Passwords as 4 groups of 4 letters; spaces are optional.
  pass: z.string().transform((v) => v.replace(/\s+/g, "")).pipe(z.string().length(16, "An App Password has 16 letters (spaces are fine)")),
  fromName: z.string().trim().max(80).optional(),
});

export async function saveGmailSmtpAction(_: IntegrationState, formData: FormData): Promise<IntegrationState> {
  try {
    const session = await requireRole("ADMIN");
    const parsed = gmailSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    const { user, pass, fromName } = parsed.data;
    await verifySmtp({ host: "smtp.gmail.com", port: 465, secure: true, user, pass });
    await saveCredentials(session.workspace.id, "GMAIL_SMTP", { secret: { user, pass }, config: { fromName: fromName ?? "" }, accountLabel: user });
    await recordTest(session.workspace.id, "GMAIL_SMTP", true);
    return done(`Gmail connected: ${user}. Login verified with Google.`);
  } catch (e) {
    return fail(e);
  }
}

const smtpSchema = z.object({
  host: z.string().trim().min(3, "Enter the SMTP server").max(200),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.literal("on").optional(),
  user: z.string().trim().max(200).optional().default(""),
  pass: z.string().max(500).optional().default(""),
  fromEmail: z.string().trim().email("Enter the sender address"),
  fromName: z.string().trim().max(80).optional(),
});

export async function saveSmtpAction(_: IntegrationState, formData: FormData): Promise<IntegrationState> {
  try {
    const session = await requireRole("ADMIN");
    const parsed = smtpSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    const d = parsed.data;
    const secure = d.secure === "on";
    await verifySmtp({ host: d.host, port: d.port, secure, user: d.user, pass: d.pass });
    await saveCredentials(session.workspace.id, "SMTP", { secret: { user: d.user, pass: d.pass }, config: { host: d.host, port: d.port, secure, fromEmail: d.fromEmail, fromName: d.fromName ?? "" }, accountLabel: d.fromEmail });
    await recordTest(session.workspace.id, "SMTP", true);
    return done(`SMTP connected: ${d.fromEmail}`);
  } catch (e) {
    return fail(e);
  }
}

// ───────────── API keys ─────────────

export async function saveApiKeyAction(provider: "GEMINI" | "PAGESPEED" | "PLACES", _: IntegrationState, formData: FormData): Promise<IntegrationState> {
  try {
    const session = await requireRole("ADMIN");
    const apiKey = String(formData.get("apiKey") ?? "").trim();
    if (apiKey.length < 20 || apiKey.length > 200) return { fieldErrors: { apiKey: ["Paste the full API key"] } };
    if (provider === "GEMINI") {
      // A real (tiny) generation with the model audits will use: listing models can succeed while that model is unavailable.
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the word OK." }] }] }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
        return {
          error:
            res.status === 400 || res.status === 401 || res.status === 403
              ? `Google rejected this Gemini key${detail ? `: ${detail}` : "."} Create a key at aistudio.google.com/apikey.`
              : `Gemini test failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
        };
      }
    } else if (provider === "PLACES") {
      // One real (free-quota) search proves the key works and the Places API is enabled.
      try {
        await findPlace(apiKey, { businessName: "Google Sydney", domain: "google.com", city: "Sydney" });
      } catch (e) {
        if (e instanceof GbpError) return { error: e.message };
        throw e;
      }
    } else {
      await runPageSpeed("https://example.com/", "DESKTOP", fetch, apiKey);
    }
    await saveCredentials(session.workspace.id, provider, { secret: { apiKey }, accountLabel: `Key ending …${apiKey.slice(-4)}` });
    await recordTest(session.workspace.id, provider, true);
    return done(
      provider === "GEMINI" ? "Gemini key verified. New audits will include an AI summary." : provider === "PLACES" ? "Places key verified — Google Business Profiles can now be fetched." : "PageSpeed key verified with a real test.",
    );
  } catch (e) {
    return fail(e);
  }
}

// ───────────── Google sign-in app (OAuth client) ─────────────

const googleAppSchema = z.object({
  clientId: z.string().trim().regex(/^[\w-]+\.apps\.googleusercontent\.com$/, "The Client ID ends with .apps.googleusercontent.com"),
  clientSecret: z.string().trim().min(10, "Paste the full Client Secret").max(200),
});

/** Saves the OAuth client of the user's own Google Cloud project (encrypted), used for Gmail and Search Console sign-in. */
export async function saveGoogleAppAction(_: IntegrationState, formData: FormData): Promise<IntegrationState> {
  try {
    const session = await requireRole("ADMIN");
    const parsed = googleAppSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    await saveCredentials(session.workspace.id, "GOOGLE_OAUTH_APP", { secret: parsed.data, accountLabel: `Client …${parsed.data.clientId.split("-")[1]?.slice(0, 6) ?? ""}` });
    return done("Google sign-in app saved. You can now connect Search Console and Gmail with Google.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────── Test & disconnect ─────────────

export async function testConnectionAction(provider: Provider): Promise<IntegrationState> {
  try {
    const session = await requireRole("ADMIN");
    const ws = session.workspace.id;
    try {
      if (provider === "GMAIL_SMTP") {
        const c = await getCredentials<{ user: string; pass: string }>(ws, provider);
        if (!c) return { error: "Not connected." };
        await verifySmtp({ host: "smtp.gmail.com", port: 465, secure: true, user: c.secret.user, pass: c.secret.pass });
      } else if (provider === "SMTP") {
        const c = await getCredentials<{ user: string; pass: string }>(ws, provider);
        if (!c) return { error: "Not connected." };
        await verifySmtp({ host: c.config.host as string, port: c.config.port as number, secure: !!c.config.secure, user: c.secret.user, pass: c.secret.pass });
      } else {
        return { error: "Re-save the key to test it." };
      }
      await recordTest(ws, provider, true);
      return done("Connection works.");
    } catch (e) {
      await recordTest(ws, provider, false, (e as Error).message);
      revalidatePath("/integrations");
      return { error: (e as Error).message };
    }
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectAction(provider: Provider): Promise<IntegrationState> {
  try {
    const session = await requireRole("ADMIN");
    if (provider === "GMAIL_OAUTH" || provider === "SEARCH_CONSOLE") {
      const c = await getCredentials<{ refreshToken: string }>(session.workspace.id, provider);
      if (c) await revokeToken(c.secret.refreshToken);
    }
    await disconnect(session.workspace.id, provider);
    return done("Disconnected. Stored credentials were deleted.");
  } catch (e) {
    return fail(e);
  }
}
