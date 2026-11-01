"use client";

import { Card, CardHeader } from "@/components/ui";
import { ChangesList, type ChangeItem } from "@/components/changes-list";
import { checkChangesAction } from "./tracking-actions";

/** The won client's website change log on its prospect page (Search Console lives in My Websites). */
export function TrackingCard({ prospectId, changes, checkedAt, tracked }: { prospectId: string; changes: ChangeItem[]; checkedAt: string | null; tracked: boolean }) {
  return (
    <Card>
      <CardHeader title="Website changes" description="Every change found on the client's live website — part of the monthly work report." />
      <div className="p-5">
        <ChangesList changes={changes} checkedAt={checkedAt} note={tracked ? "Checked every week automatically" : "Checked weekly once the client is won"} check={() => checkChangesAction(prospectId)} />
      </div>
    </Card>
  );
}
