"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Globe, Loader2, MapPin, Phone, Plus, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import type { FoundBusiness } from "@/lib/research/places-tools";
import { addFoundAction, findProspectsAction } from "./actions";

type Found = FoundBusiness & { prospectId: string | null };

export function Finder() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [onlyWeak, setOnlyWeak] = useState(true);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);

  const search = () =>
    start(async () => {
      const r = await findProspectsAction(query);
      if (!r.ok) return void toast.error(r.error);
      setResults(r.results);
      setSearched(query);
    });

  const add = async (b: Found) => {
    setAdding(b.placeId);
    const r = await addFoundAction(b, searched);
    setAdding(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.created ? `${b.name} added to Prospects` : `${b.name} is already a prospect`);
    setResults((list) => list?.map((x) => (x.placeId === b.placeId ? { ...x, prospectId: r.prospectId } : x)) ?? null);
  };

  const shown = results?.filter((b) => !onlyWeak || b.score > 0) ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="dentist Dubai, plumber Manchester, thai restaurant Brooklyn…" aria-label="Business type and city" className="sm:flex-1" />
          <Button type="submit" disabled={pending || query.trim().length < 3}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {pending ? "Searching the map… (up to 30 s)" : "Find businesses"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted">
          {"Type the business and the city (“dentist Karachi”). OpenStreetMap lists names, phones and websites but no Google ratings — businesses without a website come first. Check their Google profile with the Maps link — OpenStreetMap can miss a website, so confirm before pitching."}
        </p>
      </Card>

      {results && <p className="text-xs text-muted">Map data © OpenStreetMap contributors (ODbL).</p>}
      {results && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            {results.length} businesses for “{searched}” · {results.filter((b) => b.score > 0).length} with a weak profile
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={onlyWeak} onChange={(e) => setOnlyWeak(e.target.checked)} /> Weak profiles only
          </label>
        </div>
      )}

      {results && shown.length === 0 && (
        <Card>
          <EmptyState title="No weak profiles in these results" description="Try a nearby area or a more specific service." />
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((b) => (
          <Card key={b.placeId} className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{b.name}</p>
                <p className="truncate text-xs text-muted">{[b.category, b.address].filter(Boolean).join(" · ")}</p>
              </div>
              {b.source !== "OSM" && (
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  {b.rating != null ? b.rating.toFixed(1) : "—"}
                  <span className="text-xs font-normal text-muted">({b.reviewCount})</span>
                </span>
              )}
            </div>
            {b.detailsUnknown && <p className="text-xs text-muted">Website and phone are not listed on the map for this place — check it on Google Maps.</p>}
            {b.weaknesses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {b.weaknesses.map((w) => (
                  <Badge key={w} tone={/No website|No Google reviews/.test(w) ? "danger" : "warning"}>
                    {w}
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              {b.website && (
                <a href={b.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  <Globe className="h-3.5 w-3.5" /> {b.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 40)}
                </a>
              )}
              {b.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {b.phone}
                </span>
              )}
              {b.mapsUrl && (
                <a href={b.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  <MapPin className="h-3.5 w-3.5" /> {b.source === "OSM" ? "Find on Google Maps" : "Google Maps"} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="mt-auto">
              {b.prospectId ? (
                <Link href={`/prospects/${b.prospectId}`} className="text-sm font-medium text-primary hover:underline">
                  Open prospect →
                </Link>
              ) : (
                <Button size="sm" variant="secondary" disabled={adding === b.placeId} onClick={() => add(b)}>
                  {adding === b.placeId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add as prospect
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
