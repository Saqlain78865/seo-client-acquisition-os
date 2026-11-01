"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Input, Select } from "@/components/ui";
import { addWorkAction, deleteWorkAction } from "../actions";

type Entry = { id: string; category: string; title: string; detail: string | null; url: string | null; count: number };
type Categories = Record<string, { label: string; example: string }>;

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** The SEO work done this month — one click for common tasks, or a short note — shown in the monthly report. */
export function WorkLog({ websiteId, month, entries, categories }: { websiteId: string; month: string; entries: Entry[]; categories: Categories }) {
  const [form, setForm] = useState({ category: "INTERNAL_LINKING", title: "", url: "", count: "1" });
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (m: string) => router.push(`/websites/${websiteId}?month=${m}`, { scroll: false });

  const add = (input: { category: string; title?: string; url?: string; count?: number }) =>
    start(async () => {
      const r = await addWorkAction(websiteId, { month, ...input });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Added to this month's report");
      setForm((f) => ({ ...f, title: "", url: "", count: "1" }));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        title="Work log"
        description="What you did on this website — it goes into the monthly report next to the Search Console results. Only real work: tick what was done."
        action={
          <div className="flex items-center gap-1 text-sm">
            <Button size="sm" variant="ghost" onClick={() => go(shift(month, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-28 text-center font-medium">{monthName(month)}</span>
            <Button size="sm" variant="ghost" onClick={() => go(shift(month, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-5 text-sm">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">One click for common work</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(categories).map(([key, c]) => (
              <button key={key} type="button" disabled={pending} onClick={() => add({ category: key })} className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-primary-soft hover:text-primary disabled:opacity-50">
                + {c.label}
              </button>
            ))}
          </div>
        </div>
        <form
          className="grid gap-2 md:grid-cols-[13rem_1fr_1fr_5rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add({ category: form.category, title: form.title, url: form.url, count: Number(form.count) || 1 });
          }}
        >
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="Type of work">
            {Object.entries(categories).map(([key, c]) => (
              <option key={key} value={key}>
                {c.label}
              </option>
            ))}
          </Select>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={categories[form.category]?.example ?? "What was done"} aria-label="What was done" />
          <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Page (optional)" aria-label="Page address" />
          <Input value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} type="number" min={1} max={999} aria-label="How many" title="How many (pages, links, articles…)" />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </form>
        {entries.length === 0 ? (
          <p className="text-muted">Nothing logged for {monthName(month)} yet. Pages published and content changes found by the weekly check are added to the report automatically.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-44 shrink-0 text-xs text-muted">{categories[e.category]?.label ?? e.category}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {e.count > 1 && <b className="font-semibold">{e.count} × </b>}
                    {e.title}
                  </span>
                  {e.url && <span className="block truncate text-xs text-muted">{e.url.replace(/^https?:\/\//, "")}</span>}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  aria-label="Remove"
                  onClick={() =>
                    start(async () => {
                      const r = await deleteWorkAction(websiteId, e.id);
                      if (!r.ok) toast.error(r.error);
                      router.refresh();
                    })
                  }
                  className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
