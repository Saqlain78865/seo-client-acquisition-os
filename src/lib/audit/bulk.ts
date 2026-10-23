import "server-only";
import { db } from "../db";
import { normalizeDomain, normalizeWebsiteUrl } from "../url";
import { opportunityScore } from "./opportunity";
import { AuditRequestError, startAudit } from "./service";
import type { AuditRequest } from "../validation";

export const MAX_BULK_SITES = 50;

/** Splits pasted text (one per line, or comma/space separated) into unique websites, by domain. */
export function parseSiteList(text: string) {
  const seen = new Set<string>();
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)) {
    try {
      const url = normalizeWebsiteUrl(raw);
      const domain = normalizeDomain(url);
      if (!domain.includes(".")) throw new Error("no dot");
      if (seen.has(domain)) continue;
      seen.add(domain);
      urls.push(url);
    } catch {
      invalid.push(raw.slice(0, 100));
    }
  }
  return { urls, invalid };
}

/** Queues a quick audit for each website. Sites that cannot be reached are reported, not queued. */
export async function startBulkAudit(workspaceId: string, userId: string, input: { name?: string; sites: string }) {
  const { urls, invalid } = parseSiteList(input.sites);
  if (urls.length === 0) throw new AuditRequestError("Add at least one website, e.g. example.com.");
  if (urls.length > MAX_BULK_SITES) throw new AuditRequestError(`Up to ${MAX_BULK_SITES} websites per bulk audit (you added ${urls.length}).`);
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId } });
  const name = input.name?.trim().slice(0, 120) || `Bulk audit ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  const batch = await db.auditBatch.create({ data: { workspaceId, name, createdById: userId } });
  const skipped: { site: string; reason: string }[] = invalid.map((site) => ({ site, reason: "Not a valid website address" }));
  let queued = 0;
  for (const url of urls) {
    try {
      await startAudit(workspaceId, userId, { websiteUrl: url, currency: (settings?.defaultCurrency ?? "USD") as AuditRequest["currency"] }, { batchId: batch.id, quick: true });
      queued++;
    } catch (e) {
      skipped.push({ site: url, reason: e instanceof AuditRequestError ? e.message : "Could not be queued" });
    }
  }
  if (skipped.length) await db.auditBatch.update({ where: { id: batch.id }, data: { skipped: skipped.slice(0, 100) } });
  if (queued === 0) {
    await db.auditBatch.delete({ where: { id: batch.id } });
    throw new AuditRequestError(`None of the websites could be audited. ${skipped[0]?.reason ?? ""}`.trim());
  }
  return { batch, queued, skipped };
}

/** The batch's audits ranked by opportunity score (finished audits first, best leads on top). */
export async function getBatchResults(workspaceId: string, batchId: string) {
  const batch = await db.auditBatch.findFirst({
    where: { id: batchId, workspaceId },
    include: {
      audits: {
        include: {
          prospect: { select: { id: true, businessName: true, domain: true, contacts: { where: { type: { in: ["EMAIL", "PHONE", "WHATSAPP"] } }, select: { type: true, value: true } } } },
          findings: { select: { severity: true, evidenceStatus: true, title: true, priority: true, ruleId: true } },
          proposals: { select: { id: true }, take: 1, orderBy: { createdAt: "desc" } },
          crawlJob: { select: { pagesCrawled: true } },
        },
      },
    },
  });
  if (!batch) return null;
  const rows = batch.audits.map((a) => {
    const done = a.status === "COMPLETED" || a.status === "PARTIAL";
    const contacts = a.prospect.contacts;
    return {
      auditId: a.id,
      status: a.status,
      prospect: a.prospect,
      contact: contacts.find((c) => c.type === "EMAIL")?.value ?? contacts[0]?.value ?? null,
      pages: a.crawlJob?.pagesCrawled ?? 0,
      proposalId: a.proposals[0]?.id ?? null,
      opportunity: done ? opportunityScore(a.findings, contacts.length > 0) : null,
    };
  });
  rows.sort((x, y) => (y.opportunity?.score ?? -1) - (x.opportunity?.score ?? -1) || x.prospect.domain.localeCompare(y.prospect.domain));
  const active = rows.filter((r) => r.status === "QUEUED" || r.status === "RUNNING").length;
  return { batch, rows, active };
}

export async function listBatches(workspaceId: string) {
  const batches = await db.auditBatch.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { audits: { select: { status: true } } },
  });
  return batches.map((b) => ({
    id: b.id,
    name: b.name,
    createdAt: b.createdAt,
    total: b.audits.length,
    done: b.audits.filter((a) => !["QUEUED", "RUNNING"].includes(a.status)).length,
  }));
}
