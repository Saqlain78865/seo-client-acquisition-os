"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImagePlus, Loader2, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader } from "@/components/ui";
import { checkReviewsAction, createReputationProposalAction, deleteReviewShotAction, uploadReviewShotAction } from "./actions";

type Review = { rating: number; text: string; when: string | null; verdict: "POLICY" | "GENUINE" | null; policy: string | null; reason: string | null; reply: string | null };

/**
 * Reputation work for one business: the negative reviews with Gemini's policy check, the user's
 * screenshots of them, and a one-click reputation proposal for the client.
 */
export function ReputationCard({ prospectId, reviews, shots, aiReady }: { prospectId: string; reviews: Review[]; shots: { id: string; caption: string | null }[]; aiReady: boolean }) {
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const removable = reviews.filter((r) => r.verdict === "POLICY").length;

  const upload = (files: FileList | null) =>
    start(async () => {
      if (!files?.length) return;
      let added = 0;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set("file", file);
        const r = await uploadReviewShotAction(prospectId, fd);
        if (r.ok) added++;
        else toast.error(`${file.name}: ${r.error}`);
      }
      if (added) toast.success(`${added} screenshot${added === 1 ? "" : "s"} added`);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        title="Reputation — bad reviews"
        description="Check each negative review against Google's policies, add your screenshots, and send the client a reputation proposal."
        action={
          <Button
            size="sm"
            disabled={pending || (!reviews.length && !shots.length)}
            onClick={() =>
              start(async () => {
                const r = await createReputationProposalAction(prospectId);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Reputation proposal created");
                router.push(`/proposals/${r.proposalId}`);
              })
            }
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Create reputation proposal
          </Button>
        }
      />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {reviews.length} negative review{reviews.length === 1 ? "" : "s"}
              {removable > 0 && <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{removable} may break Google policy</span>}
            </h3>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !reviews.length || !aiReady}
              title={aiReady ? undefined : "Add a Gemini key on the Integrations page"}
              onClick={() =>
                start(async () => {
                  const r = await checkReviewsAction(prospectId);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Check with AI
            </Button>
          </div>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted">No negative reviews yet. Paste them in “Enter by hand” above (one review per paragraph, starting with its stars, e.g. “1★ …”), or upload screenshots.</p>
          ) : (
            <ul className="space-y-2">
              {reviews.map((r, i) => (
                <li key={i} className={`rounded-xl border p-3 text-sm ${r.verdict === "POLICY" ? "border-warning/40 bg-warning-soft/40" : "border-border"}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-amber-500">{"★".repeat(r.rating)}</span>
                    {r.when && <span className="text-muted">{r.when}</span>}
                    {r.verdict === "POLICY" && (
                      <span className="inline-flex items-center gap-1 font-medium text-warning">
                        <ShieldAlert className="h-3.5 w-3.5" /> Breaks policy{r.policy ? `: ${r.policy}` : ""}
                      </span>
                    )}
                    {r.verdict === "GENUINE" && <span className="font-medium text-info">Genuine — reply and outweigh</span>}
                  </div>
                  <p className="mt-1 line-clamp-3 text-text/85">“{r.text}”</p>
                  {r.reason && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                  {r.reply && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-primary">Suggested reply</summary>
                      <p className="mt-1 whitespace-pre-line">{r.reply}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Screenshots ({shots.length})</h3>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-3.5 w-3.5" /> Add screenshots
            </Button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
          {shots.length === 0 ? (
            <p className="text-sm text-muted">Screenshot the bad reviews on Google Maps (phone or PC) and add them here — they appear in the proposal under “As your customers see it on Google”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {shots.map((s) => (
                <figure key={s.id} className="group relative overflow-hidden rounded-lg border border-border bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/review-screenshots/${s.id}`} alt={s.caption ?? "Review screenshot"} className="block h-32 w-full object-cover object-top" />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteReviewShotAction(prospectId, s.id);
                        if (!r.ok) toast.error(r.error);
                        router.refresh();
                      })
                    }
                    className="absolute top-1.5 right-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="Remove screenshot"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
