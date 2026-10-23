"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import { setDoNotContactAction } from "../actions";

export function OptOut({ prospectId, on, reason }: { prospectId: string; on: boolean; reason: string | null }) {
  const [open, setOpen] = useState(false);
  const action = setDoNotContactAction.bind(null, prospectId);
  if (on) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="danger">
          <Ban className="h-3 w-3" /> Do not contact
        </Badge>
        {reason && <span className="text-muted">{reason}</span>}
        <input type="hidden" name="on" value="0" />
        <Button type="submit" size="sm" variant="ghost" onClick={(e) => !confirm("Only remove the opt-out if they agreed to be contacted again. Continue?") && e.preventDefault()}>
          Remove opt-out
        </Button>
      </form>
    );
  }
  return open ? (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="on" value="1" />
      <Input name="reason" placeholder="Reason (optional)" aria-label="Opt-out reason" className="h-8 w-56" />
      <Button type="submit" size="sm" variant="danger">
        Mark do not contact
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
      <Ban className="h-4 w-4" /> Opt-out / do not contact
    </Button>
  );
}
