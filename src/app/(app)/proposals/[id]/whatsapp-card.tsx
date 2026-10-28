"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Eye, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader } from "@/components/ui";
import { WhatsAppIcon } from "@/components/whatsapp-button";
import { markSeenOnWhatsAppAction, markSentOnWhatsAppAction } from "../whatsapp-actions";

type State = { sentAt: string | null; seen: boolean; recipient: string | null; openedNotConfirmed: boolean };

/**
 * WhatsApp happens on the phone, so the user tells LeadLift: "sent" (proposal becomes Sent, reminders
 * are scheduled) and "seen" (a follow-up is scheduled with the WhatsApp message ready to open).
 */
export function WhatsAppStatusCard({ proposalId, state, followUp }: { proposalId: string; state: State; followUp: { message: string; url: string | null } | null }) {
  const [pending, start] = useTransition();
  const [ready, setReady] = useState(followUp);
  const router = useRouter();
  const sentOn = state.sentAt ? new Date(state.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

  return (
    <Card>
      <CardHeader title="WhatsApp" description="Tell LeadLift what happened in WhatsApp, so status and follow-ups stay right." />
      <div className="space-y-3 p-5 text-sm">
        {!state.sentAt ? (
          <>
            <p className="text-muted">{state.openedNotConfirmed ? "The chat was opened from here but not confirmed as sent." : "Sent the proposal from WhatsApp? Mark it here."}</p>
            <Button
              className="w-full bg-[#25D366] text-white hover:brightness-95"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await markSentOnWhatsAppAction(proposalId);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.already ? "Already marked as sent." : `Marked as sent on WhatsApp${r.followUps ? ` · ${r.followUps} reminders scheduled` : ""}`);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Mark as sent on WhatsApp
            </Button>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2">
              <CheckCheck className={state.seen ? "h-4 w-4 text-[#34B7F1]" : "h-4 w-4 text-muted"} />
              Sent {sentOn}
              {state.recipient?.startsWith("+") ? ` to ${state.recipient}` : ""}
              {state.seen && <span className="text-xs font-medium text-[#0b8fd1]">· seen</span>}
            </p>
            {!state.seen && (
              <Button
                variant="secondary"
                className="w-full"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await markSeenOnWhatsAppAction(proposalId);
                    if (!r.ok) return void toast.error(r.error);
                    setReady({ message: r.message, url: r.url });
                    toast.success("Marked as seen — a follow-up is due tomorrow if they don't reply.");
                    router.refresh();
                  })
                }
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} They&apos;ve seen it (blue ticks)
              </Button>
            )}
            {state.seen && ready && (
              <div className="space-y-2 rounded-xl border border-border bg-surface-2/50 p-3">
                <p className="text-xs font-medium text-muted">Follow-up message, ready</p>
                <p className="whitespace-pre-line text-xs">{ready.message}</p>
                {ready.url ? (
                  <a href={ready.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#25D366] px-3 text-xs font-semibold text-white hover:brightness-95">
                    <WhatsAppIcon className="h-3.5 w-3.5" /> Send follow-up on WhatsApp
                  </a>
                ) : (
                  <p className="text-xs text-muted">No WhatsApp number saved — copy the message.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
