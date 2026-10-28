"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui";
import { setCampaignStatusAction } from "./actions";

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (s: "ACTIVE" | "PAUSED" | "STOPPED") =>
    start(async () => {
      const r = await setCampaignStatusAction(id, s);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Updated");
      router.refresh();
    });
  if (status === "DONE" || status === "STOPPED") return null;
  return (
    <div className="flex gap-2">
      {status === "ACTIVE" ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("PAUSED")}>
          <Pause className="h-3.5 w-3.5" /> Pause
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={() => set("ACTIVE")}>
          <Play className="h-3.5 w-3.5" /> Resume
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Stop this campaign? The proposals not sent yet will not be emailed.") && set("STOPPED")}>
        <Square className="h-3.5 w-3.5" /> Stop
      </Button>
    </div>
  );
}
