"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { db } from "@/lib/db";
import { GscError, linkSite, listSites, matchSite, syncProspect, type GscSite } from "@/lib/search-console";
import { checkSiteChanges } from "@/lib/site-changes";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof GscError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("tracking", e)) };
}

/** The Search Console properties of the connected account, with the one that matches this website. */
export async function gscSitesAction(prospectId: string): Promise<R<{ sites: GscSite[]; suggested: string | null }>> {
  const session = await requireSession();
  try {
    const p = await db.prospect.findFirst({ where: { id: prospectId, workspaceId: session.workspace.id }, select: { domain: true } });
    if (!p) return { ok: false, error: "Prospect not found." };
    const sites = await listSites(session.workspace.id);
    return { ok: true, sites, suggested: matchSite(sites, p.domain) };
  } catch (e) {
    return fail(e);
  }
}

export async function linkGscAction(prospectId: string, siteUrl: string | null): Promise<R<{ days: number }>> {
  const session = await requireSession();
  try {
    const days = await linkSite(session.workspace.id, session.user.id, prospectId, siteUrl);
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true, days };
  } catch (e) {
    return fail(e);
  }
}

export async function syncGscAction(prospectId: string): Promise<R<{ days: number }>> {
  const session = await requireSession();
  try {
    const days = await syncProspect(session.workspace.id, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true, days };
  } catch (e) {
    return fail(e);
  }
}

/** Crawls the live website now and records what changed since the last check. */
export async function checkChangesAction(prospectId: string): Promise<R<{ baseline: boolean; changes: number; pages: number }>> {
  const session = await requireSession();
  try {
    const r = await checkSiteChanges(session.workspace.id, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error && /respond|Blocked|could not be found/i.test(e.message) ? e.message : (await fail(e)).error };
  }
}
