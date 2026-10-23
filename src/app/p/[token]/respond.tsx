"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, MessageCircleQuestion, PartyPopper, X } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { respondAction } from "./actions";

type Kind = "ACCEPT" | "QUESTION";

export function RespondButtons({ token, accepted, companyName }: { token: string; accepted: boolean; companyName: string | null }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof respondAction>>, formData: FormData) => {
    const result = await respondAction(token, prev, formData);
    if (result?.ok) setOpen(null);
    return result;
  }, undefined);
  const done: Kind | null = accepted || (state?.ok && state.kind === "ACCEPT") ? "ACCEPT" : state?.ok ? "QUESTION" : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {done === "ACCEPT" ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ec] px-3 py-1.5 text-xs font-semibold text-[#15803d]">
          <CheckCircle2 className="h-4 w-4" /> Proposal accepted
        </span>
      ) : (
        <>
          <Button size="sm" variant="secondary" onClick={() => setOpen("QUESTION")}>
            <MessageCircleQuestion className="h-4 w-4" /> <span className="hidden sm:inline">Ask a question</span>
          </Button>
          <Button size="sm" className="bg-[#15803d] hover:bg-[#126c34]" onClick={() => setOpen("ACCEPT")}>
            <CheckCircle2 className="h-4 w-4" /> Accept proposal
          </Button>
        </>
      )}
      {done === "QUESTION" && !open && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#0b1f3a] px-4 py-2 text-sm text-white shadow-lg">
          Thanks — your question was sent{companyName ? ` to ${companyName}` : ""}.
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="respond-title">
          <div className="absolute inset-0 bg-[#0b1f3a]/50 backdrop-blur-sm" onClick={() => setOpen(null)} />
          <form action={action} className="animate-rise relative w-full max-w-md space-y-4 rounded-t-2xl bg-white p-6 text-[#0f1b2d] shadow-2xl sm:rounded-2xl">
            <button type="button" onClick={() => setOpen(null)} className="absolute top-4 right-4 rounded-lg p-1 text-[#5b6b82] hover:bg-[#f1f4f9]" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <span className={open === "ACCEPT" ? "rounded-xl bg-[#e7f6ec] p-2.5 text-[#15803d]" : "rounded-xl bg-[#e8efff] p-2.5 text-[#1d4ed8]"}>
                {open === "ACCEPT" ? <PartyPopper className="h-5 w-5" /> : <MessageCircleQuestion className="h-5 w-5" />}
              </span>
              <div>
                <h2 id="respond-title" className="text-lg font-semibold">
                  {open === "ACCEPT" ? "Accept this proposal" : "Ask a question"}
                </h2>
                <p className="text-sm text-[#5b6b82]">
                  {open === "ACCEPT" ? `${companyName ?? "The team"} will contact you to confirm the next steps.` : "We usually reply within one working day."}
                </p>
              </div>
            </div>
            {state?.error && <Alert tone="danger">{state.error}</Alert>}
            <input type="hidden" name="kind" value={open} />
            <Field label="Your name" name="name" required>
              <Input autoFocus autoComplete="name" maxLength={120} />
            </Field>
            <Field label="Email or phone" name="contact" hint="So we can reach you.">
              <Input autoComplete="email" maxLength={200} />
            </Field>
            <Field label={open === "ACCEPT" ? "Message (optional)" : "Your question"} name="message" required={open === "QUESTION"}>
              <Textarea rows={3} maxLength={3000} />
            </Field>
            <Button type="submit" size="lg" disabled={pending} className={open === "ACCEPT" ? "w-full bg-[#15803d] hover:bg-[#126c34]" : "w-full"}>
              {pending ? "Sending…" : open === "ACCEPT" ? "Yes, I accept" : "Send question"}
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
