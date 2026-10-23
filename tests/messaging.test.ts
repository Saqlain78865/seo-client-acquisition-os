import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { addContact, createProspect } from "@/lib/prospects";
import { createProposal } from "@/lib/proposals/service";
import { getCredentials, saveCredentials } from "@/lib/integrations";
import { renderTemplate, summariseFindings } from "@/lib/messaging/templates";
import { clickToChatUrl, mapGraphError, parseStatusWebhook, toWaNumber, verifyWebhookSignature } from "@/lib/messaging/whatsapp";
import { createShareLink, recordShareView, resolveShareToken, respondToProposal, revokeShareLink } from "@/lib/messaging/share";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";
import { applyWhatsAppStatuses, confirmClickToChatSent, loadComposeContext, openClickToChat, sendProposalEmail, sendWhatsAppCloud, SendError, type EmailSendInput } from "@/lib/messaging/service";

describe("templates", () => {
  it("fills placeholders and reports missing or unknown ones", () => {
    const r = renderTemplate("Hi {{clientName}}, see {{proposalLink}} {{foo}}", { clientName: "Ali", proposalLink: "" });
    expect(r.text).toBe("Hi Ali, see {{proposalLink}} {{foo}}");
    expect(r.missing).toEqual(["proposalLink"]);
    expect(r.unknown).toEqual(["foo"]);
    expect(summariseFindings(["Slow mobile pages", "Duplicate titles", "x"])).toBe("I found 3 specific improvements, including slow mobile pages and duplicate titles.");
  });
});

describe("WhatsApp helpers", () => {
  it("requires international numbers", () => {
    expect(toWaNumber("+92 300 1234567")).toBe("923001234567");
    expect(toWaNumber("0092 300 1234567")).toBe("923001234567");
    expect(toWaNumber("0300 1234567")).toBeNull();
    expect(clickToChatUrl("+44 7700 900123", "Hi & bye")).toBe("https://wa.me/447700900123?text=Hi%20%26%20bye");
  });
  it("maps Graph errors to recovery steps", () => {
    expect(mapGraphError({ code: 190 }).code).toBe("TOKEN");
    expect(mapGraphError({ code: 131047 }).code).toBe("WINDOW");
    expect(mapGraphError({ code: 132001, message: "Template name does not exist" }).recovery).toMatch(/template name/i);
    expect(mapGraphError({ code: 130429 }).code).toBe("RATE_LIMITED");
  });
  it("verifies webhook signatures and parses statuses", () => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "read", timestamp: "1700000000" }, { id: "x", status: "weird" }] } }] }] });
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, "secret")).toBe(true);
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false);
    expect(verifyWebhookSignature(body + " ", sig, "secret")).toBe(false);
    expect(parseStatusWebhook(JSON.parse(body))).toEqual([{ messageId: "wamid.1", status: "READ", error: undefined, timestamp: new Date(1700000000_000) }]);
  });
});

describe("sending (database + local SMTP server)", () => {
  const received: string[] = [];
  let smtp: SMTPServer;
  let port: number;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth: (auth, _s, cb) => (auth.password === "right-password" ? cb(null, { user: auth.username }) : cb(new Error("Invalid login"))),
      onData: (stream, _s, cb) => {
        let raw = "";
        stream.on("data", (c) => (raw += c.toString()));
        stream.on("end", () => {
          received.push(raw);
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
    port = (smtp.server.address() as AddressInfo).port;
    const user = await db.user.create({ data: { email: `msg${Date.now()}@test.example`, name: "M", passwordHash: "x" } });
    userId = user.id;
    workspaceId = (await createWorkspace("Messaging WS", user.id)).id;
    await db.workspaceSettings.update({ where: { workspaceId }, data: { consultantName: "Saqlain", companyName: "Nova SEO", followUpDefaultDays: "3,7" } });
    await saveCredentials(workspaceId, "SMTP", { secret: { user: "me@nova.example", pass: "right-password" }, config: { host: "127.0.0.1", port, secure: false, fromEmail: "me@nova.example", fromName: "Saqlain" }, accountLabel: "me@nova.example" });
  });
  afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

  async function newProposal(email = "owner@client.example", verified = true) {
    const p = await createProspect(workspaceId, userId, { businessName: `Client ${Math.random().toString(36).slice(2, 7)}`, websiteUrl: `c${Date.now()}${Math.random().toString(36).slice(2, 5)}.example`, currency: "USD", contactName: "Sara Khan", email: verified ? email : undefined });
    if (!verified) await addContact(p.id, { type: "EMAIL", value: email });
    if (!verified) await db.prospectContact.updateMany({ where: { prospectId: p.id, type: "EMAIL" }, data: { verified: false } });
    const proposal = await createProposal(workspaceId, userId, { prospectId: p.id });
    return { prospect: p, proposal };
  }

  const input = (proposalId: string, patch: Partial<EmailSendInput> = {}): EmailSendInput => ({
    proposalId,
    version: 1,
    to: "owner@client.example",
    cc: [],
    bcc: [],
    subject: "SEO proposal",
    body: "Hi Sara,\n\nPlease find the proposal attached.",
    idempotencyKey: `k-${proposalId}`,
    scheduleFollowUps: true,
    confirmUnverified: false,
    ...patch,
  });

  it("stores credentials encrypted", async () => {
    const row = await db.integrationConnection.findFirstOrThrow({ where: { workspaceId, provider: "SMTP" } });
    expect(row.encryptedSecret).not.toContain("right-password");
    expect((await getCredentials<{ pass: string }>(workspaceId, "SMTP"))!.secret.pass).toBe("right-password");
  });

  it("sends once with the PDF attached, locks the version and schedules reminders", async () => {
    const { prospect, proposal } = await newProposal();
    const before = received.length;
    const r = await sendProposalEmail(workspaceId, userId, input(proposal.id));
    expect(r.duplicate).toBe(false);
    expect(r.delivery.status).toBe("ACCEPTED");
    expect(r.delivery.channelMethod).toBe("SMTP");
    expect(r.delivery.providerMessageId).toBeTruthy();
    expect(r.followUps).toBe(2);
    expect(received.length).toBe(before + 1);
    const raw = received.at(-1)!;
    expect(raw).toContain("Subject: SEO proposal");
    expect(raw).toMatch(/filename="?SEO-Proposal-Client-.*-v1\.pdf/);
    expect(raw).toContain("Content-Type: application/pdf");

    expect((await db.proposalVersion.findFirstOrThrow({ where: { proposalId: proposal.id, version: 1 } })).locked).toBe(true);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("SENT");
    expect((await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe("PROPOSAL_SENT");
    expect(await db.followUp.count({ where: { prospectId: prospect.id, type: "PROPOSAL_REMINDER" } })).toBe(2);
    expect(r.delivery.bodySha256).toHaveLength(64);

    // Retrying the same request never sends a second email.
    const again = await sendProposalEmail(workspaceId, userId, input(proposal.id));
    expect(again.duplicate).toBe(true);
    expect(received.length).toBe(before + 1);
  }, 60_000);

  it("blocks unverified recipients, opt-outs and unfilled placeholders", async () => {
    const { prospect, proposal } = await newProposal("new@client.example", false);
    await expect(sendProposalEmail(workspaceId, userId, input(proposal.id, { to: "new@client.example" }))).rejects.toThrow(/not been verified/);
    await expect(sendProposalEmail(workspaceId, userId, input(proposal.id, { to: "stranger@else.example" }))).rejects.toThrow(/not one of this prospect/);
    await expect(sendProposalEmail(workspaceId, userId, input(proposal.id, { to: "new@client.example", confirmUnverified: true, body: "Link: {{proposalLink}}" }))).rejects.toThrow(/placeholders/);
    await db.prospect.update({ where: { id: prospect.id }, data: { doNotContact: true, doNotContactReason: "Asked not to be contacted" } });
    await expect(sendProposalEmail(workspaceId, userId, input(proposal.id, { to: "new@client.example", confirmUnverified: true }))).rejects.toThrow(/opted out/);
    expect(await db.emailDelivery.count({ where: { proposalId: proposal.id } })).toBe(0);
  });

  it("records a failed send without locking or marking sent", async () => {
    const { proposal } = await newProposal("fail@client.example");
    await saveCredentials(workspaceId, "SMTP", { secret: { user: "me@nova.example", pass: "wrong" } });
    await expect(sendProposalEmail(workspaceId, userId, input(proposal.id, { to: "fail@client.example" }))).rejects.toThrow(SendError);
    const d = await db.emailDelivery.findFirstOrThrow({ where: { proposalId: proposal.id } });
    expect(d.status).toBe("FAILED");
    expect(d.error).toMatch(/rejected the login/);
    expect((await db.proposalVersion.findFirstOrThrow({ where: { proposalId: proposal.id } })).locked).toBe(false);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");
    // Fix the password and retry with the same key: the same delivery row succeeds.
    await saveCredentials(workspaceId, "SMTP", { secret: { user: "me@nova.example", pass: "right-password" } });
    const ok = await sendProposalEmail(workspaceId, userId, input(proposal.id, { to: "fail@client.example" }));
    expect(ok.delivery.id).toBe(d.id);
    expect(ok.delivery.attempts).toBe(2);
  }, 60_000);

  it("share links lock the version, expire and can be revoked", async () => {
    const { proposal } = await newProposal("share@client.example");
    const { url } = await createShareLink(workspaceId, userId, proposal.id, 7);
    const token = url.split("/p/")[1];
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect((await resolveShareToken(token))!.id).toBe(proposal.id);
    expect((await db.proposalVersion.findFirstOrThrow({ where: { proposalId: proposal.id } })).locked).toBe(true);
    expect(await resolveShareToken("not-a-real-token-but-long-enough")).toBeNull();
    await db.proposal.update({ where: { id: proposal.id }, data: { shareExpiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveShareToken(token)).toBeNull();
    await createShareLink(workspaceId, userId, proposal.id, 7);
    const t2 = (await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).shareToken!;
    await revokeShareLink(workspaceId, userId, proposal.id);
    expect(await resolveShareToken(t2)).toBeNull();
  });

  it("alerts the team when the client opens, asks or accepts on the share link", async () => {
    const { prospect, proposal } = await newProposal("accept@client.example");
    const { url } = await createShareLink(workspaceId, userId, proposal.id, 7);
    const token = url.split("/p/")[1];
    await db.followUp.create({ data: { workspaceId, prospectId: prospect.id, proposalId: proposal.id, type: "PROPOSAL_REMINDER", dueAt: new Date(Date.now() + 86400_000) } });

    await recordShareView(proposal.id);
    await recordShareView(proposal.id); // within 6 hours: counted, but no second alert
    // The alert opens the composer with a ready follow-up draft, and one reminder is scheduled for tomorrow.
    const opened = await db.notification.findMany({ where: { workspaceId, link: `/proposals/${proposal.id}/send?followup=1` } });
    expect(opened).toHaveLength(1);
    expect(opened[0].title).toMatch(/opened your proposal/);
    expect(opened[0].body).toMatch(/follow-up email draft is ready/);
    const nudges = await db.followUp.findMany({ where: { proposalId: proposal.id, type: "OPENED_NO_REPLY" } });
    expect(nudges).toHaveLength(1);
    expect(nudges[0].dueAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).nextFollowUpAt).not.toBeNull();

    const ctx = (await loadComposeContext(workspaceId, proposal.id))!;
    expect(ctx.followUp.subject).toBe(`Quick follow-up: SEO proposal for ${prospect.businessName}`);
    expect(ctx.followUp.email).toMatch(/^Hi Sara,/);
    expect(ctx.followUp.email).toContain(url);
    expect(ctx.followUp.email).not.toMatch(/opened|viewed/i);
    expect(ctx.followUp.whatsapp).toContain(url);

    await expect(respondToProposal(token, { kind: "QUESTION", name: "S" })).rejects.toThrow(/name/);
    await respondToProposal(token, { kind: "QUESTION", name: "Sara Khan", contact: "sara@client.example", message: "Can we start next month?" });
    await respondToProposal(token, { kind: "ACCEPT", name: "Sara Khan", message: "Let's go" });
    expect((await respondToProposal(token, { kind: "ACCEPT", name: "Sara Khan" })).alreadyAccepted).toBe(true);

    const p = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { responses: true, prospect: true, followUps: true } });
    expect(p.status).toBe("ACCEPTED");
    expect(p.acceptedAt).not.toBeNull();
    expect(p.responses.map((r) => r.kind).sort()).toEqual(["ACCEPT", "QUESTION"]);
    // Accepting online records the deal as won and prepares the onboarding steps.
    expect(p.prospect.status).toBe("WON");
    const deal = await db.deal.findFirstOrThrow({ where: { prospectId: prospect.id } });
    expect(deal.stage).toBe("WON");
    expect(deal.proposalId).toBe(proposal.id);
    const tasks = await db.kickoffTask.findMany({ where: { prospectId: prospect.id }, orderBy: { sortOrder: "asc" } });
    expect(tasks.length).toBeGreaterThan(5);
    expect(tasks[0].title).toMatch(/welcome/i);
    expect(tasks.every((t) => t.dealId === deal.id)).toBe(true);
    expect(p.followUps.every((f) => f.status === "CANCELLED")).toBe(true);
    const titles = (await db.notification.findMany({ where: { workspaceId, link: { in: [`/proposals/${proposal.id}`, `/prospects/${prospect.id}`] } } })).map((n) => n.title).join("\n");
    expect(titles).toMatch(/sent a question/);
    expect(titles).toMatch(/accepted your proposal/);

    const { items, unread } = await listNotifications(workspaceId, userId);
    expect(unread).toBeGreaterThanOrEqual(3);
    expect(items[0].readAt).toBeNull();
    await markNotificationsRead(workspaceId, userId);
    expect((await listNotifications(workspaceId, userId)).unread).toBe(0);

    await revokeShareLink(workspaceId, userId, proposal.id);
    await expect(respondToProposal(token, { kind: "QUESTION", name: "Sara Khan", message: "Hello?" })).rejects.toThrow(/no longer active/);
  });

  it("click-to-chat is only 'sent' after the user confirms", async () => {
    const { prospect, proposal } = await newProposal("wa@client.example");
    await addContact(prospect.id, { type: "WHATSAPP", value: "+92 300 1234567" });
    const { url, delivery } = await openClickToChat(workspaceId, userId, { proposalId: proposal.id, version: 1, to: "+923001234567", message: "Hi Sara", idempotencyKey: `wa-${proposal.id}`, scheduleFollowUps: false, confirmUnverified: false });
    expect(url).toBe("https://wa.me/923001234567?text=Hi%20Sara");
    expect(delivery.status).toBe("MANUAL_OPENED");
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");
    await confirmClickToChatSent(workspaceId, userId, delivery.id, false);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("SENT");
  });

  it("sends a Cloud API template, maps errors, and applies webhook statuses forward only", async () => {
    const { prospect, proposal } = await newProposal("cloud@client.example");
    await addContact(prospect.id, { type: "WHATSAPP", value: "+447700900123" });
    await saveCredentials(workspaceId, "WHATSAPP_CLOUD", { secret: { accessToken: "EAAG-test" }, config: { phoneNumberId: "1234", templateName: "proposal_intro", templateLanguage: "en", bodyParams: ["{{clientName}}", "{{businessName}}"], headerDocument: false } });
    let sentBody: { template: { name: string; components: { parameters: { text: string }[] }[] }; to: string } | null = null;
    const ok = (async (_u: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.ABC" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const base = { proposalId: proposal.id, version: 1, to: "+447700900123", message: "", idempotencyKey: `cloud-${proposal.id}`, scheduleFollowUps: false, confirmUnverified: false };
    const r = await sendWhatsAppCloud(workspaceId, userId, base, ok);
    expect(r.delivery.status).toBe("ACCEPTED");
    expect(sentBody!.to).toBe("447700900123");
    expect(sentBody!.template.name).toBe("proposal_intro");
    expect(sentBody!.template.components[0].parameters.map((p) => p.text)).toEqual(["Sara", prospect.businessName]);

    await applyWhatsAppStatuses([{ messageId: "wamid.ABC", status: "READ" }]);
    await applyWhatsAppStatuses([{ messageId: "wamid.ABC", status: "DELIVERED" }]);
    expect((await db.whatsAppDelivery.findFirstOrThrow({ where: { providerMessageId: "wamid.ABC" } })).status).toBe("READ");

    const { proposal: p2, prospect: pr2 } = await newProposal("cloud2@client.example");
    await addContact(pr2.id, { type: "WHATSAPP", value: "+447700900124" });
    const expired = (async () => new Response(JSON.stringify({ error: { code: 190, message: "Error validating access token" } }), { status: 401 })) as unknown as typeof fetch;
    await expect(sendWhatsAppCloud(workspaceId, userId, { ...base, proposalId: p2.id, to: "+447700900124", idempotencyKey: `cloud-${p2.id}` }, expired)).rejects.toThrow(/access token has expired/);
    const failed = await db.whatsAppDelivery.findFirstOrThrow({ where: { proposalId: p2.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/System User/);
  });
});
