import { AlertTriangle, ExternalLink, MapPin, MessageSquareWarning, Star } from "lucide-react";
import { badReviews, gbpIssues, type GbpData } from "@/lib/research/gbp";
import { formatDate, cn } from "@/lib/utils";
import { Alert, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { FetchGbpForm, ManualGbpForm } from "./gbp-controls";
import { GbpDraftsCard } from "./gbp-drafts";

const SEV_TONE = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warning", LOW: "neutral" } as const;

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-4 w-4", rating >= i - 0.25 ? "fill-amber-400 text-amber-400" : rating >= i - 0.75 ? "fill-amber-400/50 text-amber-400" : "text-border")} />
      ))}
    </span>
  );
}

export function GbpPanel({
  prospectId,
  businessName,
  domain,
  gbp,
  fetchedAt,
  placesReady,
  defaultQueries,
}: {
  prospectId: string;
  businessName: string;
  domain: string;
  gbp: GbpData | null;
  fetchedAt: Date | null;
  placesReady: boolean;
  defaultQueries: string[];
}) {
  const issues = gbp ? gbpIssues(gbp, domain) : [];
  const bad = gbp ? badReviews(gbp) : [];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Google Business Profile"
          description="Rating, reviews and Google Maps position — they decide who gets the call in local searches. Findings here go into the proposal's Local SEO and Reputation sections."
        />
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div className="space-y-3">
            {!placesReady && (
              <Alert tone="info" title="Fetching needs the Places API">
                Enable “Places API (New)” on your Google key (Integrations page). Until then, enter the profile by hand — it takes a minute.
              </Alert>
            )}
            <FetchGbpForm prospectId={prospectId} defaultQueries={defaultQueries} ready={placesReady} />
          </div>
          <ManualGbpForm prospectId={prospectId} businessName={businessName} defaultQuery={defaultQueries[0] ?? ""} startOpen={!placesReady && !gbp} />
        </div>
      </Card>

      {!gbp ? (
        <Card>
          <EmptyState icon={<MapPin className="h-5 w-5" />} title="No business profile yet" description="Fetch it from Google or enter it by hand to add local SEO and reputation findings to the proposal." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary to-accent p-5 text-white">
              <p className="text-xs font-medium tracking-wide text-white/70 uppercase">{gbp.category ?? "Business profile"}</p>
              <h2 className="mt-1 text-lg font-bold">{gbp.name}</h2>
              {gbp.rating != null ? (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-3xl font-bold">{gbp.rating.toFixed(1)}</span>
                  <span>
                    <Stars rating={gbp.rating} />
                    <span className="block text-xs text-white/75">{gbp.reviewCount ?? 0} Google reviews</span>
                  </span>
                </div>
              ) : (
                <p className="mt-3 text-sm text-white/75">Rating not entered</p>
              )}
            </div>
            <dl className="space-y-2 p-5 text-sm">
              {gbp.address && (
                <div>
                  <dt className="text-xs text-muted">Address</dt>
                  <dd>{gbp.address}</dd>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-xs text-muted">Photos</dt>
                  <dd>{gbp.photoCount == null ? "—" : gbp.source === "PLACES_API" && gbp.photoCount >= 10 ? "10+" : gbp.photoCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Opening hours</dt>
                  <dd>{gbp.hasHours == null ? "—" : gbp.hasHours ? "Listed" : "Missing"}</dd>
                </div>
              </div>
              <p className="pt-2 text-xs text-muted">
                {gbp.source === "PLACES_API" ? "From the Google Places API" : "Entered by hand from the public profile"}
                {fetchedAt ? ` · ${formatDate(fetchedAt, true)}` : ""}
              </p>
              {gbp.mapsUrl && (
                <a href={gbp.mapsUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Open on Google Maps <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </dl>
          </Card>

          <div className="space-y-6">
            {gbp.rankings.length > 0 && (
              <Card>
                <CardHeader title="Google Maps position" description="Position among the first 20 Google Maps results for each search." />
                <ul className="divide-y divide-border">
                  {gbp.rankings.map((r) => (
                    <li key={r.query} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span>“{r.query}”</span>
                      <Badge tone={r.position == null ? "danger" : r.position <= 3 ? "success" : "warning"}>{r.position == null ? "Not in top 20" : `#${r.position}`}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card>
              <CardHeader title={`${issues.length} profile issue${issues.length === 1 ? "" : "s"}`} description="Only issues shown by the data above." />
              {issues.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No issues found in the data we have.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {issues.map((i) => (
                    <li key={i.key} className="space-y-1 px-5 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                        <span className="font-medium">{i.title}</span>
                        <Badge tone={SEV_TONE[i.severity]} className="ml-auto">
                          {i.severity.toLowerCase()}
                        </Badge>
                      </div>
                      <p className="text-muted">{i.fix}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader
                title={`${bad.length} negative review${bad.length === 1 ? "" : "s"} found`}
                description={gbp.source === "PLACES_API" ? "Google shares up to five “most relevant” reviews through the API." : "The reviews you pasted."}
              />
              {bad.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No negative reviews in the data we have.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {bad.map((r, i) => (
                    <li key={i} className="space-y-1 px-5 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <MessageSquareWarning className="h-4 w-4 text-danger" />
                        <Stars rating={r.rating} />
                        <span className="text-xs text-muted">{[r.author, r.when].filter(Boolean).join(" · ")}</span>
                      </div>
                      <p className="text-text/85">“{r.text.length > 400 ? `${r.text.slice(0, 400)}…` : r.text}”</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
      {gbp && <GbpDraftsCard prospectId={prospectId} />}
    </div>
  );
}
