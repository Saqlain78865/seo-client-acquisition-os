"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Field, Input } from "@/components/ui";
import { addStatusAction, deleteStatusAction, moveStatusAction, renameStatusAction } from "./actions";

type Status = { id: string; key: string; label: string; isSystem: boolean; isTerminal: boolean; count: number };

function Row({ s, first, last, canEdit }: { s: Status; first: boolean; last: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-2 px-5 py-2">
      <form action={renameStatusAction.bind(null, s.id)} className="flex flex-1 items-center gap-2">
        <Input name="label" defaultValue={s.label} aria-label={`Status name: ${s.label}`} disabled={!canEdit} className="h-8" onBlur={(e) => e.currentTarget.value !== s.label && e.currentTarget.form?.requestSubmit()} />
      </form>
      <span className="w-14 text-right text-xs tabular-nums text-muted" title="Prospects with this status">
        {s.count}
      </span>
      {s.isSystem ? <Badge>built-in</Badge> : <Badge tone="primary">custom</Badge>}
      {canEdit && (
        <>
          <Button size="icon" variant="ghost" aria-label={`Move up: ${s.label}`} disabled={first || pending} onClick={() => start(() => moveStatusAction(s.id, -1))}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Move down: ${s.label}`} disabled={last || pending} onClick={() => start(() => moveStatusAction(s.id, 1))}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete status: ${s.label}`}
            disabled={s.isSystem || pending}
            onClick={() =>
              confirm(`Delete status “${s.label}”?`) &&
              start(async () => {
                const r = await deleteStatusAction(s.id);
                if (r?.error) toast.error(r.error);
                else toast.success("Status deleted");
              })
            }
          >
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        </>
      )}
    </li>
  );
}

export function StatusManager({ statuses, canEdit }: { statuses: Status[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(addStatusAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      toast.success("Status added");
      ref.current?.reset();
    }
  }, [state]);
  return (
    <>
      <ul className="divide-y divide-border">
        {statuses.map((s, i) => (
          <Row key={s.id} s={s} first={i === 0} last={i === statuses.length - 1} canEdit={canEdit} />
        ))}
      </ul>
      {canEdit && (
        <form ref={ref} action={action} className="flex flex-wrap items-end gap-3 border-t border-border p-5">
          <Field label="New status" name="label" error={state?.fieldErrors?.label} className="min-w-48 flex-1">
            <Input placeholder="e.g. Waiting for access" />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="isTerminal" className="h-4 w-4" /> Final stage
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            Add status
          </Button>
        </form>
      )}
    </>
  );
}
