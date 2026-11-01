import "server-only";
import { db } from "../db";
import { logActivity } from "../activity";
import { getApiKey } from "../integrations";
import { createProspect } from "../prospects";
import { normalizeDomain, normalizeWebsiteUrl } from "../url";
import { GbpError, places } from "./gbp";
import { findBusinesses, gridSummary, scanGrid, type FoundBusiness, type GridPoint } from "./places-tools";
import { ResearchError, saveGbp } from "./service";

/** Workspace actions on top of the Places tools: find prospects, add them, scan the Maps grid. */

async function placesKey(workspaceId: string) {
  const key = await getApiKey(workspaceId, "PLACES");
  if (!key) throw new ResearchError("Add a Google key with “Places API (New)” enabled on the Integrations page first.");
  return key;
}

const wrap = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GbpError) throw new ResearchError(e.message);
    throw e;
  }
};

/** Businesses for a search, weakest profiles first, marked when they are already prospects. */
export async function findProspects(workspaceId: string, query: string, fetchImpl?: typeof fetch) {
  const q = query.trim().slice(0, 120);
  if (q.length < 3) throw new ResearchError("Type a business type and a city, e.g. “dentist Dubai”.");
  const key = await placesKey(workspaceId);
  const found = await wrap(() => findBusinesses(key, q, fetchImpl));
  const domains = found.map((b) => (b.website ? normalizeDomain(normalizeWebsiteUrl(b.website)) : null)).filter((d): d is string => !!d);
  const placeIds = found.map((b) => b.placeId);
  const [byDomain, byPlace] = await Promise.all([
    db.prospect.findMany({ where: { workspaceId, domain: { in: domains } }, select: { id: true, domain: true } }),
    db.gbpProfile.findMany({ where: { workspaceId, placeId: { in: placeIds } }, select: { prospectId: true, placeId: true } }),
  ]);
  const domainMap = new Map(byDomain.map((p) => [p.domain, p.id]));
  const placeMap = new Map(byPlace.map((p) => [p.placeId, p.prospectId]));
  return found.map((b) => ({ ...b, prospectId: placeMap.get(b.placeId) ?? (b.website ? (domainMap.get(normalizeDomain(normalizeWebsiteUrl(b.website))) ?? null) : null) }));
}

/** Adds a found business as a prospect, with its Google profile figures saved for the proposal. */
export async function addFoundBusiness(workspaceId: string, userId: string, found: FoundBusiness, query: string) {
  // The row comes back from the browser: keep only sane values.
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const url = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v.slice(0, 500) : null);
  if (!text(found.placeId, 300) || !text(found.name, 200)) throw new ResearchError("This business could not be added.");
  const b: FoundBusiness = {
    placeId: found.placeId,
    name: text(found.name, 200)!,
    address: text(found.address, 300),
    phone: text(found.phone, 40),
    website: url(found.website),
    mapsUrl: url(found.mapsUrl),
    category: text(found.category, 120),
    rating: num(found.rating) != null ? Math.min(Math.max(found.rating!, 0), 5) : null,
    reviewCount: Math.max(0, Math.round(num(found.reviewCount) ?? 0)),
    lat: num(found.lat),
    lng: num(found.lng),
    weaknesses: Array.isArray(found.weaknesses) ? found.weaknesses.filter((w) => typeof w === "string").slice(0, 5).map((w) => w.slice(0, 80)) : [],
    score: 0,
  };
  query = query.slice(0, 120);
  const exists = await db.gbpProfile.findFirst({ where: { workspaceId, placeId: b.placeId }, select: { prospectId: true } });
  if (exists) return { prospectId: exists.prospectId, created: false };
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId }, select: { defaultCurrency: true } });
  const city = b.address?.split(",").slice(-2, -1)[0]?.trim() || undefined;
  const prospect = await createProspect(workspaceId, userId, {
    businessName: b.name,
    // No website: the Google Maps profile is the prospect's address (it is never crawled).
    websiteUrl: b.website ?? b.mapsUrl ?? `https://www.google.com/maps/place/?q=place_id:${b.placeId}`,
    city,
    industry: b.category ?? undefined,
    leadSource: "Prospect Finder",
    notes: [`Found with “${query}”.`, ...b.weaknesses].join(" "),
    currency: settings?.defaultCurrency ?? "USD",
    phone: b.phone ?? undefined,
  });
  await saveGbp(workspaceId, userId, prospect.id, {
    source: "PLACES_API",
    placeId: b.placeId,
    name: b.name,
    address: b.address,
    phone: b.phone,
    website: b.website,
    mapsUrl: b.mapsUrl,
    category: b.category,
    rating: b.rating,
    reviewCount: b.reviewCount,
    photoCount: null,
    hasHours: null,
    hasDescription: null,
    businessStatus: null,
    reviews: [],
    rankings: [],
    lat: b.lat,
    lng: b.lng,
  });
  return { prospectId: prospect.id, created: true };
}

/** The Maps ranking grid for a prospect's profile: size × size points, spacingKm apart, around the business. */
export async function scanMapsGrid(workspaceId: string, userId: string, prospectId: string, input: { query: string; size: number; spacingKm: number }, fetchImpl?: typeof fetch) {
  const query = input.query.trim().slice(0, 120);
  if (query.length < 3) throw new ResearchError("Enter the search to check, e.g. “dentist dubai marina”.");
  const size = [3, 5, 7].includes(input.size) ? input.size : 5;
  const spacingKm = Math.min(Math.max(input.spacingKm || 1, 0.3), 5);
  const gbp = await db.gbpProfile.findFirst({ where: { workspaceId, prospectId, placeId: { not: null } }, orderBy: { fetchedAt: "desc" } });
  if (!gbp?.placeId) throw new ResearchError("Fetch the Google Business Profile from Google first (Research page), so the business can be found on the map.");
  const key = await placesKey(workspaceId);
  let center = gbp.lat != null && gbp.lng != null ? { lat: gbp.lat, lng: gbp.lng } : null;
  if (!center) {
    const d = await wrap(() => places<{ location?: { latitude?: number; longitude?: number } }>(key, `/places/${encodeURIComponent(gbp.placeId!)}`, { method: "GET", fieldMask: "location" }, fetchImpl ?? fetch));
    if (d.location?.latitude == null || d.location.longitude == null) throw new ResearchError("Google did not return the business's location.");
    center = { lat: d.location.latitude, lng: d.location.longitude };
    await db.gbpProfile.update({ where: { id: gbp.id }, data: { lat: center.lat, lng: center.lng } });
  }
  const points = await wrap(() => scanGrid(key, gbp.placeId!, query, center!, { size, spacingKm }, fetchImpl));
  const scan = await db.mapsGridScan.create({ data: { workspaceId, prospectId, query, placeId: gbp.placeId, centerLat: center.lat, centerLng: center.lng, spacingKm, size, points: points as object } });
  const s = gridSummary(points);
  await logActivity({ workspaceId, prospectId, userId, type: "research.maps_grid", message: `Google Maps grid for “${query}”: top 3 at ${s.top3} of ${s.total} points` });
  return scan;
}

export async function latestGridScan(workspaceId: string, prospectId: string) {
  const s = await db.mapsGridScan.findFirst({ where: { workspaceId, prospectId }, orderBy: { createdAt: "desc" } });
  return s ? { ...s, points: s.points as GridPoint[] } : null;
}
