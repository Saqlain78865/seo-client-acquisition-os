"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Megaphone, MessageSquareReply, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader } from "@/components/ui";
import type { GbpDrafts } from "@/lib/research/gbp-drafts";
import { gbpDraftsAction } from "./actions";

const BUTTONS = { CALL: "Call now", BOOK: "Book", LEARN_MORE: "Learn more", ORDER: "Order online" } as const;

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => toast.error("Could not copy — select the text instead."),
        );
      }}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Gemini drafts for the profile: a reply per review and four weekly posts, to copy into Google. */
export function GbpDraftsCard({ prospectId }: { prospectId: string }) {
  const [drafts, setDrafts] = useState<GbpDrafts | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await gbpDraftsAction(prospectId);
      if (!r.ok) return void toast.error(r.error);
      setDrafts(r.drafts);
    });

  return (
    <Card>
      <CardHeader
        title="Review replies & weekly posts"
        description="Written by Gemini from the profile above. Copy each one into Google Business Profile — nothing is posted for you."
        action={
          <Button size="sm" variant={drafts ? "secondary" : "primary"} disabled={pending} onClick={run}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {pending ? "Writing…" : drafts ? "Write again" : "Write drafts"}
          </Button>
        }
      />
      {drafts && (
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <MessageSquareReply className="h-4 w-4 text-primary" /> Replies to reviews
            </h3>
            {drafts.replies.length === 0 ? (
              <p className="text-sm text-muted">No review text to reply to. Fetch the profile again or paste reviews in the manual form.</p>
            ) : (
              <ul className="space-y-3">
                {drafts.replies.map((r, i) => (
                  <li key={i} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="font-semibold text-amber-500">{"★".repeat(Math.round(r.rating))}</span> {r.author}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">“{r.review}”</p>
                    <p className="mt-2 whitespace-pre-line">{r.reply}</p>
                    <div className="mt-1 text-right">
                      <CopyText text={r.reply} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Megaphone className="h-4 w-4 text-primary" /> Google posts — one a week
            </h3>
            <ol className="space-y-3">
              {drafts.posts.map((p, i) => (
                <li key={i} className="rounded-xl border border-border p-3 text-sm">
                  <p className="text-xs font-medium text-muted">Week {i + 1}</p>
                  <p className="font-semibold">{p.title}</p>
                  <p className="mt-1 whitespace-pre-line">{p.body}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">Button: {BUTTONS[p.button]}</span>
                    <CopyText text={`${p.title}\n\n${p.body}`} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}
