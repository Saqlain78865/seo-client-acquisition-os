"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { FOLLOW_UP_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { scheduleFollowUpAction, updateFollowUpAction } from "../actions";

export function FollowUpForm({ prospectId }: { prospectId: string }) {
  const [state, action, pending] = useActionState(scheduleFollowUpAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      toast.success("Follow-up scheduled");
    }
  }, [state]);
  const e = state?.fieldErrors;
  return (
    <form ref={formRef} action={action} className="space-y-3">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="prospectId" value={prospectId} />
      <Field label="Follow-up type" name="type" id="followup-type" error={e?.type}>
        <Select defaultValue="CUSTOM">
          {Object.entries(FOLLOW_UP_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Due" name="dueAt" id="followup-dueAt" error={e?.dueAt}>
        <Input type="datetime-local" required />
      </Field>
      <Field label="Note" name="note" id="followup-note" error={e?.note}>
        <Textarea rows={2} className="min-h-0" />
      </Field>
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        Schedule follow-up
      </Button>
    </form>
  );
}

const STATUS_TONE = { PENDING: "warning", DONE: "success", PAUSED: "neutral", CANCELLED: "neutral" } as const;

export function FollowUpRow({
  followUp: f,
}: {
  followUp: { id: string; label: string; dueAt: string; status: string; note: string | null; proposalId?: string | null };
}) {
  const update = updateFollowUpAction.bind(null, f.id);
  const overdue = f.status === "PENDING" && new Date(f.dueAt) < new Date();
  return (
    <li className="space-y-2 px-5 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{f.label}</p>
          <p className={overdue ? "text-xs text-danger" : "text-xs text-muted"}>
            {overdue ? "Overdue · " : ""}
            {formatDate(f.dueAt, true)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[f.status as keyof typeof STATUS_TONE] ?? "neutral"}>{f.status.toLowerCase()}</Badge>
      </div>
      {f.note && <p className="text-xs text-muted">{f.note}</p>}
      <div className="flex flex-wrap gap-1">
        {f.status === "PENDING" && f.proposalId && (
          <Link href={`/proposals/${f.proposalId}/send?followup=1`} className={buttonClass("primary", "sm")}>
            <Mail className="h-3.5 w-3.5" /> Write follow-up
          </Link>
        )}
        {f.status === "PENDING" && (
          <>
            <form action={update}>
              <input type="hidden" name="status" value="DONE" />
              <Button type="submit" size="sm" variant="secondary">Done</Button>
            </form>
            <form action={update}>
              <input type="hidden" name="status" value="PAUSED" />
              <Button type="submit" size="sm" variant="ghost">Pause</Button>
            </form>
            <form action={update}>
              <input type="hidden" name="status" value="CANCELLED" />
              <Button type="submit" size="sm" variant="ghost">Cancel</Button>
            </form>
          </>
        )}
        {f.status === "PAUSED" && (
          <form action={update}>
            <input type="hidden" name="status" value="PENDING" />
            <Button type="submit" size="sm" variant="ghost">Resume</Button>
          </form>
        )}
      </div>
    </li>
  );
}
