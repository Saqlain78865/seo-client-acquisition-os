import "server-only";
import { db } from "../db";
import { logActivity } from "../activity";
import { getApiKey } from "../integrations";
import { createProspect } from "../prospects";
import { normalizeDomain, normalizeWebsiteUrl } from "../url";
import { GbpError, places } from "./gbp";
import { findBusinesses, gridSummary, scanGrid, type FoundBusiness, type GridPoint } from "./places-tools";
import { ResearchError, saveGbp } from "./service";
import { OsmError, findOsmBusinesses, splitQuery } from "./osm-finder";

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

/**
 * The last Places API result for the workspace: an error from Google (key blocked, API not enabled,
 * no billing) or null when it worked. Kept on the PLACES connection row, made if needed.
 */
export async function placesStatus(workspaceId: string, error: string | null) {
  await db.integrationConnection.upsert({
    where: { workspaceId_provider: { workspaceId, provider: "PLACES" } },
    create: { workspaceId, provider: "PLACES", status: error ? "ERROR" : "NOT_CONFIGURED", lastError: error?.slice(0, 500) ?? null, lastTestedAt: new Date() },
    update: { lastError: error?.slice(0, 500) ?? null, lastTestedAt: new Date(), ...(error ? {} : { status: "CONNECTED" }) },
  });
}

export async function placesProblem(workspaceId: string) {
  const c = await db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "PLACES" } }, select: { lastError: true } });
  return c?.lastError ?? null;
}

/** Businesses for a search, weakest profiles first, marked when they are already prospects. */
export async function findProspects(workspaceId: string, query: string, fetchImpl?: typeof fetch, source: "GOOGLE" | "OSM" = "GOOGLE") {
  const q = query.trim().slice(0, 120);
  if (q.length < 3) throw new ResearchError("Type a business type and a city, e.g. “dentist Dubai”.");
  let found: FoundBusiness[];
  if (source === "OSM") {
    try {
      found = (await findOsmBusinesses(q, fetchImpl)).results;
    } catch (e) {
      if (e instanceof OsmError) throw new ResearchError(e.message);
      throw e;
    }
  } else {
    const key = await placesKey(workspaceId);
    try {
      found = await findBusinesses(key, q, fetchImpl);
      await placesStatus(workspaceId, null);
    } catch (e) {
      if (e instanceof GbpError) {
        // Remembered, so the Finder can say why Google is unavailable instead of failing again.
        if (e.code === "NOT_ENABLED" || e.code === "INVALID_KEY") await placesStatus(workspaceId, e.message);
        throw new ResearchError(e.message);
      }
      throw e;
    }
  }
  const domains = found.map((b) => (b.website ? normalizeDomain(normalizeWebsiteUrl(b.website)) : null)).filter((d): d is string => !!d);
  const placeIds = found.map((b) => b.placeId);
  const [byDomain, byPlace] = await Promise.all([
    db.prospect.findMany({ where: { workspaceId, domain: { in: domains } }, select: { id: true, domain: true } }),
    db.gbpProfile.findMany({ where: { workspaceId, placeId: { in: placeIds } }, select: { prospectId: true, placeId: true } }),
  ]);
  const byName = await db.prospect.findMany({ where: { workspaceId, businessName: { in: found.map((b) => b.name) } }, select: { id: true, businessName: true } });
  const domainMap = new Map(byDomain.map((p) => [p.domain, p.id]));
  const placeMap = new Map(byPlace.map((p) => [p.placeId, p.prospectId]));
  const nameMap = new Map(byName.map((p) => [p.businessName, p.id]));
  return found.map((b) => ({ ...b, prospectId: placeMap.get(b.placeId) ?? (b.website ? (domainMap.get(normalizeDomain(normalizeWebsiteUrl(b.website))) ?? null) : null) ?? (b.source === "OSM" ? (nameMap.get(b.name) ?? null) : null) }));
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
    source: found.source === "OSM" ? "OSM" : "GOOGLE",
  };
  query = query.slice(0, 120);
  if (b.source === "OSM") {
    // OpenStreetMap has no Google profile data: the prospect is added with what the map lists.
    const same = await db.prospect.findFirst({ where: { workspaceId, businessName: b.name }, select: { id: true } });
    if (same) return { prospectId: same.id, created: false };
    const settings = await db.workspaceSettings.findUnique({ where: { workspaceId }, select: { defaultCurrency: true } });
    const prospect = await createProspect(workspaceId, userId, {
      businessName: b.name,
      // No website: a Google Maps search for the business stands in (it is never crawled).
      websiteUrl: b.website ?? b.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name)}`,
      city: splitQuery(query).where || undefined,
      industry: b.category ?? undefined,
      leadSource: "Prospect Finder (OpenStreetMap)",
      notes: [`Found with “${query}” on OpenStreetMap.`, b.address ? `Address: ${b.address}.` : "", ...b.weaknesses].filter(Boolean).join(" "),
      currency: settings?.defaultCurrency ?? "USD",
      phone: b.phone ?? undefined,
    });
    return { prospectId: prospect.id, created: true };
  }
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

export type ManualCompetitors = { query: string; ownPosition: number | null; competitors: { name: string; rating: number | null; reviewCount: number; position: number | null }[] };

/**
 * Competitors copied by hand from Google Maps (when there is no Places key): the top businesses
 * for one search, saved on the latest profile so the proposal can compare reviews and ratings.
 */
export async function saveManualCompetitors(workspaceId: string, userId: string, prospectId: string, input: ManualCompetitors) {
  const gbp = await db.gbpProfile.findFirst({ where: { workspaceId, prospectId }, orderBy: { fetchedAt: "desc" } });
  if (!gbp) throw new ResearchError("Add the business's own Google profile first (the form above), then its competitors.");
  const query = input.query.trim().slice(0, 120);
  if (query.length < 3) throw new ResearchError("Enter the Google Maps search you checked, e.g. “dentist karachi”.");
  const list = input.competitors
    .filter((c) => c.name.trim())
    .slice(0, 3)
    .map((c, i) => {
      if (c.rating != null && (!Number.isFinite(c.rating) || c.rating < 1 || c.rating > 5)) throw new ResearchError(`Rating of ${c.name} must be between 1 and 5.`);
      if (!Number.isInteger(c.reviewCount) || c.reviewCount < 0 || c.reviewCount > 1_000_000) throw new ResearchError(`Enter the number of reviews of ${c.name}.`);
      const position = c.position != null && Number.isInteger(c.position) && c.position >= 1 && c.position <= 20 ? c.position : i + 1;
      return { name: c.name.trim().slice(0, 120), rating: c.rating, reviewCount: c.reviewCount, position, website: null };
    });
  const own = input.ownPosition != null && Number.isInteger(input.ownPosition) && input.ownPosition >= 1 && input.ownPosition <= 20 ? input.ownPosition : null;
  const rankings = ((gbp.rankings as { query: string; position: number | null; total: number; checkedAt: string }[] | null) ?? []).filter((r) => r.query.toLowerCase() !== query.toLowerCase());
  await db.gbpProfile.update({
    where: { id: gbp.id },
    data: { competitors: list as object, rankings: [{ query, position: own, total: 20, checkedAt: new Date().toISOString() }, ...rankings].slice(0, 5) as object },
  });
  await logActivity({ workspaceId, prospectId, userId, type: "research.competitors_saved", message: `${list.length} Google Maps competitor${list.length === 1 ? "" : "s"} entered for “${query}”` });
  return list.length;
}
