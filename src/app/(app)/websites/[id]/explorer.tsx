"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { ArrowDown, ArrowUp, Download, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  Input,
  Select,
  tabBarClass,
  tabClass,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  Dimension,
  ExploreResult,
  ExploreRow,
} from "@/lib/search-console";
import { exploreAction } from "../actions";

// days 1 = the last 24 hours, hour by hour.
const RANGES = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 28, label: "Last 28 days" },
  { days: 90, label: "Last 3 months" },
  { days: 180, label: "Last 6 months" },
  { days: 365, label: "Last 12 months" },
  { days: 480, label: "Last 16 months" },
];
const TABS: { key: Dimension; label: string; one: string }[] = [
  { key: "query", label: "Queries", one: "Query" },
  { key: "page", label: "Pages", one: "Page" },
  { key: "country", label: "Countries", one: "Country" },
  { key: "device", label: "Devices", one: "Device" },
  {
    key: "searchAppearance",
    label: "Search appearance",
    one: "Search appearance",
  },
];
type Metric = "clicks" | "impressions" | "ctr" | "position";
const METRICS: { key: Metric; label: string; color: string }[] = [
  { key: "clicks", label: "Clicks", color: "#4f46e5" },
  { key: "impressions", label: "Impressions", color: "#7c3aed" },
  { key: "ctr", label: "CTR", color: "#0d9488" },
  { key: "position", label: "Position", color: "#ea580c" },
];
type Filters = Partial<Record<"query" | "page" | "country" | "device", string>>;

const fmt = (m: Metric, v: number) =>
  m === "ctr"
    ? `${(v * 100).toFixed(1)}%`
    : m === "position"
      ? v.toFixed(1)
      : Math.round(v).toLocaleString();
/** A day ("2026-10-03") or, for the 24-hour view, an hour ("2026-11-01T13:00:00-07:00" → "1 Nov 13:00"). */
const when = (d: string) =>
  d.includes("T")
    ? `${new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.slice(11, 16)}`
    : d;
const label = (dim: Dimension, key: string) =>
  dim === "country"
    ? key.toUpperCase()
    : dim === "page"
      ? key.replace(/^https?:\/\/[^/]+/, "") || "/"
      : key;

/** Change against the previous period; for position, lower is better. */
function Delta({
  m,
  now,
  before,
}: {
  m: Metric;
  now: number;
  before: number | null | undefined;
}) {
  if (before == null)
    return <span className="text-[11px] text-muted">new</span>;
  if (m === "position") {
    const d = before - now;
    if (Math.abs(d) < 0.05) return null;
    return (
      <span
        className={cn(
          "text-[11px] tabular-nums",
          d > 0 ? "text-success" : "text-danger",
        )}
      >{`${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}`}</span>
    );
  }
  if (!before)
    return now ? <span className="text-[11px] text-success">new</span> : null;
  const p = ((now - before) / before) * 100;
  if (Math.abs(p) < 0.5) return null;
  return (
    <span
      className={cn(
        "text-[11px] tabular-nums",
        p > 0 ? "text-success" : "text-danger",
      )}
    >{`${p > 0 ? "+" : ""}${p.toFixed(0)}%`}</span>
  );
}

/** Work logged or changes found on a day, drawn on the chart. */
export type Annotation = { date: string; label: string };

/** Line chart of the selected metrics over the period, with the previous period dashed and the work done marked. */
function Chart({ data, metrics, annotations = [] }: { data: ExploreResult; metrics: Metric[]; annotations?: Annotation[] }) {
  const W = 1000;
  const H = 220;
  const pts = data.series;
  if (pts.length < 2)
    return (
      <p className="py-10 text-center text-sm text-muted">
        Not enough days of data to draw a chart.
      </p>
    );
  const line = (values: number[], invert: boolean) => {
    const max = Math.max(...values, 0.0001);
    const min = invert ? Math.min(...values) : 0;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * W;
        const t = invert ? (v - min) / Math.max(max - min, 0.0001) : v / max;
        return `${x.toFixed(1)},${(H - 8 - t * (H - 24)).toFixed(1)}`;
      })
      .join(" ");
  };
  // Each day with work on it gets one marker; the labels of that day are listed together.
  const dayIndex = new Map(pts.map((p, i) => [p.date.slice(0, 10), i]));
  const marks = new Map<number, { date: string; labels: string[] }>();
  for (const a of annotations) {
    const i = dayIndex.get(a.date);
    if (i === undefined) continue;
    const m = marks.get(i) ?? { date: a.date, labels: [] };
    m.labels.push(a.label);
    marks.set(i, m);
  }
  const markList = [...marks.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Search performance over time"
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2={W}
            y1={H * g}
            y2={H * g}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1"
          />
        ))}
        {metrics.includes("clicks") && data.previousSeries.length > 1 && (
          <polyline
            points={line(
              data.previousSeries.slice(-pts.length).map((p) => p.clicks),
              false,
            )}
            fill="none"
            stroke="#4f46e5"
            strokeOpacity="0.35"
            strokeWidth="2"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {METRICS.filter((m) => metrics.includes(m.key)).map((m) => (
          <polyline
            key={m.key}
            points={line(
              pts.map((p) => p[m.key]),
              m.key === "position",
            )}
            fill="none"
            stroke={m.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {markList.map(([i, m]) => {
          const x = (i / (pts.length - 1)) * W;
          return (
            <g key={i}>
              <title>{`${when(m.date)}: ${m.labels.join("; ")}`}</title>
              <line x1={x} x2={x} y1={10} y2={H} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
              <rect x={x - 6} y={0} width={12} height={12} rx={3} fill="#f59e0b" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{when(pts[0].date)}</span>
        <span>{when(pts[Math.floor(pts.length / 2)].date)}</span>
        <span>{when(pts[pts.length - 1].date)}</span>
      </div>
      {markList.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {markList.slice(-8).map(([i, m]) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />
              <b className="font-medium text-text">{when(m.date)}</b> {m.labels.join("; ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function toCsv(dim: Dimension, rows: ExploreRow[], compare: boolean) {
  const head = [
    dim,
    "clicks",
    "impressions",
    "ctr",
    "position",
    ...(compare
      ? ["previous_clicks", "previous_impressions", "previous_position"]
      : []),
  ];
  const esc = (v: string | number) =>
    typeof v === "string" && /[",\n]/.test(v)
      ? `"${v.replace(/"/g, '""')}"`
      : String(v);
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.key,
        Math.round(r.clicks),
        Math.round(r.impressions),
        r.ctr.toFixed(4),
        r.position.toFixed(2),
        ...(compare
          ? [
              r.previous?.clicks ?? "",
              r.previous?.impressions ?? "",
              r.previous?.position.toFixed(2) ?? "",
            ]
          : []),
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}

/** Search Console performance for one website, as in Search Console itself. */
export function Explorer({
  websiteId,
  domain,
  annotations = [],
}: {
  websiteId: string;
  domain: string;
  annotations?: Annotation[];
}) {
  const [days, setDays] = useState(28);
  const [compare, setCompare] = useState(true);
  const [dim, setDim] = useState<Dimension>("query");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [metrics, setMetrics] = useState<Metric[]>(["clicks", "impressions"]);
  const [sort, setSort] = useState<{ by: Metric | "change"; desc: boolean }>({
    by: "clicks",
    desc: true,
  });
  const [shown, setShown] = useState(100);
  // The table always shows the dimension its data was loaded for, never stale rows under a new heading.
  const [loaded, setLoaded] = useState<{
    dim: Dimension;
    data: ExploreResult;
  } | null>(null);
  const data = loaded?.data ?? null;
  const shownDim = loaded?.dim ?? dim;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(
    () =>
      start(async () => {
        const r = await exploreAction(websiteId, {
          ...(days === 1 ? { hours: 24 as const } : { days }),
          compare,
          dimension: days === 1 && dim === "searchAppearance" ? "query" : dim,
          search: applied || undefined,
          filters,
        });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        setLoaded({ dim, data: r.data });
        setShown(100);
      }),
    [websiteId, days, compare, dim, applied, filters],
  );
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    const val = (r: ExploreRow) =>
      sort.by === "change" ? r.clicks - (r.previous?.clicks ?? 0) : r[sort.by];
    list.sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
    return list;
  }, [data, sort]);

  const drill = (key: string) => {
    if (shownDim === "searchAppearance" || pending) return;
    setFilters((f) => ({ ...f, [shownDim]: key }));
    setDim(shownDim === "query" ? "page" : "query");
    setSearch("");
    setApplied("");
  };
  const header = (m: Metric | "change", text: string) => (
    <th scope="col" className="px-3 py-2 text-right font-medium">
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-text"
        onClick={() =>
          setSort((s) => ({
            by: m,
            desc: s.by === m ? !s.desc : m !== "position",
          }))
        }
      >
        {text}{" "}
        {sort.by === m &&
          (sort.desc ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          ))}
      </button>
    </th>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Select
          value={String(days)}
          onChange={(e) => {
            const d = Number(e.target.value);
            setDays(d);
            if (d === 1 && dim === "searchAppearance") setDim("query");
          }}
          className="w-44"
          aria-label="Date range"
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />{" "}
          Compare with previous period
        </label>
        {Object.entries(filters).map(([k, v]) =>
          v ? (
            <button
              key={k}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, [k]: undefined }))}
              className="inline-flex max-w-xs items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary"
            >
              <span className="truncate">
                {k}: {label(k as Dimension, v)}
              </span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ) : null,
        )}
        <span className="ml-auto text-xs text-muted">
          {data
            ? `${data.siteUrl} · ${when(data.range.start)} → ${when(data.range.end)}${days === 1 ? " (Pacific Time)" : ""}`
            : domain}
        </span>
      </div>

      {error ? (
        <p className="p-6 text-sm text-danger">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-4">
            {METRICS.map((m) => {
              const on = metrics.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() =>
                    setMetrics((x) =>
                      on
                        ? x.length > 1
                          ? x.filter((k) => k !== m.key)
                          : x
                        : [...x, m.key],
                    )
                  }
                  className={cn(
                    "p-4 text-left transition-colors",
                    on ? "text-white" : "bg-surface hover:bg-surface-2",
                  )}
                  style={on ? { background: m.color } : undefined}
                >
                  <p
                    className={cn(
                      "text-xs",
                      on ? "text-white/80" : "text-muted",
                    )}
                  >
                    {m.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {data ? fmt(m.key, data.totals[m.key]) : "—"}
                  </p>
                  {data?.previousTotals && (
                    <p
                      className={cn(
                        "text-xs",
                        on ? "text-white/85" : "text-muted",
                      )}
                    >
                      was {fmt(m.key, data.previousTotals[m.key])}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          <div className="relative p-4">
            {pending && (
              <Loader2 className="absolute top-4 right-4 h-4 w-4 animate-spin text-muted" />
            )}
            {data && <Chart data={data} metrics={metrics} annotations={annotations} />}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 pt-3">
            <div className={tabBarClass} role="tablist">
              {TABS.filter(
                (t) => days !== 1 || t.key !== "searchAppearance",
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={dim === t.key}
                  className={tabClass(dim === t.key)}
                  onClick={() => (setDim(t.key), setSearch(""), setApplied(""))}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {(dim === "query" || dim === "page") && (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setApplied(search.trim());
                }}
              >
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    dim === "query" ? "Search keywords…" : "Filter pages…"
                  }
                  className="h-9 w-56"
                  aria-label="Search"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  aria-label="Apply search"
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </form>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={!rows.length}
              onClick={() => {
                const blob = new Blob(
                  [toCsv(shownDim, rows, !!data?.previousRange)],
                  { type: "text/csv" },
                );
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${domain}-${shownDim}-${data?.range.start}_${data?.range.end}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
                toast.success("CSV downloaded");
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          <div className="overflow-x-auto p-4 pt-2">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    {TABS.find((t) => t.key === shownDim)?.one} ({rows.length})
                  </th>
                  {header("clicks", "Clicks")}
                  {header("impressions", "Impressions")}
                  {header("ctr", "CTR")}
                  {header("position", "Position")}
                  {data?.previousRange && header("change", "Click change")}
                </tr>
              </thead>
              <tbody>
                {pending && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-3 text-center text-xs text-muted"
                    >
                      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{" "}
                      Loading from Search Console…
                    </td>
                  </tr>
                )}
                {rows.slice(0, shown).map((r) => (
                  <tr
                    key={r.key}
                    className={cn(
                      "border-b border-border/60 hover:bg-surface-2/50",
                      pending && "opacity-40",
                    )}
                  >
                    <td className="max-w-md px-3 py-1.5">
                      <button
                        type="button"
                        className="max-w-full truncate text-left hover:text-primary"
                        title={
                          shownDim === "searchAppearance"
                            ? r.key
                            : `Show ${shownDim === "query" ? "pages for" : "queries for"} ${r.key}`
                        }
                        onClick={() => drill(r.key)}
                      >
                        {label(shownDim, r.key)}
                      </button>
                    </td>
                    {(
                      ["clicks", "impressions", "ctr", "position"] as Metric[]
                    ).map((m) => (
                      <td
                        key={m}
                        className="px-3 py-1.5 text-right tabular-nums"
                      >
                        {fmt(m, r[m])}{" "}
                        {data?.previousRange && (
                          <Delta
                            m={m}
                            now={r[m]}
                            before={r.previous ? r.previous[m] : null}
                          />
                        )}
                      </td>
                    ))}
                    {data?.previousRange && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.previous
                          ? `${r.clicks - r.previous.clicks >= 0 ? "+" : ""}${Math.round(r.clicks - r.previous.clicks)}`
                          : "new"}
                      </td>
                    )}
                  </tr>
                ))}
                {!rows.length && !pending && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-muted"
                    >
                      No data for this selection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {rows.length > shown && (
              <div className="pt-3 text-center">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShown((n) => n + 200)}
                >
                  Show more ({rows.length - shown} left)
                </Button>
              </div>
            )}
            <p className="pt-3 text-[11px] text-muted">
              Click a search to see the pages it brings visitors to — or a page
              to see its searches. Data from Google Search Console, including
              fresh data that may still change. The last 24 hours come from
              hourly data and fill in over the day.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
