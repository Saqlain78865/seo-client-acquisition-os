"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileSearch, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui";
import { addCompetitorAction, checkCompetitorAction, checkHealthAction, checkIndexingAction, removeCompetitorAction } from "./monitor-actions";

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Index = { total: number; indexed: number; checkedAt: string | null; reasons: { reason: string; count: number }[]; notIndexed: { url: string; reason: string; lastCrawl: string | null }[] };

export function SiteHealth({
  websiteId,
  linked,
  robotsCheckedAt,
  sitemapUrls,
  problems,
  index,
}: {
  websiteId: string;
  linked: boolean;
  robotsCheckedAt: string | null;
  sitemapUrls: number | null;
  problems: { title: string; label: string }[];
  index: Index;
}) {
  const [busy, setBusy] = useState<"health" | "index" | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);

  const health = () => {
    setBusy("health");
    start(async () => {
      const r = await checkHealthAction(websiteId);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      toast[r.problems.length ? "error" : "success"](r.problems.length ? `${r.problems.length} problem${r.problems.length === 1 ? "" : "s"} found — see Alerts` : `All good: robots.txt allows Google, sitemap has ${r.sitemapUrls} URLs`);
      router.refresh();
    });
  };
  const inspect = () => {
    setBusy("index");
    start(async () => {
      const r = await checkIndexingAction(websiteId);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.inspected} pages checked with Google${r.errors ? ` (${r.errors} could not be checked)` : ""}`);
      router.refresh();
    });
  };

  const list = showAll ? index.notIndexed : index.notIndexed.slice(0, 12);
  return (
    <Card id="health">
      <CardHeader
        title="Google indexing & site health"
        description="Which pages are in Google's index and why others are not (Search Console, monthly), plus a daily check of robots.txt, noindex on the home page and the sitemap."
      />
      <div className="grid gap-5 p-5 text-sm md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> robots.txt & sitemap
            </p>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={health}>
              {busy === "health" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check now
            </Button>
          </div>
          {problems.length === 0 ? (
            <p className="text-success">{robotsCheckedAt ? "No problems: Google may crawl the site." : "Not checked yet."}</p>
          ) : (
            <ul className="space-y-1.5">
              {problems.map((p) => (
                <li key={p.title} className="flex items-start gap-2">
                  <Badge tone="danger">{p.label}</Badge> <span>{p.title}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            {sitemapUrls != null ? `${sitemapUrls.toLocaleString()} URLs in the sitemap · ` : ""}
            {robotsCheckedAt ? `checked ${when(robotsCheckedAt)} (every day)` : "checked every day"}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <FileSearch className="h-4 w-4 text-primary" /> Pages in Google
            </p>
            <Button size="sm" variant="secondary" disabled={busy !== null || !linked} onClick={inspect}>
              {busy === "index" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {busy === "index" ? "Asking Google…" : "Check now"}
            </Button>
          </div>
          {!linked ? (
            <p className="text-warning">Link this website&apos;s Search Console property above.</p>
          ) : index.total === 0 ? (
            <p className="text-muted">Not checked yet. Up to 100 pages are checked once a month (a few minutes).</p>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <p className="text-3xl font-bold tabular-nums">
                  {index.indexed}
                  <span className="text-base font-normal text-muted"> / {index.total}</span>
                </p>
                <p className="pb-1 text-xs text-muted">pages indexed</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-success" style={{ width: `${(index.indexed / index.total) * 100}%` }} />
              </div>
              {index.reasons.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {index.reasons.map((r) => (
                    <li key={r.reason} className="flex justify-between gap-2">
                      <span>{r.reason}</span> <b className="tabular-nums">{r.count}</b>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted">{index.checkedAt ? `Checked ${when(index.checkedAt)} (monthly)` : ""}</p>
            </>
          )}
        </div>

        {index.notIndexed.length > 0 && (
          <div className="md:col-span-2">
            <p className="mb-2 font-medium">Not indexed</p>
            <ul className="divide-y divide-border/70">
              {list.map((p) => (
                <li key={p.url} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate hover:text-primary">
                    {path(p.url)}
                  </a>
                  <span className="text-xs text-muted">
                    {p.reason}
                    {p.lastCrawl ? ` · last crawled ${new Date(p.lastCrawl).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {index.notIndexed.length > 12 && (
              <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show all ${index.notIndexed.length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

type Activity = { id: string; name: string; domain: string; checkedAt: string | null; newPages: { url: string; title: string | null }[]; titleChanges: { url: string; before: string | null; after: string | null }[]; contentUpdates: number; removed: number };

export function CompetitorWatch({ websiteId, monthLabel, competitors, max }: { websiteId: string; monthLabel: string; competitors: Activity[]; max: number }) {
  const [form, setForm] = useState({ name: "", url: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  const act = <T extends { ok: true } | { ok: false; error: string }>(key: string, fn: () => Promise<T>, done: (r: Extract<T, { ok: true }>) => void) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) return void toast.error((r as { error: string }).error);
      done(r as Extract<T, { ok: true }>);
      router.refresh();
    });
  };

  return (
    <Card id="competitors">
      <CardHeader
        title="Competitor watch"
        description={`Up to ${max} competitor websites, checked every week: new pages and articles, title changes, content updates. It goes into the monthly report as “what competitors did”.`}
      />
      <div className="space-y-4 p-5 text-sm">
        {competitors.length < max && (
          <form
            className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              act("add", () => addCompetitorAction(websiteId, form), (r) => {
                setForm({ name: "", url: "" });
                toast.success(`Watching — ${r.pages} pages recorded today; changes show from next week`);
              });
            }}
          >
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="competitor.com" aria-label="Competitor website" />
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (optional)" aria-label="Competitor name" />
            <Button type="submit" disabled={busy !== null || !form.url.trim()}>
              {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {busy === "add" ? "Reading site…" : "Watch"}
            </Button>
          </form>
        )}
        {competitors.length === 0 ? (
          <p className="text-muted">No competitors watched yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {competitors.map((c) => (
              <div key={c.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:text-primary">
                      {c.domain}
                    </a>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" title="Check now" className="text-muted hover:text-primary" disabled={busy !== null} onClick={() => act(c.id, () => checkCompetitorAction(websiteId, c.id), (r) => toast.success(r.baseline ? "Pages recorded" : `${r.changes} change${r.changes === 1 ? "" : "s"} found`))}>
                      {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button type="button" title="Stop watching" className="text-muted hover:text-danger" disabled={busy !== null} onClick={() => act(`rm${c.id}`, () => removeCompetitorAction(websiteId, c.id), () => toast.success("Removed"))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">{monthLabel}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={c.newPages.length ? "warning" : "neutral"}>{c.newPages.length} new pages</Badge>
                  <Badge tone={c.titleChanges.length ? "info" : "neutral"}>{c.titleChanges.length} titles changed</Badge>
                  <Badge>{c.contentUpdates} updated</Badge>
                </div>
                {c.newPages.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {c.newPages.slice(0, 5).map((p) => (
                      <li key={p.url} className="truncate" title={p.url}>
                        + {p.title || path(p.url)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-muted">{c.checkedAt ? `Last checked ${when(c.checkedAt)}` : "Not checked yet"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
