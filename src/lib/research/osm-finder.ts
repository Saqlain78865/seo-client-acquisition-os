import type { FoundBusiness } from "./places-tools";

/**
 * Prospect Finder without a Google key: businesses from OpenStreetMap (free, no card). Three free
 * services read the same map data and are asked together, because each is often slow, overloaded
 * or blocked on some networks: Overpass (several servers), Nominatim and Photon. Their results are
 * merged. Nominatim is asked at most once a second, as its policy requires, and every request names
 * the app. OpenStreetMap has no Google ratings or reviews, so the weak spots it can show are a
 * missing website or phone.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_LOOKUP = "https://nominatim.openstreetmap.org/lookup";
const PHOTON = "https://photon.komoot.io/api/";
// Public Overpass servers, asked together: whichever answers first is used.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
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
    // Only places whose full map details were read can be said to have no website or phone.
    const known = t[DETAILS] === "1";
    const weaknesses = known ? [...(!website ? ["No website on OpenStreetMap"] : []), ...(!phone ? ["No phone on OpenStreetMap"] : [])] : [];
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
      score: known ? (website ? 0 : 3) + (phone ? 0 : 1) : 0,
      detailsUnknown: !known || undefined,
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
  const box: [number, number, number, number] = [s, w, n, e];
  const body = overpassQuery(what, box);
  const [overpass, nominatim, photon] = await Promise.allSettled([
    Promise.any(OVERPASS.map((url) => getJson<{ elements?: OsmElement[] }>(url, { method: "POST", body: new URLSearchParams({ data: body }), headers: { "content-type": "application/x-www-form-urlencoded" } }, fetchImpl, 15_000))).then((r) => (r.elements ?? []).map(withDetails)),
    searchNominatim(what, where, box, fetchImpl),
    searchPhoton(what, where, box, fetchImpl),
  ]);
  const got = (r: PromiseSettledResult<OsmElement[]>) => (r.status === "fulfilled" ? r.value : []);
  // The same place from several services is kept once, with the most details.
  const merged = new Map<string, OsmElement>();
  for (const el of [...got(overpass), ...got(nominatim), ...got(photon)]) {
    const key = `${el.type[0]}${el.id}`;
    const had = merged.get(key);
    if (!had || Object.keys(el.tags ?? {}).length > Object.keys(had.tags ?? {}).length) merged.set(key, el);
  }
  // Photon gives no website or phone: those are read with Nominatim lookups (50 places each, up to 150).
  const bare = [...merged.values()].filter((el) => el.tags?.[DETAILS] !== "1").slice(0, 150);
  for (let i = 0; i < bare.length; i += 50) {
    await pause(1100);
    const ids = bare.slice(i, i + 50).map((el) => `${el.type[0].toUpperCase()}${el.id}`).join(",");
    const found = await getJson<NominatimPlace[]>(`${NOMINATIM_LOOKUP}?${new URLSearchParams({ osm_ids: ids, format: "jsonv2", extratags: "1", addressdetails: "1", "accept-language": "en" })}`, {}, fetchImpl, 30_000).catch(() => []);
    for (const p of found) {
      const el = merged.get(`${p.osm_type[0]}${p.osm_id}`);
      if (el) el.tags = { ...nominatimTags(p), ...(el.tags ?? {}), ...(p.extratags ?? {}), [DETAILS]: "1" };
    }
  }
  const results = toBusinesses([...merged.values()]);
  if (!results.length && [overpass, nominatim, photon].every((r) => r.status === "rejected")) {
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Marks places whose full OpenStreetMap details (website, phone) were read. */
const DETAILS = "_details";
const withDetails = (el: OsmElement): OsmElement => ({ ...el, tags: { ...(el.tags ?? {}), [DETAILS]: "1" } });
const NOT_A_BUSINESS = new Set(["boundary", "place", "highway", "landuse", "natural", "waterway", "railway"]);

function nominatimTags(p: NominatimPlace): Record<string, string> {
  return {
    ...(p.extratags ?? {}),
    [DETAILS]: "1",
    ...(p.name ? { name: p.name } : {}),
    ...(p.category ? { [p.category]: p.type ?? "" } : {}),
    ...(p.address?.road ? { "addr:street": p.address.road } : {}),
    ...(p.address?.house_number ? { "addr:housenumber": p.address.house_number } : {}),
    ...(p.address?.suburb ? { "addr:suburb": p.address.suburb } : {}),
    ...(p.address?.city ? { "addr:city": p.address.city } : {}),
  };
}

const fromNominatim = (list: NominatimPlace[]): OsmElement[] =>
  list.filter((p) => p.name && !NOT_A_BUSINESS.has(p.category ?? "")).map((p) => ({ type: p.osm_type, id: p.osm_id, lat: Number(p.lat), lon: Number(p.lon), tags: nominatimTags(p) }));

/** Businesses from Nominatim: free-text searches ("dentist in Lahore") and a structured one (amenity + city). One request a second. */
async function searchNominatim(what: string, where: string, box: [number, number, number, number], fetchImpl: typeof fetch): Promise<OsmElement[]> {
  const [s, w, n, e] = box;
  const common = { format: "jsonv2", limit: "40", extratags: "1", addressdetails: "1", "accept-language": "en", viewbox: `${w},${n},${e},${s}` };
  const terms = nominatimTerms(what);
  const requests = [...terms.map((term) => new URLSearchParams({ ...common, q: `${term} in ${where}` })), new URLSearchParams({ ...common, amenity: terms[terms.length - 1], city: where })];
  const list: NominatimPlace[] = [];
  for (const params of requests) {
    // The city lookup came just before: every Nominatim request waits its second.
    await pause(1100);
    list.push(...(await getJson<NominatimPlace[]>(`${NOMINATIM}?${params}`, {}, fetchImpl, 30_000).catch(() => [])));
  }
  return fromNominatim(list);
}

type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties: { osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; name?: string; street?: string; housenumber?: string; city?: string; district?: string } };

/** Businesses from Photon (OpenStreetMap search by komoot): by name words, limited to the area and the business tags. */
async function searchPhoton(what: string, where: string, box: [number, number, number, number], fetchImpl: typeof fetch): Promise<OsmElement[]> {
  const [s, w, n, e] = box;
  const tags = TYPES.filter((t) => t.words.test(what)).flatMap((t) => t.tags.map(([k, v]) => `${k}:${v}`));
  const words = [...new Set([...what.toLowerCase().split(/\s+/).filter((x) => x.length > 2), ...nominatimTerms(what), where])].slice(0, 5);
  const lists = await Promise.all(
    words.map((q) => {
      const params = new URLSearchParams({ q, bbox: `${w},${s},${e},${n}`, limit: "50", lang: "en" });
      for (const t of tags) params.append("osm_tag", t);
      return getJson<{ features?: PhotonFeature[] }>(`${PHOTON}?${params}`, {}, fetchImpl, 20_000).then(
        (r) => r.features ?? [],
        () => [] as PhotonFeature[],
      );
    }),
  );
  const kinds: Record<string, string> = { N: "node", W: "way", R: "relation" };
  return lists
    .flat()
    .filter((f) => f.properties.name && f.properties.osm_id && f.properties.osm_type && !NOT_A_BUSINESS.has(f.properties.osm_key ?? "") && (tags.length > 0 || f.properties.osm_key !== "building"))
    .map((f) => {
      const p = f.properties;
      return {
        type: kinds[p.osm_type!] ?? "node",
        id: p.osm_id!,
        lon: f.geometry?.coordinates?.[0],
        lat: f.geometry?.coordinates?.[1],
        tags: {
          name: p.name!,
          ...(p.osm_key ? { [p.osm_key]: p.osm_value ?? "" } : {}),
          ...(p.street ? { "addr:street": p.street } : {}),
          ...(p.housenumber ? { "addr:housenumber": p.housenumber } : {}),
          ...(p.district ? { "addr:suburb": p.district } : {}),
          ...(p.city ? { "addr:city": p.city } : {}),
        },
      };
    });
}
