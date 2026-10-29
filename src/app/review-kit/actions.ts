"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ReviewKitError, setReviewLink } from "@/lib/review-kit";

export async function saveReviewLinkAction(prospectId: string, link: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    await setReviewLink(session.workspace.id, session.user.id, prospectId, link);
    revalidatePath("/review-kit");
    return { ok: true };
  } catch (e) {
    if (e instanceof ReviewKitError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("review-kit", e)) };
  }
}
