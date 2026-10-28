/**
 * Google Business Profile / Google Maps links pasted instead of a website:
 * maps.app.goo.gl/…, goo.gl/maps/…, google.com/maps/place/Name/@lat,lng, maps.google.com/?q=…, g.page/…
 * Only Google's own hosts are accepted, so following a short link cannot reach anything else.
 */
const GBP_HOST = /^(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl|g\.page|maps\.google\.[a-z.]+|google\.[a-z.]+|business\.google\.com)$/i;

export type GbpLink = { name: string | null; lat: number | null; lng: number | null; url: string };

export function isGbpLink(text: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`);
    if (!GBP_HOST.test(u.hostname)) return false;
    if (/^(?:www\.)?google\./i.test(u.hostname)) return u.pathname.startsWith("/maps");
    if (/^(?:www\.)?goo\.gl$/i.test(u.hostname)) return u.pathname.startsWith("/maps");
    return true;
  } catch {
    return false;
  }
}

/** Business name and map position from a full Google Maps URL. */
export function parseMapsUrl(raw: string): GbpLink {
  const u = new URL(raw);
  const place = u.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
  const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ?? raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const q = u.searchParams.get("q") ?? u.searchParams.get("query");
  const name = place ? decodeURIComponent(place.replace(/\+/g, " ")) : q && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q) ? q : null;
  return { name: name?.trim() || null, lat: at ? Number(at[1]) : null, lng: at ? Number(at[2]) : null, url: raw };
}

/** Follows a short link (maps.app.goo.gl, g.page) to the full Maps address, then reads it. */
export async function resolveGbpLink(text: string, fetchImpl: typeof fetch = fetch): Promise<GbpLink> {
  let url = /^https?:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (!GBP_HOST.test(u.hostname)) throw new Error("The link leads outside Google Maps.");
    if (u.pathname.startsWith("/maps/place/") || u.searchParams.has("q") || u.searchParams.has("query")) return parseMapsUrl(url);
    const res = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (compatible; LeadLift)" } });
    const next = res.headers.get("location");
    if (!next) return parseMapsUrl(url);
    url = new URL(next, url).toString();
  }
  return parseMapsUrl(url);
}
