import "server-only";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeContactValue, validateContactValue } from "./contacts";
import { normalizeDomain, normalizeWebsiteUrl } from "./url";
import type { ProspectInput } from "./validation";

export const PROSPECT_SORTS = {
  recent: { createdAt: "desc" },
  hottest: { leadScore: { sort: "desc", nulls: "last" } },
  oldest: { createdAt: "asc" },
  name: { businessName: "asc" },
  activity: { lastActivityAt: "desc" },
  value: { estimatedValue: "desc" },
  followUp: { nextFollowUpAt: "asc" },
} as const satisfies Record<string, Prisma.ProspectOrderByWithRelationInput>;
export type ProspectSort = keyof typeof PROSPECT_SORTS;

export type ProspectFilters = {
  q?: string;
  status?: string;
  country?: string;
  service?: string;
  ownerId?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export function buildProspectWhere(workspaceId: string, f: ProspectFilters): Prisma.ProspectWhereInput {
  const where: Prisma.ProspectWhereInput = { workspaceId };
  const and: Prisma.ProspectWhereInput[] = [];
  if (f.q) {
    const q = f.q.trim();
    // Phone numbers are stored normalised, so also search the digits-only form.
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { businessName: { contains: q } },
        { websiteUrl: { contains: q } },
        { domain: { contains: q.toLowerCase() } },
        { contacts: { some: { value: { contains: q.toLowerCase() } } } },
        ...(digits.length >= 4 ? [{ contacts: { some: { value: { contains: digits } } } }] : []),
      ],
    });
  }
  if (f.status) and.push({ status: f.status });
  if (f.country) and.push({ country: f.country });
  if (f.service) and.push({ primaryServices: { contains: f.service } });
  if (f.ownerId) and.push({ ownerId: f.ownerId });
  if (f.from) and.push({ createdAt: { gte: new Date(f.from) } });
  if (f.to) and.push({ createdAt: { lte: new Date(`${f.to}T23:59:59.999Z`) } });
  if (and.length) where.AND = and;
  return where;
}

export async function listProspects(workspaceId: string, f: ProspectFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 20, 5), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = buildProspectWhere(workspaceId, f);
  const orderBy = PROSPECT_SORTS[(f.sort as ProspectSort) in PROSPECT_SORTS ? (f.sort as ProspectSort) : "recent"];
  const [total, rows] = await Promise.all([
    db.prospect.count({ where }),
    db.prospect.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        owner: { select: { id: true, name: true } },
        contacts: { where: { type: { in: ["EMAIL", "PHONE", "WHATSAPP"] } }, orderBy: { isPreferred: "desc" } },
        _count: { select: { audits: true, proposals: true } },
      },
    }),
  ]);
  return { total, rows, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

/** Prospects in the same workspace that share the domain, or (when given) an email or phone. */
export async function findDuplicateProspects(
  workspaceId: string,
  input: { websiteUrl: string; email?: string; phone?: string },
  excludeId?: string,
) {
  const domain = normalizeDomain(input.websiteUrl);
  const contactValues = [
    input.email ? normalizeContactValue("EMAIL", input.email) : null,
    input.phone ? normalizeContactValue("PHONE", input.phone) : null,
  ].filter((v): v is string => !!v);
  return db.prospect.findMany({
    where: {
      workspaceId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ domain }, ...(contactValues.length ? [{ contacts: { some: { value: { in: contactValues } } } }] : [])],
    },
    select: { id: true, businessName: true, websiteUrl: true, status: true, createdAt: true },
    take: 5,
  });
}

type ContactSeed = { type: string; value: string; label?: string };

function contactsFromInput(input: Pick<ProspectInput, "email" | "phone" | "whatsapp" | "contactName">): ContactSeed[] {
  const seeds: ContactSeed[] = [];
  if (input.contactName) seeds.push({ type: "PERSON_NAME", value: input.contactName });
  if (input.email) seeds.push({ type: "EMAIL", value: input.email });
  if (input.phone) seeds.push({ type: "PHONE", value: input.phone });
  if (input.whatsapp) seeds.push({ type: "WHATSAPP", value: input.whatsapp });
  return seeds;
}

/** Manually entered contacts are user-provided, so they start as verified and preferred. */
function manualContactData(seed: ContactSeed) {
  return {
    type: seed.type,
    value: normalizeContactValue(seed.type, seed.value),
    label: seed.label,
    sourceMethod: "MANUAL",
    validationStatus: validateContactValue(seed.type, seed.value),
    confidence: "HIGH",
    verified: true,
    verifiedAt: new Date(),
    isPreferred: true,
  };
}

export type ParsedProspect = {
  businessName: string;
  websiteUrl: string;
  industry?: string;
  country?: string;
  city?: string;
  primaryServices?: string;
  leadSource?: string;
  notes?: string;
  estimatedValue?: number;
  currency: string;
  contactName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
};

export async function createProspect(workspaceId: string, ownerId: string, input: ParsedProspect) {
  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
  return db.prospect.create({
    data: {
      workspaceId,
      ownerId,
      businessName: input.businessName,
      websiteUrl,
      domain: normalizeDomain(websiteUrl),
      industry: input.industry,
      country: input.country,
      city: input.city,
      primaryServices: input.primaryServices,
      leadSource: input.leadSource,
      notes: input.notes,
      estimatedValue: input.estimatedValue,
      currency: input.currency,
      contacts: { create: contactsFromInput(input).map(manualContactData) },
    },
  });
}

export async function updateProspect(workspaceId: string, id: string, input: ParsedProspect) {
  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
  // updateMany scoped by workspace guarantees we never touch another tenant's row.
  const { count } = await db.prospect.updateMany({
    where: { id, workspaceId },
    data: {
      businessName: input.businessName,
      websiteUrl,
      domain: normalizeDomain(websiteUrl),
      industry: input.industry ?? null,
      country: input.country ?? null,
      city: input.city ?? null,
      primaryServices: input.primaryServices ?? null,
      leadSource: input.leadSource ?? null,
      notes: input.notes ?? null,
      estimatedValue: input.estimatedValue ?? null,
      currency: input.currency,
    },
  });
  return count === 1;
}

export async function getProspect(workspaceId: string, id: string) {
  return db.prospect.findFirst({
    where: { id, workspaceId },
    include: {
      owner: { select: { id: true, name: true } },
      contacts: { orderBy: [{ type: "asc" }, { isPreferred: "desc" }] },
      audits: { orderBy: { createdAt: "desc" } },
      proposals: { orderBy: { createdAt: "desc" }, include: { versions: { select: { version: true, locked: true } } } },
      followUps: { orderBy: { dueAt: "asc" } },
      deals: { orderBy: { createdAt: "desc" } },
      meetingNotes: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true } } } },
    },
  });
}

export async function addContact(prospectId: string, seed: ContactSeed & { sourceUrl?: string }) {
  const value = normalizeContactValue(seed.type, seed.value);
  return db.prospectContact.upsert({
    where: { prospectId_type_value: { prospectId, type: seed.type, value } },
    update: { label: seed.label, sourceUrl: seed.sourceUrl },
    create: { prospectId, ...manualContactData(seed), isPreferred: false, sourceUrl: seed.sourceUrl },
  });
}

/**
 * Moves every related record from `sourceId` onto `targetId`, fills empty fields on the target
 * from the source, then deletes the source. Runs in a single transaction.
 */
export async function mergeProspects(workspaceId: string, targetId: string, sourceId: string) {
  if (targetId === sourceId) throw new Error("Cannot merge a prospect into itself.");
  return db.$transaction(async (tx) => {
    const [target, source] = await Promise.all([
      tx.prospect.findFirst({ where: { id: targetId, workspaceId } }),
      tx.prospect.findFirst({ where: { id: sourceId, workspaceId }, include: { contacts: true } }),
    ]);
    if (!target || !source) throw new Error("Prospect not found.");

    for (const c of source.contacts) {
      const exists = await tx.prospectContact.findUnique({
        where: { prospectId_type_value: { prospectId: targetId, type: c.type, value: c.value } },
      });
      if (!exists) await tx.prospectContact.update({ where: { id: c.id }, data: { prospectId: targetId, isPreferred: false } });
    }
    const move = { where: { prospectId: sourceId }, data: { prospectId: targetId } };
    await tx.websiteAudit.updateMany(move);
    await tx.proposal.updateMany(move);
    await tx.followUp.updateMany(move);
    await tx.deal.updateMany(move);
    await tx.meetingNote.updateMany(move);
    await tx.activityLog.updateMany(move);

    const fill = <K extends keyof typeof target>(k: K) => (target[k] == null ? source[k as keyof typeof source] : undefined);
    await tx.prospect.update({
      where: { id: targetId },
      data: {
        industry: fill("industry") as string | undefined,
        country: fill("country") as string | undefined,
        city: fill("city") as string | undefined,
        primaryServices: fill("primaryServices") as string | undefined,
        leadSource: fill("leadSource") as string | undefined,
        estimatedValue: fill("estimatedValue") as number | undefined,
        notes: [target.notes, source.notes].filter(Boolean).join("\n\n— merged —\n\n") || null,
        lastActivityAt: new Date(),
      },
    });
    await tx.prospect.delete({ where: { id: sourceId } });
    return { targetId, sourceName: source.businessName };
  });
}

export async function recomputeNextFollowUp(prospectId: string) {
  const next = await db.followUp.findFirst({
    where: { prospectId, status: "PENDING" },
    orderBy: { dueAt: "asc" },
  });
  await db.prospect.update({ where: { id: prospectId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}

const CSV_COLUMNS = [
  "Business name",
  "Website",
  "Status",
  "Industry",
  "Country",
  "City",
  "Primary services",
  "Lead source",
  "Owner",
  "Email",
  "Phone",
  "WhatsApp",
  "Estimated value",
  "Won value",
  "Currency",
  "Next follow-up",
  "Created",
] as const;

function csvCell(value: unknown) {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportProspectsCsv(workspaceId: string, f: ProspectFilters) {
  const rows = await db.prospect.findMany({
    where: buildProspectWhere(workspaceId, f),
    orderBy: { createdAt: "desc" },
    include: { owner: { select: { name: true } }, contacts: true },
  });
  const pick = (contacts: { type: string; value: string; isPreferred: boolean }[], type: string) =>
    contacts
      .filter((c) => c.type === type)
      .sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred))
      .map((c) => c.value)
      .join("; ");
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of rows) {
    lines.push(
      [
        p.businessName,
        p.websiteUrl,
        p.status,
        p.industry,
        p.country,
        p.city,
        p.primaryServices,
        p.leadSource,
        p.owner?.name,
        pick(p.contacts, "EMAIL"),
        pick(p.contacts, "PHONE"),
        pick(p.contacts, "WHATSAPP"),
        p.estimatedValue,
        p.wonValue,
        p.currency,
        p.nextFollowUpAt,
        p.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
