import "server-only";
import dns from "node:dns/promises";
import tls from "node:tls";
import { assertPublicHost, guardedLookup, type GuardOptions } from "../crawler/network-guard";
import { isHtml, safeFetch } from "../crawler/safe-fetch";
import { trancoRank } from "./tranco";

/**
 * Domain overview from free, public sources only — no API keys, nothing paid, no scraping of SEO
 * tools. Every block records its source; a failed source is reported as unavailable, never guessed.
 *
 *  - Registration: RDAP (the official successor of WHOIS) via the rdap.org bootstrap service
 *  - History:      Internet Archive Wayback Machine CDX API
 *  - Popularity:   Tranco top-1M research ranking
 *  - SSL, email DNS (MX / SPF / DMARC) and technology: checked directly against the domain
 */

type Sourced<T> = ({ ok: true } & T) | { ok: false; error: string };

export type DomainOverview = {
  domain: string;
  checkedAt: string;
  registration: Sourced<{ registeredAt: string | null; expiresAt: string | null; updatedAt: string | null; registrar: string | null }>;
  history: Sourced<{ firstCapture: string | null; lastCapture: string | null }>;
  popularity: Sourced<{ rank: number | null; listId: string | null; listDate: string }>;
  ssl: Sourced<{ issuer: string | null; validTo: string; daysLeft: number }>;
  email: Sourced<{ mx: boolean; spf: string | null; dmarc: string | null }>;
  tech: Sourced<{ cms: string | null; analytics: string[]; other: string[] }>;
  signals: { tone: "good" | "warning" | "info"; text: string }[];
};

export const DOMAIN_SOURCES = {
  registration: "RDAP (rdap.org)",
  history: "Internet Archive Wayback Machine",
  popularity: "Tranco top 1M list",
  ssl: "TLS certificate of the website",
  email: "Public DNS records",
  tech: "Homepage HTML",
} as const;

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "Unavailable");

async function settle<T>(fn: () => Promise<T>): Promise<Sourced<T>> {
  try {
    return { ok: true, ...(await fn()) } as Sourced<T>;
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

type RdapEntity = { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] };
type Rdap = { events?: { eventAction: string; eventDate: string }[]; entities?: RdapEntity[] };

export async function rdapLookup(domain: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    // rdap.org refuses requests without a user agent.
    headers: { accept: "application/rdap+json, application/json", "user-agent": "SEOClientAcquisitionOS/1.0 (domain overview)" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new Error("No registration record found (RDAP not available for this domain ending)");
  if (!res.ok) throw new Error(`RDAP lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as Rdap;
  const event = (name: string) => data.events?.find((e) => e.eventAction === name)?.eventDate ?? null;
  const registrarCard = data.entities?.find((e) => e.roles?.includes("registrar"))?.vcardArray?.[1];
  const registrar = registrarCard?.find((f) => f[0] === "fn")?.[3] ?? null;
  return { registeredAt: event("registration"), expiresAt: event("expiration"), updatedAt: event("last changed"), registrar: typeof registrar === "string" ? registrar : null };
}

const waybackDate = (ts: string | undefined) => (ts && /^\d{8}/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : null);

export async function waybackHistory(domain: string, fetchImpl: typeof fetch = fetch) {
  const query = async (limit: number) => {
    const res = await fetchImpl(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&fl=timestamp&limit=${limit}&output=json`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Wayback Machine lookup failed (HTTP ${res.status})`);
    const rows = (await res.json()) as string[][];
    return waybackDate(rows[1]?.[0]);
  };
  const firstCapture = await query(1);
  return { firstCapture, lastCapture: firstCapture ? await query(-1) : null };
}

export async function sslCertificate(host: string, guard: GuardOptions = {}) {
  await assertPublicHost(host, guard);
  return new Promise<{ issuer: string | null; validTo: string; daysLeft: number }>((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, lookup: guardedLookup(guard), rejectUnauthorized: false, timeout: 15_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return reject(new Error("No certificate presented"));
      const validTo = new Date(cert.valid_to);
      const issuer = (cert.issuer?.O as string | undefined) ?? (cert.issuer?.CN as string | undefined) ?? null;
      // Untrusted or expired certificates are still read (rejectUnauthorized: false) so the expiry can be reported.
      resolve({ issuer, validTo: validTo.toISOString(), daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000) });
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timed out"));
    });
    socket.on("error", (e) => reject(e));
  });
}

export async function emailDns(domain: string) {
  const txt = async (name: string) => (await dns.resolveTxt(name).catch(() => [] as string[][])).map((r) => r.join(""));
  const [mx, root, dmarc] = await Promise.all([dns.resolveMx(domain).catch(() => []), txt(domain), txt(`_dmarc.${domain}`)]);
  return { mx: mx.length > 0, spf: root.find((r) => /^v=spf1/i.test(r)) ?? null, dmarc: dmarc.find((r) => /^v=DMARC1/i.test(r)) ?? null };
}

const CMS: [string, RegExp][] = [
  ["WordPress", /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+WordPress/i],
  ["Shopify", /cdn\.shopify\.com|Shopify\.theme/i],
  ["Wix", /static\.wixstatic\.com|<meta[^>]+generator[^>]+Wix/i],
  ["Squarespace", /static1\.squarespace\.com|<meta[^>]+generator[^>]+Squarespace/i],
  ["Webflow", /<html[^>]+data-wf-site|webflow\.js/i],
  ["Joomla", /<meta[^>]+generator[^>]+Joomla/i],
  ["Drupal", /<meta[^>]+generator[^>]+Drupal|\/sites\/default\/files\//i],
  ["Next.js", /\/_next\/static\//i],
  ["Blogger", /<meta[^>]+generator[^>]+Blogger/i],
];
const ANALYTICS: [string, RegExp][] = [
  ["Google Analytics 4", /gtag\/js\?id=G-|['"]G-[A-Z0-9]{6,}['"]/],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/],
  ["Meta Pixel", /connect\.facebook\.net\/[^"']+\/fbevents\.js/],
  ["Microsoft Clarity", /clarity\.ms\/tag/],
  ["Hotjar", /static\.hotjar\.com/],
];
const OTHER: [string, RegExp][] = [
  ["WooCommerce", /woocommerce/i],
  ["Elementor", /elementor/i],
  ["Yoast SEO", /yoast/i],
  ["Rank Math", /rank-math|rankmath/i],
  ["Cloudflare", /cdnjs\.cloudflare\.com|cf-ray|__cf_bm/i],
  ["WhatsApp chat button", /wa\.me\/|api\.whatsapp\.com\/send/i],
];

export function detectTech(html: string, headers: Record<string, string> = {}) {
  const all = html + "\n" + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n");
  return {
    cms: CMS.find(([, re]) => re.test(all))?.[0] ?? null,
    analytics: ANALYTICS.filter(([, re]) => re.test(all)).map(([n]) => n),
    other: OTHER.filter(([, re]) => re.test(all)).map(([n]) => n),
  };
}

const years = (from: string, to = Date.now()) => (to - new Date(from).getTime()) / (365.25 * 86_400_000);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Plain-language observations a consultant can use in a conversation or proposal. */
export function domainSignals(o: Omit<DomainOverview, "signals">): DomainOverview["signals"] {
  const s: DomainOverview["signals"] = [];
  const reg = o.registration.ok ? o.registration : null;
  if (reg?.registeredAt) {
    const age = years(reg.registeredAt);
    if (age < 1) s.push({ tone: "warning", text: `Young domain: registered ${fmt(reg.registeredAt)} (${Math.max(1, Math.round(age * 12))} months ago). New domains usually need more time and trusted links before they rank well.` });
    else s.push({ tone: "good", text: `Domain registered ${fmt(reg.registeredAt)} — about ${Math.floor(age)} year${Math.floor(age) === 1 ? "" : "s"} old.` });
  }
  if (reg?.expiresAt) {
    const days = Math.floor((new Date(reg.expiresAt).getTime() - Date.now()) / 86_400_000);
    if (days < 60) s.push({ tone: "warning", text: `The domain registration expires on ${fmt(reg.expiresAt)} (${days} days). If it lapses, the website and email stop working.` });
  }
  const hist = o.history.ok ? o.history : null;
  if (hist?.firstCapture && reg?.registeredAt && new Date(hist.firstCapture).getTime() < new Date(reg.registeredAt).getTime() - 90 * 86_400_000) {
    s.push({ tone: "info", text: `The Wayback Machine has copies of this domain from ${fmt(hist.firstCapture)} — before the current registration (${fmt(reg.registeredAt)}). The domain was used before; its old links and history can help or hurt.` });
  } else if (hist?.firstCapture) {
    s.push({ tone: "info", text: `First archived copy of the website: ${fmt(hist.firstCapture)}.` });
  }
  if (o.popularity.ok) {
    s.push(
      o.popularity.rank
        ? { tone: "good", text: `Ranked #${o.popularity.rank.toLocaleString("en-US")} among the world's most visited domains (Tranco).` }
        : { tone: "info", text: "Not in the world's top 1 million domains (Tranco) — normal for local and small businesses." },
    );
  }
  if (o.ssl.ok && o.ssl.daysLeft < 21) s.push({ tone: "warning", text: o.ssl.daysLeft < 0 ? "The SSL certificate has expired — visitors see a security warning." : `The SSL certificate expires in ${o.ssl.daysLeft} days.` });
  if (o.email.ok) {
    if (o.email.mx && !o.email.dmarc) s.push({ tone: "warning", text: "Email on this domain has no DMARC record, so its emails are more likely to land in spam and the domain is easier to spoof." });
    if (o.email.mx && !o.email.spf) s.push({ tone: "warning", text: "No SPF record: mail servers cannot check which servers may send email for this domain." });
  }
  if (o.tech.ok) {
    if (o.tech.analytics.length === 0) s.push({ tone: "warning", text: "No Google Analytics or Tag Manager found on the homepage — visits and enquiries are probably not being measured." });
    if (o.tech.cms) s.push({ tone: "info", text: `The website is built with ${o.tech.cms}.` });
  }
  return s;
}

/** `popularity: false` skips the Tranco list (a 22 MB weekly download), e.g. inside a website audit. */
export async function checkDomain(domain: string, opts: { guard?: GuardOptions; fetchImpl?: typeof fetch; popularity?: boolean } = {}): Promise<DomainOverview> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const bare = domain.toLowerCase().replace(/^www\./, "");
  const [registration, history, popularity, ssl, email, tech] = await Promise.all([
    settle(() => rdapLookup(bare, fetchImpl)),
    settle(() => waybackHistory(bare, fetchImpl)),
    opts.popularity === false ? Promise.resolve({ ok: false as const, error: "Not checked" }) : settle(() => trancoRank(bare, fetchImpl)),
    settle(async () => {
      try {
        return await sslCertificate(`www.${bare}`, opts.guard);
      } catch {
        return sslCertificate(bare, opts.guard);
      }
    }),
    settle(() => emailDns(bare)),
    settle(async () => {
      const res = await safeFetch(`https://${bare}/`, { ...opts.guard, acceptBody: isHtml });
      return detectTech(res.body, res.headers);
    }),
  ]);
  const overview = { domain: bare, checkedAt: new Date().toISOString(), registration, history, popularity, ssl, email, tech };
  return { ...overview, signals: domainSignals(overview) };
}
