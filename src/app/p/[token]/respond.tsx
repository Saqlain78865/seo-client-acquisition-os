"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageCircleQuestion, PartyPopper, X } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { respondAction } from "./actions";

type Kind = "ACCEPT" | "QUESTION";

/** Draw-to-sign box (mouse, finger or pen). The drawing is sent as a PNG with the form. */
function SignaturePad() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState("");
  const drawing = useRef(false);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * e.currentTarget.width) / r.width, ((e.clientY - r.top) * e.currentTarget.height) / r.height] as const;
  };
  const ctx = () => {
    const c = canvas.current!.getContext("2d")!;
    c.lineWidth = 3.2;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#0f1b2d";
    return c;
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">Your signature</span>
        {data && (
          <button
            type="button"
            className="text-xs text-[#5b6b82] underline"
            onClick={() => {
              ctx().clearRect(0, 0, canvas.current!.width, canvas.current!.height);
              setData("");
            }}
          >
            Clear
          </button>
        )}
      </div>
      <canvas
        ref={canvas}
        width={760}
        height={220}
        aria-label="Sign here"
        className="h-28 w-full touch-none rounded-xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc]"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const [x, y] = point(e);
          const c = ctx();
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + 0.1, y + 0.1);
          c.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const [x, y] = point(e);
          const c = ctx();
          c.lineTo(x, y);
          c.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          setData(canvas.current!.toDataURL("image/png"));
        }}
      />
      {!data && <p className="mt-1 text-xs text-[#5b6b82]">Sign with your finger, mouse or pen.</p>}
      <input type="hidden" name="signature" value={data} />
    </div>
  );
}

/** Shown after acceptance: how to pay, as set by the consultant (a link becomes a button). */
function PaymentNote({ text }: { text: string }) {
  const url = text.trim().match(/^https?:\/\/\S+$/) ? text.trim() : null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#bbf7d0] bg-white p-4 text-sm text-[#0f1b2d] shadow-2xl">
        <p className="font-semibold text-[#15803d]">Thank you — proposal accepted and signed.</p>
        <p className="mt-1 text-[#5b6b82]">To get started, here is how to make the first payment:</p>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-[#15803d] px-4 py-2.5 font-semibold text-white hover:bg-[#126c34]">
            Pay now
          </a>
        ) : (
          <p className="mt-2 whitespace-pre-line rounded-lg bg-[#f1f5f9] p-3">{text}</p>
        )}
      </div>
    </div>
  );
}

export function RespondButtons({ token, accepted, companyName, paymentInstructions }: { token: string; accepted: boolean; companyName: string | null; paymentInstructions: string | null }) {
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
      {done === "ACCEPT" && paymentInstructions && !open && <PaymentNote text={paymentInstructions} />}
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
            {open === "ACCEPT" ? (
              <>
                <SignaturePad />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="agree" required className="mt-0.5 h-4 w-4 accent-[#15803d]" />
                  <span>I accept this proposal, its scope and its terms, and sign it electronically.</span>
                </label>
              </>
            ) : (
              <Field label="Your question" name="message" required>
                <Textarea rows={3} maxLength={3000} />
              </Field>
            )}
            <Button type="submit" size="lg" disabled={pending} className={open === "ACCEPT" ? "w-full bg-[#15803d] hover:bg-[#126c34]" : "w-full"}>
              {pending ? "Sending…" : open === "ACCEPT" ? "Sign and accept" : "Send question"}
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
