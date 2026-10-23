"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { retryAuditAction } from "../actions";

/** Refreshes server data while the audit is queued or running, so progress appears without reloads. */
export function AutoRefresh({ active, intervalMs = 2500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}

export function RetryButton({ auditId }: { auditId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryAuditAction(auditId);
          if (r?.error) toast.error(r.error);
          else toast.success("Audit re-queued. Completed stages are kept.");
        })
      }
    >
      <RotateCcw className="h-4 w-4" /> Retry failed stages
    </Button>
  );
}
