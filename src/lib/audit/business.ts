import type { CrawledRecord } from "../crawler/crawl";
import type { ContactCandidate } from "../crawler/contacts-extract";
import { isOtherLanguage } from "../crawler/classify";

/** Inferred business facts. Every value carries its sources and stays "unverified" until a person confirms it. */
export type InferredValue = { value: string; sources: string[]; method: string };
export type BusinessProfile = {
  name: InferredValue | null;
  nameCandidates: InferredValue[];
  services: InferredValue[];
  locations: InferredValue[];
  language: string | null;
  verified: false;
};

export function titleBrand(title: string | null) {
  if (!title) return null;
  const parts = title.split(/\s[|\-–—:·]\s/).map((s) => s.trim()).filter(Boolean);
  // Brand names are usually the shortest segment at the start or end of the homepage title.
  if (parts.length < 2) return null;
  const candidates = [parts[0], parts[parts.length - 1]].sort((a, b) => a.length - b.length);
  return candidates[0].length <= 60 ? candidates[0] : null;
}

export function identifyBusiness(pages: CrawledRecord[], contacts: ContactCandidate[]): BusinessProfile {
  const ok = pages.filter((p) => p.page && p.finalUrl);
  const home = ok.find((p) => p.pageType === "HOMEPAGE");

  const candidates = new Map<string, InferredValue>();
  const addName = (value: string | null | undefined, source: string, method: string) => {
    const v = value?.trim();
    if (!v || v.length > 80) return;
    const key = v.toLowerCase();
    const c = candidates.get(key);
    if (c) {
      if (!c.sources.includes(source)) c.sources.push(source);
    } else candidates.set(key, { value: v, sources: [source], method });
  };
  for (const c of contacts.filter((c) => c.type === "BUSINESS_NAME")) for (const s of c.sources) addName(c.value, s.url, s.method);
  if (home) addName(titleBrand(home.page!.title), home.finalUrl!, "homepage title");
  const nameCandidates = [...candidates.values()].sort((a, b) => b.sources.length - a.sources.length || (a.method === "structured data" ? -1 : 1));

  const services = new Map<string, InferredValue>();
  const mainLanguage = ok.filter((p) => !isOtherLanguage(p.finalUrl!, home?.finalUrl, p.page!.lang, home?.page?.lang));
  for (const p of mainLanguage.filter((p) => p.pageType === "SERVICE" || p.pageType === "PRODUCT")) {
    const h = p.page!.h1[0] || p.page!.title;
    if (h && h.length <= 90 && !services.has(h.toLowerCase())) services.set(h.toLowerCase(), { value: h, sources: [p.finalUrl!], method: "H1 of service page" });
  }
  const locations = new Map<string, InferredValue>();
  for (const p of mainLanguage.filter((p) => p.pageType === "LOCATION")) {
    const h = p.page!.h1[0] || p.page!.title;
    if (h && h.length <= 90 && !locations.has(h.toLowerCase())) locations.set(h.toLowerCase(), { value: h, sources: [p.finalUrl!], method: "H1 of location page" });
  }
  for (const a of contacts.filter((c) => c.type === "ADDRESS")) {
    if (!locations.has(a.value.toLowerCase())) locations.set(a.value.toLowerCase(), { value: a.value, sources: a.sources.map((s) => s.url), method: "published address" });
  }

  return {
    name: nameCandidates[0] ?? null,
    nameCandidates,
    services: [...services.values()].slice(0, 20),
    locations: [...locations.values()].slice(0, 20),
    language: home?.page?.lang ?? null,
    verified: false,
  };
}
