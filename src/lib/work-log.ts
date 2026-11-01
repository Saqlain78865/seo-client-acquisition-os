import "server-only";
import { db } from "./db";

/**
 * The SEO work done on a website each month, for its monthly report. Entered by the SEO (one click
 * for common tasks); work the weekly check found on the live site is added to the report as well.
 * Nothing is invented: the report only shows logged or detected work.
 */

export class WorkLogError extends Error {}

export const WORK_CATEGORIES = {
  INTERNAL_LINKING: { label: "Internal linking", example: "Added internal links between related pages" },
  CONTENT_OPTIMIZATION: { label: "Content optimisation", example: "Improved existing content for its target keywords" },
  SEMANTIC_SEO: { label: "Semantic SEO / topical coverage", example: "Covered related questions and entities on key pages" },
  NEW_CONTENT: { label: "New articles and pages", example: "Published a new article" },
  ONPAGE: { label: "Titles, meta and headings", example: "Rewrote titles and meta descriptions" },
  TECHNICAL: { label: "Technical SEO", example: "Fixed crawl and indexing issues" },
  SCHEMA: { label: "Structured data (schema)", example: "Added schema markup" },
  SPEED: { label: "Speed and Core Web Vitals", example: "Improved page speed" },
  LINK_BUILDING: { label: "Link building and outreach", example: "Earned new backlinks" },
  LOCAL: { label: "Local SEO / Google Business Profile", example: "Posted updates and replied to reviews" },
  OTHER: { label: "Other work", example: "Other SEO work" },
} as const;
export type WorkCategory = keyof typeof WORK_CATEGORIES;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function addWork(workspaceId: string, websiteId: string, input: { month: string; category: string; title?: string; detail?: string; url?: string; count?: number }) {
  const site = await db.website.findFirst({ where: { id: websiteId, workspaceId }, select: { id: true } });
  if (!site) throw new WorkLogError("Website not found.");
  if (!MONTH.test(input.month)) throw new WorkLogError("Choose a month.");
  const category = (input.category in WORK_CATEGORIES ? input.category : "OTHER") as WorkCategory;
  const title = (input.title?.trim() || WORK_CATEGORIES[category].example).slice(0, 200);
  let url: string | null = null;
  if (input.url?.trim()) {
    try {
      url = new URL(/^https?:\/\//i.test(input.url.trim()) ? input.url.trim() : `https://${input.url.trim()}`).toString();
    } catch {
      throw new WorkLogError("That page address is not valid.");
    }
  }
  const count = Math.min(Math.max(Math.round(input.count ?? 1), 1), 999);
  return db.workLogEntry.create({ data: { workspaceId, websiteId, month: input.month, category, title, detail: input.detail?.trim().slice(0, 600) || null, url, count } });
}

export async function deleteWork(workspaceId: string, id: string) {
  const { count } = await db.workLogEntry.deleteMany({ where: { id, workspaceId } });
  if (!count) throw new WorkLogError("Entry not found.");
}

export function monthWork(workspaceId: string, websiteId: string, month: string) {
  return db.workLogEntry.findMany({ where: { workspaceId, websiteId, month }, orderBy: [{ category: "asc" }, { createdAt: "asc" }] });
}
