"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Alert, Button, Select, Textarea } from "@/components/ui";
import { addNoteAction } from "../actions";

export function NoteForm({ prospectId }: { prospectId: string }) {
  const [state, action, pending] = useActionState(addNoteAction.bind(null, prospectId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      toast.success("Note saved");
    }
  }, [state]);
  return (
    <form ref={formRef} action={action} className="space-y-2">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Textarea name="body" rows={3} placeholder="Meeting notes, objections, context…" aria-label="New note" aria-invalid={!!state?.fieldErrors?.body} />
      {state?.fieldErrors?.body && <p className="text-xs text-danger">{state.fieldErrors.body[0]}</p>}
      <div className="flex justify-end gap-2">
        <Select name="kind" defaultValue="GENERAL" className="w-44" aria-label="Note type">
          <option value="GENERAL">General note</option>
          <option value="MEETING">Meeting note</option>
          <option value="OBJECTION">Client objection</option>
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          Add note
        </Button>
      </div>
    </form>
  );
}
