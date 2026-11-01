"use client";

import { ChangesList, type ChangeItem } from "@/components/changes-list";
import { checkWebsiteChangesAction } from "../actions";

export function WebsiteChanges({ websiteId, changes, checkedAt }: { websiteId: string; changes: ChangeItem[]; checkedAt: string | null }) {
  return <ChangesList changes={changes} checkedAt={checkedAt} note="Checked every week automatically" check={() => checkWebsiteChangesAction(websiteId)} />;
}
