"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Input } from "@/components/ui";
import { saveCompetitorsAction } from "./actions";

type Row = { name: string; rating: string; reviews: string; position: string };
const blank: Row = { name: "", rating: "", reviews: "", position: "" };

/** Top Google Maps competitors entered by hand (no Places key needed): the proposal compares reviews and ratings. */
export function CompetitorsForm({
  prospectId,
  hasProfile,
  defaultQuery,
  current,
}: {
  prospectId: string;
  hasProfile: boolean;
  defaultQuery: string;
  current: { query: string; ownPosition: number | null; competitors: { name: string; rating: number | null; reviewCount: number; position: number }[] } | null;
}) {
  const [query, setQuery] = useState(current?.query ?? defaultQuery);
  const [own, setOwn] = useState(current?.ownPosition != null ? String(current.ownPosition) : "");
  const [rows, setRows] = useState<Row[]>(() => {
    const filled = (current?.competitors ?? []).map((c) => ({ name: c.name, rating: c.rating != null ? String(c.rating) : "", reviews: String(c.reviewCount), position: String(c.position) }));
    return [...filled, blank, blank, blank].slice(0, 3);
  });
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  const save = () =>
    start(async () => {
      const r = await saveCompetitorsAction(prospectId, {
        query,
        ownPosition: num(own),
        competitors: rows.filter((x) => x.name.trim()).map((x) => ({ name: x.name, rating: num(x.rating), reviewCount: Number(x.reviews || "0"), position: num(x.position) })),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Google Maps competitors
          </span>
        }
        description="Search Google Maps, then copy the top 3 businesses' rating and number of reviews here. The proposal shows the comparison — e.g. “your 18 reviews, their 140 on average”."
      />
      <form
        className="space-y-3 p-5 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!hasProfile && <p className="text-warning">Add the business&apos;s own profile first (fetch it or enter it by hand above).</p>}
        <div className="grid gap-2 md:grid-cols-[1fr_10rem_auto] md:items-center">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="dentist karachi" aria-label="Google Maps search" />
          <Input value={own} onChange={(e) => setOwn(e.target.value)} type="number" min={1} max={20} placeholder="Their position" aria-label="This business's position (1–20, empty if not in top 20)" title="This business's position in the results (empty if not in the top 20)" />
          {query.trim().length >= 3 && (
            <a href={`https://www.google.com/maps/search/${encodeURIComponent(query.trim())}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Open this search on Google Maps <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_6rem_7rem_6rem] gap-2 text-xs text-muted md:grid">
            <span>Competitor</span>
            <span>Rating</span>
            <span>Reviews</span>
            <span>Position</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_6rem_7rem_6rem]">
              <Input className="col-span-2 md:col-span-1" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={`Competitor ${i + 1}`} aria-label={`Competitor ${i + 1} name`} />
              <Input value={r.rating} onChange={(e) => set(i, { rating: e.target.value })} type="number" step="0.1" min={1} max={5} placeholder="4.7" aria-label={`Competitor ${i + 1} rating`} />
              <Input value={r.reviews} onChange={(e) => set(i, { reviews: e.target.value })} type="number" min={0} placeholder="140" aria-label={`Competitor ${i + 1} reviews`} />
              <Input value={r.position} onChange={(e) => set(i, { position: e.target.value })} type="number" min={1} max={20} placeholder={String(i + 1)} aria-label={`Competitor ${i + 1} position`} />
            </div>
          ))}
        </div>
        <Button type="submit" disabled={pending || !hasProfile}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save competitors
        </Button>
      </form>
    </Card>
  );
}
