"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Check, Link2, Loader2, Mail, RefreshCw, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, Input, Select, Textarea } from "@/components/ui";
import {
  addKeywordsAction,
  approveReportAction,
  cancelReportAction,
  checkUptimeAction,
  internalLinksAction,
  prepareReportAction,
  removeKeywordAction,
  resolveAlertAction,
  saveReportScheduleAction,
  syncKeywordsAction,
} from "./monitor-actions";
import type { LinkSuggestion } from "@/lib/internal-links";

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = <T extends { ok: true } | { ok: false; error: string }>(fn: () => Promise<T>, done?: (r: Extract<T, { ok: true }>) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error((r as { error: string }).error);
      done?.(r as Extract<T, { ok: true }>);
      router.refresh();
    });
  return { pending, act };
}

// ── Alerts ──

type AlertRow = { id: string; kind: string; label: string; title: string; detail: string | null; url: string | null; at: string; resolved: boolean };

export function Alerts({ websiteId, status, checkedAt, alerts }: { websiteId: string; status: string | null; checkedAt: string | null; alerts: AlertRow[] }) {
  const { pending, act } = useAction();
  const open = alerts.filter((a) => !a.resolved);
  return (
    <Card id="alerts">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Alerts {open.length > 0 && <Badge tone="danger">{open.length} open</Badge>}
          </span>
        }
        description="Site down (checked every 15 minutes), pages that disappear, a sudden fall in Google clicks, and tracked keywords that drop. You get a notification in the app."
        action={
          <div className="flex items-center gap-2">
            <Badge tone={status === "DOWN" ? "danger" : status === "UP" ? "success" : "neutral"} dot>
              {status === "DOWN" ? "Site down" : status === "UP" ? "Site up" : "Not checked yet"}
            </Badge>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => checkUptimeAction(websiteId), (r) => toast.success(r.status === "DOWN" ? "The site is not answering" : r.status === "UP" ? "The site is up" : "Checked"))}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check now
            </Button>
          </div>
        }
      />
      <div className="p-5 text-sm">
        {checkedAt && <p className="mb-3 text-xs text-muted">Last uptime check: {when(checkedAt)}</p>}
        {alerts.length === 0 ? (
          <p className="text-muted">No alerts. All checks are quiet.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {alerts.map((a) => (
              <li key={a.id} className={`flex items-start gap-3 py-2.5 ${a.resolved ? "opacity-60" : ""}`}>
                <Badge tone={a.resolved ? "neutral" : a.kind === "SITE_DOWN" || a.kind === "TRAFFIC_DROP" ? "danger" : "warning"}>{a.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.title}</p>
                  {a.detail && <p className="truncate text-xs text-muted">{a.detail}</p>}
                  <p className="text-xs text-muted">
                    {when(a.at)}
                    {a.resolved ? " · resolved" : ""}
                  </p>
                </div>
                {!a.resolved && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => resolveAlertAction(websiteId, a.id))} title="Mark as dealt with">
                    <Check className="h-4 w-4" /> Done
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── Keyword rank tracking ──

type KeywordRow = { id: string; keyword: string; points: { date: string; position: number | null }[]; latest: { date: string; position: number } | null; now: number | null; before: number | null; change: number | null };

function Spark({ points }: { points: { position: number | null }[] }) {
  const shown = points.map((p, i) => ({ i, p: p.position })).filter((x) => x.p != null) as { i: number; p: number }[];
  if (shown.length < 2) return <span className="text-xs text-muted">—</span>;
  const max = Math.max(...shown.map((s) => s.p), 10);
  const w = 96;
  const h = 26;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * w;
  // Position 1 at the top.
  const y = (p: number) => ((p - 1) / Math.max(max - 1, 1)) * (h - 4) + 2;
  return (
    <svg width={w} height={h} className="text-primary" aria-label="Position over the last days">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.6" points={shown.map((s) => `${x(s.i).toFixed(1)},${y(s.p).toFixed(1)}`).join(" ")} />
    </svg>
  );
}

export function KeywordTracking({ websiteId, linked, syncedAt, keywords, max }: { websiteId: string; linked: boolean; syncedAt: string | null; keywords: KeywordRow[]; max: number }) {
  const [text, setText] = useState("");
  const { pending, act } = useAction();
  return (
    <Card id="keywords">
      <CardHeader
        title="Keyword rank tracking"
        description={`Up to ${max} searches. Their average Google position is read from Search Console every day; a fall of 3+ places week on week raises an alert.`}
        action={
          linked && keywords.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => syncKeywordsAction(websiteId), () => toast.success("Positions updated"))}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Update
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-5 text-sm">
        {!linked && <p className="text-warning">Link this website&apos;s Search Console property above — positions come from there.</p>}
        <form
          className="flex flex-col gap-2 md:flex-row md:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => addKeywordsAction(websiteId, text),
              (r) => {
                setText("");
                const res = r;
                toast.success(`${res.added} keyword${res.added === 1 ? "" : "s"} added`);
                if (res.syncError) toast.error(res.syncError);
              },
            );
          }}
        >
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={"One per line, or separated by commas\nthai restaurant nyc, pad thai near me"} className="md:flex-1" aria-label="Keywords to track" />
          <Button type="submit" disabled={pending || !text.trim()}>
            Track
          </Button>
        </form>
        {keywords.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 font-medium">Keyword</th>
                  <th className="py-1.5 text-right font-medium">Latest</th>
                  <th className="py-1.5 text-right font-medium">This week</th>
                  <th className="py-1.5 text-right font-medium">vs last week</th>
                  <th className="py-1.5 pl-4 font-medium">Last 30 days</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => (
                  <tr key={k.id} className="border-t border-border/60">
                    <td className="py-2 pr-3">{k.keyword}</td>
                    <td className="py-2 text-right tabular-nums">{k.latest ? k.latest.position.toFixed(1) : <span className="text-muted">not shown</span>}</td>
                    <td className="py-2 text-right tabular-nums">{k.now != null ? k.now.toFixed(1) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {k.change == null ? (
                        "—"
                      ) : Math.abs(k.change) < 0.1 ? (
                        <span className="text-muted">same</span>
                      ) : k.change > 0 ? (
                        <span className="inline-flex items-center text-success">
                          <ArrowUpRight className="h-3.5 w-3.5" /> {k.change.toFixed(1)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-danger">
                          <ArrowDownRight className="h-3.5 w-3.5" /> {Math.abs(k.change).toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pl-4">
                      <Spark points={k.points} />
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" className="text-muted hover:text-danger" aria-label={`Stop tracking ${k.keyword}`} disabled={pending} onClick={() => act(() => removeKeywordAction(websiteId, k.id))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              {keywords.length}/{max} tracked{syncedAt ? ` · updated ${when(syncedAt)}` : ""} · position = Google&apos;s average for the day (Search Console); &quot;not shown&quot; = no impressions that day.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Monthly report email ──

type Delivery = { id: string; month: string; to: string; status: string; error: string | null; sentAt: string | null; createdAt: string };

export function ReportEmail({ websiteId, day, email, approval, gmail, deliveries }: { websiteId: string; day: number | null; email: string | null; approval: boolean; gmail: boolean; deliveries: Delivery[] }) {
  const [form, setForm] = useState({ day: day ? String(day) : "", email: email ?? "", approval });
  const { pending, act } = useAction();
  const tone = (s: string) => (s === "SENT" ? "success" : s === "FAILED" ? "danger" : s === "AWAITING_APPROVAL" ? "warning" : "neutral");
  const label = (s: string) => ({ SENT: "Sent", FAILED: "Failed", AWAITING_APPROVAL: "Waiting for approval", CANCELLED: "Cancelled" })[s] ?? s;
  return (
    <Card id="report-email">
      <CardHeader title="Monthly report email" description="Each client can have their own day. On that day last month's report is prepared as a PDF; it waits for your approval, then goes out from your Gmail." />
      <div className="space-y-4 p-5 text-sm">
        {!gmail && <p className="text-warning">Connect Gmail on the Integrations page so reports can be emailed.</p>}
        <form
          className="grid gap-2 md:grid-cols-[11rem_1fr_auto_auto] md:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => saveReportScheduleAction(websiteId, { day: form.day ? Number(form.day) : null, email: form.email, approval: form.approval }), () => toast.success(form.day ? `Report will be prepared on day ${form.day} of every month` : "Automatic report turned off"));
          }}
        >
          <Select value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} aria-label="Day of the month">
            <option value="">Off</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Day {d} of every month
              </option>
            ))}
          </Select>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="client@example.com" aria-label="Client's email" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.approval} onChange={(e) => setForm({ ...form, approval: e.target.checked })} /> Wait for my approval
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            Save
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={pending || !email} onClick={() => act(() => prepareReportAction(websiteId), () => toast.success("Last month's report is ready for approval below"))}>
            <Mail className="h-4 w-4" /> Prepare last month&apos;s report now
          </Button>
        </div>
        {deliveries.length > 0 && (
          <ul className="divide-y divide-border/70">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-32 font-medium">{monthName(d.month)}</span>
                <Badge tone={tone(d.status)}>{label(d.status)}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  to {d.to}
                  {d.sentAt ? ` · sent ${when(d.sentAt)}` : ""}
                  {d.error ? ` · ${d.error}` : ""}
                </span>
                <a href={`/website-report?site=${websiteId}&month=${d.month}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                  Preview
                </a>
                {(d.status === "AWAITING_APPROVAL" || d.status === "FAILED") && (
                  <>
                    <Button size="sm" disabled={pending || !gmail} onClick={() => act(() => approveReportAction(websiteId, d.id), () => toast.success(`Report emailed to ${d.to}`))}>
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {d.status === "FAILED" ? "Try again" : "Approve & send"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelReportAction(websiteId, d.id))} aria-label="Cancel">
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── Internal linking ──

export function InternalLinks({ websiteId }: { websiteId: string }) {
  const [result, setResult] = useState<{ pagesRead: number; usedSearchConsole: boolean; suggestions: LinkSuggestion[]; orphans: string[] } | null>(null);
  const [pending, start] = useTransition();
  const find = () =>
    start(async () => {
      const r = await internalLinksAction(websiteId);
      if (!r.ok) return void toast.error(r.error);
      setResult(r);
    });
  return (
    <Card id="internal-links">
      <CardHeader
        title="Internal linking suggestions"
        description="Reads the website's pages and finds places where one page mentions another page's topic but does not link to it yet. Pages with the fewest links come first."
        action={
          <Button size="sm" variant="secondary" disabled={pending} onClick={find}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {pending ? "Reading pages…" : result ? "Check again" : "Find suggestions"}
          </Button>
        }
      />
      <div className="p-5 text-sm">
        {!result ? (
          <p className="text-muted">{pending ? "Reading up to 60 pages — this takes a minute or two." : "Nothing checked yet."}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {result.pagesRead} pages read{result.usedSearchConsole ? " · topics from each page's Search Console searches, titles and headings" : " · topics from page titles and headings"}
            </p>
            {result.orphans.length > 0 && (
              <div className="rounded-xl bg-warning-soft p-3">
                <p className="font-medium text-warning">
                  {result.orphans.length} page{result.orphans.length === 1 ? "" : "s"} no other page links to
                </p>
                <p className="mt-1 text-xs break-all">{result.orphans.slice(0, 10).map(path).join(" · ")}</p>
              </div>
            )}
            {result.suggestions.length === 0 ? (
              <p className="text-muted">No missing links found: pages that mention each other already link.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="py-2.5">
                    <p>
                      On <b>{path(s.source)}</b> link the words <span className="rounded bg-primary-soft px-1.5 py-0.5 font-medium text-primary">{s.anchor}</span> to <b>{path(s.target)}</b>
                      <span className="text-xs text-muted"> ({s.targetInlinks} link{s.targetInlinks === 1 ? "" : "s"} to it today)</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted italic">{s.context}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
