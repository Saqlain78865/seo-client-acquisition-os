"use client";

import { useOptimistic, useTransition } from "react";
import { Check, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toggleKickoffTaskAction } from "../actions";

type Task = { id: string; title: string; detail: string | null; done: boolean };

/** The onboarding steps for a won client. Ticking a step saves it immediately. */
export function KickoffChecklist({ prospectId, tasks }: { prospectId: string; tasks: Task[] }) {
  const [, start] = useTransition();
  const [list, setDone] = useOptimistic(tasks, (state, { id, done }: { id: string; done: boolean }) => state.map((t) => (t.id === id ? { ...t, done } : t)));
  const done = list.filter((t) => t.done).length;
  const pct = Math.round((done / Math.max(list.length, 1)) * 100);
  return (
    <Card className="overflow-hidden border-success/30">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <PartyPopper className="h-4 w-4 text-success" /> Kickoff checklist
          </span>
        }
        description={done === list.length ? "All set — the client is fully onboarded." : `${done} of ${list.length} done`}
      />
      <div className="px-5 pt-4">
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-success to-emerald-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="space-y-1 p-3">
        {list.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() =>
                start(async () => {
                  setDone({ id: t.id, done: !t.done });
                  const r = await toggleKickoffTaskAction(prospectId, t.id, !t.done);
                  if (!r.ok) toast.error(r.error);
                })
              }
              className="group flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
              aria-pressed={t.done}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                  t.done ? "border-success bg-success text-white" : "border-border group-hover:border-success/60",
                )}
              >
                {t.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", t.done && "text-muted line-through decoration-muted/50")}>{t.title}</span>
                {t.detail && <span className="block text-xs text-muted">{t.detail}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
