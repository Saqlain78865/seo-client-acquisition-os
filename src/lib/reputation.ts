import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { logActivity } from "./activity";
import { getApiKey } from "./integrations";
import { deleteFile, putFile } from "./storage";
import { AiError, getAiProvider, type AiProvider } from "./ai/provider";
import { badReviews, type GbpData } from "./research/gbp";
import { gbpRowToData, latestGbp } from "./research/service";
import { ProposalError, createProposal, getProposalWithVersion } from "./proposals/service";
import type { ProposalReview } from "./proposals/types";

/**
 * Reputation: the negative reviews of a Google Business Profile, each checked against Google's
 * review policies, plus screenshots the user captured, turned into a reputation-only proposal.
 * The proposal promises only what is possible: removal requests for reviews that break a policy,
 * professional replies and more genuine reviews for the rest.
 */

export class ReputationError extends Error {}

export type ReviewCheck = { key: string; verdict: "POLICY" | "GENUINE"; policy: string | null; reason: string; reply: string };

/** A review is matched to its check by its opening words, so a re-fetched profile keeps its checks. */
export const reviewKey = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 120).toLowerCase();

const POLICIES = ["Fake engagement", "Conflict of interest", "Off-topic", "Harassment or hate speech", "Offensive content", "Personal information", "Spam or advertising", "Impersonation"] as const;

const checkSchema = z.object({
  reviews: z.array(
    z.object({
      index: z.number().int(),
      verdict: z.enum(["POLICY", "GENUINE"]),
      policy: z.string().max(80).nullable(),
      reason: z.string().max(400),
      reply: z.string().max(900),
    }),
  ),
});

const SYSTEM = [
  "You review negative Google reviews of a local business against Google's prohibited and restricted content policy for reviews.",
  `verdict POLICY only when the text itself shows a likely violation, naming one policy from: ${POLICIES.join(", ")}. Signs: no real experience described, written by a competitor or ex-employee, about a different business, insults or threats, personal data, links or promotion.`,
  "verdict GENUINE when it describes a real customer experience, even if harsh or unfair. Do not guess: a plain complaint is GENUINE.",
  "reason: one short sentence a business owner understands. reply: a calm, professional public reply under 70 words, in the review's language, that never argues and invites the reviewer to get in touch.",
].join("\n");

export async function checkReviews(workspaceId: string, prospectId: string, providerOverride?: AiProvider) {
  const row = await latestGbp(prospectId);
  if (!row || row.workspaceId !== workspaceId) throw new ReputationError("Fetch or enter the Google Business Profile first.");
  const bad = badReviews(gbpRowToData(row));
  if (!bad.length) throw new ReputationError("No negative reviews to check. Paste the bad reviews in the profile form first.");
  const provider = providerOverride ?? getAiProvider(await getApiKey(workspaceId, "GEMINI"));
  if (!provider) throw new ReputationError("The review check uses Gemini (free). Add your Gemini key on the Integrations page first.");
  let out: z.infer<typeof checkSchema>;
  try {
    out = await provider.generateJson({
      system: SYSTEM,
      prompt: JSON.stringify({ business: row.name, category: row.category, reviews: bad.slice(0, 20).map((r, index) => ({ index, rating: r.rating, text: r.text })) }),
      schema: checkSchema,
      maxOutputTokens: 8192,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ReputationError(e.message);
    throw e;
  }
  const checks: ReviewCheck[] = out.reviews
    .filter((c) => bad[c.index])
    .map((c) => ({ key: reviewKey(bad[c.index].text), verdict: c.verdict, policy: c.verdict === "POLICY" ? (c.policy ?? "Policy violation") : null, reason: c.reason.trim(), reply: c.reply.trim() }));
  await db.gbpProfile.update({ where: { id: row.id }, data: { reviewChecks: checks } });
  return { checked: checks.length, policy: checks.filter((c) => c.verdict === "POLICY").length };
}

export function checksOf(row: { reviewChecks: unknown } | null): Map<string, ReviewCheck> {
  return new Map(((row?.reviewChecks as ReviewCheck[] | null) ?? []).map((c) => [c.key, c]));
}

/** Negative reviews for a proposal, with the check's verdict where there is one. */
export function proposalReviews(reviews: GbpData["reviews"], checks: Map<string, ReviewCheck>, max: number): ProposalReview[] {
  return badReviews({ reviews })
    .slice(0, max)
    .map((r) => {
      const c = checks.get(reviewKey(r.text));
      return { rating: Math.min(5, Math.max(1, Math.round(r.rating))), text: r.text.length > 600 ? `${r.text.slice(0, 597)}…` : r.text, when: r.when, verdict: c?.verdict ?? null, policy: c?.policy?.slice(0, 120) ?? null };
    });
}

// ───────────────────────────── Cases ─────────────────────────────

/**
 * Starts reputation work for a business: links or creates the prospect, and with a Places key and a
 * Google Maps link, reads the profile and its reviews. Without them the user pastes reviews or adds
 * screenshots on the next page.
 */
export async function startReputationCase(workspaceId: string, userId: string, input: { businessName: string; websiteUrl: string; gbpLink?: string }) {
  const { normalizeDomain, normalizeWebsiteUrl } = await import("./url");
  const { createProspect } = await import("./prospects");
  const name = input.businessName.trim();
  if (name.length < 2) throw new ReputationError("Enter the business name.");
  let websiteUrl: string;
  try {
    websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
  } catch {
    throw new ReputationError("Enter the business's website address.");
  }
  const domain = normalizeDomain(websiteUrl);
  if (!domain.includes(".")) throw new ReputationError("Enter the business's website address, e.g. example.com.");
  const prospect =
    (await db.prospect.findFirst({ where: { workspaceId, domain }, orderBy: { createdAt: "asc" } })) ??
    (await createProspect(workspaceId, userId, { businessName: name, websiteUrl, leadSource: "Reputation (Google reviews)", currency: "USD" } as Parameters<typeof createProspect>[2]));

  let note: string | null = null;
  const link = input.gbpLink?.trim();
  if (link) {
    const key = await getApiKey(workspaceId, "PLACES");
    if (!key) note = "Reading a Google Maps link needs the Places API key (Integrations). Paste the bad reviews or add screenshots below instead.";
    else {
      try {
        const { resolveGbpLink } = await import("./research/gbp-link");
        const { fetchGbpByPlaceId, findPlaceFromLink } = await import("./research/gbp");
        const { saveGbp } = await import("./research/service");
        const where = await resolveGbpLink(link);
        const placeId = await findPlaceFromLink(key, { name: where.name ?? name, lat: where.lat, lng: where.lng });
        if (!placeId) note = "That profile was not found on Google. Paste the bad reviews or add screenshots below.";
        else await saveGbp(workspaceId, userId, prospect.id, { ...(await fetchGbpByPlaceId(key, placeId, name, [])), mapsUrl: where.url });
      } catch (e) {
        note = `The profile could not be read (${(e as Error).message.slice(0, 120)}). Paste the bad reviews or add screenshots below.`;
      }
    }
  }
  await logActivity({ workspaceId, prospectId: prospect.id, userId, type: "reputation.started", message: "Reputation case started (Google reviews)" });
  return { prospectId: prospect.id, note };
}

/** Businesses with a Google profile on record, with their negative-review numbers, for the Reputation page. */
export async function reputationList(workspaceId: string) {
  const rows = await db.gbpProfile.findMany({ where: { workspaceId }, orderBy: { fetchedAt: "desc" }, include: { prospect: { select: { id: true, businessName: true, domain: true } } } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.prospectId)) latest.set(r.prospectId, r);
  const shots = await db.reviewScreenshot.groupBy({ by: ["prospectId"], where: { workspaceId }, _count: { _all: true } });
  return [...latest.values()].map((r) => {
    const bad = badReviews(gbpRowToData(r));
    const checks = checksOf(r);
    return {
      prospectId: r.prospectId,
      businessName: r.prospect.businessName,
      domain: r.prospect.domain,
      rating: r.rating,
      reviewCount: r.reviewCount,
      negative: bad.length,
      policy: bad.filter((b) => checks.get(reviewKey(b.text))?.verdict === "POLICY").length,
      checked: checks.size > 0,
      screenshots: shots.find((s) => s.prospectId === r.prospectId)?._count._all ?? 0,
      fetchedAt: r.fetchedAt,
    };
  });
}

// ───────────────────────────── Screenshots ─────────────────────────────

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_REVIEW_SHOT_BYTES = 6 * 1024 * 1024;
export const MAX_REVIEW_SHOTS = 12;

export async function addReviewScreenshot(workspaceId: string, prospectId: string, file: { type: string; bytes: Buffer }, caption?: string) {
  const prospect = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, select: { id: true } });
  if (!prospect) throw new ReputationError("Prospect not found.");
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ReputationError("Upload a PNG, JPG or WebP image.");
  if (file.bytes.length > MAX_REVIEW_SHOT_BYTES) throw new ReputationError("Each screenshot can be up to 6 MB.");
  if ((await db.reviewScreenshot.count({ where: { prospectId } })) >= MAX_REVIEW_SHOTS) throw new ReputationError(`Up to ${MAX_REVIEW_SHOTS} screenshots per business.`);
  // Kept under the workspace's screenshot folder, so proposals can embed it like audit screenshots.
  const storageKey = `screenshots/${workspaceId}/reviews/${prospectId}/${randomUUID()}.${ext}`;
  await putFile(storageKey, file.bytes);
  return db.reviewScreenshot.create({ data: { workspaceId, prospectId, storageKey, caption: caption?.trim().slice(0, 200) || null } });
}

export async function deleteReviewScreenshot(workspaceId: string, id: string) {
  const shot = await db.reviewScreenshot.findFirst({ where: { id, workspaceId } });
  if (!shot) throw new ReputationError("Screenshot not found.");
  await db.reviewScreenshot.delete({ where: { id } });
  await deleteFile(shot.storageKey).catch(() => undefined);
}

// ───────────────────────────── Proposal ─────────────────────────────

const KEEP = ["executive_summary", "gbp", "reputation", "what_you_get", "why_us", "next_steps", "acceptance"];
const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

/** A proposal about the business's Google reviews only: what customers see today and the plan to fix it. */
export async function createReputationProposal(workspaceId: string, userId: string, prospectId: string) {
  const prospect = await db.prospect.findFirst({ where: { id: prospectId, workspaceId } });
  if (!prospect) throw new ReputationError("Prospect not found.");
  const row = await latestGbp(prospectId);
  if (!row) throw new ReputationError("Fetch or enter the Google Business Profile first.");
  const gbp = gbpRowToData(row);
  const checks = checksOf(row);
  const reviews = proposalReviews(gbp.reviews, checks, 10);
  const shots = await db.reviewScreenshot.findMany({ where: { prospectId }, orderBy: { createdAt: "asc" }, take: MAX_REVIEW_SHOTS });
  if (!reviews.length && !shots.length) throw new ReputationError("Add the negative reviews (paste them or upload screenshots) before creating a reputation proposal.");

  let proposal;
  try {
    proposal = await createProposal(workspaceId, userId, { prospectId });
  } catch (e) {
    if (e instanceof ProposalError) throw new ReputationError(e.message);
    throw e;
  }
  const found = (await getProposalWithVersion(workspaceId, proposal.id))!;
  const name = prospect.businessName;
  const removable = reviews.filter((r) => r.verdict === "POLICY").length;
  const negatives = Math.max(reviews.length, shots.length);
  const rating = gbp.rating != null ? `${gbp.rating.toFixed(1)}★` : null;
  const title = `Reputation rescue plan for ${name}`;

  const body: Record<string, { title?: string; body: string; data?: object }> = {
    executive_summary: {
      body: [
        `**Most customers read your Google reviews before they call.** Right now, people searching for ${name} see ${negatives === 1 ? "a negative review" : `${negatives} negative reviews`}${rating ? ` next to a ${rating} rating` : ""} — and many of them quietly choose a competitor instead.`,
        removable
          ? `We checked every negative review against Google's review policies. **${removable} of them appear to break those policies** — the kind Google can take down when the request is made the right way, with the right evidence.`
          : "We checked every negative review against Google's review policies and know exactly how to handle each one.",
        `Our Reputation Rescue plan cleans up what can be removed, answers what cannot, and builds a steady flow of genuine 5-star reviews — so the first thing customers see about ${name} is trust.`,
      ].join("\n\n"),
    },
    reputation: {
      title: "The reviews hurting your business today",
      body: [
        `These are the reviews customers read first. ${removable ? `Reviews marked **“Breaks Google policy”** can be reported for removal; ` : ""}every other negative review gets a calm, professional reply that shows future customers you care — which often matters more than the review itself.`,
        `What we do, step by step:\n${bullets([
          "**Review audit** — every review checked against Google's policies (fake engagement, conflict of interest, off-topic, harassment, spam)",
          "**Removal requests** — policy-breaking reviews reported through Google's official process, with evidence, followed up until decided",
          "**Professional replies** — a public answer to every review, in your voice, within 48 hours",
          "**More genuine 5-star reviews** — QR codes and WhatsApp review links for your happy customers",
          "**Monthly monitoring** — new reviews watched and handled before they cost you customers",
        ])}`,
        "Honest note: Google decides on every removal request, and real customer reviews cannot be deleted by anyone — but they can be answered well and outweighed by many more positive ones. That is how ratings recover.",
      ].join("\n\n"),
      data: { reviews, shots: shots.map((s) => s.storageKey) },
    },
    what_you_get: {
      title: "What you get",
      body: bullets([
        "**A cleaner profile** — removal requests for every review that breaks Google's policies",
        "**Every review answered** — professional, on-brand replies that win back trust",
        "**A rising rating** — a simple system that brings in genuine 5-star reviews every month",
        "**Peace of mind** — monthly report: reviews removed, replies posted, new reviews and rating trend",
      ]),
    },
    next_steps: {
      body: [
        "**Every day these reviews stay unanswered, they keep costing you calls.** Here is how we start:",
        bullets([
          "**Today** — accept this proposal online or message us on WhatsApp",
          "**Within 48 hours** — we get manager access to your Google Business Profile (you stay the owner)",
          "**Week 1** — removal requests filed and every negative review answered",
          "**Month 1** — your first reputation report: what was removed, replied and gained",
        ]),
      ].join("\n\n"),
    },
  };

  await db.$transaction(async (tx) => {
    for (const s of found.version.sections) {
      const b = body[s.key];
      await tx.proposalSection.update({
        where: { id: s.id },
        data: { included: KEEP.includes(s.key) && (s.key !== "gbp" || !!row), ...(b ? { body: b.body, ...(b.title ? { title: b.title } : {}), ...(b.data ? { data: b.data } : {}) } : {}) },
      });
    }
    await tx.proposalVersion.update({
      where: { id: found.version.id },
      data: {
        title,
        services: ["REPUTATION", "LOCAL"],
        deliverables: [
          { title: "Review audit and removal requests", detail: "Every negative review checked against Google's policies; violations reported with evidence and followed up" },
          { title: "Replies to every review", detail: "Professional public replies to new and existing reviews within 48 hours" },
          { title: "Genuine review generation", detail: "QR code and WhatsApp review link for your customers, with a simple routine for your team" },
          { title: "Monthly reputation report", detail: "Removals, replies, new reviews and rating trend" },
        ],
        includeAppendix: false,
        changeNote: "Reputation proposal (Google reviews)",
      },
    });
    await tx.proposal.update({ where: { id: proposal.id }, data: { title } });
  });
  await logActivity({ workspaceId, prospectId, userId, type: "proposal.reputation", message: `Reputation proposal created (${negatives} negative review${negatives === 1 ? "" : "s"}${removable ? `, ${removable} may break Google policy` : ""})`, metadata: { proposalId: proposal.id } });
  return proposal;
}
