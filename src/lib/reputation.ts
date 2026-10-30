import "server-only";
import { badReviews, type GbpData } from "./research/gbp";
import type { ProposalReview } from "./proposals/types";

/**
 * Negative Google reviews as they appear in a proposal. A review may carry a policy check saved on
 * the profile (`reviewChecks`); reviews without one are shown as they are.
 */

export type ReviewCheck = { key: string; verdict: "POLICY" | "GENUINE"; policy: string | null; reason: string; reply: string };

/** A review is matched to its check by its opening words, so a re-fetched profile keeps its checks. */
export const reviewKey = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 120).toLowerCase();

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
