"use server";

import { z } from "zod";
import { reportError } from "@/lib/log";
import { respondToProposal, ResponseError } from "@/lib/messaging/share";

export type RespondState = { ok?: true; kind?: "ACCEPT" | "QUESTION"; error?: string } | undefined;

const schema = z.object({
  kind: z.enum(["ACCEPT", "QUESTION"]),
  name: z.string().trim().min(2, "Please enter your name").max(120),
  contact: z.string().trim().max(200).optional(),
  message: z.string().trim().max(3000).optional(),
});

/** Public: anyone with an active link may reply. Input is length-limited and rate-limited per proposal. */
export async function respondAction(token: string, _: RespondState, formData: FormData): Promise<RespondState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  if (parsed.data.kind === "QUESTION" && !parsed.data.message) return { error: "Please write your question." };
  try {
    await respondToProposal(token, parsed.data);
    return { ok: true, kind: parsed.data.kind };
  } catch (e) {
    if (e instanceof ResponseError) return { error: e.message };
    await reportError("proposal-response", e);
    return { error: "Something went wrong. Please try again or contact the sender directly." };
  }
}
