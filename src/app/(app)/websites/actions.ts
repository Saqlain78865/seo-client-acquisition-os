"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { db } from "@/lib/db";
import { WebsiteError, createWebsite, deleteWebsite, type WebsiteKind } from "@/lib/websites";
import { GscError, explore, linkWebsite, listSites, matchSite, propertyMatches, type ExploreInput, type ExploreResult } from "@/lib/search-console";
import { checkSiteChanges } from "@/lib/site-changes";
import { WorkLogError, addWork, deleteWork } from "@/lib/work-log";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof GscError || e instanceof WebsiteError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("websites", e)) };
}

export async function createWebsiteAction(input: { name: string; url: string; kind: WebsiteKind }): Promise<R<{ id: string }>> {
  const session = await requireSession();
  try {
    const w = await createWebsite(session.workspace.id, session.user.id, input);
    revalidatePath("/websites");
    return { ok: true, id: w.id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWebsiteAction(id: string) {
  const session = await requireSession();
  await deleteWebsite(session.workspace.id, session.user.id, id);
  revalidatePath("/websites");
  redirect("/websites");
}

/** This website's own Search Console properties (other sites' properties are never offered). */
export async function websitePropertiesAction(id: string): Promise<R<{ own: string[]; suggested: string | null; total: number }>> {
  const session = await requireSession();
  try {
    const w = await db.website.findFirst({ where: { id, workspaceId: session.workspace.id }, select: { domain: true } });
    if (!w) return { ok: false, error: "Website not found." };
    const sites = await listSites(session.workspace.id);
    const own = sites.filter((s) => propertyMatches(s.siteUrl, w.domain)).map((s) => s.siteUrl);
    return { ok: true, own, suggested: matchSite(sites, w.domain), total: sites.length };
  } catch (e) {
    return fail(e);
  }
}

export async function linkWebsiteAction(id: string, siteUrl: string | null): Promise<R> {
  const session = await requireSession();
  try {
    await linkWebsite(session.workspace.id, session.user.id, id, siteUrl);
    revalidatePath(`/websites/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function exploreAction(id: string, input: ExploreInput): Promise<R<{ data: ExploreResult }>> {
  const session = await requireSession();
  try {
    return { ok: true, data: await explore(session.workspace.id, id, input) };
  } catch (e) {
    return fail(e);
  }
}

export async function addWorkAction(id: string, input: { month: string; category: string; title?: string; detail?: string; url?: string; count?: number }): Promise<R> {
  const session = await requireSession();
  try {
    await addWork(session.workspace.id, id, input);
    revalidatePath(`/websites/${id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof WorkLogError) return { ok: false, error: e.message };
    return fail(e);
  }
}

export async function deleteWorkAction(id: string, entryId: string): Promise<R> {
  const session = await requireSession();
  try {
    await deleteWork(session.workspace.id, entryId);
    revalidatePath(`/websites/${id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof WorkLogError) return { ok: false, error: e.message };
    return fail(e);
  }
}

export async function checkWebsiteChangesAction(id: string): Promise<R<{ baseline: boolean; changes: number; pages: number }>> {
  const session = await requireSession();
  try {
    const r = await checkSiteChanges(session.workspace.id, { websiteId: id });
    revalidatePath(`/websites/${id}`);
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof Error && /respond|Blocked|could not be found|not found/i.test(e.message)) return { ok: false, error: e.message };
    return fail(e);
  }
}
