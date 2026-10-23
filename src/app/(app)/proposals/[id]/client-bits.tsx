"use client";

import { useTransition } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { generatePdfAction, setReadyAction } from "../actions";

export function PdfButton({ proposalId, version, hasPdf }: { proposalId: string; version: number; hasPdf: boolean }) {
  const [pending, start] = useTransition();
  if (hasPdf) return null;
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await generatePdfAction(proposalId, version);
          if (r.ok) toast.success(`PDF generated (${Math.round(r.bytes / 1024)} KB)`);
          else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      {pending ? "Generating PDF…" : "Generate PDF"}
    </Button>
  );
}

export function ReadyToggle({ proposalId, ready }: { proposalId: string; ready: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={ready ? "secondary" : "primary"}
      className="w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setReadyAction(proposalId, !ready);
          if (r.ok) toast.success(ready ? "Moved back to draft" : "Marked ready to send");
          else toast.error(r.error);
        })
      }
    >
      {ready ? "Move back to draft" : "Mark ready to send"}
    </Button>
  );
}
