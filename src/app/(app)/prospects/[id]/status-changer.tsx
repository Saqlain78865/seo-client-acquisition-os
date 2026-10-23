"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { changeStatusAction } from "../actions";

export function StatusChanger({
  prospectId,
  current,
  currency,
  statuses,
}: {
  prospectId: string;
  current: string;
  currency: string;
  statuses: { key: string; label: string }[];
}) {
  const [status, setStatus] = useState(current);
  const [state, action, pending] = useActionState(changeStatusAction.bind(null, prospectId), undefined);
  useEffect(() => {
    if (state?.ok) toast.success("Status updated");
  }, [state]);
  const e = state?.fieldErrors;
  const needsReason = status === "LOST" || status === "NOT_INTERESTED";

  return (
    <form action={action} className="space-y-3">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Status" name="status" error={e?.status}>
        <Select value={status} onChange={(ev) => setStatus(ev.target.value)}>
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      {status === "WON" && (
        <Field label={`Agreed value (${currency})`} name="wonValue" error={e?.wonValue} hint="Actual contracted value — counted as won revenue.">
          <Input type="number" min={0} step="any" required />
        </Field>
      )}
      {needsReason && (
        <Field label="Reason" name="lostReason" error={e?.lostReason}>
          <Textarea rows={3} required />
        </Field>
      )}
      <Button type="submit" variant="secondary" className="w-full" disabled={pending || status === current}>
        {pending ? "Updating…" : "Update status"}
      </Button>
    </form>
  );
}
