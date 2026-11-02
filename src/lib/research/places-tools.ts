import { places, type GbpCompetitor } from "./gbp";

/**
 * Prospect Finder and the Google Maps ranking grid, both on the official Places API (New) with the
 * workspace's own key. Text Search returns at most 20 results per search; nothing is scraped.
 */

export type FoundBusiness = {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  mapsUrl: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number;
  lat: number | null;
  lng: number | null;
  /** Why the profile looks weak, strongest reason first. */
  weaknesses: string[];
  score: number;
  /** Where the business came from: Google Places (ratings and reviews) or OpenStreetMap (free, no ratings). */
  source?: "GOOGLE" | "OSM";
};

type FoundPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
};

const FINDER_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.businessStatus",
].join(",");

/** What makes a profile an easy pitch: no website, a low rating, few reviews. */
export function weaknessesOf(p: { website: string | null; rating: number | null; reviewCount: number }) {
  const out: { text: string; weight: number }[] = [];
  if (!p.website) out.push({ text: "No website on the profile", weight: 3 });
  if (p.rating == null || p.reviewCount === 0) out.push({ text: "No Google reviews yet", weight: 3 });
  else if (p.rating < 4) out.push({ text: `Low rating (${p.rating.toFixed(1)}★)`, weight: 2 });
  if (p.reviewCount > 0 && p.reviewCount < 20) out.push({ text: `Only ${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"}`, weight: 2 });
  else if (p.reviewCount >= 20 && p.reviewCount < 50) out.push({ text: `${p.reviewCount} reviews — fewer than most leaders`, weight: 1 });
  return { weaknesses: out.sort((a, b) => b.weight - a.weight).map((w) => w.text), score: out.reduce((s, w) => s + w.weight, 0) };
}

/** Businesses for a search such as "dentist Dubai", weakest profiles first. */
export async function findBusinesses(apiKey: string, query: string, fetchImpl: typeof fetch = fetch): Promise<FoundBusiness[]> {
  const r = await places<{ places?: FoundPlace[] }>(apiKey, "/places:searchText", { method: "POST", fieldMask: FINDER_FIELDS, body: { textQuery: query, pageSize: 20 } }, fetchImpl);
  return (r.places ?? [])
    .filter((p) => p.displayName?.text && p.businessStatus !== "CLOSED_PERMANENTLY")
    .map((p) => {
      const base = {
        placeId: p.id,
        name: p.displayName!.text!.slice(0, 200),
        address: p.formattedAddress ?? null,
        phone: p.internationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        mapsUrl: p.googleMapsUri ?? null,
        category: p.primaryTypeDisplayName?.text ?? null,
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
      };
      return { ...base, ...weaknessesOf(base), source: "GOOGLE" as const };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Google Maps ranking grid ──

export type GridPoint = { lat: number; lng: number; position: number | null };

/** size × size points around the centre, spacingKm apart (north-south and east-west). */
export function gridPoints(center: { lat: number; lng: number }, size: number, spacingKm: number) {
  const half = (size - 1) / 2;
  const dLat = spacingKm / 111.32;
  const dLng = spacingKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  const out: { lat: number; lng: number }[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) out.push({ lat: +(center.lat + (half - row) * dLat).toFixed(6), lng: +(center.lng + (col - half) * dLng).toFixed(6) });
  return out;
}

/**
 * The business's Google Maps position for one search, as seen from each grid point: a text search
 * biased to a small circle around the point. Only place IDs are requested (the cheapest search).
 */
export async function scanGrid(apiKey: string, placeId: string, query: string, center: { lat: number; lng: number }, opts: { size: number; spacingKm: number }, fetchImpl: typeof fetch = fetch): Promise<GridPoint[]> {
  const points = gridPoints(center, opts.size, opts.spacingKm);
  const out: GridPoint[] = [];
  // A few at a time keeps within Google's per-minute limits.
  for (let i = 0; i < points.length; i += 5) {
    const batch = points.slice(i, i + 5);
    const found = await Promise.all(
      batch.map(async (pt) => {
        const r = await places<{ places?: { id: string }[] }>(
          apiKey,
          "/places:searchText",
          { method: "POST", fieldMask: "places.id", body: { textQuery: query, pageSize: 20, locationBias: { circle: { center: { latitude: pt.lat, longitude: pt.lng }, radius: Math.max(300, opts.spacingKm * 500) } } } },
          fetchImpl,
        );
        const at = (r.places ?? []).findIndex((p) => p.id === placeId);
        return { ...pt, position: at >= 0 ? at + 1 : null };
      }),
    );
    out.push(...found);
  }
  return out;
}

/** Share of grid points where the business is in the top 3 (the Maps "local pack"). */
export function gridSummary(points: GridPoint[]) {
  const shown = points.filter((p) => p.position != null);
  return {
    top3: points.filter((p) => p.position != null && p.position <= 3).length,
    top10: points.filter((p) => p.position != null && p.position <= 10).length,
    missing: points.length - shown.length,
    average: shown.length ? shown.reduce((s, p) => s + p.position!, 0) / shown.length : null,
    total: points.length,
  };
}

/** Compares the business with its top Maps competitors, in plain sentences for the proposal. */
export function competitorGap(own: { name: string; rating: number | null; reviewCount: number | null }, competitors: GbpCompetitor[]) {
  if (!competitors.length) return null;
  const avgReviews = Math.round(competitors.reduce((s, c) => s + c.reviewCount, 0) / competitors.length);
  const rated = competitors.filter((c) => c.rating != null);
  const avgRating = rated.length ? rated.reduce((s, c) => s + c.rating!, 0) / rated.length : null;
  const mine = own.reviewCount ?? 0;
  const lines: string[] = [];
  if (avgReviews > mine) lines.push(`${own.name} has ${mine} Google review${mine === 1 ? "" : "s"}; the top ${competitors.length} competitors average ${avgReviews}.`);
  if (avgRating != null && own.rating != null && avgRating - own.rating >= 0.1) lines.push(`Their average rating is ${avgRating.toFixed(1)}★ against ${own.rating.toFixed(1)}★.`);
  return { avgReviews, avgRating, lines };
}
