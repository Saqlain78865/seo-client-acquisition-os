"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown, Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { generatePdfAction, setReadyAction, translateProposalAction } from "../actions";

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

export function TranslateButtons({ proposalId }: { proposalId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (language: "ur" | "ar", name: string) =>
    start(async () => {
      toast.info(`Translating into ${name} — this takes 2–4 minutes, keep this page open…`, { duration: 10000 });
      const r = await translateProposalAction(proposalId, language);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${name} copy saved as version ${r.version}. Check it before sending.`);
      router.refresh();
    });
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
        <Languages className="h-3.5 w-3.5" /> Client prefers another language? Save a translated copy as a new version.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("ur", "Urdu")}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} اردو · Urdu
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("ar", "Arabic")}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} العربية · Arabic
        </Button>
      </div>
    </div>
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
