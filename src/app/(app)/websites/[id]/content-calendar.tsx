"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { createContentPlanAction, setPlanItemAction } from "./monitor-actions";

type Item = { id: string; month: string; title: string; keyword: string; kind: string; reason: string; linkTo: string | null; status: string };
const KINDS: Record<string, string> = { NEW_ARTICLE: "New article", REFRESH: "Improve a page", SERVICE_PAGE: "Service page", FAQ: "FAQ / answer" };
const monthName = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

/** 12 months of topics from the site's Search Console searches; a topic marked done goes into the work log. */
export function ContentCalendar({ websiteId, linked, plan }: { websiteId: string; linked: boolean; plan: { source: string; createdAt: string; items: Item[] } | null }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(plan?.items[0]?.month ?? null);
  const router = useRouter();
  const make = () =>
    start(async () => {
      const r = await createContentPlanAction(websiteId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.items} topics planned${r.source === "AI" ? " with Gemini" : " from the Search Console data"}`);
      router.refresh();
    });
  const mark = (id: string, status: "PLANNED" | "DONE" | "SKIPPED") => {
    setBusy(id);
    start(async () => {
      const r = await setPlanItemAction(websiteId, id, status);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      if (status === "DONE") toast.success("Done — added to this month's work log");
      router.refresh();
    });
  };
  const months = [...new Set(plan?.items.map((i) => i.month) ?? [])];
  const done = plan?.items.filter((i) => i.status === "DONE").length ?? 0;
  return (
    <Card id="content-calendar">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4" /> 12-month content calendar
          </span>
        }
        description="Topics for each month, from the searches this site already appears for: questions to answer, pages just off page one, searches without a page. Next month's topics go into the monthly report."
        action={
          <Button size="sm" variant={plan ? "secondary" : "primary"} disabled={!linked || pending} onClick={make}>
            {pending && !busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {plan ? "Make a new plan" : "Make the plan"}
          </Button>
        }
      />
      <div className="p-5 text-sm">
        {!linked ? (
          <p className="text-warning">Link this website&apos;s Search Console property above — the plan is built from its searches.</p>
        ) : !plan ? (
          <p className="text-muted">No plan yet. With a Gemini key the topics are written up as titles; without it the plan comes straight from the numbers.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              {plan.items.length} topics · {done} done · {plan.source === "AI" ? "written with Gemini from your Search Console data" : "from your Search Console data"} · made{" "}
              {new Date(plan.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            {months.map((m) => {
              const items = plan.items.filter((i) => i.month === m);
              return (
                <div key={m} className="rounded-xl border border-border">
                  <button type="button" className="flex w-full items-center justify-between px-4 py-2.5 text-left font-medium" onClick={() => setOpen(open === m ? null : m)}>
                    {monthName(m)}
                    <span className="text-xs font-normal text-muted">
                      {items.filter((i) => i.status === "DONE").length}/{items.length} done
                    </span>
                  </button>
                  {open === m && (
                    <ul className="divide-y divide-border/70 border-t border-border">
                      {items.map((i) => (
                        <li key={i.id} className={`flex items-start gap-3 px-4 py-2.5 ${i.status === "SKIPPED" ? "opacity-50" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <p className={`font-medium ${i.status === "DONE" ? "line-through decoration-success" : ""}`}>{i.title}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              <Badge tone={i.kind === "REFRESH" ? "info" : i.kind === "FAQ" ? "warning" : "primary"}>{KINDS[i.kind] ?? i.kind}</Badge>“{i.keyword}”{i.linkTo ? ` · link: ${path(i.linkTo)}` : ""}
                            </p>
                            <p className="mt-0.5 text-xs text-muted">{i.reason}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {i.status !== "DONE" ? (
                              <Button size="sm" variant="ghost" disabled={busy === i.id} onClick={() => mark(i.id, "DONE")} title="Mark done">
                                {busy === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              </Button>
                            ) : (
                              <Badge tone="success">Done</Badge>
                            )}
                            {i.status === "PLANNED" && (
                              <Button size="sm" variant="ghost" disabled={busy === i.id} onClick={() => mark(i.id, "SKIPPED")} title="Skip">
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
