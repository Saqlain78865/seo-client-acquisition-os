import "server-only";
import { z } from "zod";
import { db } from "../db";
import { getApiKey } from "../integrations";
import { AiError, getAiProvider, type AiProvider } from "../ai/provider";
import { ResearchError, gbpRowToData, latestGbp } from "./service";

/**
 * Drafts for managing a Google Business Profile, written by Gemini: a reply to each review we have,
 * and a month of weekly Google posts. Nothing is posted — Google has no free API for that — the
 * user copies a draft into the profile. Drafts never invent offers, prices, awards or facts.
 */

export type ReviewReply = { author: string | null; rating: number; review: string; reply: string };
export type GbpPost = { title: string; body: string; button: "CALL" | "BOOK" | "LEARN_MORE" | "ORDER" };
export type GbpDrafts = { replies: ReviewReply[]; posts: GbpPost[] };

const draftSchema = z.object({
  replies: z.array(z.object({ index: z.number().int(), reply: z.string().min(1).max(1200) })),
  posts: z.array(z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(1500), button: z.enum(["CALL", "BOOK", "LEARN_MORE", "ORDER"]) })).max(6),
});

const SYSTEM = [
  "You write content for a local business's Google Business Profile, on behalf of the business owner.",
  "Review replies: thank the reviewer by first name if given; answer what they actually said; for a complaint, apologise without admitting legal fault, and invite them to contact the business directly to put it right. Never mention private details, never argue, never offer refunds or discounts. Under 80 words. Reply in the language of the review.",
  "Posts: four weekly Google posts, 80–160 words each, useful to a local customer (a service explained, a tip, what to expect, why choose them). Mention the area naturally. Never invent offers, prices, discounts, awards, years in business or other facts not given to you. End with a short call to action that matches the button.",
  "Write plainly and warmly, like a real local owner — no hashtags, no emojis overload (at most one), no ALL CAPS.",
].join("\n");

export async function draftGbpContent(workspaceId: string, prospectId: string, providerOverride?: AiProvider): Promise<GbpDrafts> {
  const prospect = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, select: { businessName: true, city: true, country: true, primaryServices: true, industry: true } });
  if (!prospect) throw new ResearchError("Prospect not found.");
  const row = await latestGbp(prospectId);
  if (!row) throw new ResearchError("Fetch or enter the Google Business Profile first.");
  const provider = providerOverride ?? getAiProvider(await getApiKey(workspaceId, "GEMINI"));
  if (!provider) throw new ResearchError("Drafts are written by Gemini (free). Add your Gemini key on the Integrations page first.");
  const gbp = gbpRowToData(row);
  const reviews = gbp.reviews.filter((r) => r.text.trim()).slice(0, 10);

  let out: z.infer<typeof draftSchema>;
  try {
    out = await provider.generateJson({
      system: SYSTEM,
      prompt: JSON.stringify({
        business: { name: gbp.name || prospect.businessName, category: gbp.category ?? prospect.industry, services: prospect.primaryServices, area: [prospect.city, prospect.country].filter(Boolean).join(", ") || gbp.address },
        reviews: reviews.map((r, index) => ({ index, author: r.author, rating: r.rating, text: r.text })),
        task: "Write one reply per review (use its index) and four weekly posts.",
      }),
      schema: draftSchema,
      maxOutputTokens: 8192,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ResearchError(e.message);
    throw e;
  }
  const replies = out.replies
    .filter((r) => reviews[r.index])
    .map((r) => ({ author: reviews[r.index].author, rating: reviews[r.index].rating, review: reviews[r.index].text, reply: r.reply.trim() }));
  return { replies, posts: out.posts.slice(0, 4) };
}
