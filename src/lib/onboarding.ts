import "server-only";
import { db } from "./db";
import { getApiKey } from "./integrations";

export type ChecklistStep = { key: string; title: string; description: string; href: string; cta: string; done: boolean; optional?: boolean };

/** "Getting started" steps, each worked out from what is actually saved in the workspace. */
export async function gettingStarted(workspaceId: string): Promise<ChecklistStep[]> {
  const [settings, email, gemini, audits, proposals, sent] = await Promise.all([
    db.workspaceSettings.findUnique({ where: { workspaceId }, select: { companyName: true, consultantName: true, companyEmail: true } }),
    db.integrationConnection.count({ where: { workspaceId, provider: { in: ["GMAIL_SMTP", "GMAIL_OAUTH", "SMTP"] }, status: "CONNECTED" } }),
    getApiKey(workspaceId, "GEMINI"),
    db.websiteAudit.count({ where: { workspaceId, status: { in: ["COMPLETED", "PARTIAL"] } } }),
    db.proposal.count({ where: { workspaceId } }),
    db.proposal.count({ where: { workspaceId, OR: [{ status: { in: ["SENT", "ACCEPTED", "DECLINED"] } }, { shareToken: { not: null } }] } }),
  ]);
  return [
    { key: "branding", title: "Add your agency details", description: "Your name, company and email appear on every proposal.", href: "/settings", cta: "Open settings", done: !!(settings?.companyName && settings.consultantName) },
    { key: "email", title: "Connect your email", description: "Send proposals from your own Gmail with an App Password — free.", href: "/integrations", cta: "Connect Gmail", done: email > 0 },
    { key: "ai", title: "Add a free Gemini key", description: "Optional: clearer, client-friendly wording in audits and proposals.", href: "/integrations", cta: "Add key", done: !!gemini, optional: true },
    { key: "audit", title: "Audit your first website", description: "Just paste a website address — the proposal can be drafted automatically.", href: "/audits/new", cta: "Start audit", done: audits > 0 },
    { key: "proposal", title: "Review your first proposal", description: "Check the draft, adjust anything you like and mark it ready.", href: "/proposals", cta: "View proposals", done: proposals > 0 },
    { key: "send", title: "Send it to the client", description: "Email, WhatsApp or a share link — you will see when they open or accept it.", href: "/proposals", cta: "Send proposal", done: sent > 0 },
  ];
}
