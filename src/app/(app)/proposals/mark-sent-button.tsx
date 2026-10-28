"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { WhatsAppIcon } from "@/components/whatsapp-button";
import { markSentOnWhatsAppAction } from "./whatsapp-actions";

/** For a proposal sent from WhatsApp directly: one click marks it Sent and schedules reminders. */
export function MarkSentButton({ proposalId }: { proposalId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await markSentOnWhatsAppAction(proposalId);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Marked as sent on WhatsApp${r.followUps ? ` · ${r.followUps} reminders scheduled` : ""}`);
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#25D366] px-2 py-0.5 font-medium text-[#128C7E] hover:bg-[#25D366]/10 disabled:opacity-50"
      title="Already sent it from WhatsApp? Mark it here."
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <WhatsAppIcon className="h-3 w-3" />} Mark sent on WhatsApp
    </button>
  );
}
