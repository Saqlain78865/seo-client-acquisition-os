// Fictional Google Search Console / OAuth and OpenStreetMap answers for the product tour only.
// Loaded with `node --import ./scripts/_tour/fake-google.mjs …` it wraps global fetch in the demo
// server process, so the tour shows charts and results without any real account or network.
// Never used by the app itself.

const DAY = 86400_000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

// A small deterministic random generator, so every run shows the same numbers.
function rand(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [query, page path, impressions a day, position 6 months ago, position today]
export const SITE_DATA = {
  "desertskyballoons.ae": [
    ["hot air balloon dubai", "/", 140, 14, 6.2],
    ["balloon ride dubai price", "/prices", 70, 18, 8.4],
    ["sunrise balloon dubai", "/tours", 45, 12, 4.1],
    ["hot air balloon dubai price", "/prices", 60, 16, 9.8],
    ["desert balloon tour", "/tours", 30, 22, 11.5],
    ["how much is a hot air balloon ride in dubai", "/prices", 26, 25, 13.2],
    ["balloon safari dubai", "/tours", 22, 19, 7.7],
    ["private balloon flight dubai", "/tours", 12, 30, 15.4],
    ["desert sky balloon rides", "/", 18, 2.2, 1.1],
    ["hot air balloon uae", "/", 35, 24, 17.9],
    ["best balloon ride in dubai", "/", 16, 28, 12.6],
    ["balloon ride for kids dubai", "/tours", 8, 35, 21.3],
  ],
  "brightsmiledental.co.uk": [
    ["dentist leeds", "/", 120, 19, 8.8],
    ["emergency dentist leeds", "/emergency", 55, 15, 5.4],
    ["dental implants leeds", "/implants", 40, 21, 10.1],
    ["teeth whitening leeds", "/whitening", 35, 17, 7.3],
    ["nhs dentist leeds", "/", 60, 26, 18.2],
    ["invisalign leeds cost", "/invisalign", 20, 23, 12.9],
    ["bright smile dental", "/", 14, 1.6, 1.0],
    ["how much are dental implants uk", "/implants", 25, 31, 16.4],
    ["family dentist leeds", "/", 18, 16, 6.9],
  ],
  "karachimovers.pk": [
    ["house shifting karachi", "/", 90, 13, 5.2],
    ["movers and packers karachi", "/", 75, 17, 7.9],
    ["office shifting karachi", "/office", 25, 20, 9.6],
    ["shifting services karachi price", "/prices", 30, 22, 11.8],
    ["karachi movers", "/", 15, 2.5, 1.3],
    ["packers and movers near me", "/", 40, 28, 19.6],
  ],
  "lahorespicekitchen.pk": [
    ["restaurant in lahore", "/", 160, 24, 13.5],
    ["best biryani lahore", "/menu", 85, 16, 6.4],
    ["desi food lahore", "/menu", 40, 19, 8.1],
    ["family restaurant gulberg", "/", 35, 14, 4.7],
    ["lahore spice kitchen", "/", 20, 1.8, 1.1],
    ["home delivery food lahore", "/delivery", 55, 27, 15.2],
    ["karahi lahore", "/menu", 30, 21, 9.9],
  ],
};

const START = Date.parse("2026-05-01T00:00:00Z");
function dayRecords(domain, day) {
  const list = SITE_DATA[domain] ?? [];
  const t = Math.min(Math.max((day - START) / (180 * DAY), 0), 1.15);
  const r = rand(`${domain}${ymd(day)}`);
  const weekday = new Date(day).getUTCDay();
  const weekly = weekday === 5 || weekday === 6 ? 1.15 : weekday === 0 ? 0.9 : 1;
  return list.map(([q, path, impr, from, to]) => {
    const position = Math.max(1, from + (to - from) * t + (r() - 0.5) * 1.2);
    const impressions = Math.round(impr * (0.55 + 0.6 * t) * weekly * (0.85 + r() * 0.3));
    const ctr = position < 1.5 ? 0.32 : position < 3 ? 0.18 : position < 5 ? 0.09 : position < 10 ? 0.035 : position < 20 ? 0.008 : 0.002;
    const clicks = Math.round(impressions * ctr * (0.8 + r() * 0.4));
    return { query: q, page: `https://${domain}${path}`, country: r() < 0.8 ? "are" : "gbr", device: r() < 0.68 ? "MOBILE" : "DESKTOP", date: ymd(day), impressions, clicks, position };
  });
}

function match(rec, filters) {
  return filters.every((f) => {
    const v = rec[f.dimension] ?? "";
    if (f.operator === "equals") return v === f.expression;
    if (f.operator === "contains") return v.toLowerCase().includes(f.expression.toLowerCase());
    if (f.operator === "includingRegex") return new RegExp(f.expression).test(v);
    return true;
  });
}

function searchAnalytics(domain, body) {
  const filters = (body.dimensionFilterGroups ?? []).flatMap((g) => g.filters ?? []);
  const dims = body.dimensions ?? [];
  if (dims[0] === "hour") {
    const now = Date.now();
    const rows = [];
    for (let h = 72; h >= 1; h--) {
      const t = Math.floor((now - h * 3600_000) / 3600_000) * 3600_000;
      const daily = dayRecords(domain, Math.floor(t / DAY) * DAY).filter((x) => match(x, filters));
      const share = [0.2, 0.15, 0.1, 0.1, 0.15, 0.3, 0.6, 1, 1.4, 1.6, 1.7, 1.6, 1.5, 1.4, 1.4, 1.5, 1.6, 1.7, 1.8, 1.7, 1.4, 1, 0.6, 0.35][new Date(t).getUTCHours()] / 24;
      const key = new Date(t).toISOString();
      if (dims.length === 1) {
        const impressions = Math.round(daily.reduce((s, x) => s + x.impressions, 0) * share);
        const clicks = Math.round(daily.reduce((s, x) => s + x.clicks, 0) * share);
        rows.push({ keys: [key], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: daily.reduce((s, x) => s + x.position, 0) / Math.max(daily.length, 1) });
      } else {
        for (const x of daily) {
          const impressions = Math.round(x.impressions * share);
          if (impressions) rows.push({ keys: [key, x[dims[1]] ?? ""], clicks: Math.round(x.clicks * share), impressions, ctr: 0, position: x.position });
        }
      }
    }
    return { rows };
  }
  const recs = [];
  for (let d = Date.parse(`${body.startDate}T00:00:00Z`); d <= Date.parse(`${body.endDate}T00:00:00Z`) && d < Date.now() - DAY; d += DAY) {
    for (const x of dayRecords(domain, d)) if (match(x, filters)) recs.push(x);
  }
  const groups = new Map();
  for (const x of recs) {
    const keys = dims.map((k) => (k === "searchAppearance" ? "WEB" : x[k]));
    const id = keys.join("\u0001");
    const g = groups.get(id) ?? { keys, clicks: 0, impressions: 0, pos: 0 };
    g.clicks += x.clicks;
    g.impressions += x.impressions;
    g.pos += x.position * x.impressions;
    groups.set(id, g);
  }
  const rows = [...groups.values()]
    .map((g) => ({ keys: g.keys, clicks: g.clicks, impressions: g.impressions, ctr: g.impressions ? g.clicks / g.impressions : 0, position: g.impressions ? g.pos / g.impressions : 0 }))
    .sort((a, b) => (dims[0] === "date" ? a.keys[0].localeCompare(b.keys[0]) : b.clicks - a.clicks || b.impressions - a.impressions))
    .slice(0, body.rowLimit ?? 1000);
  return { rows };
}

// Fictional local businesses for the Prospect Finder (OpenStreetMap search).
const BUSINESSES = [
  ["Pearl Dental Clinic", "Jumeirah Beach Road", false, true],
  ["Al Noor Dental Centre", "Al Wasl Road", false, false],
  ["Marina Smile Studio", "Dubai Marina Walk", true, true],
  ["Desert Rose Dentistry", "Sheikh Zayed Road", false, true],
  ["Bur Dubai Family Dental", "Al Fahidi Street", false, false],
  ["Healthy Teeth Clinic", "Al Barsha 1", true, false],
  ["Gulf Orthodontics", "Business Bay", false, true],
  ["Creek Dental Care", "Deira", false, false],
  ["City Walk Dental", "City Walk", true, true],
  ["Palm Smile Centre", "Palm Jumeirah", false, true],
];

function osm(url) {
  if (url.includes("nominatim.openstreetmap.org/search") && /[?&]q=Dubai(&|$)/i.test(url)) return json([{ display_name: "Dubai, United Arab Emirates", boundingbox: ["24.95", "25.35", "55.05", "55.45"] }]);
  if (url.includes("overpass")) {
    return json({
      elements: BUSINESSES.map(([name, street, site, phone], i) => ({
        type: "node",
        id: 9100 + i,
        lat: 25.1 + i * 0.01,
        lon: 55.2 + i * 0.01,
        tags: { name, amenity: "dentist", "addr:street": street, "addr:city": "Dubai", ...(site ? { website: `https://${name.toLowerCase().replace(/[^a-z]+/g, "")}.ae` } : {}), ...(phone ? { phone: `+971 4 ${300 + i} ${1000 + i * 7}` } : {}) },
      })),
    });
  }
  if (url.includes("nominatim") || url.includes("photon")) return json(url.includes("photon") ? { features: [] } : []);
  return null;
}

export function fakeGoogle(url, init) {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "demo-token", expires_in: 3600, scope: "openid email" });
  if (u.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
  if (u.startsWith("https://www.googleapis.com/webmasters/v3/sites") && !u.includes("searchAnalytics")) return json({ siteEntry: Object.keys(SITE_DATA).map((d) => ({ siteUrl: `sc-domain:${d}`, permissionLevel: "siteOwner" })) });
  if (u.includes("/searchAnalytics/query")) {
    const site = decodeURIComponent(u.match(/\/sites\/([^/]+)\/searchAnalytics/)[1]).replace(/^sc-domain:/, "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    return json(searchAnalytics(site, JSON.parse(String(init?.body ?? "{}"))));
  }
  if (u.includes("urlInspection/index:inspect")) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    const r = rand(b.inspectionUrl)();
    const result =
      r < 0.82
        ? { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL", lastCrawlTime: new Date(Date.now() - 6 * DAY).toISOString() }
        : r < 0.92
          ? { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", pageFetchState: "SUCCESSFUL", lastCrawlTime: new Date(Date.now() - 20 * DAY).toISOString() }
          : { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" };
    return json({ inspectionResult: { indexStatusResult: result } });
  }
  return osm(u);
}

if (!globalThis.__leadliftFakeGoogle) {
  globalThis.__leadliftFakeGoogle = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => fakeGoogle(typeof url === "string" ? url : url.url ?? String(url), init) ?? real(url, init);
}
