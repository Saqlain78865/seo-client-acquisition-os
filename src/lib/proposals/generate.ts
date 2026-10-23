import { randomUUID } from "node:crypto";
import {
  SECTION_DEFS,
  type Deliverable,
  type ProposalFinding,
  type ProposalGbp,
  type ProposalKeyword,
  type ProposalReview,
  type ProposalScreens,
  type RoadmapKey,
  type RoadmapPhase,
  type SectionDraft,
  type ServiceKey,
} from "./types";

/**
 * Builds a first-draft proposal from audit data. Pure and deterministic: every factual statement
 * comes from the audit snapshot passed in. No traffic, ranking, revenue or ROI figures are invented,
 * and nothing promises positions in Google.
 */

export type SourceFinding = {
  id: string;
  ruleId: string;
  category: string;
  title: string;
  severity: string;
  evidenceStatus: string;
  affectedUrls: string[];
  observedFacts: string;
  businessImpact: string | null;
  recommendation: string;
  verificationMethod: string | null;
  requiresAccess: boolean;
  priority: number;
  includeInProposal: boolean;
  resolutionStatus: string;
  evidence: { kind: string; method: string; excerpt: string | null; url: string | null }[];
};

export type GenerateInput = {
  prospect: { businessName: string; websiteUrl: string; domain: string; industry: string | null; city: string | null; country: string | null; primaryServices: string | null };
  audit: {
    createdAt: Date;
    summary: string | null;
    context: { targetCity?: string; targetCountry?: string; primaryService?: string; secondaryServices?: string; businessType?: string; discoveryNotes?: string };
    scope: { pagesAnalysed: number; pageLimit: number; limitReached: boolean; collectedAt: string } | null;
    business: { name: string | null; services: string[]; locations: string[] } | null;
    aiExplanations: Record<string, string>;
  } | null;
  findings: SourceFinding[];
  services: ServiceKey[];
  roadmap: RoadmapKey;
  /** Target keywords from the Research tab; shown as a table in the keyword section. */
  keywords?: ProposalKeyword[];
  /** Google Business Profile summary and its negative reviews (Research → Google Business). */
  gbp?: ProposalGbp | null;
  badReviews?: ProposalReview[];
  /** Homepage screenshots and, per audit rule, a screenshot of the issue (storage keys). */
  screens?: ProposalScreens | null;
  screenshots?: Record<string, string>;
  consultantName: string | null;
  companyName: string | null;
};

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "OPPORTUNITY", "NEEDS_VERIFICATION"];

export function usableFindings(findings: SourceFinding[]) {
  return findings
    .filter((f) => f.includeInProposal && f.resolutionStatus !== "DISMISSED")
    .sort((a, b) => b.priority - a.priority);
}

function periodFor(severity: string) {
  if (severity === "CRITICAL" || severity === "HIGH") return "Days 1–30";
  if (severity === "MEDIUM") return "Days 31–60";
  return "Days 61–90";
}

function priorityLabel(severity: string): ProposalFinding["priority"] {
  if (severity === "CRITICAL" || severity === "HIGH") return "High";
  if (severity === "MEDIUM" || severity === "OPPORTUNITY") return "Medium";
  return "Low";
}

export function toProposalFinding(f: SourceFinding, aiExplanation?: string, screenshot?: string | null): ProposalFinding {
  const ev = f.evidence[0];
  return {
    id: randomUUID(),
    sourceFindingId: f.id,
    title: f.title,
    severity: f.severity,
    observed: f.observedFacts,
    where: f.affectedUrls.slice(0, 5),
    evidence: ev ? `${ev.method}${ev.excerpt ? `: ${ev.excerpt.slice(0, 300)}` : ""}` : "",
    whyItMatters: aiExplanation ?? f.businessImpact ?? "",
    solution: f.recommendation,
    priority: priorityLabel(f.severity),
    period: periodFor(f.severity),
    verification: f.verificationMethod ?? "",
    custom: false,
    category: f.category,
    screenshot: screenshot ?? null,
  };
}

/** Reputation work is offered when the profile shows a weak rating, few reviews or negative reviews. */
export function needsReputation(gbp: ProposalGbp | null | undefined, badReviews: ProposalReview[] = []) {
  return !!gbp && (badReviews.length > 0 || (gbp.rating != null && gbp.rating < 4.5) || (gbp.reviewCount != null && gbp.reviewCount < 30));
}

export function defaultServices(findings: SourceFinding[], input: Pick<GenerateInput, "audit" | "prospect" | "gbp" | "badReviews">): ServiceKey[] {
  const cats = new Set(findings.map((f) => f.category));
  const local = !!(input.gbp || input.audit?.context.targetCity || input.prospect.city || (input.audit?.business?.locations.length ?? 0) > 0 || cats.has("Local SEO"));
  const out: ServiceKey[] = ["TECHNICAL", "ONPAGE", "KEYWORDS", "CONTENT"];
  if (local) out.push("LOCAL");
  out.push("OFFPAGE");
  if (cats.has("Conversion")) out.push("CRO");
  if (needsReputation(input.gbp, input.badReviews)) out.push("REPUTATION");
  out.push("REPORTING");
  return out;
}

function byCategory(findings: SourceFinding[], categories: string[]) {
  return findings.filter((f) => categories.includes(f.category) && f.severity !== "NEEDS_VERIFICATION");
}

export function buildRoadmap(roadmap: RoadmapKey, findings: SourceFinding[], services: ServiceKey[]): RoadmapPhase[] {
  const actionable = findings.filter((f) => f.severity !== "NEEDS_VERIFICATION");
  const titles = (sevs: string[], max = 5) => actionable.filter((f) => sevs.includes(f.severity)).slice(0, max).map((f) => `Fix: ${f.title}`);
  const has = (s: ServiceKey) => services.includes(s);

  const phases: RoadmapPhase[] = [
    {
      title: "Baseline and critical fixes",
      period: "Days 1–30",
      items: [
        "Agree goals and confirm access (Search Console, Analytics, website CMS)",
        "Record baseline metrics before any change",
        ...(has("KEYWORDS") ? ["Keyword research and mapping of keywords to pages"] : []),
        ...titles(["CRITICAL", "HIGH"]),
      ],
    },
    {
      title: "Priority page optimisation",
      period: "Days 31–60",
      items: [
        ...(has("ONPAGE") ? ["Optimise titles, headings and content on priority service pages"] : []),
        ...(has("LOCAL") ? ["Google Business Profile optimisation: categories, services, photos, posts and consistent business details"] : []),
        ...(has("REPUTATION") ? ["Reputation: review audit, policy-violation removal requests, professional replies and a review-request system"] : []),
        ...(has("CRO") ? ["Improve calls to action and contact paths on key pages"] : []),
        ...titles(["MEDIUM"]),
      ],
    },
    {
      title: "Content expansion and review",
      period: "Days 61–90",
      items: [
        ...(has("CONTENT") ? ["Publish or improve content for the agreed priority topics"] : []),
        ...(has("OFFPAGE") ? ["Start relevant link and mention outreach based on the backlink review"] : []),
        ...titles(["LOW", "OPPORTUNITY"], 4),
        "Review results against the baseline and plan the next stage",
      ],
    },
  ];
  if (roadmap === "6_MONTH" || roadmap === "12_MONTH") {
    phases.push({
      title: "Further optimisation based on measured results",
      period: "Months 4–6",
      items: ["Expand the pages and topics that show measurable progress", "Continue technical maintenance and content updates", "Quarterly strategy review"],
    });
  }
  if (roadmap === "12_MONTH") {
    phases.push({
      title: "Longer-term growth",
      period: "Months 7–12",
      items: ["New service or location pages where demand is confirmed", "Ongoing authority building", "Annual review and planning"],
    });
  }
  return phases.map((p) => ({ ...p, items: p.items.length ? p.items : ["Agreed implementation work"] }));
}

export function defaultDeliverables(services: ServiceKey[]): Deliverable[] {
  const d: Deliverable[] = [];
  const has = (s: ServiceKey) => services.includes(s);
  if (has("TECHNICAL")) d.push({ title: "Technical SEO fixes", detail: "Implementation or developer-ready tickets for agreed technical issues, plus a monthly crawl check" });
  if (has("ONPAGE")) d.push({ title: "On-page optimisation", detail: "Agreed number of pages optimised per month (titles, headings, content, internal links)" });
  if (has("CONTENT")) d.push({ title: "Content", detail: "Agreed number of new or improved pages/articles per month" });
  if (has("KEYWORDS")) d.push({ title: "Keyword research", detail: "Initial research and mapping in month 1, reviewed quarterly" });
  if (has("LOCAL")) d.push({ title: "Local SEO", detail: "Business profile optimisation and citation consistency work" });
  if (has("OFFPAGE")) d.push({ title: "Off-page SEO", detail: "Relevant link and mention outreach — no paid or spam links" });
  if (has("REPUTATION")) d.push({ title: "Reputation management", detail: "Review monitoring, replies to every review, removal requests for policy-violating reviews and a steady flow of genuine new reviews" });
  if (has("CRO")) d.push({ title: "Conversion improvements", detail: "Recommendations and agreed changes to calls to action and contact paths" });
  if (has("REPORTING")) d.push({ title: "Monthly report", detail: "Work completed, KPI movement against baseline, next month's plan" });
  return d;
}

export function generateSections(input: GenerateInput): SectionDraft[] {
  const { prospect, audit } = input;
  const findings = usableFindings(input.findings);
  const actionable = findings.filter((f) => f.severity !== "NEEDS_VERIFICATION");
  const services = input.services;
  const has = (s: ServiceKey) => services.includes(s);
  const name = prospect.businessName;
  const area = audit?.context.targetCity || prospect.city;
  const auditDate = audit?.scope?.collectedAt ? new Date(audit.scope.collectedAt) : audit?.createdAt;
  const dateText = auditDate ? auditDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  const confirmed = actionable.filter((f) => f.evidenceStatus === "CONFIRMED");
  const shot = (ruleId: string) => input.screenshots?.[ruleId] ?? null;
  const keyFindings = actionable.slice(0, 8).map((f) => toProposalFinding(f, audit?.aiExplanations[f.ruleId], shot(f.ruleId)));
  const gbp = input.gbp ?? null;
  const badReviews = input.badReviews ?? [];
  const who = input.companyName || input.consultantName || "we";
  const mapsGaps = gbp?.rankings.filter((r) => r.position == null || r.position > 3) ?? [];
  const gbpLine = gbp
    ? `On Google, ${name} ${gbp.rating != null ? `shows **${gbp.rating.toFixed(1)}★ from ${gbp.reviewCount ?? 0} review${gbp.reviewCount === 1 ? "" : "s"}**` : "has a Business Profile"}${mapsGaps.length ? ` and is ${mapsGaps[0].position == null ? "not in the top 20 Google Maps results" : `at position ${mapsGaps[0].position} on Google Maps`} for “${mapsGaps[0].query}”` : ""}.`
    : "";
  const needAccess = findings.filter((f) => f.requiresAccess);
  const count = (sev: string) => actionable.filter((f) => f.severity === sev).length;
  // What the client sells, in their customers' words. "SEO" typed here describes our service, not theirs, so it is skipped.
  const notSeo = (s?: string | null) => (s && !/\bseo\b/i.test(s) ? s : null);
  const serviceText = (notSeo(audit?.context.primaryService) ?? notSeo(prospect.primaryServices) ?? "what you offer").toLowerCase();
  const issueCount = actionable.filter((f) => f.severity !== "OPPORTUNITY").length;
  // The business impact of the most serious confirmed problems, in the client's terms.
  const highImpact = confirmed
    .filter((f) => ["CRITICAL", "HIGH", "MEDIUM"].includes(f.severity))
    .slice(0, 4)
    .map((f) => (f.businessImpact ? `**${f.title}** — ${f.businessImpact}` : `**${f.title}**`));
  const firstMonth = actionable.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length;

  const body: Record<string, string> = {
    executive_summary: [
      `**${name} can win many more customers from Google — and we know exactly how to get you there.** People${area ? ` in ${area}` : ""} search for ${serviceText} every day. The question is whether they find ${name}, or a competitor.`,
      audit
        ? `We have already done the groundwork: we reviewed ${prospect.domain}${dateText ? ` on ${dateText}` : ""} and found ${issueCount} specific issue${issueCount === 1 ? "" : "s"} that make it harder for Google to recommend you and for visitors to get in touch${confirmed.length ? ` — starting with ${confirmed.slice(0, 3).map((f) => f.title.toLowerCase()).join("; ")}` : ""}. ${gbpLine}`.trim()
        : `This proposal sets out how we will grow the search visibility of ${name} (${prospect.domain}) and turn more of those searches into enquiries. ${gbpLine}`.trim(),
      `This proposal is our plan to change that. We fix what is holding you back first, make ${name} the obvious choice in Google Search${has("LOCAL") ? " and on Google Maps" : ""}, and keep growing month after month — with one dedicated team, work you can see, and a clear report every month.`,
    ]
      .filter(Boolean)
      .join("\n\n"),

    opportunity: [
      `When someone${area ? ` in ${area}` : ""} needs ${serviceText}, the first thing most of them do is search on Google — and they choose from the businesses they see on the first page. These customers are not browsing: they are ready to call, message or book.`,
      highImpact.length
        ? `Right now, your website is making that harder than it needs to be:\n${bullets(highImpact)}`
        : "",
      firstMonth > 0
        ? `The good news: these are fixable problems. ${firstMonth} of the issues we found are planned for the first 30 days, so improvements start early instead of months from now.`
        : highImpact.length
          ? "The good news: none of these are major structural problems — they are practical fixes we can start on straight away."
          : "The good news: the foundations are in place, so the work can focus on growth from day one.",
      "Unlike paid ads, SEO keeps working after the work is done: pages that rank keep bringing customers month after month, without paying for every click.",
    ]
      .filter(Boolean)
      .join("\n\n"),

    what_you_get: [
      `Here is what ${name} gets from working with ${who === "we" ? "us" : who}:`,
      bullets([
        ...(has("TECHNICAL") ? ["**A website Google can trust** — every important page can be found, crawled and shown correctly in search"] : []),
        ...(has("ONPAGE") ? ["**Pages that match what customers search for** — clear titles and content that earn the click"] : []),
        ...(has("KEYWORDS") ? ["**A clear map of the searches that bring paying customers**, each matched to the right page"] : []),
        ...(has("CONTENT") ? ["**Helpful content that answers customers' questions** and builds trust before they contact you"] : []),
        ...(has("LOCAL") ? [`**More calls from Google Maps**${area ? ` in ${area}` : ""} — a complete, active Business Profile that competes for the top 3`] : []),
        ...(has("REPUTATION") ? ["**A reputation customers trust** — every review answered, policy-breaking reviews challenged, and a steady flow of genuine 5-star reviews"] : []),
        ...(has("OFFPAGE") ? ["**More authority** through genuine, relevant links and mentions — never spam"] : []),
        ...(has("CRO") ? ["**More visitors turning into calls, WhatsApp messages and bookings**"] : []),
        ...(has("REPORTING") ? ["**A simple monthly report**: what we did, what changed, and what comes next"] : []),
        "**You stay in control**: your website, content and accounts remain yours",
      ]),
    ].join("\n\n"),

    how_we_work: [
      "Our process is simple, transparent and built around results:",
      bullets([
        "**Audit and baseline** — we confirm every issue and record where you stand today, so every improvement can be measured.",
        "**Fix the foundations** — the problems that stop Google from ranking you are fixed first, in the first 30 days.",
        `**Grow your visibility** — better pages for the searches that bring customers${has("LOCAL") ? ", a stronger Google Business Profile" : ""} and genuine authority.`,
        "**Convert and report** — more visitors become calls and bookings, and every month you see exactly what we did and what changed.",
      ]),
    ].join("\n\n"),

    gbp: gbp
      ? [
          `Your Google Business Profile is often the first thing customers see — before your website. It decides who appears in the Google Maps “map pack” and who gets the call.`,
          gbpLine,
          gbp.issues.length
            ? `We found ${gbp.issues.length} thing${gbp.issues.length === 1 ? "" : "s"} to improve on the profile. Fixing them is one of the fastest ways to get more calls${area ? ` from customers in ${area}` : ""}.`
            : "The profile is in reasonable shape — the opportunity now is to outpace competitors with more reviews, photos and activity.",
          `Our approach:\n${bullets([
            "Complete and optimise every part of the profile: categories, services, description, hours and photos",
            "A steady stream of genuine reviews, with a professional reply to every one",
            "Regular posts and offers that keep the profile active",
            "The same business name, address and phone everywhere online",
          ])}`,
        ]
          .filter(Boolean)
          .join("\n\n")
      : "",

    reputation: [
      `Customers read reviews before they call. ${badReviews.length ? `Today, anyone looking at ${name} on Google can read ${badReviews.length === 1 ? "a negative review" : `${badReviews.length} negative reviews`} like the ones below${gbp?.rating != null ? `, next to an average of ${gbp.rating.toFixed(1)}★` : ""}.` : gbp?.rating != null ? `${name} currently averages ${gbp.rating.toFixed(1)}★ from ${gbp.reviewCount ?? 0} reviews — competitors with more and better reviews win the click.` : ""}`.trim(),
      `Our **Brand Reputation Management** service protects and improves how ${name} looks online:`,
      bullets([
        "**Review audit and removal requests** — every negative review is checked against Google's policies, and we request removal of those that break them (fake, spam, offensive, off-topic or conflict-of-interest reviews)",
        "**Professional replies** — a calm, helpful public answer to every review, in your voice, that shows future customers you care",
        "**More genuine 5-star reviews** — QR codes and WhatsApp links that make it easy for happy customers to leave a review",
        "**Monitoring and alerts** — new reviews and mentions are watched so problems are handled quickly",
      ]),
      "Genuine reviews cannot be deleted by anyone — but they can be answered well and outweighed by many more positive ones. That is exactly what we do.",
    ].join("\n\n"),

    why_us: [
      `Why ${who === "we" ? "we are" : `${who} is`} the right partner for ${name}:`,
      bullets([
        `**We have already done the work** — this proposal is built on a real review of ${prospect.domain}${gbp ? " and your Google Business Profile" : ""}, not a template. Every issue shows exactly where it is.`,
        "**Focused on what grows your business** — calls, bookings and enquiries, not vanity numbers.",
        "**A fast start** — the first high-priority fixes begin in week one, and you see them go live in the first month.",
        "**Full transparency** — results are measured against a baseline recorded before we start, and reported every month.",
        "**Safe, long-term methods** — no fake promises, no paid or spam links, nothing that puts your website at risk.",
        `**One dedicated point of contact**${input.consultantName ? ` — ${input.consultantName}` : ""}, with quick answers by email or WhatsApp.`,
      ]),
    ].join("\n\n"),

    business_context: [
      `${name}${prospect.industry || audit?.context.businessType ? ` operates in ${prospect.industry || audit?.context.businessType}` : ""}${area ? `, serving customers in ${area}${prospect.country ? `, ${prospect.country}` : ""}` : prospect.country ? ` in ${prospect.country}` : ""}.`,
      audit?.business?.services.length
        ? `Services identified on the website (please confirm):\n${bullets(audit.business.services.slice(0, 8))}`
        : prospect.primaryServices
          ? `Main services: ${prospect.primaryServices}.`
          : "",
      audit?.context.discoveryNotes ? `Notes from our conversation:\n${audit.context.discoveryNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),

    audit_overview: audit?.scope
      ? [
          `This is how ${prospect.domain} looks to your customers today, on a computer and on a phone. We reviewed ${audit.scope.pagesAnalysed} public page${audit.scope.pagesAnalysed === 1 ? "" : "s"}${audit.scope.limitReached ? ` (the review was limited to ${audit.scope.pageLimit} pages)` : ""}, the same way Google sees them.`,
          `What we found: ${count("CRITICAL")} critical, ${count("HIGH")} high, ${count("MEDIUM")} medium and ${count("LOW")} low priority issues, plus ${count("OPPORTUNITY")} growth opportunit${count("OPPORTUNITY") === 1 ? "y" : "ies"}.`,
          "Rankings, traffic and conversion data need access to your Google accounts; we measure them in month 1 so every improvement can be shown against where you started.",
        ].join("\n\n")
      : "A full website audit will be carried out at the start of the engagement.",

    key_findings: keyFindings.length
      ? "These are the most important problems we found — each one costs you visibility in Google or enquiries from visitors. For every issue you can see the evidence, why it matters, and exactly how we will fix it. The complete list is in the appendix."
      : "No major confirmed issues were found in the pages reviewed. The work will focus on growth opportunities.",

    technical: sectionFromFindings(byCategory(findings, ["Technical SEO", "AI search"]), "We will make sure search engines can crawl, understand and trust every important page.", [
      "Fix confirmed crawl, indexing-directive and redirect issues",
      "Keep the XML sitemap and robots.txt accurate",
      "Monitor site health monthly and after website changes",
    ]),
    onpage: sectionFromFindings(byCategory(findings, ["On-Page SEO"]), "Each important page should clearly match what customers search for.", [
      "Unique, descriptive titles and meta descriptions for priority pages",
      "Clear heading structure and helpful, specific page content",
      "Internal links that guide visitors to the most important services",
    ]),
    content: sectionFromFindings(byCategory(findings, ["Content"]), `Content will be planned around the questions ${name}'s customers actually ask.`, [
      "Improve thin or overlapping pages after reviewing their purpose and data",
      "Create content for confirmed topic gaps from keyword research",
      "Add practical, original information that builds trust",
    ]),
    keywords: input.keywords?.length
      ? keywordSectionBody(name, area ?? null, input.keywords)
      : [
      `${KEYWORD_PLAN_INTRO} using a keyword tool and, once connected, your Search Console data.`,
      bullets([
        `Seed topics: ${[audit?.context.primaryService, audit?.context.secondaryServices, prospect.primaryServices].filter(Boolean).join(", ") || "your main services"}${area ? ` in ${area}` : ""}`,
        "Group keywords by search intent and map each group to one page",
        "Prioritise commercial searches that can lead to enquiries",
        "Search volumes and difficulty are third-party estimates and will be labelled as such",
      ]),
    ].join("\n\n"),
    competitors:
      "Competitors will be identified from the businesses that actually appear for your priority searches in your target market (not just the biggest websites). For each, we will compare service and location pages, content depth and, where data is available, backlinks. Every comparison will show its data source and date.",
    local: sectionFromFindings([...byCategory(findings, ["Local SEO"]), ...(gbp?.issues ?? []).map((i) => ({ title: `Google Business Profile: ${i.title}`, severity: i.severity }) as SourceFinding)], `Local visibility${area ? ` in ${area}` : ""} depends on consistent business details and pages that are genuinely useful for local customers.`, [
      "Review and optimise the Google Business Profile (with your access)",
      "Keep name, address and phone consistent across the website and directories",
      "Create location pages only where you genuinely serve the area",
      "Encourage genuine customer reviews (no incentivised or fake reviews)",
    ]),
    offpage:
      "Off-page work will start with a review of your current backlink profile using a backlink tool export. We will then pursue relevant, natural opportunities: local and industry publications, partners, and mentions. We do not buy links or use link schemes.",
    conversion: sectionFromFindings(byCategory(findings, ["Conversion"]), "More visitors only help if they can easily contact you.", [
      "Clear calls to action on every service page",
      "Tap-to-call and messaging options for mobile visitors",
      "Short, simple enquiry forms",
    ]),
    roadmap: "These phases are a planning default. They will be adjusted after month 1 based on access, website size and what the data shows.",
    deliverables: "Each month you will receive the following:",
    kpis: [
      "Baselines are recorded in month 1, before any change. Progress is reported against them every month:",
      bullets([
        "Organic clicks and impressions (Google Search Console)",
        "Number of tracked priority keywords on page 1 (rank tracking tool, location-specific)",
        "Enquiries and conversions from organic search (Google Analytics 4, once tracking is confirmed)",
        "Resolution of the issues listed in this proposal",
        ...(has("LOCAL") ? ["Google Business Profile actions (calls, direction requests, website clicks)"] : []),
      ]),
      "These are measures of progress, not guarantees of specific results.",
    ].join("\n\n"),
    client_responsibilities: [
      "To deliver this work we will need:",
      bullets([
        "Access to Google Search Console and Google Analytics 4 (or permission to set them up)",
        "Access to the website CMS or a developer contact for technical changes",
        ...(has("LOCAL") ? ["Manager access to the Google Business Profile"] : []),
        "Timely review and approval of content and changes (normally within 5 working days)",
        "Accurate information about services, prices and locations",
        ...(needAccess.some((f) => f.ruleId === "access.backlinks")
          ? ["A backlink export from Ahrefs or Semrush if you have an account (otherwise we use ours)"]
          : []),
      ]),
    ].join("\n\n"),
    exclusions: bullets([
      "Website redesign or development beyond the agreed SEO changes",
      "Paid advertising (Google Ads, social ads)",
      "Copywriting beyond the agreed monthly content volume",
      "Costs of third-party tools, plugins or hosting",
      "Any service not listed in this proposal",
    ]),
    timeline:
      "Work starts after acceptance and receipt of access. Technical fixes depend on developer or CMS availability; content depends on approval times. SEO results typically build over several months and depend on competition, the website's starting point and how quickly changes are implemented.",
    assumptions: bullets([
      `Audit findings reflect the website as it was on ${dateText ?? "the audit date"}; the site may have changed since.`,
      "Only publicly accessible pages were reviewed; data that requires access was not assumed.",
      "No guarantee of specific rankings, traffic or revenue is given or implied.",
      "Search engine algorithms change; the plan will be adapted to measured results.",
    ]),
    next_steps: [
      "**Ready to get more customers from Google? Here is how we start:**",
      bullets([
        "**Today** — accept this proposal online, reply to our email or message us on WhatsApp. Happy to answer questions on a short call first.",
        "**Within 48 hours** — kick-off call and access set-up (the list is under “What we need from you”).",
        "**Week 1** — your baseline is recorded and work starts on the highest-priority fixes.",
        "**Month 1** — your first report shows everything we have done and what is next.",
      ]),
      "Every week these issues stay unfixed is a week customers may choose a competitor instead. We are ready to start as soon as you are.",
    ].join("\n\n"),
    acceptance: `By signing below, ${name} accepts this proposal, its scope and its terms.`,
    appendix: "All findings from the website audit, ordered by priority. Items marked “needs data” require access before they can be confirmed.",
  };

  const data: Partial<Record<string, unknown>> = {
    key_findings: { findings: keyFindings },
    ...(input.screens && (input.screens.desktop || input.screens.mobile) ? { audit_overview: { screens: input.screens } } : {}),
    ...(gbp ? { gbp: { gbp } } : {}),
    ...(badReviews.length ? { reputation: { reviews: badReviews.slice(0, 5) } } : {}),
    roadmap: { phases: buildRoadmap(input.roadmap, findings, services) },
    ...(input.keywords?.length ? { keywords: { keywords: input.keywords } } : {}),
    appendix: { findings: findings.map((f) => toProposalFinding(f, audit?.aiExplanations[f.ruleId], shot(f.ruleId))) },
  };

  const serviceSection: Partial<Record<string, ServiceKey>> = {
    technical: "TECHNICAL",
    onpage: "ONPAGE",
    content: "CONTENT",
    keywords: "KEYWORDS",
    competitors: "KEYWORDS",
    local: "LOCAL",
    offpage: "OFFPAGE",
    conversion: "CRO",
    reputation: "REPUTATION",
  };

  // Kept short for the client: the small print is available in the editor but starts hidden.
  const hiddenByDefault = new Set(["competitors", "exclusions", "timeline", "assumptions"]);

  return SECTION_DEFS.map((def) => {
    const svc = serviceSection[def.key];
    return {
      key: def.key,
      title: def.title,
      body: body[def.key] ?? "",
      included: hiddenByDefault.has(def.key) ? false : def.key === "gbp" ? !!gbp : def.key === "keywords" && input.keywords?.length ? true : svc ? has(svc) : def.key === "appendix" ? findings.length > keyFindings.length : true,
      data: data[def.key],
    };
  });
}

/** Intro for the keyword section when it has a table of target keywords. */
export function keywordSectionBody(businessName: string, area: string | null, keywords: ProposalKeyword[]) {
  return [
    `These are the searches we will target first. We chose them from our research into ${businessName}'s services${area ? ` and customers in ${area}` : ""}: each one is something a potential customer types into Google.`,
    bullets([
      "Every keyword is matched to one page: an existing page we will improve, or a new page we will create",
      "We focus first on searches from people who are ready to call, book or buy",
      keywords.some((k) => k.volume != null)
        ? "Monthly search numbers come from the tool named in the table and are estimates; keywords without a number will be measured in month 1"
        : "Monthly search numbers will be measured in month 1 with a keyword tool and, once connected, your Search Console data",
      "The list is reviewed every month as real ranking and traffic data comes in",
    ]),
  ].join("\n\n");
}

/** Start of the keyword section text before any keywords were chosen (used to detect an unedited section). */
export const KEYWORD_PLAN_INTRO = "Keyword research will be done in month 1";

function sectionFromFindings(findings: SourceFinding[], intro: string, approach: string[]) {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return [
    intro,
    sorted.length ? `What we found on your site:\n${bullets(sorted.slice(0, 5).map((f) => f.title))}` : "",
    `Our approach:\n${bullets(approach)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
