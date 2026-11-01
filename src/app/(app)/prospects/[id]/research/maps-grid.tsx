"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Grid3x3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Input, Select } from "@/components/ui";
import { mapsGridAction } from "./actions";

type Scan = { query: string; size: number; spacingKm: number; centerLat: number; centerLng: number; points: { lat: number; lng: number; position: number | null }[]; at: string };

/** Green in the top 3 (the map pack), amber 4–10, red 11–20, grey when not in the top 20. */
export const gridColor = (p: number | null) => (p == null ? "#94a3b8" : p <= 3 ? "#16a34a" : p <= 10 ? "#f59e0b" : "#dc2626");

export function MapsGrid({ prospectId, ready, defaultQuery, scan }: { prospectId: string; ready: boolean; defaultQuery: string; scan: Scan | null }) {
  const [form, setForm] = useState({ query: scan?.query ?? defaultQuery, size: String(scan?.size ?? 5), spacingKm: String(scan?.spacingKm ?? 1) });
  const [pending, start] = useTransition();
  const router = useRouter();
  const calls = Number(form.size) ** 2;
  const run = () =>
    start(async () => {
      const r = await mapsGridAction(prospectId, { query: form.query, size: Number(form.size), spacingKm: Number(form.spacingKm) });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });
  const top3 = scan ? scan.points.filter((p) => p.position != null && p.position <= 3).length : 0;
  const shown = scan ? scan.points.filter((p) => p.position != null) : [];
  const avg = shown.length ? shown.reduce((s, p) => s + p.position!, 0) / shown.length : null;

  return (
    <Card>
      <CardHeader title="Google Maps ranking grid" description="Where the business appears on Google Maps for one search, seen from points around it — the picture that shows a client which parts of the city cannot find them." />
      <div className="space-y-5 p-5 text-sm">
        {!ready && <p className="text-warning">Fetch the profile from Google above (needs the Places API key) — the grid needs the business&apos;s place on the map.</p>}
        <form
          className="grid gap-2 md:grid-cols-[1fr_9rem_9rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <Input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} placeholder="dentist dubai marina" aria-label="Search to check" />
          <Select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} aria-label="Grid size">
            <option value="3">3 × 3 points</option>
            <option value="5">5 × 5 points</option>
            <option value="7">7 × 7 points</option>
          </Select>
          <Select value={form.spacingKm} onChange={(e) => setForm({ ...form, spacingKm: e.target.value })} aria-label="Distance between points">
            <option value="0.5">0.5 km apart</option>
            <option value="1">1 km apart</option>
            <option value="2">2 km apart</option>
            <option value="3">3 km apart</option>
          </Select>
          <Button type="submit" disabled={!ready || pending || form.query.trim().length < 3}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid3x3 className="h-4 w-4" />} Scan
          </Button>
        </form>
        <p className="text-xs text-muted">This scan uses {calls} Places searches (place IDs only, the lowest-cost kind).</p>

        {scan && (
          <div className="flex flex-col gap-5 md:flex-row md:items-start">
            <div className="inline-grid gap-1.5 self-start rounded-2xl bg-surface-2 p-3" style={{ gridTemplateColumns: `repeat(${scan.size}, minmax(0, 1fr))` }}>
              {scan.points.map((p, i) => {
                const centre = i === Math.floor(scan.points.length / 2);
                return (
                  <span
                    key={i}
                    title={`${p.lat}, ${p.lng}: ${p.position == null ? "not in the top 20" : `#${p.position}`}`}
                    className={`grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white ${centre ? "ring-2 ring-text ring-offset-2 ring-offset-surface-2" : ""}`}
                    style={{ background: gridColor(p.position) }}
                  >
                    {p.position ?? "20+"}
                  </span>
                );
              })}
            </div>
            <div className="space-y-2">
              <p className="font-medium">“{scan.query}”</p>
              <p>
                In the top 3 at <b>{top3}</b> of {scan.points.length} points · average position {avg != null ? <b>{avg.toFixed(1)}</b> : "—"}
              </p>
              <p className="text-xs text-muted">
                {scan.size} × {scan.size} points, {scan.spacingKm} km apart, centred on the business (ringed) · {new Date(scan.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                {[
                  ["#16a34a", "1–3 (map pack)"],
                  ["#f59e0b", "4–10"],
                  ["#dc2626", "11–20"],
                  ["#94a3b8", "not in top 20"],
                ].map(([c, l]) => (
                  <span key={l} className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full" style={{ background: c }} /> {l}
                  </span>
                ))}
              </div>
              <a href={`https://www.google.com/maps/@${scan.centerLat},${scan.centerLng},14z`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                See the area on Google Maps <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
