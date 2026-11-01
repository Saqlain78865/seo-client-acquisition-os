/**
 * Google Business Profile (GBP / "GMB") data. Two honest sources only:
 *  - the official Places API (New), with the workspace's own Google key — it has a free monthly
 *    quota but Google requires a billing account on the project; or
 *  - figures the user copies from the public profile by hand.
 * Google Maps pages are never scraped. Places returns at most five reviews ("most relevant").
 */

export type GbpReview = { rating: number; text: string; author: string | null; when: string | null };
export type GbpRanking = { query: string; position: number | null; total: number; checkedAt: string };
/** A business shown above or near this one in Google Maps for the same search. */
export type GbpCompetitor = { name: string; rating: number | null; reviewCount: number; position: number; website: string | null };

export type GbpData = {
  source: "PLACES_API" | "MANUAL";
  placeId: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  mapsUrl: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  hasHours: boolean | null;
  hasDescription: boolean | null;
  businessStatus: string | null;
  reviews: GbpReview[];
  rankings: GbpRanking[];
  /** Top three other businesses for the first ranking search (Places API only). */
  competitors?: GbpCompetitor[];
  lat?: number | null;
  lng?: number | null;
};

export class GbpError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_ENABLED" | "NOT_FOUND" | "HTTP" | "NETWORK" | "INVALID_KEY",
  ) {
    super(message);
  }
}

const PLACES = "https://places.googleapis.com/v1";
const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "rating",
  "userRatingCount",
  "reviews",
  "regularOpeningHours",
  "photos",
  "primaryTypeDisplayName",
  "businessStatus",
  "editorialSummary",
  "location",
].join(",");

type PlaceSummary = { id: string; displayName?: { text?: string }; websiteUri?: string; formattedAddress?: string };
type PlaceDetails = PlaceSummary & {
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: { rating?: number; text?: { text?: string }; originalText?: { text?: string }; authorAttribution?: { displayName?: string }; relativePublishTimeDescription?: string }[];
  regularOpeningHours?: unknown;
  photos?: unknown[];
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  editorialSummary?: { text?: string };
  location?: { latitude?: number; longitude?: number };
};

export async function places<T>(apiKey: string, path: string, init: { method: "GET" | "POST"; fieldMask: string; body?: unknown }, fetchImpl: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${PLACES}${path}`, {
      method: init.method,
      headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": init.fieldMask },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GbpError(`Could not reach Google Places: ${(e as Error).message}`, "NETWORK");
  }
  if (res.ok) return (await res.json()) as T;
  const detail = ((await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null)?.error;
  if (res.status === 403 && /not been used|disabled|billing/i.test(detail?.message ?? "")) {
    throw new GbpError("The Places API is not enabled for this Google key. In Google Cloud: enable “Places API (New)” and link a billing account (the monthly free quota covers normal use).", "NOT_ENABLED");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new GbpError(`Google rejected the key: ${detail?.message ?? `HTTP ${res.status}`}`, "INVALID_KEY");
  throw new GbpError(`Google Places returned HTTP ${res.status}${detail?.message ? `: ${detail.message}` : ""}`, "HTTP");
}

const bareDomain = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Finds the business's profile: the result whose website matches the domain wins; otherwise a close name match. */
export async function findPlace(apiKey: string, q: { businessName: string; domain: string; city: string | null }, fetchImpl: typeof fetch = fetch) {
  const queries = [[q.businessName, q.city].filter(Boolean).join(" "), q.domain];
  for (const textQuery of queries) {
    const r = await places<{ places?: PlaceSummary[] }>(apiKey, "/places:searchText", { method: "POST", fieldMask: "places.id,places.displayName,places.websiteUri,places.formattedAddress", body: { textQuery, pageSize: 10 } }, fetchImpl);
    const list = r.places ?? [];
    const byDomain = list.find((p) => bareDomain(p.websiteUri) === q.domain);
    if (byDomain) return byDomain.id;
    const wanted = q.businessName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const byName = list.find((p) => (p.displayName?.text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === wanted);
    if (byName) return byName.id;
  }
  return null;
}

/** Position of the place in Google Maps text-search results for each query (top 20), or null when absent. */
export async function mapsRankings(apiKey: string, placeId: string, queries: string[], fetchImpl: typeof fetch = fetch): Promise<GbpRanking[]> {
  return (await rankingsAndCompetitors(apiKey, placeId, queries, fetchImpl)).rankings;
}

type RatedPlace = { id: string; displayName?: { text?: string }; rating?: number; userRatingCount?: number; websiteUri?: string };

/**
 * Maps positions for each query; the first query also reads the ratings of the results, so the
 * top three competitors can be compared with the business ("your 18 reviews, their 140").
 */
export async function rankingsAndCompetitors(apiKey: string, placeId: string, queries: string[], fetchImpl: typeof fetch = fetch) {
  const rankings: GbpRanking[] = [];
  let competitors: GbpCompetitor[] = [];
  for (const [i, query] of queries.slice(0, 3).entries()) {
    const fieldMask = i === 0 ? "places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri" : "places.id";
    const r = await places<{ places?: RatedPlace[] }>(apiKey, "/places:searchText", { method: "POST", fieldMask, body: { textQuery: query, pageSize: 20 } }, fetchImpl);
    const list = r.places ?? [];
    const at = list.findIndex((p) => p.id === placeId);
    rankings.push({ query, position: at >= 0 ? at + 1 : null, total: list.length, checkedAt: new Date().toISOString() });
    if (i === 0) {
      competitors = list
        .map((p, n) => ({ p, position: n + 1 }))
        .filter(({ p }) => p.id !== placeId && p.displayName?.text)
        .slice(0, 3)
        .map(({ p, position }) => ({ name: p.displayName!.text!.slice(0, 120), rating: p.rating ?? null, reviewCount: p.userRatingCount ?? 0, position, website: p.websiteUri ?? null }));
    }
  }
  return { rankings, competitors };
}

export async function fetchGbp(apiKey: string, q: { businessName: string; domain: string; city: string | null; queries: string[] }, fetchImpl: typeof fetch = fetch): Promise<GbpData> {
  const placeId = await findPlace(apiKey, q, fetchImpl);
  if (!placeId) throw new GbpError(`No Google Business Profile found for “${q.businessName}”${q.city ? ` in ${q.city}` : ""}. Check the business name, or enter the profile details by hand.`, "NOT_FOUND");
  return fetchGbpByPlaceId(apiKey, placeId, q.businessName, q.queries, fetchImpl);
}

/** The place that a Google Maps link points to: the best text match near the link's map position. */
export async function findPlaceFromLink(apiKey: string, link: { name: string; lat: number | null; lng: number | null }, fetchImpl: typeof fetch = fetch) {
  const body: Record<string, unknown> = { textQuery: link.name, pageSize: 5 };
  if (link.lat != null && link.lng != null) body.locationBias = { circle: { center: { latitude: link.lat, longitude: link.lng }, radius: 2000 } };
  const r = await places<{ places?: PlaceSummary[] }>(apiKey, "/places:searchText", { method: "POST", fieldMask: "places.id,places.displayName,places.websiteUri,places.formattedAddress", body }, fetchImpl);
  return r.places?.[0]?.id ?? null;
}

export async function fetchGbpByPlaceId(apiKey: string, placeId: string, fallbackName: string, queries: string[], fetchImpl: typeof fetch = fetch): Promise<GbpData> {
  const q = { businessName: fallbackName, queries };
  const d = await places<PlaceDetails>(apiKey, `/places/${encodeURIComponent(placeId)}`, { method: "GET", fieldMask: DETAIL_FIELDS }, fetchImpl);
  const ranked = q.queries.length ? await rankingsAndCompetitors(apiKey, placeId, q.queries, fetchImpl) : { rankings: [], competitors: [] };
  return {
    source: "PLACES_API",
    placeId,
    name: d.displayName?.text ?? q.businessName,
    address: d.formattedAddress ?? null,
    phone: d.internationalPhoneNumber ?? null,
    website: d.websiteUri ?? null,
    mapsUrl: d.googleMapsUri ?? null,
    category: d.primaryTypeDisplayName?.text ?? null,
    rating: d.rating ?? null,
    reviewCount: d.userRatingCount ?? 0,
    // Places returns up to 10 photo references: 10 means "10 or more".
    photoCount: d.photos?.length ?? 0,
    hasHours: !!d.regularOpeningHours,
    hasDescription: !!d.editorialSummary?.text,
    businessStatus: d.businessStatus ?? null,
    reviews: (d.reviews ?? [])
      .map((r) => ({ rating: r.rating ?? 0, text: (r.originalText?.text ?? r.text?.text ?? "").slice(0, 1500), author: r.authorAttribution?.displayName ?? null, when: r.relativePublishTimeDescription ?? null }))
      .filter((r) => r.rating > 0),
    rankings: ranked.rankings,
    competitors: ranked.competitors,
    lat: d.location?.latitude ?? null,
    lng: d.location?.longitude ?? null,
  };
}

/** Reviews pasted from the profile: blocks separated by a blank line; a leading "2★", "2/5" or "2 stars" sets the rating. */
export function parsePastedReviews(text: string): GbpReview[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((block) => {
      const m = block.match(/^\s*([1-5])\s*(?:★|\*|\/\s*5|stars?)\s*[-–:.]?\s*/i);
      return { rating: m ? Number(m[1]) : 1, text: (m ? block.slice(m[0].length) : block).slice(0, 1500), author: null, when: null };
    });
}

export type GbpIssue = { key: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; title: string; observed: string; fix: string };

/** Problems on the profile, stated only from the data we have. */
export function gbpIssues(g: GbpData, prospectDomain: string): GbpIssue[] {
  const out: GbpIssue[] = [];
  if (g.businessStatus && g.businessStatus !== "OPERATIONAL") {
    out.push({ key: "status", severity: "CRITICAL", title: "The profile is not shown as open", observed: `Google lists the business as ${g.businessStatus.toLowerCase().replace(/_/g, " ")}.`, fix: "Correct the business status in the profile so customers can find and contact you." });
  }
  const site = bareDomain(g.website);
  if (!site) out.push({ key: "website", severity: "HIGH", title: "No website link on the profile", observed: "The profile does not link to your website.", fix: "Add the website so profile visitors can learn more and Google connects the two." });
  else if (site !== prospectDomain) out.push({ key: "website", severity: "MEDIUM", title: "The profile links to a different website", observed: `The profile links to ${site}, not ${prospectDomain}.`, fix: "Point the profile to the main website (or the right location page)." });
  if (g.rating != null && g.reviewCount) {
    if (g.rating < 4) out.push({ key: "rating", severity: "HIGH", title: `Rating of ${g.rating.toFixed(1)}★ puts customers off`, observed: `Average rating ${g.rating.toFixed(1)} from ${g.reviewCount} reviews.`, fix: "Reply to every review, resolve complaints, and ask happy customers for reviews to lift the average." });
    else if (g.rating < 4.5) out.push({ key: "rating", severity: "MEDIUM", title: `Rating of ${g.rating.toFixed(1)}★ is below the top competitors`, observed: `Average rating ${g.rating.toFixed(1)} from ${g.reviewCount} reviews.`, fix: "A steady flow of new, genuine reviews lifts the rating to 4.5+, where most customers choose." });
  }
  if (g.reviewCount != null && g.reviewCount < 30) {
    out.push({ key: "reviews", severity: g.reviewCount < 10 ? "HIGH" : "MEDIUM", title: `Only ${g.reviewCount} review${g.reviewCount === 1 ? "" : "s"}`, observed: `The profile has ${g.reviewCount} Google review${g.reviewCount === 1 ? "" : "s"}.`, fix: "Set up a simple review request (QR code, WhatsApp link after each job) to keep reviews coming." });
  }
  if (g.photoCount != null && g.photoCount < 10) out.push({ key: "photos", severity: "MEDIUM", title: `Few photos (${g.photoCount})`, observed: `About ${g.photoCount} photo${g.photoCount === 1 ? "" : "s"} on the profile.`, fix: "Add real photos of the team, premises and work every month — profiles with photos get more calls and direction requests." });
  if (g.hasHours === false) out.push({ key: "hours", severity: "MEDIUM", title: "Opening hours are missing", observed: "No opening hours are listed.", fix: "Add regular and holiday hours so Google can show you as open when people search." });
  if (!g.phone) out.push({ key: "phone", severity: "MEDIUM", title: "No phone number on the profile", observed: "Customers cannot call straight from Google.", fix: "Add the main phone number (the same one as on the website)." });
  for (const r of g.rankings) {
    if (r.position == null) out.push({ key: `rank:${r.query}`, severity: "HIGH", title: `Not in the top ${r.total || 20} Google Maps results for “${r.query}”`, observed: `Searching “${r.query}” on Google Maps did not show the business in the first ${r.total || 20} results.`, fix: "Optimise categories, services, photos, reviews and the website's local pages to enter the map pack." });
    else if (r.position > 3) out.push({ key: `rank:${r.query}`, severity: "MEDIUM", title: `Position ${r.position} on Google Maps for “${r.query}”`, observed: `The business appears at position ${r.position}. Most calls go to the top 3 (the “map pack”).`, fix: "Close the gap to the top 3 with profile optimisation, reviews and local signals." });
  }
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const badReviews = (g: Pick<GbpData, "reviews">) => g.reviews.filter((r) => r.rating <= 3 && r.text.trim());
