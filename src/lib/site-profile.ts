import "server-only";
import { db } from "./db";
import { safeFetch } from "./crawler/safe-fetch";
import { runnerOptions } from "./audit/runner";
import { isGbpLink } from "./research/gbp-link";
import { detectStack, type TechStack } from "./tech-stack";
import { checkEmailHealth, type EmailHealth, type Resolver } from "./email-health";
import { logActivity } from "./activity";

/** Checks a prospect's website technology and email domain, and keeps the result on the prospect. */
export async function checkProspectProfile(workspaceId: string, prospectId: string, deps: { resolver?: Resolver } = {}) {
  const p = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, include: { contacts: { where: { type: "EMAIL" } } } });
  if (!p) throw new Error("Prospect not found.");
  let techStack: TechStack | null = null;
  let techError: string | null = null;
  if (!isGbpLink(p.websiteUrl)) {
    try {
      const r = await safeFetch(p.websiteUrl, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks, timeoutMs: 30_000, retries: 1 });
      techStack = detectStack(r.body, r.headers);
    } catch (e) {
      techError = (e as Error).message.slice(0, 200);
    }
  }
  // The domain their email uses: their own email address if it is on a business domain, else the website's.
  const emailDomain = p.contacts.map((c) => c.value.split("@")[1]?.toLowerCase()).find((d) => d && !/^(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail)\./.test(d)) ?? (isGbpLink(p.websiteUrl) ? null : p.domain);
  const emailHealth: EmailHealth | null = emailDomain ? await checkEmailHealth(emailDomain, deps.resolver).catch(() => null) : null;
  await db.prospect.update({ where: { id: p.id }, data: { techStack: techStack ?? undefined, emailHealth: emailHealth ?? undefined, techCheckedAt: new Date() } });
  const summary = [techStack?.technologies.find((t) => t.group === "Platform")?.name, emailHealth ? `email ${emailHealth.score}/100` : null].filter(Boolean).join(", ");
  await logActivity({ workspaceId, prospectId, type: "research.site_profile", message: `Website technology and email checked${summary ? ` (${summary})` : ""}` });
  return { techStack, techError, emailHealth };
}
