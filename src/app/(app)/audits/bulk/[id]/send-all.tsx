"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, CircleAlert, FileText, Loader2, Mail, Send } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { BatchSendRow } from "@/lib/messaging/bulk-send";
import { createBatchProposalsAction, sendBatchAction } from "./actions";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { startCampaignAction } from "../../../campaigns/actions";

/** "Create proposals for all" for batches that were run without automatic proposals. */
export function CreateAllProposals({ batchId, count }: { batchId: string; count: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createBatchProposalsAction(batchId);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`${r.created} proposal${r.created === 1 ? "" : "s"} drafted`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Create proposals for all {count}
    </Button>
  );
}

/**
 * Review every proposal of the bulk audit and send the ready ones in one go. Nothing is sent until
 * the person ticks the confirmation and presses Send.
 */
export function SendAll({ batchId, rows, senderReady }: { batchId: string; rows: BatchSendRow[]; senderReady: boolean }) {
  const ready = rows.filter((r) => !r.problem);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(ready.map((r) => r.proposalId)));
  const [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const sentCount = rows.filter((r) => r.sent).length;
  const [dailyLimit, setDailyLimit] = useState(20);
  const startAuto = () => {
    const ids = [...chosen];
    const days = Math.ceil(ids.length / Math.max(dailyLimit, 1));
    if (!confirm(`Start auto-send for ${ids.length} proposal${ids.length === 1 ? "" : "s"}?

Up to ${dailyLimit} emails a day between 9:00 and 18:00 while LeadLift is open — about ${days} day${days === 1 ? "" : "s"}. Clients who reply, accept, decline or opt out are skipped. You can pause or stop it on the Auto-send page.`)) return;
    start(async () => {
      const r = await startCampaignAction(batchId, ids, dailyLimit);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Auto-send started");
      router.push("/campaigns");
    });
  };
  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const send = () => {
    const ids = [...chosen];
    if (!confirm(`Send ${ids.length} proposal email${ids.length === 1 ? "" : "s"} now, each with its PDF attached?`)) return;
    start(async () => {
      const r = await sendBatchAction(batchId, ids);
      if (!r.ok) return void toast.error(r.error);
      setResults(Object.fromEntries(r.results.map((x) => [x.proposalId, x])));
      const ok = r.results.filter((x) => x.ok).length;
      if (ok) toast.success(`${ok} proposal${ok === 1 ? "" : "s"} sent`);
      if (ok < r.results.length) toast.error(`${r.results.length - ok} could not be sent — see the list`);
      setChosen(new Set());
      setConfirmed(false);
      router.refresh();
    });
  };

  return (
    <Card className="mb-6">
      <CardHeader
        title="Send the proposals"
        description={`${ready.length} ready to send${sentCount ? ` · ${sentCount} already sent` : ""}. Each client gets your default email template with their own PDF.`}
        action={
          <Link href="/templates" className="text-xs text-primary hover:underline">
            Edit the email
          </Link>
        }
      />
      {!senderReady && (
        <p className="border-b border-border px-5 py-3 text-sm text-muted">
          <Link href="/integrations" className="font-medium text-primary hover:underline">
            Connect Gmail
          </Link>{" "}
          to email all proposals in one go. WhatsApp works without it.
        </p>
      )}
      <>
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => {
              const res = results[r.proposalId];
              return (
                <li key={r.proposalId} className={cn("flex items-center gap-3 px-5 py-2.5", r.problem && !res && "opacity-70")}>
                  <input type="checkbox" aria-label={`Send to ${r.businessName}`} disabled={!senderReady || !!r.problem || pending} checked={chosen.has(r.proposalId)} onChange={() => toggle(r.proposalId)} className="h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/proposals/${r.proposalId}`} className="font-medium hover:text-primary">
                      {r.businessName}
                    </Link>
                    <p className="flex items-center gap-1 truncate text-xs text-muted">
                      <Mail className="h-3 w-3" /> {r.to ?? "no email"} {r.to && !r.verified && <span className="text-warning">· found on the website, not verified</span>}
                    </p>
                  </div>
                  {r.whatsapp && !r.problem?.startsWith("Opted out") && <WhatsAppButton proposalId={r.proposalId} number={r.whatsapp} size="sm" />}
                  {res ? (
                    <Badge tone={res.ok ? "success" : "danger"}>
                      {res.ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />} {res.message}
                    </Badge>
                  ) : r.sent ? (
                    <Badge tone="success">Sent</Badge>
                  ) : r.problem ? (
                    <span className="max-w-xs text-right text-xs text-warning">{r.problem}</span>
                  ) : (
                    <Badge tone="info">Ready</Badge>
                  )}
                </li>
              );
            })}
          </ul>
          {senderReady && ready.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border p-5">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>I checked these addresses and may contact these businesses.</span>
              </label>
              <Button className="ml-auto" disabled={pending || !confirmed || chosen.size === 0} onClick={send}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {pending ? "Sending…" : `Send ${chosen.size} now`}
              </Button>
              <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary-soft/40 p-3 text-sm">
                <CalendarClock className="h-4 w-4 text-primary" />
                <span className="font-medium">Or send automatically</span>
                <label className="flex items-center gap-2 text-muted">
                  up to
                  <Input type="number" min={1} max={50} value={dailyLimit} onChange={(e) => setDailyLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} className="h-8 w-20 text-sm" aria-label="Emails per day" />
                  a day
                </label>
                <Button variant="secondary" className="ml-auto" disabled={pending || !confirmed || chosen.size === 0} onClick={startAuto}>
                  Start auto-send
                </Button>
                <span className="w-full text-xs text-muted">Spread over working hours (9:00–18:00) while LeadLift is open. Stops by itself for clients who reply, accept, decline or opt out.</span>
              </div>
            </div>
          )}
      </>
    </Card>
  );
}
