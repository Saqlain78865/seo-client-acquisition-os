"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Link2, Loader2, RefreshCw, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Select } from "@/components/ui";
import { checkChangesAction, gscSitesAction, linkGscAction, syncGscAction } from "./tracking-actions";

type Totals = { clicks: number; impressions: number; ctr: number; position: number };
type Change = { id: string; url: string; label: string; before: string | null; after: string | null; at: string };

const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  const p = pct(now, before);
  if (p == null || p === 0) return null;
  const good = invert ? p < 0 : p > 0;
  return <span className={good ? "text-success" : "text-danger"}>{`${p > 0 ? "+" : ""}${p}%`}</span>;
}

/** Search Console results and the change log for one website, on its prospect page. */
export function TrackingCard(props: {
  prospectId: string;
  gscConnected: boolean;
  siteUrl: string | null;
  syncedAt: string | null;
  last28: Totals | null;
  prev28: Totals | null;
  spark: number[];
  changes: Change[];
  checkedAt: string | null;
  tracked: boolean;
}) {
  const [pending, start] = useTransition();
  const [sites, setSites] = useState<{ siteUrl: string }[] | null>(null);
  const [choice, setChoice] = useState("");
  const router = useRouter();
  const max = Math.max(1, ...props.spark);

  const loadSites = () =>
    start(async () => {
      const r = await gscSitesAction(props.prospectId);
      if (!r.ok) return void toast.error(r.error);
      if (!r.sites.length) return void toast.error("This Google account has no Search Console properties. Ask the client to add your email as a user in their Search Console.");
      setSites(r.sites);
      setChoice(r.suggested ?? r.sites[0].siteUrl);
    });

  return (
    <Card>
      <CardHeader title="Search Console & website changes" description="Results from Google, and every change found on the live website — the basis of the monthly report." />
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <SearchCheck className="h-4 w-4 text-primary" /> Google Search Console
          </h3>
          {!props.gscConnected ? (
            <p className="text-muted">
              Connect Search Console on the{" "}
              <Link href="/integrations" className="text-primary hover:underline">
                Integrations page
              </Link>{" "}
              (read-only), then link this website here.
            </p>
          ) : props.siteUrl ? (
            <>
              <p className="text-xs text-muted">
                {props.siteUrl} · {props.syncedAt ? `synced ${new Date(props.syncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "first sync pending"}
              </p>
              {props.last28 && (
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Clicks (28 days)", props.last28.clicks.toLocaleString(), props.prev28 && <Delta now={props.last28.clicks} before={props.prev28.clicks} />],
                      ["Impressions", props.last28.impressions.toLocaleString(), props.prev28 && <Delta now={props.last28.impressions} before={props.prev28.impressions} />],
                      ["Avg. position", props.last28.position ? props.last28.position.toFixed(1) : "—", props.prev28 && props.last28.position > 0 && <Delta now={props.last28.position} before={props.prev28.position} invert />],
                      ["CTR", `${(props.last28.ctr * 100).toFixed(1)}%`, null],
                    ] as const
                  ).map(([label, value, delta]) => (
                    <div key={label} className="rounded-xl bg-surface-2/60 p-3">
                      <p className="text-xs text-muted">{label}</p>
                      <p className="text-lg font-bold tabular-nums">
                        {value} <span className="text-xs font-medium">{delta}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {props.spark.length > 1 && (
                <div className="flex h-14 items-end gap-px" aria-label="Clicks per day, last 28 days">
                  {props.spark.map((v, i) => (
                    <span key={i} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await syncGscAction(props.prospectId);
                      if (r.ok) toast.success(`Synced — ${r.days} days of data`);
                      else toast.error(r.error);
                      router.refresh();
                    })
                  }
                >
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={loadSites}>
                  Change property
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted">Choose this website&apos;s Search Console property. Data for the last 16 months is loaded, then updated every day.</p>
          )}
          {props.gscConnected && (sites || !props.siteUrl) && (
            <div className="flex gap-2">
              {sites ? (
                <>
                  <Select value={choice} onChange={(e) => setChoice(e.target.value)} className="flex-1" aria-label="Search Console property">
                    {sites.map((s) => (
                      <option key={s.siteUrl}>{s.siteUrl}</option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={pending || !choice}
                    onClick={() =>
                      start(async () => {
                        const r = await linkGscAction(props.prospectId, choice);
                        if (!r.ok) return void toast.error(r.error);
                        toast.success(`Linked — ${r.days} days of Search Console data loaded`);
                        setSites(null);
                        router.refresh();
                      })
                    }
                  >
                    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Link
                  </Button>
                </>
              ) : (
                <Button size="sm" disabled={pending} onClick={loadSites}>
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Choose property
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Activity className="h-4 w-4 text-primary" /> Website changes
          </h3>
          <p className="text-xs text-muted">
            {props.tracked ? "Checked every week automatically" : "Checked weekly once the client is won or linked to Search Console"}
            {props.checkedAt ? ` · last check ${new Date(props.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
          </p>
          {props.changes.length === 0 ? (
            <p className="text-muted">{props.checkedAt ? "No changes found since the first check." : "The first check records how the site looks today; later checks list what changed."}</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {props.changes.map((c) => (
                <li key={c.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs">
                    <b className="font-medium">{c.label}</b> · <span className="text-muted">{new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  </p>
                  <p className="truncate text-xs text-muted" title={c.url}>
                    {c.url.replace(/^https?:\/\//, "")}
                  </p>
                  {(c.before || c.after) && (
                    <p className="mt-0.5 line-clamp-2 text-xs">
                      {c.before && <span className="text-danger line-through decoration-1">{c.before}</span>}
                      {c.before && c.after && " → "}
                      {c.after && <span className="text-success">{c.after}</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                toast.info("Checking the live website — this takes a minute or two…");
                const r = await checkChangesAction(props.prospectId);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.baseline ? `First check done: ${r.pages} pages recorded. Changes will show from the next check.` : `${r.changes} change${r.changes === 1 ? "" : "s"} found on ${r.pages} pages`);
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check for changes now
          </Button>
        </div>
      </div>
    </Card>
  );
}
