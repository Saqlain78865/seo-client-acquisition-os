import { isValidEmailFormat, isValidPhoneFormat, normalizePhone } from "../contacts";
import type { ExtractedPage } from "./extract";

/**
 * Finds publicly displayed business contact details. Rules:
 * - only values literally present on crawled public pages (links, structured data, visible text)
 * - no guessing of missing emails, no inferring private details
 * - every value keeps the page(s) it was found on
 */

export type ContactCandidate = {
  type: "EMAIL" | "PHONE" | "WHATSAPP" | "ADDRESS" | "CONTACT_FORM" | "CONTACT_PAGE" | "SOCIAL" | "BUSINESS_NAME";
  value: string;
  sources: { url: string; method: string }[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  validationStatus: "VALID_FORMAT" | "INVALID_FORMAT" | "UNCHECKED";
  hasConflict: boolean;
  conflictNote?: string;
};

export type PageForContacts = { url: string; pageType: string; page: ExtractedPage };

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
// Asset filenames and tracking/platform addresses that look like emails but are not contacts.
const NOT_CONTACT_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|wixpress|example|domain|email)\.|^(your|name|email|user)@/i;
// Phone numbers in text are only trusted next to a phone-ish label, or when written in international form.
const PHONE_LABELLED = /(?:phone|tel|call|mobile|whatsapp|contact)[^\d+]{0,12}(\+?\d[\d\s().-]{6,18}\d)/gi;
const PHONE_INTERNATIONAL = /(?<![\w/=])(\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4})(?![\w/])/g;

function waNumber(link: string): string | null {
  try {
    const u = new URL(link);
    if (/wa\.me$/i.test(u.hostname)) return u.pathname.replace(/\D/g, "") || null;
    return u.searchParams.get("phone")?.replace(/\D/g, "") || null;
  } catch {
    return null;
  }
}

function asStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(asStrings);
  return [];
}

function addressFromSchema(a: unknown): string | null {
  if (typeof a === "string") return a.trim() || null;
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
      .map((k) => (typeof o[k] === "string" ? (o[k] as string) : o[k] && typeof o[k] === "object" ? ((o[k] as Record<string, unknown>).name as string) : null))
      .filter(Boolean);
    return parts.length >= 2 ? parts.join(", ") : null;
  }
  return null;
}

const BUSINESS_SCHEMA = /^(organization|localbusiness|corporation|.*business|.*store|.*clinic|dentist|physician|restaurant|hotel|travelagency|attorney|legalservice|plumber|electrician|roofingcontractor|hvacbusiness|realestateagent|autorepair|beautysalon|medicalbusiness|professionalservice|homeandconstructionbusiness)$/i;

export function extractContacts(pages: PageForContacts[]): ContactCandidate[] {
  const map = new Map<string, ContactCandidate>();
  const add = (type: ContactCandidate["type"], raw: string, url: string, method: string) => {
    let value = raw.trim();
    if (!value) return;
    if (type === "EMAIL") value = value.toLowerCase();
    if (type === "PHONE" || type === "WHATSAPP") value = normalizePhone(value);
    if (type === "SOCIAL" || type === "CONTACT_PAGE" || type === "CONTACT_FORM") value = value.replace(/\/$/, "");
    const key = `${type}|${value}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.sources.some((s) => s.url === url && s.method === method)) existing.sources.push({ url, method });
      return;
    }
    map.set(key, {
      type,
      value,
      sources: [{ url, method }],
      confidence: "MEDIUM",
      validationStatus:
        type === "EMAIL" ? (isValidEmailFormat(value) ? "VALID_FORMAT" : "INVALID_FORMAT") : type === "PHONE" || type === "WHATSAPP" ? (isValidPhoneFormat(value) ? "VALID_FORMAT" : "INVALID_FORMAT") : "UNCHECKED",
      hasConflict: false,
    });
  };

  for (const { url, pageType, page } of pages) {
    for (const m of page.mailtoLinks) if (isValidEmailFormat(m) && !NOT_CONTACT_EMAIL.test(m)) add("EMAIL", m, url, "mailto link");
    for (const t of page.telLinks) if (isValidPhoneFormat(t)) add("PHONE", t, url, "tel link");
    for (const w of page.whatsappLinks) {
      const n = waNumber(w);
      if (n && isValidPhoneFormat(n)) add("WHATSAPP", `+${n}`, url, "WhatsApp link");
    }
    for (const sl of page.socialLinks) {
      const u = new URL(sl);
      // Only profile-like links, not share buttons.
      if (u.pathname.length > 1 && !/sharer|share|intent|plugins|dialog/i.test(u.pathname + u.search)) add("SOCIAL", `${u.origin}${u.pathname}`, url, "link");
    }

    // Visible text emails (only if not already found as link on any page).
    for (const m of page.text.match(EMAIL_IN_TEXT) ?? []) {
      if (!NOT_CONTACT_EMAIL.test(m)) add("EMAIL", m, url, "page text");
    }
    const textForPhones = pageType === "CONTACT" || pageType === "HOMEPAGE" ? page.text : page.footerText;
    for (const re of [PHONE_LABELLED, PHONE_INTERNATIONAL]) {
      for (const match of textForPhones.matchAll(re)) {
        const candidate = match[1];
        const digits = candidate.replace(/\D/g, "");
        // Avoid years, prices and IDs: require 9–15 digits.
        if (digits.length >= 9 && digits.length <= 15 && isValidPhoneFormat(candidate)) add("PHONE", candidate, url, "page text");
      }
    }

    // Structured data.
    for (const item of page.structuredData.items as Record<string, unknown>[]) {
      const types = asStrings(item["@type"]);
      for (const e of asStrings(item.email)) add("EMAIL", e.replace(/^mailto:/i, ""), url, "structured data");
      for (const t of asStrings(item.telephone)) if (isValidPhoneFormat(t)) add("PHONE", t, url, "structured data");
      const addr = addressFromSchema(item.address);
      if (addr) add("ADDRESS", addr, url, "structured data");
      if (types.some((t) => BUSINESS_SCHEMA.test(t)) && typeof item.name === "string") add("BUSINESS_NAME", item.name, url, "structured data");
      for (const same of asStrings(item.sameAs)) {
        try {
          const u = new URL(same);
          if (/facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest/i.test(u.hostname)) add("SOCIAL", `${u.origin}${u.pathname}`.replace(/\/$/, ""), url, "structured data");
        } catch {}
      }
    }

    if (page.ogSiteName) add("BUSINESS_NAME", page.ogSiteName, url, "og:site_name");
    if (pageType === "CONTACT") add("CONTACT_PAGE", url, url, "page classification");
    if (page.forms.some((f) => f.hasTextarea && f.hasEmailField && !f.hasPassword)) add("CONTACT_FORM", url, url, "form with email + message fields");
  }

  const result = [...map.values()];

  // Confidence: explicit links / structured data, contact-page or repeated values are HIGH.
  const contactPages = new Set(pages.filter((p) => p.pageType === "CONTACT").map((p) => p.url));
  for (const c of result) {
    const explicit = c.sources.some((s) => s.method !== "page text");
    const onContactPage = c.sources.some((s) => contactPages.has(s.url));
    const pageCount = new Set(c.sources.map((s) => s.url)).size;
    c.confidence = explicit && (onContactPage || pageCount >= 2) ? "HIGH" : explicit || onContactPage || pageCount >= 2 ? "MEDIUM" : "LOW";
    if (c.validationStatus === "INVALID_FORMAT") c.confidence = "LOW";
  }

  // Conflicting business names → human review.
  const names = result.filter((c) => c.type === "BUSINESS_NAME");
  const distinct = new Set(names.map((n) => n.value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
  if (distinct.size > 1) {
    for (const n of names) {
      n.hasConflict = true;
      n.conflictNote = `Different business names appear on the site: ${names.map((x) => `"${x.value}"`).join(", ")}`;
    }
  }
  // Several public phone numbers are normal (branches), but flag for review when more than 2.
  const phones = result.filter((c) => c.type === "PHONE");
  if (phones.length > 2) {
    for (const p of phones) {
      p.hasConflict = true;
      p.conflictNote = `${phones.length} different phone numbers found — confirm which one to use`;
    }
  }

  return result.sort((a, b) => ["HIGH", "MEDIUM", "LOW"].indexOf(a.confidence) - ["HIGH", "MEDIUM", "LOW"].indexOf(b.confidence));
}
