import "server-only";
import { promises as dns } from "node:dns";

/**
 * Email health of a domain from public DNS (free, no account): who handles its mail (MX), SPF,
 * DKIM (looked for under the selectors common providers use) and DMARC. Each finding says what
 * it means in plain words; missing records are what makes email land in spam or be spoofed.
 */

export type EmailCheck = { key: "MX" | "SPF" | "DKIM" | "DMARC"; status: "OK" | "WARN" | "MISSING"; detail: string; record?: string };
export type EmailHealth = { domain: string; provider: string | null; checks: EmailCheck[]; score: number; checkedAt: string };

/** Selectors used by common email services (Google, Microsoft 365, Zoho, Mailchimp, SendGrid, Brevo…). */
export const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "k2", "s1", "s2", "zoho", "zmail", "mail", "dkim", "smtp", "mandrill", "mxvault", "sendgrid", "brevo", "everlytickey1", "hs1", "hs2", "protonmail"];

const PROVIDERS: [RegExp, string][] = [
  [/google\.com$|googlemail\.com$/i, "Google Workspace"],
  [/outlook\.com$|protection\.outlook\.com$/i, "Microsoft 365"],
  [/zoho\.(com|eu|in)$/i, "Zoho Mail"],
  [/secureserver\.net$/i, "GoDaddy email"],
  [/titan\.email$/i, "Titan email"],
  [/hostinger\.com$/i, "Hostinger email"],
  [/protonmail\.ch$/i, "Proton Mail"],
  [/yandex\.(net|ru)$/i, "Yandex mail"],
  [/mx\.cloudflare\.net$/i, "Cloudflare Email Routing"],
];

export type Resolver = { mx: (d: string) => Promise<{ exchange: string; priority: number }[]>; txt: (d: string) => Promise<string[][]> };
const system: Resolver = { mx: (d) => dns.resolveMx(d), txt: (d) => dns.resolveTxt(d) };
const txtOf = async (r: Resolver, name: string) => (await r.txt(name).catch(() => [] as string[][])).map((parts) => parts.join(""));

/** DNS lookups an SPF record makes (the limit is 10); nested includes are not followed. */
export function spfLookups(record: string) {
  return record
    .split(/\s+/)
    .map((term) => term.replace(/^[+~?-]/, "").toLowerCase())
    .filter((m) => /^(include:|exists:|redirect=)/.test(m) || /^(a|mx|ptr)([:/]|$)/.test(m)).length;
}

export async function checkEmailHealth(domain: string, r: Resolver = system): Promise<EmailHealth> {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const checks: EmailCheck[] = [];

  const records = await r.mx(d).catch(() => []);
  // A "null MX" (an empty or "." exchange) means the domain accepts no email at all.
  const nullMx = records.length > 0 && records.every((m) => m.exchange === "" || m.exchange === ".");
  const mx = nullMx ? [] : records;
  const provider = mx.map((m) => PROVIDERS.find(([re]) => re.test(m.exchange.replace(/\.$/, "")))?.[1]).find(Boolean) ?? null;
  checks.push(
    mx.length
      ? { key: "MX", status: "OK", detail: `Email is received${provider ? ` by ${provider}` : ""} (${mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).slice(0, 2).join(", ")}).` }
      : { key: "MX", status: "MISSING", detail: nullMx ? "The domain is set to receive no email at all (null MX)." : "No mail server (MX) is set up: email sent to this domain cannot be delivered." },
  );

  const spf = (await txtOf(r, d)).filter((t) => /^v=spf1\b/i.test(t));
  if (!spf.length) checks.push({ key: "SPF", status: "MISSING", detail: "No SPF record: anyone can send email pretending to be this domain, and real emails are more likely to go to spam." });
  else if (spf.length > 1) checks.push({ key: "SPF", status: "WARN", detail: "More than one SPF record — receivers treat that as an error. Merge them into one.", record: spf.join(" | ") });
  else {
    const rec = spf[0];
    const all = rec.match(/([~?+-])all\b/i)?.[1];
    const lookups = spfLookups(rec);
    if (all === "+" || all === "?") checks.push({ key: "SPF", status: "WARN", detail: `SPF ends with “${all}all”, which allows any server to send as this domain. Use “~all” or “-all”.`, record: rec });
    else if (!all && !/redirect=/i.test(rec)) checks.push({ key: "SPF", status: "WARN", detail: "SPF has no “all” rule at the end, so it does not say what to do with other senders.", record: rec });
    else if (lookups > 10) checks.push({ key: "SPF", status: "WARN", detail: `SPF needs ${lookups} DNS lookups; more than 10 makes it fail.`, record: rec });
    else checks.push({ key: "SPF", status: "OK", detail: "SPF lists the servers allowed to send email for this domain.", record: rec });
  }

  const found: string[] = [];
  await Promise.all(
    DKIM_SELECTORS.map(async (sel) => {
      const recs = await txtOf(r, `${sel}._domainkey.${d}`);
      // A record with an empty key ("p=") is a revoked key, not DKIM.
      if (recs.some((t) => /(^|;)\s*p=[A-Za-z0-9+/]{20,}/i.test(t))) found.push(sel);
    }),
  );
  checks.push(
    found.length
      ? { key: "DKIM", status: "OK", detail: `DKIM signing is set up (selector ${found.sort().join(", ")}), so receivers can verify emails really come from this domain.` }
      : { key: "DKIM", status: "MISSING", detail: "No DKIM key found under the usual selectors. Without DKIM, emails are easier to fake and more often filtered as spam (a custom selector may still exist)." },
  );

  const dmarc = (await txtOf(r, `_dmarc.${d}`)).find((t) => /^v=DMARC1\b/i.test(t));
  if (!dmarc) checks.push({ key: "DMARC", status: "MISSING", detail: "No DMARC policy: Gmail and Yahoo expect one from businesses that send email, and without it the domain can be spoofed." });
  else {
    const policy = dmarc.match(/\bp=(none|quarantine|reject)/i)?.[1]?.toLowerCase();
    const reports = /\brua=/i.test(dmarc);
    if (policy === "none") checks.push({ key: "DMARC", status: "WARN", detail: `DMARC is in monitor mode (p=none): fake emails are still delivered.${reports ? "" : " No report address (rua) is set either."}`, record: dmarc });
    else checks.push({ key: "DMARC", status: "OK", detail: `DMARC policy “${policy ?? "set"}” protects the domain from spoofing.${reports ? "" : " Adding a report address (rua) would show who sends as the domain."}`, record: dmarc });
  }

  const points: Record<EmailCheck["status"], number> = { OK: 25, WARN: 12, MISSING: 0 };
  return { domain: d, provider, checks, score: checks.reduce((s, c) => s + points[c.status], 0), checkedAt: new Date().toISOString() };
}

/** Sales talking points for a prospect, only from what is actually missing or weak. */
export function emailPitch(h: EmailHealth) {
  const bad = h.checks.filter((c) => c.status !== "OK" && c.key !== "MX");
  if (!bad.length) return [];
  return [`${h.domain}'s email setup is missing ${bad.map((c) => c.key).join(", ")} — their emails are more likely to land in spam and the domain can be used to send fake emails. A quick DNS fix you can offer.`];
}
