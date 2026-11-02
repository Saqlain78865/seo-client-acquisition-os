import type { FoundBusiness } from "./places-tools";

/**
 * Prospect Finder without a Google key: businesses from OpenStreetMap (free, no card). The city is
 * found with Nominatim and the businesses with the Overpass API, both public services used within
 * their usage policies (one search at a time, identified by a User-Agent). OpenStreetMap has no
 * Google ratings or reviews, so the weak spots it can show are a missing website or phone.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// The main Overpass server and a mirror, asked together: whichever answers first is used.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const UA = "LeadLift/1.0 (SEO prospecting desktop app)";

/** Common business types and their OpenStreetMap tags. */
const TYPES: { words: RegExp; tags: [string, string][] }[] = [
  { words: /dent(ist|al)/i, tags: [["amenity", "dentist"], ["healthcare", "dentist"]] },
  { words: /doctor|clinic|physician|gp\b/i, tags: [["amenity", "doctors"], ["amenity", "clinic"], ["healthcare", "doctor"], ["healthcare", "clinic"]] },
  { words: /hospital/i, tags: [["amenity", "hospital"]] },
  { words: /pharmac|chemist/i, tags: [["amenity", "pharmacy"]] },
  { words: /vet(erinar)?/i, tags: [["amenity", "veterinary"]] },
  { words: /restaurant|food|dining|eatery|thai|pizza|burger|biryani|cafe|coffee/i, tags: [["amenity", "restaurant"], ["amenity", "cafe"], ["amenity", "fast_food"]] },
  { words: /hotel|resort|guest ?house|motel/i, tags: [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "motel"]] },
  { words: /salon|hair|barber/i, tags: [["shop", "hairdresser"], ["shop", "beauty"]] },
  { words: /beauty|spa|nail/i, tags: [["shop", "beauty"], ["leisure", "spa"], ["amenity", "spa"]] },
  { words: /gym|fitness/i, tags: [["leisure", "fitness_centre"]] },
  { words: /lawyer|law firm|attorney|solicitor|legal/i, tags: [["office", "lawyer"]] },
  { words: /account(ant|ing)|tax/i, tags: [["office", "accountant"], ["office", "tax_advisor"]] },
  { words: /real estate|estate agent|property|realtor/i, tags: [["office", "estate_agent"]] },
  { words: /plumb/i, tags: [["craft", "plumber"]] },
  { words: /electric/i, tags: [["craft", "electrician"]] },
  { words: /car repair|mechanic|garage|auto/i, tags: [["shop", "car_repair"], ["shop", "car"]] },
  { words: /school|academy|tuition/i, tags: [["amenity", "school"], ["amenity", "college"]] },
  { words: /bakery|cake/i, tags: [["shop", "bakery"], ["shop", "pastry"]] },
  { words: /furniture/i, tags: [["shop", "furniture"]] },
  { words: /optic|eye/i, tags: [["shop", "optician"]] },
  { words: /travel|tour/i, tags: [["shop", "travel_agency"], ["office", "travel_agent"]] },
];

export class OsmError extends Error {}

/** "dentist Dubai" → type "dentist", place "Dubai"; "plumber in London" works too. */
export function splitQuery(query: string) {
  const q = query.trim().replace(/\s+/g, " ");
  const m = q.match(/^(.+?)\s+(?:in|near|at)\s+(.+)$/i);
  if (m) return { what: m[1], where: m[2] };
  const type = TYPES.find((t) => t.words.test(q));
  const hit = type ? q.match(type.words) : null;
  if (hit && hit.index === 0) {
    // The type word(s) first, the place after: "dental clinic karachi".
    const words = q.split(" ");
    for (let i = words.length - 1; i > 0; i--) if (TYPES.some((t) => t.words.test(words.slice(0, i).join(" ")))) return { what: words.slice(0, i).join(" "), where: words.slice(i).join(" ") };
  }
  const words = q.split(" ");
  return words.length > 1 ? { what: words.slice(0, -1).join(" "), where: words[words.length - 1] } : { what: q, where: "" };
}

const esc = (s: string) => s.replace(/[\\"]/g, "\\$&").replace(/[.*+?^${}()|[\]]/g, "\\\\$&");

export function overpassQuery(what: string, bbox: [number, number, number, number]) {
  const box = bbox.join(",");
  const tags = TYPES.filter((t) => t.words.test(what)).flatMap((t) => t.tags);
  const parts = [...tags.map(([k, v]) => `nwr["${k}"="${v}"](${box});`), `nwr["name"~"${esc(what)}",i](${box});`];
  return `[out:json][timeout:25];(${parts.join("")});out center tags 300;`;
}

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export function toBusinesses(elements: OsmElement[]): FoundBusiness[] {
  const seen = new Set<string>();
  const out: FoundBusiness[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (!t.name || t.disused || t["disused:amenity"]) continue;
    const key = `${t.name.toLowerCase()}|${t["addr:street"] ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const site = t.website ?? t["contact:website"] ?? t.url ?? null;
    const website = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null;
    const phone = t.phone ?? t["contact:phone"] ?? t["contact:mobile"] ?? null;
    const address = [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:suburb"] ?? t["addr:district"], t["addr:city"]].filter(Boolean).join(", ") || null;
    const lat = e.lat ?? e.center?.lat ?? null;
    const lng = e.lon ?? e.center?.lon ?? null;
    const weaknesses = [...(!website ? ["No website on OpenStreetMap"] : []), ...(!phone ? ["No phone on OpenStreetMap"] : [])];
    out.push({
      placeId: `osm:${e.type}/${e.id}`,
      name: t.name.slice(0, 200),
      address,
      phone: phone?.split(";")[0].trim() ?? null,
      website,
      // A Google Maps search for the business, so its Google profile can be checked by hand.
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([t.name, address ?? (lat != null ? `${lat},${lng}` : "")].filter(Boolean).join(" "))}`,
      category: (t.amenity ?? t.shop ?? t.healthcare ?? t.office ?? t.craft ?? t.tourism ?? t.leisure ?? null)?.replace(/_/g, " ") ?? null,
      rating: null,
      reviewCount: 0,
      lat,
      lng,
      weaknesses,
      score: (website ? 0 : 3) + (phone ? 0 : 1),
      source: "OSM",
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 100);
}

async function getJson<T>(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs = 40_000): Promise<T> {
  let res: Response | null = null;
  // One retry: a dropped connection is common on mobile and home internet.
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetchImpl(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt >= 1 || (e as Error).name === "TimeoutError") throw new OsmError(`OpenStreetMap could not be reached: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (res.status === 429) throw new OsmError("OpenStreetMap is busy (too many searches). Wait a minute and try again.");
  if (!res.ok) throw new OsmError(`OpenStreetMap returned HTTP ${res.status}. Try again in a minute.`);
  return (await res.json()) as T;
}

/** Businesses of a type in a city from OpenStreetMap, those without a website first. */
export async function findOsmBusinesses(query: string, fetchImpl: typeof fetch = fetch): Promise<{ results: FoundBusiness[]; place: string }> {
  const { what, where } = splitQuery(query);
  if (!where) throw new OsmError("Add a city or area after the business type, e.g. “dentist Karachi”.");
  const places = await getJson<{ display_name: string; boundingbox: [string, string, string, string] }[]>(`${NOMINATIM}?format=json&limit=1&accept-language=en&q=${encodeURIComponent(where)}`, {}, fetchImpl);
  if (!places[0]) throw new OsmError(`“${where}” was not found on the map. Check the spelling of the city.`);
  const [south, north, west, east] = places[0].boundingbox.map(Number);
  // Very large areas (a whole country) are cut to the centre, so the search stays quick.
  const clamp = (lo: number, hi: number, max: number) => (hi - lo > max ? [(lo + hi) / 2 - max / 2, (lo + hi) / 2 + max / 2] : [lo, hi]);
  const [s, n] = clamp(south, north, 0.6);
  const [w, e] = clamp(west, east, 0.6);
  const body = overpassQuery(what, [s, w, n, e]);
  // Overpass gives the most results but is often overloaded or unreachable on some networks;
  // Nominatim's own business search runs alongside and is used when Overpass fails.
  const [overpass, nominatim] = await Promise.allSettled([
    Promise.any(OVERPASS.map((url) => getJson<{ elements?: OsmElement[] }>(url, { method: "POST", body: new URLSearchParams({ data: body }), headers: { "content-type": "application/x-www-form-urlencoded" } }, fetchImpl, 20_000))),
    searchNominatim(what, where, [s, w, n, e], fetchImpl),
  ]);
  const fromOverpass = overpass.status === "fulfilled" ? toBusinesses(overpass.value.elements ?? []) : [];
  const fromNominatim = nominatim.status === "fulfilled" ? toBusinesses(nominatim.value) : [];
  const results = fromOverpass.length >= fromNominatim.length ? fromOverpass : fromNominatim;
  if (!results.length && overpass.status === "rejected" && nominatim.status === "rejected") {
    throw new OsmError("OpenStreetMap could not be reached right now. Check the internet connection and try again in a minute.");
  }
  if (!results.length) throw new OsmError(`No “${what}” businesses found on OpenStreetMap in ${where}. Try another word for the business (e.g. “dental clinic”, “restaurant”) or a bigger city.`);
  return { results, place: places[0].display_name };
}

type NominatimPlace = { osm_type: string; osm_id: number; lat: string; lon: string; name?: string; category?: string; type?: string; extratags?: Record<string, string> | null; address?: Record<string, string> };

/** The words Nominatim understands for a business type: the user's own, then OpenStreetMap's ("salon" → "hairdresser"). */
export function nominatimTerms(what: string) {
  const mapped = TYPES.filter((t) => t.words.test(what)).flatMap((t) => t.tags.map(([, v]) => v.replace(/_/g, " ")));
  return [...new Set([what.toLowerCase(), ...mapped])].slice(0, 3);
}

/** Businesses from Nominatim's search ("dentist in Lahore"), shaped like Overpass elements. One search a second, as its policy asks. */
async function searchNominatim(what: string, where: string, box: [number, number, number, number], fetchImpl: typeof fetch): Promise<OsmElement[]> {
  const [s, w, n, e] = box;
  const list: NominatimPlace[] = [];
  for (const [i, term] of nominatimTerms(what).entries()) {
    if (i) await new Promise((r) => setTimeout(r, 1100));
    const params = new URLSearchParams({ q: `${term} in ${where}`, format: "jsonv2", limit: "40", extratags: "1", addressdetails: "1", "accept-language": "en", viewbox: `${w},${n},${e},${s}` });
    list.push(...(await getJson<NominatimPlace[]>(`${NOMINATIM}?${params}`, {}, fetchImpl, 30_000).catch(() => [])));
  }
  return list
    .filter((p) => p.name && p.category !== "boundary" && p.category !== "place" && p.category !== "highway")
    .map((p) => ({
      type: p.osm_type,
      id: p.osm_id,
      lat: Number(p.lat),
      lon: Number(p.lon),
      tags: {
        ...(p.extratags ?? {}),
        name: p.name!,
        [p.category ?? "amenity"]: p.type ?? "",
        ...(p.address?.road ? { "addr:street": p.address.road } : {}),
        ...(p.address?.house_number ? { "addr:housenumber": p.address.house_number } : {}),
        ...(p.address?.suburb ? { "addr:suburb": p.address.suburb } : {}),
        ...(p.address?.city ? { "addr:city": p.address.city } : {}),
      },
    }));
}
