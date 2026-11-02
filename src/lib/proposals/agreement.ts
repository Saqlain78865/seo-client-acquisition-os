import "server-only";
import { db } from "../db";
import { escapeHtml } from "./render";
import { htmlToPdf } from "./pdf";
import { SERVICES, type Branding, type Deliverable, type ServiceKey } from "./types";

/**
 * Service agreement made from a proposal: who, what, how much, how long and the usual terms, with
 * the client's signature from the online acceptance. A plain, fair template — not legal advice;
 * it can be checked by a lawyer before use.
 */

export class AgreementError extends Error {}

export type AgreementData = {
  title: string;
  version: number;
  branding: Branding;
  client: { businessName: string; website: string; city: string | null; country: string | null };
  services: string[];
  deliverables: Deliverable[];
  currency: string;
  monthlyPrice: number | null;
  setupFee: number | null;
  paymentTerms: string | null;
  paymentInstructions: string | null;
  durationMonths: number;
  acceptance: { name: string; contact: string | null; signature: string | null; at: Date } | null;
  date: Date;
};

const money = (n: number | null, currency: string) => (n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(n));
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export function agreementHtml(a: AgreementData) {
  const consultant = a.branding.companyName || a.branding.consultantName || "The consultant";
  const start = a.acceptance?.at ?? a.date;
  const contact = [a.branding.email, a.branding.phone, a.branding.website].filter(Boolean).map((x) => escapeHtml(x!)).join(" · ");
  const clauses: [string, string][] = [
    [
      "Services",
      `${escapeHtml(consultant)} will provide the following search engine optimisation services for ${escapeHtml(a.client.website)}: <b>${a.services.map(escapeHtml).join(", ") || "as described in the proposal"}</b>.${
        a.deliverables.length ? `<ul>${a.deliverables.map((d) => `<li><b>${escapeHtml(d.title)}</b>${d.detail ? ` — ${escapeHtml(d.detail)}` : ""}</li>`).join("")}</ul>` : ""
      } The full scope is in the proposal “${escapeHtml(a.title)}” (version ${a.version}), which forms part of this agreement.`,
    ],
    [
      "Fees and payment",
      `Monthly fee: <b>${money(a.monthlyPrice, a.currency)}</b>${a.setupFee ? `; one-time setup fee: <b>${money(a.setupFee, a.currency)}</b>` : ""}. ${a.paymentTerms ? escapeHtml(a.paymentTerms) : "Invoices are payable within 7 days, monthly in advance."}${a.paymentInstructions ? `<br>Payment details: ${escapeHtml(a.paymentInstructions).replace(/\n/g, "<br>")}` : ""}`,
    ],
    [
      "Term",
      `The agreement starts on ${day(start)} and runs for ${a.durationMonths} month${a.durationMonths === 1 ? "" : "s"}. After that it continues month to month until either party ends it with 30 days' written notice (email is enough).`,
    ],
    [
      "What the client provides",
      "Timely access needed for the work (website or CMS, Google Search Console, Google Business Profile, analytics), accurate business information, and replies to questions and approvals within a reasonable time. Delays on the client's side move the timeline accordingly.",
    ],
    [
      "Results",
      "Search rankings and traffic depend on Google and on competitors, so no specific position or number of visitors can be guaranteed. The consultant will follow Google's guidelines, never use methods that put the website at risk, and report the work and results every month.",
    ],
    ["Ownership", "Content, pages and materials created for the client belong to the client once the related fees are paid. Tools and accounts of the consultant remain the consultant's."],
    ["Confidentiality", "Both parties keep each other's non-public information confidential and use logins and data only for this work. Access given to the consultant is removed when the agreement ends."],
    [
      "Ending early",
      "Either party may end the agreement with 30 days' written notice; fees for work done up to the end date remain payable. Either party may end it at once if the other seriously breaches it and does not put it right within 14 days of being told.",
    ],
    ["Liability", "Each party's total liability under this agreement is limited to the fees paid in the three months before the claim, except where the law does not allow such a limit."],
  ];
  const sig = a.acceptance?.signature && SIGNATURE.test(a.acceptance.signature) ? `<img src="${a.acceptance.signature}" alt="Signature" style="height:22mm;max-width:70mm;object-fit:contain">` : `<div class="line"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Service agreement — ${escapeHtml(a.client.businessName)}</title><style>
  @page { size: A4; margin: 18mm 18mm 20mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.55; }
  h1 { font-size: 20pt; margin: 0 0 2mm; } .muted { color: #64748b; font-size: 9pt; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 7mm 0; padding: 5mm; border: 1px solid #e2e8f0; border-radius: 3mm; }
  .parties b { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: 1mm; }
  h2 { font-size: 11.5pt; margin: 6mm 0 1.5mm; } ul { margin: 2mm 0 0; padding-left: 5mm; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 12mm; break-inside: avoid; }
  .sigs .line { height: 22mm; border-bottom: 1px solid #94a3b8; } .sigs p { margin: 1.5mm 0 0; }
  </style></head><body>
  <h1>Service agreement</h1>
  <p class="muted">SEO services · ${day(a.date)} · based on proposal “${escapeHtml(a.title)}” v${a.version}</p>
  <div class="parties">
    <div><b>Consultant</b>${escapeHtml(consultant)}${a.branding.consultantName && a.branding.companyName ? `<br>${escapeHtml(a.branding.consultantName)}` : ""}${contact ? `<br><span class="muted">${contact}</span>` : ""}</div>
    <div><b>Client</b>${escapeHtml(a.client.businessName)}<br><span class="muted">${escapeHtml(a.client.website)}${a.client.city || a.client.country ? ` · ${escapeHtml([a.client.city, a.client.country].filter(Boolean).join(", "))}` : ""}</span></div>
  </div>
  ${clauses.map(([h, body], i) => `<h2>${i + 1}. ${h}</h2><div>${body}</div>`).join("")}
  <div class="sigs">
    <div>${sig}<p><b>For the client:</b> ${escapeHtml(a.acceptance?.name ?? "")}</p><p class="muted">${a.acceptance ? `Signed online on ${day(a.acceptance.at)}${a.acceptance.contact ? ` · ${escapeHtml(a.acceptance.contact)}` : ""}` : "Name, signature and date"}</p></div>
    <div><div class="line"></div><p><b>For the consultant:</b> ${escapeHtml(a.branding.consultantName || consultant)}</p><p class="muted">Signature and date</p></div>
  </div>
  </body></html>`;
}

/** The agreement for a proposal: the accepted version and its online signature when there is one. */
export async function agreementData(workspaceId: string, proposalId: string): Promise<AgreementData> {
  const p = await db.proposal.findFirst({ where: { id: proposalId, workspaceId }, include: { prospect: true, responses: { where: { kind: "ACCEPT" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!p) throw new AgreementError("Proposal not found.");
  const accepted = p.responses[0] ?? null;
  const versionNo = accepted?.version ?? p.shareVersion ?? p.currentVersion;
  const v = await db.proposalVersion.findUnique({ where: { proposalId_version: { proposalId: p.id, version: versionNo } } });
  if (!v) throw new AgreementError("Proposal version not found.");
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId }, select: { paymentInstructions: true } });
  const keys = ((v.services as string[] | null) ?? []).filter((k): k is ServiceKey => k in SERVICES);
  return {
    title: v.title ?? p.title,
    version: v.version,
    branding: (v.branding as Branding) ?? { companyName: null, consultantName: null, email: null, phone: null, website: null, whatsapp: null, logoDataUri: null },
    client: { businessName: p.prospect.businessName, website: p.prospect.websiteUrl, city: p.prospect.city, country: p.prospect.country },
    services: keys.map((k) => SERVICES[k]),
    deliverables: ((v.deliverables as Deliverable[] | null) ?? []).slice(0, 15),
    currency: v.currency,
    monthlyPrice: v.monthlyPrice,
    setupFee: v.setupFee,
    paymentTerms: v.paymentTerms,
    paymentInstructions: settings?.paymentInstructions ?? null,
    durationMonths: v.durationMonths,
    acceptance: accepted ? { name: accepted.name, contact: accepted.contact, signature: accepted.signature, at: p.acceptedAt ?? accepted.createdAt } : null,
    date: new Date(),
  };
}

export async function agreementPdf(workspaceId: string, proposalId: string) {
  const data = await agreementData(workspaceId, proposalId);
  const footer = `<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>Service agreement — ${escapeHtml(data.client.businessName)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  return { pdf: await htmlToPdf(agreementHtml(data), footer), fileName: `service-agreement-${data.client.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client"}.pdf`, signed: !!data.acceptance };
}
