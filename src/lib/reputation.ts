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
export async function startReputationCase(workspaceId: string, userId: string, input: { link: string }) {
  const { isGbpLink, resolveGbpLink } = await import("./research/gbp-link");
  const { fetchGbpByPlaceId, findPlaceFromLink } = await import("./research/gbp");
  const { saveGbp } = await import("./research/service");
  const { normalizeDomain, normalizeWebsiteUrl } = await import("./url");
  const { createProspect } = await import("./prospects");
  const link = input.link.trim();
  if (!isGbpLink(link)) throw new ReputationError("Paste the business's Google Maps link — on the profile press Share and copy the link (a review link works too).");
  let where;
  try {
    where = await resolveGbpLink(link);
  } catch {
    throw new ReputationError("This link could not be opened. Copy it again from the profile's Share button.");
  }

  // With a Places key the profile, its rating and reviews are read from Google; without one the link still names the business.
  let profile: GbpData | null = null;
  let note: string | null = null;
  const key = await getApiKey(workspaceId, "PLACES");
  if (key && where.name) {
    try {
      const placeId = await findPlaceFromLink(key, { name: where.name, lat: where.lat, lng: where.lng });
      if (placeId) profile = await fetchGbpByPlaceId(key, placeId, where.name, []);
      else note = "Google did not find this profile — add screenshots of the bad reviews instead.";
    } catch (e) {
      note = `The profile could not be read from Google (${(e as Error).message.slice(0, 120)}). Add screenshots of the bad reviews instead.`;
    }
  } else if (!key) {
    note = "Google's Places API is not switched on, so reviews are not read automatically. Add screenshots of the bad reviews (AI reads them) or paste them.";
  }
  const name = profile?.name ?? where.name;
  if (!name) throw new ReputationError("The business name could not be read from this link. Open the profile on Google Maps, press Share and paste that link.");

  // The prospect is keyed by its website, or by the profile when Google lists no website.
  const website = profile?.website ? normalizeWebsiteUrl(profile.website) : null;
  const domain = website ? normalizeDomain(website) : `maps/${slug(name)}`;
  let prospect = await db.prospect.findFirst({ where: { workspaceId, domain }, orderBy: { createdAt: "asc" } });
  if (!prospect) {
    prospect = await createProspect(workspaceId, userId, { businessName: name, websiteUrl: website ?? where.url, leadSource: "Reputation (Google reviews)", currency: "USD" } as Parameters<typeof createProspect>[2]);
    if (!website) prospect = await db.prospect.update({ where: { id: prospect.id }, data: { domain } });
  }
  if (profile) await saveGbp(workspaceId, userId, prospect.id, { ...profile, mapsUrl: profile.mapsUrl ?? where.url });
  else if (!(await latestGbp(prospect.id))) {
    await db.gbpProfile.create({ data: { workspaceId, prospectId: prospect.id, source: "MANUAL", name, mapsUrl: where.url, reviews: [], rankings: [] } });
  }
  await logActivity({ workspaceId, prospectId: prospect.id, userId, type: "reputation.started", message: "Reputation case started from a Google Maps link" });
  return { prospectId: prospect.id, note };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "business";

// ───────────────────────────── Reviews from screenshots or pasted text ─────────────────────────────

const readSchema = z.object({
  reviews: z.array(z.object({ rating: z.number().int().min(1).max(5), text: z.string().max(1500), author: z.string().max(80).nullable(), when: z.string().max(60).nullable() })).max(20),
});

/** Gemini reads the Google reviews visible in a screenshot: stars, text, name and date. */
export async function readReviewsFromImage(provider: AiProvider, image: { type: string; bytes: Buffer }): Promise<GbpData["reviews"]> {
  const out = await provider.generateJson({
    system: "You read screenshots of Google reviews. List every customer review visible in the image: rating = the number of filled stars (1-5), text = the review exactly as written (keep the original language), author and relative date if shown. Ignore the owner's replies, ads and anything that is not a review. If there are no reviews, return an empty list.",
    prompt: "Read the Google reviews in this screenshot.",
    schema: readSchema,
    images: [{ mimeType: image.type, data: image.bytes.toString("base64") }],
    maxOutputTokens: 4096,
  });
  return out.reviews.filter((r) => r.text.trim()).map((r) => ({ rating: r.rating, text: r.text.trim(), author: r.author?.trim() || null, when: r.when?.trim() || null }));
}

/** Adds reviews to the business's latest profile, skipping ones already there. Returns how many were new. */
export async function mergeReviews(workspaceId: string, prospectId: string, reviews: GbpData["reviews"]) {
  const row = await latestGbp(prospectId);
  if (!row || row.workspaceId !== workspaceId) throw new ReputationError("Start from the business's Google Maps link first.");
  const current = (row.reviews as GbpData["reviews"]) ?? [];
  const seen = new Set(current.map((r) => reviewKey(r.text)));
  const fresh = reviews.filter((r) => r.text.trim() && !seen.has(reviewKey(r.text)) && seen.add(reviewKey(r.text)));
  if (fresh.length) await db.gbpProfile.update({ where: { id: row.id }, data: { reviews: [...current, ...fresh].slice(0, 60) } });
  return fresh.length;
}

/** Reviews pasted as text: one per paragraph, starting with its stars ("1★ …"). */
export async function addPastedReviews(workspaceId: string, prospectId: string, text: string) {
  const { parsePastedReviews } = await import("./research/gbp");
  const reviews = parsePastedReviews(text);
  if (!reviews.length) throw new ReputationError("Paste at least one review.");
  return mergeReviews(workspaceId, prospectId, reviews);
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

/**
 * Saves the screenshot and, when Gemini is set up, reads the reviews in it into the review list.
 * `read` is null when the reviews could not be read (no key, or Gemini busy) — the screenshot is kept either way.
 */
export async function addReviewScreenshot(workspaceId: string, prospectId: string, file: { type: string; bytes: Buffer }, caption?: string, providerOverride?: AiProvider) {
  const shot = await saveReviewScreenshot(workspaceId, prospectId, file, caption);
  let read: number | null = null;
  const provider = providerOverride ?? getAiProvider(await getApiKey(workspaceId, "GEMINI"));
  if (provider && (await latestGbp(prospectId))) {
    try {
      read = await mergeReviews(workspaceId, prospectId, await readReviewsFromImage(provider, file));
    } catch {
      read = null;
    }
  }
  return { shot, read };
}

async function saveReviewScreenshot(workspaceId: string, prospectId: string, file: { type: string; bytes: Buffer }, caption?: string) {
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
