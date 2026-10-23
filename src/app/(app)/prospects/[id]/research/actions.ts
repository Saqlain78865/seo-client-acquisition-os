"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ResearchError, fetchGbpProfile, saveManualGbp, chooseTopKeywords, setKeywordInProposal, addCompetitor, addManualKeywords, analyseKeywords, deleteImport, generateAiKeywordIdeas, generateSeedKeywords, observeCompetitor, runDomainCheck, runPerformanceTest } from "@/lib/research/service";
import type { Strategy } from "@/lib/research/pagespeed";

export type ResearchResult = { ok: true; message: string } | { ok: false; error: string };

async function run(prospectId: string, fn: (workspaceId: string, userId: string) => Promise<string>): Promise<ResearchResult> {
  const session = await requireSession();
  try {
    const message = await fn(session.workspace.id, session.user.id);
    revalidatePath(`/prospects/${prospectId}/research`);
    return { ok: true, message };
  } catch (e) {
    if (e instanceof ResearchError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("research", e)) };
  }
}

export async function generateSeedsAction(prospectId: string) {
  return run(prospectId, async (ws) => {
    const r = await generateSeedKeywords(ws, prospectId);
    return `${r.created} keyword ideas added (no metrics until you import data)`;
  });
}

export async function aiKeywordIdeasAction(prospectId: string) {
  return run(prospectId, async (ws) => {
    const r = await generateAiKeywordIdeas(ws, prospectId);
    return r.created ? `${r.created} AI keyword ideas added — check demand with real data before promising results` : "No new ideas — the AI only suggested keywords you already have";
  });
}

export async function toggleKeywordInProposalAction(prospectId: string, keywordId: string, on: boolean) {
  return run(prospectId, async (ws) => {
    const n = await setKeywordInProposal(ws, prospectId, keywordId, on);
    return `${on ? "Added to" : "Removed from"} the proposal (${n} chosen)`;
  });
}

export async function chooseTopKeywordsAction(prospectId: string, n: number) {
  return run(prospectId, async (ws) => {
    const chosen = await chooseTopKeywords(ws, prospectId, n);
    return chosen ? `${chosen} top keywords chosen for the proposal` : "Proposal keyword choice cleared";
  });
}

export async function analyseAction(prospectId: string) {
  return run(prospectId, async (ws) => {
    const r = await analyseKeywords(ws, prospectId);
    return `${r.keywords} keywords grouped into ${r.clusters} clusters${r.mappedAgainstPages ? ` and mapped against ${r.mappedAgainstPages} audited pages` : " (run an audit to map them to pages)"}`;
  });
}

export async function addKeywordsAction(prospectId: string, text: string) {
  return run(prospectId, async (ws) => {
    const n = await addManualKeywords(ws, prospectId, text.split(/\r?\n|,/));
    return `${n} keyword${n === 1 ? "" : "s"} added`;
  });
}

export async function deleteImportAction(prospectId: string, importId: string) {
  return run(prospectId, async (ws) => {
    await deleteImport(ws, importId);
    await analyseKeywords(ws, prospectId);
    return "Import removed";
  });
}

export async function addCompetitorAction(prospectId: string, domain: string, businessName: string) {
  return run(prospectId, async (ws) => {
    const c = await addCompetitor(ws, prospectId, { domain, businessName });
    return `${c.domain} added — use “Observe site” to collect its public page data`;
  });
}

export async function observeCompetitorAction(prospectId: string, competitorId: string) {
  return run(prospectId, async (ws) => {
    const d = await observeCompetitor(ws, competitorId);
    return `${d.pagesAnalysed} public pages observed`;
  });
}

export async function deleteCompetitorAction(prospectId: string, competitorId: string) {
  return run(prospectId, async (ws) => {
    await db.competitor.deleteMany({ where: { id: competitorId, workspaceId: ws } });
    return "Competitor removed";
  });
}

export async function pageSpeedAction(prospectId: string, strategy: Strategy) {
  return run(prospectId, async (ws, user) => {
    const { test, finding } = await runPerformanceTest(ws, user, prospectId, strategy);
    return `${strategy === "MOBILE" ? "Mobile" : "Desktop"} test done: ${test.performanceScore ?? "—"}/100 lab score${finding ? ` — finding “${finding.title}” added to the latest audit` : ""}`;
  });
}

export async function domainCheckAction(prospectId: string, competitorId: string | null) {
  return run(prospectId, async (ws, userId) => {
    const { overview } = await runDomainCheck(ws, userId, prospectId, competitorId);
    const failed = (["registration", "history", "popularity", "ssl", "email", "tech"] as const).filter((k) => !overview[k].ok).length;
    return `Domain overview for ${overview.domain} updated${failed ? ` (${failed} source${failed === 1 ? "" : "s"} unavailable)` : ""}`;
  });
}

export async function fetchGbpAction(prospectId: string, queriesText: string) {
  return run(prospectId, async (ws, userId) => {
    const queries = queriesText.split(/\r?\n|,/).map((q) => q.trim()).filter(Boolean).slice(0, 3);
    const row = await fetchGbpProfile(ws, userId, prospectId, queries);
    return `Google Business Profile loaded: ${row.name}${row.rating != null ? ` · ${row.rating.toFixed(1)}★ from ${row.reviewCount ?? 0} reviews` : ""}`;
  });
}

const manualGbpSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name as shown on Google").max(200),
  category: z.string().trim().max(120).optional(),
  rating: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().min(1).max(5).nullable()),
  reviewCount: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(0).max(1_000_000).nullable()),
  photoCount: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(0).max(100_000).nullable()),
  hasHours: z.enum(["", "yes", "no"]).transform((v) => (v === "" ? null : v === "yes")),
  hasWebsite: z.enum(["", "yes", "no"]).transform((v) => (v === "" ? null : v === "yes")),
  hasPhone: z.enum(["", "yes", "no"]).transform((v) => (v === "" ? null : v === "yes")),
  mapsUrl: z.string().trim().max(500).optional(),
  rankQuery: z.string().trim().max(120).optional(),
  rankPosition: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1).max(100).nullable()),
  badReviewsText: z.string().max(20_000).optional(),
});

export async function saveManualGbpAction(prospectId: string, formData: FormData) {
  const parsed = manualGbpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  return run(prospectId, async (ws, userId) => {
    const row = await saveManualGbp(ws, userId, prospectId, parsed.data);
    return `Business profile saved for ${row.name}`;
  });
}
