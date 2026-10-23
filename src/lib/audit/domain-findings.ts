import type { DomainOverview } from "../research/domain";
import type { FindingDraft } from "./types";

/**
 * Turns the free domain overview (RDAP, DNS, TLS, homepage HTML) into audit findings, so issues
 * such as missing analytics or DMARC reach the report and the proposal without extra work.
 * Only sources that answered produce findings; an unavailable source is never treated as a problem.
 */

const day = 86_400_000;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function domainFindings(o: Omit<DomainOverview, "signals">, homepageUrl: string, now = Date.now()): FindingDraft[] {
  const out: FindingDraft[] = [];
  const checked = `checked ${o.checkedAt.slice(0, 10)}`;

  if (o.tech.ok && o.tech.analytics.length === 0) {
    out.push({
      ruleId: "domain.no-analytics",
      category: "Conversion",
      title: "No analytics tracking found on the homepage",
      severity: "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [homepageUrl],
      observedFacts: "The homepage HTML contains no Google Analytics 4, Google Tag Manager, Meta Pixel, Microsoft Clarity or Hotjar tag.",
      businessImpact: "Without analytics, visits, enquiries and the results of SEO work cannot be measured or reported.",
      recommendation: "Install Google Analytics 4 (ideally through Google Tag Manager) and track calls, form submissions and WhatsApp clicks as conversions.",
      complexity: "LOW",
      confidence: "MEDIUM",
      verificationMethod: "Ask the client whether analytics is installed another way (for example through a plugin that loads after consent).",
      evidence: [{ kind: "HTML", url: homepageUrl, method: `Homepage HTML searched for known analytics tags (${checked})`, measurement: { analytics: [], cms: o.tech.cms } }],
    });
  }

  if (o.ssl.ok && o.ssl.daysLeft < 21) {
    const expired = o.ssl.daysLeft < 0;
    out.push({
      ruleId: expired ? "domain.ssl-expired" : "domain.ssl-expiring",
      category: "Technical SEO",
      title: expired ? "The SSL certificate has expired" : `The SSL certificate expires in ${o.ssl.daysLeft} days`,
      severity: expired ? "CRITICAL" : "HIGH",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [homepageUrl],
      observedFacts: `The certificate${o.ssl.issuer ? ` issued by ${o.ssl.issuer}` : ""} is valid until ${fmt(o.ssl.validTo)}.`,
      businessImpact: "Browsers show a full-page security warning when the certificate is expired, and most visitors leave.",
      recommendation: "Renew the certificate now and turn on automatic renewal with the host.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Open the site in a browser and check the padlock details.",
      evidence: [{ kind: "MEASUREMENT", url: homepageUrl, method: `TLS certificate read from port 443 (${checked})`, measurement: { issuer: o.ssl.issuer, validTo: o.ssl.validTo, daysLeft: o.ssl.daysLeft } }],
    });
  }

  if (o.registration.ok && o.registration.expiresAt) {
    const days = Math.floor((new Date(o.registration.expiresAt).getTime() - now) / day);
    if (days < 60) {
      out.push({
        ruleId: "domain.registration-expiring",
        category: "Technical SEO",
        title: `The domain registration expires in ${Math.max(days, 0)} days`,
        severity: days < 14 ? "CRITICAL" : "HIGH",
        evidenceStatus: "CONFIRMED",
        affectedUrls: [homepageUrl],
        observedFacts: `The registry record shows an expiry date of ${fmt(o.registration.expiresAt)}${o.registration.registrar ? ` (registrar: ${o.registration.registrar})` : ""}.`,
        businessImpact: "If the domain lapses, the website and email stop working and the domain can be bought by someone else.",
        recommendation: "Renew the domain for several years and enable auto-renew with the registrar.",
        complexity: "LOW",
        confidence: "HIGH",
        verificationMethod: "Check the expiry date in the registrar account.",
        evidence: [{ kind: "MEASUREMENT", url: homepageUrl, method: `RDAP registry lookup (${checked})`, measurement: { expiresAt: o.registration.expiresAt, registrar: o.registration.registrar } }],
      });
    }
  }

  if (o.email.ok && o.email.mx && (!o.email.dmarc || !o.email.spf)) {
    const missing = [!o.email.spf && "SPF", !o.email.dmarc && "DMARC"].filter(Boolean).join(" and ");
    out.push({
      ruleId: "domain.email-auth-missing",
      category: "Technical SEO",
      title: `Email on the domain has no ${missing} record`,
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [homepageUrl],
      observedFacts: `The domain receives email (MX records exist) but public DNS has no ${missing} record.`,
      businessImpact: "Replies and quotes sent from this domain are more likely to land in spam, and the domain is easier to impersonate.",
      recommendation: `Publish ${missing} DNS record${missing.includes(" and ") ? "s" : ""}, starting DMARC in monitoring mode (p=none).`,
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Look up the TXT records of the domain and of _dmarc.<domain>.",
      evidence: [{ kind: "MEASUREMENT", url: homepageUrl, method: `Public DNS lookup (${checked})`, measurement: { mx: true, spf: o.email.spf, dmarc: o.email.dmarc } }],
    });
  }

  if (o.registration.ok && o.registration.registeredAt) {
    const ageDays = (now - new Date(o.registration.registeredAt).getTime()) / day;
    const usedBefore =
      o.history.ok && o.history.firstCapture && new Date(o.history.firstCapture).getTime() < new Date(o.registration.registeredAt).getTime() - 90 * day;
    if (ageDays < 365 && !usedBefore) {
      out.push({
        ruleId: "domain.young",
        category: "Technical SEO",
        title: "New domain: authority needs to be built",
        severity: "OPPORTUNITY",
        evidenceStatus: "CONFIRMED",
        affectedUrls: [homepageUrl],
        observedFacts: `The domain was registered on ${fmt(o.registration.registeredAt)} (${Math.max(1, Math.round(ageDays / 30))} months ago).`,
        businessImpact: "New domains usually need trusted mentions and links before they can compete for valuable searches.",
        recommendation: "Plan steady authority building: business listings, local citations, partner and supplier links, and useful content others can cite.",
        complexity: "MEDIUM",
        confidence: "HIGH",
        verificationMethod: "RDAP registration date.",
        evidence: [{ kind: "MEASUREMENT", url: homepageUrl, method: `RDAP registry lookup (${checked})`, measurement: { registeredAt: o.registration.registeredAt } }],
      });
    }
    if (usedBefore && o.history.ok) {
      out.push({
        ruleId: "domain.previous-owner-history",
        category: "Technical SEO",
        title: "The domain was used before its current registration",
        severity: "LOW",
        evidenceStatus: "POTENTIAL",
        affectedUrls: [homepageUrl],
        observedFacts: `The Wayback Machine has copies from ${fmt(o.history.firstCapture!)}, but the current registration dates from ${fmt(o.registration.registeredAt)}.`,
        businessImpact: "Links and content from a previous owner can help or hurt rankings, depending on what the domain was used for.",
        recommendation: "Review the archived versions and the backlink profile; disavow or redirect only if old links are harmful.",
        complexity: "MEDIUM",
        confidence: "MEDIUM",
        verificationMethod: "Review archived copies on web.archive.org and a backlink export.",
        requiresHumanReview: true,
        evidence: [{ kind: "MEASUREMENT", url: homepageUrl, method: `Wayback Machine CDX and RDAP (${checked})`, measurement: { firstCapture: o.history.firstCapture, registeredAt: o.registration.registeredAt } }],
      });
    }
  }

  return out;
}
