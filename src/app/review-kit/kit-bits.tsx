"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button, Input } from "@/components/ui";
import { saveReviewLinkAction } from "./actions";

export function ReviewLinkForm({ prospectId, link }: { prospectId: string; link: string | null }) {
  const [value, setValue] = useState(link ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveReviewLinkAction(prospectId, value);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Review link saved");
          router.refresh();
        });
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://g.page/r/…/review" className="flex-1" aria-label="Google review link" />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save link
      </Button>
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => toast.error("Could not copy — select the text instead."),
        )
      }
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#4f46e5] hover:bg-[#eef2ff]"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

export function PrintPosterButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> Print poster
    </Button>
  );
}
