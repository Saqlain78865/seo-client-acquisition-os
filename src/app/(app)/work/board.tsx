"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarPlus, CheckCircle2, Circle, GripVertical, Loader2, Plus, Timer, Trash2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { addTaskAction, deleteTaskAction, moveTaskAction, planMonthAction, type WorkResult } from "./actions";

type Status = "TODO" | "DOING" | "DONE";
export type BoardTask = { id: string; title: string; detail: string | null; status: Status; source: string; client: { id: string; name: string } };

const COLUMNS: { key: Status; label: string; icon: typeof Circle; tone: string; ring: string }[] = [
  { key: "TODO", label: "To do", icon: Circle, tone: "text-muted", ring: "from-[#94a3b8] to-[#64748b]" },
  { key: "DOING", label: "In progress", icon: Timer, tone: "text-warning", ring: "from-[#f59e0b] to-[#f97316]" },
  { key: "DONE", label: "Done", icon: CheckCircle2, tone: "text-success", ring: "from-[#10b981] to-[#059669]" },
];

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<WorkResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.error);
    });
  return { pending, run, start };
}

/** "Plan this month" for every won client that has no tasks in the month yet. */
export function PlanMonth({ month, clients }: { month: string; clients: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  if (!clients.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-primary/30 bg-primary-soft/40 px-4 py-3 text-sm">
      <CalendarPlus className="h-4 w-4 text-primary" />
      <span className="mr-1 text-muted">Not planned yet:</span>
      {clients.map((c) => (
        <Button key={c.id} size="sm" variant="secondary" disabled={pending} onClick={() => run(() => planMonthAction(c.id, month))}>
          <Plus className="h-3.5 w-3.5" /> Plan {c.name}
        </Button>
      ))}
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      <span className="w-full text-xs text-muted sm:ml-auto sm:w-auto">Tasks come from each client&apos;s monthly deliverables in their proposal.</span>
    </div>
  );
}

export function Board({ month, tasks, clients, showClient }: { month: string; tasks: BoardTask[]; clients: { id: string; name: string }[]; showClient: boolean }) {
  const { pending, run, start } = useRun();
  const router = useRouter();
  const [optimistic, setOptimistic] = useOptimistic(tasks, (state, { id, status }: { id: string; status: Status }) => state.map((t) => (t.id === id ? { ...t, status } : t)));
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");

  const move = (id: string, status: Status) =>
    start(async () => {
      setOptimistic({ id, status });
      const r = await moveTaskAction(id, status);
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });

  const total = optimistic.length;
  const done = optimistic.filter((t) => t.status === "DONE").length;

  return (
    <div>
      {total > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-[#059669] transition-[width] duration-700" style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          <span className="text-sm font-medium tabular-nums">
            {done}/{total} done
          </span>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col, ci) => {
          const items = optimistic.filter((t) => t.status === col.key);
          return (
            <section
              key={col.key}
              aria-label={col.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const t = optimistic.find((x) => x.id === dragId);
                if (t && t.status !== col.key) move(t.id, col.key);
                setDragId(null);
              }}
              className={cn("flex min-h-64 flex-col rounded-2xl border border-border bg-surface-2/50 p-3 transition-colors", over === col.key && "border-primary/50 bg-primary-soft/50")}
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <span className={cn("rounded-lg bg-gradient-to-br p-1.5 text-white shadow-sm", col.ring)}>
                  <col.icon className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted tabular-nums ring-1 ring-border">{items.length}</span>
              </header>

              {col.key === "TODO" && clients.length > 0 && (
                <form
                  className="mb-3 space-y-2 rounded-xl border border-border bg-surface p-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (title.trim() && clientId) run(() => addTaskAction(clientId, month, title), () => setTitle(""));
                  }}
                >
                  {clients.length > 1 && (
                    <Select aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 text-sm">
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <div className="flex gap-2">
                    <Input aria-label="New task" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" className="h-9 text-sm" />
                    <Button type="submit" size="sm" disabled={pending || !title.trim()} aria-label="Add task">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              )}

              <ul className="stagger flex-1 space-y-2">
                {items.map((t) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragId(null)}
                    className={cn(
                      "group cursor-grab rounded-xl border border-border bg-surface p-3 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift active:cursor-grabbing",
                      dragId === t.id && "opacity-50",
                      t.status === "DONE" && "bg-success-soft/30",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted/50" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", t.status === "DONE" && "text-muted line-through decoration-muted/40")}>{t.title}</p>
                        {t.detail && <p className="mt-0.5 text-xs text-muted">{t.detail}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {showClient && <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-primary">{t.client.name}</span>}
                          {t.source === "DELIVERABLE" && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">From proposal</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2 opacity-70 transition-opacity group-hover:opacity-100">
                      <button type="button" disabled={ci === 0} onClick={() => move(t.id, COLUMNS[ci - 1].key)} aria-label={`Move “${t.title}” back`} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text disabled:invisible">
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" disabled={ci === COLUMNS.length - 1} onClick={() => move(t.id, COLUMNS[ci + 1].key)} aria-label={`Move “${t.title}” forward`} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text disabled:invisible">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirm(`Remove “${t.title}”?`) && run(() => deleteTaskAction(t.id))}
                        aria-label={`Remove “${t.title}”`}
                        className="ml-auto rounded-md p-1 text-muted hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
                {items.length === 0 && <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted">{col.key === "DONE" ? "Finished work lands here" : "Drag tasks here"}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
