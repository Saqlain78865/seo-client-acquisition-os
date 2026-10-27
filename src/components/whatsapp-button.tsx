"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { confirmWhatsAppAction, openWhatsAppAction } from "@/app/(app)/proposals/whatsapp-actions";

/** WhatsApp's green chat glyph (simplified), drawn inline so no external asset is needed. */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-4 w-4", className)} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.2-.2-.4-.2Z" />
    </svg>
  );
}

/**
 * "Send on WhatsApp": downloads the proposal PDF and opens the client's chat with the message ready
 * (the same click-to-chat link websites use). WhatsApp links cannot attach files, so the person
 * drops the PDF into the chat, presses Send, then confirms here.
 */
export function WhatsAppButton({
  proposalId,
  number,
  message,
  label = "WhatsApp",
  size = "md",
  disabled,
}: {
  proposalId: string;
  number?: string;
  message?: string;
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const router = useRouter();

  const open = () =>
    start(async () => {
      const r = await openWhatsAppAction(proposalId, number, message);
      if (!r.ok) return void toast.error(r.error);
      // Save the PDF first, then open the chat: attach the downloaded file there.
      const a = document.createElement("a");
      a.href = r.pdfUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.open(r.url, "_blank", "noopener,noreferrer");
      setDeliveryId(r.deliveryId);
      toast.info("WhatsApp is opening and the PDF is downloading — drop the PDF into the chat, then press Send.", { duration: 8000 });
    });

  const confirm = (sent: boolean) => {
    if (!sent || !deliveryId) return void setDeliveryId(null);
    start(async () => {
      const r = await confirmWhatsAppAction(proposalId, deliveryId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Recorded as sent on WhatsApp${r.followUps ? ` · ${r.followUps} follow-up reminders scheduled` : ""}`);
      setDeliveryId(null);
      router.refresh();
    });
  };

  const sm = size === "sm";
  if (deliveryId) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted">Sent on WhatsApp?</span>
        <button type="button" disabled={pending} onClick={() => confirm(true)} className="inline-flex items-center gap-1 rounded-lg bg-[#25D366] px-2 py-1 font-semibold text-white hover:brightness-95">
          <Check className="h-3.5 w-3.5" /> Yes
        </button>
        <button type="button" disabled={pending} onClick={() => confirm(false)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-muted hover:bg-surface-2" aria-label="Not sent">
          <X className="h-3.5 w-3.5" /> No
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending || disabled}
      onClick={open}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:brightness-95 hover:shadow-md disabled:pointer-events-none disabled:opacity-50",
        sm ? "h-8 px-2.5 text-xs" : "h-10 px-4 text-sm",
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <WhatsAppIcon />} {label}
    </button>
  );
}
