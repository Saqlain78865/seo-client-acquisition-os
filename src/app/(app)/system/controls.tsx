"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import type { MaintenanceResult } from "@/lib/system";
import { dismissJobAction, retryJobAction, runMaintenanceAction } from "./actions";

export function JobButtons({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => ReturnType<typeof retryJobAction>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(done);
      else toast.error(r.error);
      router.refresh();
    });
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => retryJobAction(jobId), "Job queued again")}>
        <RotateCcw className="h-3.5 w-3.5" /> Retry
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Dismiss this failed job? It will not run again.") && run(() => dismissJobAction(jobId), "Job dismissed")}>
        Dismiss
      </Button>
    </div>
  );
}

const LABELS: Record<keyof MaintenanceResult, string> = {
  expiredSessions: "expired sessions",
  loginAttempts: "old login attempts",
  finishedJobs: "finished jobs",
  notifications: "read notifications",
  orphanFiles: "files of deleted records",
};

export function MaintenanceButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MaintenanceResult | null>(null);
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runMaintenanceAction();
            if (r.ok) {
              setResult(r.result);
              toast.success("Clean-up finished");
            } else toast.error(r.error);
          })
        }
      >
        {pending ? "Cleaning up…" : "Run clean-up now"}
      </Button>
      {result && (
        <p className="text-xs text-muted" role="status">
          Removed: {(Object.keys(LABELS) as (keyof MaintenanceResult)[]).map((k) => `${result[k]} ${LABELS[k]}`).join(", ")}.
        </p>
      )}
    </div>
  );
}
