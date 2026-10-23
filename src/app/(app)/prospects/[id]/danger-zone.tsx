"use client";

import { useActionState } from "react";
import { Alert, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { deleteProspectAction, mergeProspectsAction } from "../actions";

export function DangerZone({
  prospectId,
  businessName,
  candidates,
  likelyDuplicateIds,
}: {
  prospectId: string;
  businessName: string;
  candidates: { id: string; businessName: string; domain: string }[];
  likelyDuplicateIds: string[];
}) {
  const [mergeState, mergeAction, merging] = useActionState(mergeProspectsAction.bind(null, prospectId), undefined);
  const [deleteState, deleteAction, deleting] = useActionState(deleteProspectAction.bind(null, prospectId), undefined);
  const sorted = [...candidates].sort(
    (a, b) => Number(likelyDuplicateIds.includes(b.id)) - Number(likelyDuplicateIds.includes(a.id)),
  );

  return (
    <Card className="border-danger/30">
      <CardHeader title="Admin actions" description="These changes cannot be undone." />
      <div className="space-y-6 p-5">
        <form action={mergeAction} className="space-y-3">
          <p className="text-sm font-medium">Merge a duplicate into this prospect</p>
          {mergeState?.error && <Alert tone="danger">{mergeState.error}</Alert>}
          <Field label="Duplicate to merge in" name="sourceId" hint="Its audits, proposals, contacts and history move here, then it is deleted.">
            <Select required defaultValue="">
              <option value="" disabled>
                Select prospect…
              </option>
              {sorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {likelyDuplicateIds.includes(c.id) ? "⚠ " : ""}
                  {c.businessName} ({c.domain})
                </option>
              ))}
            </Select>
          </Field>
          <Field label='Type "MERGE" to confirm' name="confirm">
            <Input autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={merging || candidates.length === 0}>
            Merge prospects
          </Button>
        </form>

        <form action={deleteAction} className="space-y-3 border-t border-border pt-5">
          <p className="text-sm font-medium text-danger">Delete prospect</p>
          {deleteState?.error && <Alert tone="danger">{deleteState.error}</Alert>}
          <Field label={`Type "${businessName}" to confirm`} name="confirm" hint="Deletes all audits, proposals, delivery logs and history for this prospect.">
            <Input autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" className="w-full" disabled={deleting}>
            Delete permanently
          </Button>
        </form>
      </div>
    </Card>
  );
}
