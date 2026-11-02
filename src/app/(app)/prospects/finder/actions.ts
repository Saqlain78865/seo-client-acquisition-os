"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ResearchError } from "@/lib/research/service";
import { addFoundBusiness, findProspects } from "@/lib/research/places-service";
import type { FoundBusiness } from "@/lib/research/places-tools";

type Found = FoundBusiness & { prospectId: string | null };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof ResearchError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("prospect-finder", e)) };
}

export async function findProspectsAction(query: string): Promise<{ ok: true; results: Found[] } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    return { ok: true, results: await findProspects(session.workspace.id, query, undefined, "OSM") };
  } catch (e) {
    return fail(e);
  }
}

export async function addFoundAction(business: FoundBusiness, query: string): Promise<{ ok: true; prospectId: string; created: boolean } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    const r = await addFoundBusiness(session.workspace.id, session.user.id, business, query);
    revalidatePath("/prospects");
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}
