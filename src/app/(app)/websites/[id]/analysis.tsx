"use client";

import { useState, useTransition } from "react";
import { GitFork, Link2Off, Loader2, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, tabBarClass, tabClass } from "@/components/ui";
import type { BrokenLink, CanonicalIssue, RedirectIssue } from "@/lib/link-audit";
import type { Cannibalization, DecayingPage } from "@/lib/gsc-analysis";
import { gscAnalysisAction, linkAuditAction } from "./monitor-actions";

const path = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.search}` || "/";
  } catch {
    return u;
  }
};
const monthShort = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" });

type LinkResult = { pagesChecked: number; externalChecked: number; broken: BrokenLink[]; redirects: RedirectIssue[]; canonicals: CanonicalIssue[] };

export function LinkAudit({ websiteId }: { websiteId: string }) {
  const [r, setR] = useState<LinkResult | null>(null);
  const [tab, setTab] = useState<"broken" | "redirects" | "canonical">("broken");
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await linkAuditAction(websiteId);
      if (!res.ok) return void toast.error(res.error);
      setR(res);
    });
  const realBroken = r?.broken.filter((b) => !b.blockedBots) ?? [];
  const botBlocked = r?.broken.filter((b) => b.blockedBots) ?? [];
  const foundOn = (list: string[]) => (list.length ? `on ${list.slice(0, 3).map(path).join(", ")}${list.length > 3 ? ` +${list.length - 3}` : ""}` : "");
  return (
    <Card id="links">
      <CardHeader
        title="Broken links, redirects & canonicals"
        description="Reads up to 100 pages and checks every link on them (up to 150 links to other sites): broken links, links that go through redirects, redirect chains and loops, and canonical tags that point somewhere wrong."
        action={
          <Button size="sm" variant="secondary" disabled={pending} onClick={run}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />} {pending ? "Checking… (2–4 min)" : r ? "Check again" : "Check links"}
          </Button>
        }
      />
      <div className="p-5 text-sm">
        {!r ? (
          <p className="text-muted">{pending ? "Reading the pages and following every link…" : "Not checked yet."}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {r.pagesChecked} pages and {r.externalChecked} outside links checked
            </p>
            <div className={tabBarClass} role="tablist">
              {(
                [
                  ["broken", `Broken links (${realBroken.length})`],
                  ["redirects", `Redirects (${r.redirects.length})`],
                  ["canonical", `Canonicals (${r.canonicals.length})`],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tabClass(tab === k)} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "broken" &&
              (realBroken.length === 0 && botBlocked.length === 0 ? (
                <p className="text-success">No broken links found.</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {realBroken.map((b) => (
                    <li key={b.url} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="danger">{b.status ?? "No answer"}</Badge>
                        <Badge tone={b.internal ? "warning" : "neutral"}>{b.internal ? "Own page" : "Other site"}</Badge>
                        <a href={b.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate hover:text-primary">
                          {b.internal ? path(b.url) : b.url}
                        </a>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {foundOn(b.foundOn)}
                        {b.error && !b.status ? ` · ${b.error}` : ""}
                      </p>
                    </li>
                  ))}
                  {botBlocked.length > 0 && (
                    <li className="py-2 text-xs text-muted">
                      {botBlocked.length} outside link{botBlocked.length === 1 ? "" : "s"} refused automatic checks ({[...new Set(botBlocked.map((b) => b.status))].join(", ")}) — open them by hand to be sure: {botBlocked.slice(0, 5).map((b) => new URL(b.url).hostname).join(", ")}
                    </li>
                  )}
                </ul>
              ))}
            {tab === "redirects" &&
              (r.redirects.length === 0 ? (
                <p className="text-success">No redirect problems.</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {r.redirects.map((x) => (
                    <li key={x.url} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={x.kind === "LOOP" ? "danger" : x.kind === "CHAIN" ? "warning" : "info"}>{x.kind === "LOOP" ? "Loop" : x.kind === "CHAIN" ? `Chain: ${x.hops.length - 1} hops` : "Link to a redirect"}</Badge>
                        <span className="min-w-0 truncate">{x.hops.map(path).join(" → ")}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{x.kind === "LINKED_REDIRECT" ? `Change the link to point at ${path(x.finalUrl ?? "")} directly — ${foundOn(x.foundOn)}` : foundOn(x.foundOn)}</p>
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "canonical" &&
              (r.canonicals.length === 0 ? (
                <p className="text-success">Canonical tags look right.</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {r.canonicals.map((c) => (
                    <li key={c.page} className="py-2">
                      <p>
                        <b>{path(c.page)}</b> → <span className="text-muted">{c.canonical}</span>
                      </p>
                      <p className="text-xs text-warning">{c.problem}</p>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function SearchAnalysis({ websiteId, linked }: { websiteId: string; linked: boolean }) {
  const [cannibal, setCannibal] = useState<Cannibalization[] | null>(null);
  const [decay, setDecay] = useState<DecayingPage[] | null>(null);
  const [busy, setBusy] = useState<"c" | "d" | null>(null);
  const [, start] = useTransition();
  const run = (kind: "cannibalization" | "decay") => {
    setBusy(kind === "decay" ? "d" : "c");
    start(async () => {
      const r = await gscAnalysisAction(websiteId, kind);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      if (kind === "decay") setDecay(r.decay ?? []);
      else setCannibal(r.cannibal ?? []);
    });
  };
  return (
    <Card id="analysis">
      <CardHeader title="Content decay & keyword cannibalization" description="From Search Console: pages losing clicks month after month (refresh them), and searches where two or more of your pages compete (merge or differentiate them)." />
      <div className="grid gap-6 p-5 text-sm lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <TrendingDown className="h-4 w-4 text-primary" /> Content decay
            </p>
            <Button size="sm" variant="secondary" disabled={!linked || busy !== null} onClick={() => run("decay")}>
              {busy === "d" && <Loader2 className="h-4 w-4 animate-spin" />} Find decaying pages
            </Button>
          </div>
          {decay === null ? (
            <p className="text-muted">{linked ? "Compares the last 4 full months." : "Link Search Console above first."}</p>
          ) : decay.length === 0 ? (
            <p className="text-success">No page has lost a big share of its clicks.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {decay.map((d) => (
                <li key={d.page} className="py-2">
                  <a href={d.page} target="_blank" rel="noopener noreferrer" className="block truncate font-medium hover:text-primary">
                    {path(d.page)}
                  </a>
                  <p className="text-xs text-muted">
                    {d.months.map((m) => `${monthShort(m.month)} ${m.clicks}`).join(" → ")} · <span className="text-danger">−{Math.round(d.drop * 100)}%</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <GitFork className="h-4 w-4 text-primary" /> Keyword cannibalization
            </p>
            <Button size="sm" variant="secondary" disabled={!linked || busy !== null} onClick={() => run("cannibalization")}>
              {busy === "c" && <Loader2 className="h-4 w-4 animate-spin" />} Find competing pages
            </Button>
          </div>
          {cannibal === null ? (
            <p className="text-muted">{linked ? "Looks at the last 90 days." : "Link Search Console above first."}</p>
          ) : cannibal.length === 0 ? (
            <p className="text-success">No searches where your pages compete with each other.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {cannibal.map((c) => (
                <li key={c.query} className="py-2">
                  <p className="font-medium">
                    “{c.query}” <span className="text-xs font-normal text-muted">{c.impressions.toLocaleString()} impressions</span>
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {c.pages.map((p) => (
                      <li key={p.page} className="flex justify-between gap-2">
                        <span className="truncate">{path(p.page)}</span>
                        <span className="shrink-0 text-muted tabular-nums">
                          {Math.round(p.share * 100)}% · pos {p.position.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
