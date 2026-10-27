import { getCountries, isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Whether a number can be used on WhatsApp, as far as can be known without WhatsApp's API:
 * CONFIRMED — the business links to it as WhatsApp on its own website;
 * LIKELY — a valid mobile number; POSSIBLE — the numbering plan does not say mobile or landline;
 * NO — a landline, toll-free or premium line, or not a valid number at all.
 * Nobody can check for free whether a number really has a WhatsApp account; this never pretends to.
 */
export type WhatsAppChance = "CONFIRMED" | "LIKELY" | "POSSIBLE" | "NO";

export type PhoneCheck = {
  valid: boolean;
  /** "+971501234567" when valid. */
  e164: string | null;
  /** MOBILE, FIXED_LINE, FIXED_LINE_OR_MOBILE, TOLL_FREE … (libphonenumber), or null. */
  type: string | null;
  country: string | null;
  whatsapp: WhatsAppChance;
  label: string;
};

const NOT_WHATSAPP_TYPES = new Set(["FIXED_LINE", "TOLL_FREE", "PREMIUM_RATE", "SHARED_COST", "UAN", "VOICEMAIL", "PAGER"]);

const ALIASES: Record<string, CountryCode> = {
  uae: "AE",
  "u.a.e": "AE",
  emirates: "AE",
  dubai: "AE",
  "abu dhabi": "AE",
  uk: "GB",
  "u.k.": "GB",
  england: "GB",
  britain: "GB",
  "great britain": "GB",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  ksa: "SA",
  "saudi arabia": "SA",
  saudi: "SA",
};

let byName: Map<string, CountryCode> | null = null;

/** "Pakistan", "UAE", "AE", "United Kingdom" → ISO country code, or null. */
export function countryCode(text: string | null | undefined): CountryCode | null {
  const t = text?.trim().toLowerCase();
  if (!t) return null;
  if (t.length === 2 && isSupportedCountry(t.toUpperCase())) return t.toUpperCase() as CountryCode;
  if (ALIASES[t]) return ALIASES[t];
  if (!byName) {
    byName = new Map();
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const c of getCountries()) {
      const name = names.of(c);
      if (name) byName.set(name.toLowerCase(), c);
    }
  }
  return byName.get(t) ?? null;
}

/** The country implied by a website's domain ending (".ae" → AE, ".co.uk" → GB); null for .com and the like. */
export function countryFromDomain(domain: string | null | undefined): CountryCode | null {
  const tld = domain?.toLowerCase().split(".").pop();
  if (!tld || tld.length !== 2) return null;
  if (tld === "uk") return "GB";
  return isSupportedCountry(tld.toUpperCase()) ? (tld.toUpperCase() as CountryCode) : null;
}

/** Checks a phone number found on a website or typed in, and judges its chance of being on WhatsApp. */
export function checkPhone(raw: string, opts: { defaultCountry?: CountryCode | null; fromWhatsAppLink?: boolean } = {}): PhoneCheck {
  const text = raw.trim().replace(/^00/, "+");
  const parsed = parsePhoneNumberFromString(text, opts.defaultCountry ?? undefined);
  if (!parsed || !parsed.isValid()) {
    return { valid: false, e164: null, type: null, country: null, whatsapp: "NO", label: "Not a valid phone number" };
  }
  const type = parsed.getType() ?? null;
  const base = { valid: true, e164: parsed.number, type, country: parsed.country ?? null };
  if (opts.fromWhatsAppLink) return { ...base, whatsapp: "CONFIRMED", label: "On WhatsApp — linked on their website" };
  if (type === "MOBILE") return { ...base, whatsapp: "LIKELY", label: "Mobile number — usually on WhatsApp" };
  if (type && NOT_WHATSAPP_TYPES.has(type)) return { ...base, whatsapp: "NO", label: type === "FIXED_LINE" ? "Landline — not on WhatsApp" : "Business line — not on WhatsApp" };
  return { ...base, whatsapp: "POSSIBLE", label: "May be on WhatsApp (mobile or landline)" };
}

export type WhatsAppNumber = { value: string; whatsapp: WhatsAppChance; label: string };

const RANK: Record<WhatsAppChance, number> = { CONFIRMED: 0, LIKELY: 1, POSSIBLE: 2, NO: 3 };

/**
 * The client's numbers that can be tried on WhatsApp, best first: a WhatsApp link on their site,
 * then mobiles, then numbers that may be either. Landlines and invalid numbers are left out, and the
 * same number is listed once.
 */
export function whatsAppNumbers(contacts: { type: string; value: string; sourceMethod?: string | null }[], defaultCountry?: CountryCode | null): WhatsAppNumber[] {
  const seen = new Set<string>();
  return contacts
    .filter((c) => c.type === "WHATSAPP" || c.type === "PHONE")
    .map((c) => {
      const check = checkPhone(c.value, { defaultCountry, fromWhatsAppLink: c.type === "WHATSAPP" });
      // A number the user saved as WhatsApp themselves is theirs to vouch for.
      const label = c.type === "WHATSAPP" && c.sourceMethod && c.sourceMethod !== "CRAWL" ? "Saved by you as a WhatsApp number" : check.label;
      return { value: check.e164 ?? c.value, whatsapp: check.whatsapp, label };
    })
    .filter((n) => n.whatsapp !== "NO")
    .sort((a, b) => RANK[a.whatsapp] - RANK[b.whatsapp])
    .filter((n) => (seen.has(n.value) ? false : (seen.add(n.value), true)));
}
