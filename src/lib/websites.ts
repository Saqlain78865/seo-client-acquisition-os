import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import { normalizeDomain, normalizeWebsiteUrl } from "./url";
import { isGbpLink } from "./research/gbp-link";

/**
 * My Websites: sites you run or manage — your blog, your own projects, and client sites you were
 * given access to. They are separate from prospects and proposals; each has its own Search
 * Console property and change log.
 */

export class WebsiteError extends Error {}
export type WebsiteKind = "OWN" | "CLIENT";

export async function createWebsite(workspaceId: string, userId: string, input: { name: string; url: string; kind: WebsiteKind }) {
  const name = input.name.trim();
  if (name.length < 2) throw new WebsiteError("Give the website a name.");
  if (isGbpLink(input.url)) throw new WebsiteError("Enter the website address, not a Google Maps link.");
  let url: string;
  try {
    url = `${new URL(normalizeWebsiteUrl(input.url)).origin}/`;
  } catch {
    throw new WebsiteError("Enter a valid website address, e.g. example.com.");
  }
  const domain = normalizeDomain(url);
  if (!domain.includes(".")) throw new WebsiteError("Enter a valid website address, e.g. example.com.");
  if (await db.website.findFirst({ where: { workspaceId, domain }, select: { id: true } })) throw new WebsiteError(`${domain} is already in My Websites.`);
  const w = await db.website.create({ data: { workspaceId, name: name.slice(0, 120), url, domain, kind: input.kind === "CLIENT" ? "CLIENT" : "OWN" } });
  await logActivity({ workspaceId, userId, type: "website.added", message: `${domain} added to My Websites` });
  return w;
}

export function listWebsites(workspaceId: string) {
  return db.website.findMany({ where: { workspaceId }, orderBy: [{ kind: "asc" }, { name: "asc" }], include: { _count: { select: { siteChanges: true } } } });
}

export async function getWebsite(workspaceId: string, id: string) {
  return db.website.findFirst({ where: { id, workspaceId } });
}

export async function deleteWebsite(workspaceId: string, userId: string, id: string) {
  const w = await db.website.findFirst({ where: { id, workspaceId } });
  if (!w) throw new WebsiteError("Website not found.");
  await db.website.delete({ where: { id } });
  await logActivity({ workspaceId, userId, type: "website.removed", message: `${w.domain} removed from My Websites` });
}
