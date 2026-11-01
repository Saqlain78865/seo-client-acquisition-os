import { z } from "zod";

export const SERVICES = {
  TECHNICAL: "Technical SEO",
  ONPAGE: "On-page SEO",
  CONTENT: "Content SEO",
  KEYWORDS: "Keyword research",
  LOCAL: "Local SEO",
  OFFPAGE: "Off-page SEO / link building",
  CRO: "Conversion optimisation",
  REPUTATION: "Reputation management",
  REPORTING: "Monthly reporting",
} as const;
export type ServiceKey = keyof typeof SERVICES;
export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];

export const ROADMAPS = {
  "90_DAY": "30 / 60 / 90 days",
  "6_MONTH": "6 months",
  "12_MONTH": "12 months",
} as const;
export type RoadmapKey = keyof typeof ROADMAPS;

export const THEMES = {
  navy: { label: "Navy", primary: "#1d4ed8", dark: "#0b1f3a", soft: "#e8efff" },
  indigo: { label: "Indigo", primary: "#4f46e5", dark: "#14123d", soft: "#eef0ff" },
  royal: { label: "Royal purple", primary: "#7c3aed", dark: "#1e0b3d", soft: "#f3edff" },
  teal: { label: "Teal", primary: "#0f766e", dark: "#062925", soft: "#e3f5f2" },
  emerald: { label: "Emerald", primary: "#047857", dark: "#052e22", soft: "#e6f6ef" },
  sunset: { label: "Sunset orange", primary: "#c2410c", dark: "#2b1206", soft: "#fff0e6" },
  burgundy: { label: "Burgundy", primary: "#9f1239", dark: "#3b0716", soft: "#fdecef" },
  slate: { label: "Slate", primary: "#334155", dark: "#0f172a", soft: "#eef2f6" },
  gold: { label: "Black & gold", primary: "#946200", dark: "#111111", soft: "#fbf3df" },
} as const;
export type ThemeKey = keyof typeof THEMES;

/** A finding as it appears in a proposal: a snapshot, so later audit edits never change a sent proposal. */
export const proposalFindingSchema = z.object({
  id: z.string(),
  sourceFindingId: z.string().nullable(),
  title: z.string().min(1).max(200),
  severity: z.string(),
  observed: z.string().max(3000),
  where: z.array(z.string().max(2048)).max(10),
  evidence: z.string().max(2000),
  whyItMatters: z.string().max(2000),
  solution: z.string().max(2000),
  priority: z.enum(["High", "Medium", "Low"]),
  period: z.string().max(60),
  verification: z.string().max(1000),
  custom: z.boolean().default(false),
  /** Audit category (Technical SEO, Local SEO …) for the "at a glance" page. */
  category: z.string().max(60).optional(),
  /** Storage key of a screenshot showing the issue. */
  screenshot: z.string().max(300).nullable().optional(),
});
export type ProposalFinding = z.infer<typeof proposalFindingSchema>;

export const roadmapPhaseSchema = z.object({ title: z.string().max(120), period: z.string().max(60), items: z.array(z.string().max(400)).max(20) });
export type RoadmapPhase = z.infer<typeof roadmapPhaseSchema>;

/** A target keyword as it appears in a proposal: a snapshot of the research row, with its data source. */
export const proposalKeywordSchema = z.object({
  keyword: z.string().min(1).max(120),
  intent: z.string().max(40).nullable(),
  volume: z.number().int().nonnegative().nullable(),
  volumeIsEstimate: z.boolean(),
  source: z.string().max(200),
  targetUrl: z.string().max(2048).nullable(),
  suggestedPage: z.string().max(80).nullable(),
});
export type ProposalKeyword = z.infer<typeof proposalKeywordSchema>;

/** Google Business Profile snapshot shown in the proposal (no reviewer names). */
export const proposalGbpSchema = z.object({
  name: z.string().max(200),
  category: z.string().max(120).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  photoCount: z.number().int().nonnegative().nullable(),
  hasHours: z.boolean().nullable(),
  source: z.string().max(20),
  rankings: z.array(z.object({ query: z.string().max(120), position: z.number().int().positive().nullable(), total: z.number().int().nonnegative() })).max(5),
  issues: z.array(z.object({ severity: z.string().max(20), title: z.string().max(200), fix: z.string().max(400) })).max(15),
  /** Top Google Maps competitors for the first ranking search (Places API). */
  competitors: z.array(z.object({ name: z.string().max(120), rating: z.number().min(0).max(5).nullable(), reviewCount: z.number().int().nonnegative(), position: z.number().int().positive() })).max(3).optional(),
  /** Google Maps ranking grid: positions row by row (null = not in the top 20). */
  grid: z.object({ query: z.string().max(120), size: z.number().int().min(3).max(7), spacingKm: z.number().positive().max(10), positions: z.array(z.number().int().positive().nullable()).max(49) }).nullable().optional(),
});
export type ProposalGbp = z.infer<typeof proposalGbpSchema>;

export const proposalReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().max(600),
  when: z.string().max(60).nullable(),
  /** From the review check: POLICY = appears to break a Google policy (removal can be requested), GENUINE = answer and outweigh. */
  verdict: z.enum(["POLICY", "GENUINE"]).nullable().optional(),
  policy: z.string().max(120).nullable().optional(),
});
export type ProposalReview = z.infer<typeof proposalReviewSchema>;

/** Homepage screenshots (storage keys) for "how your website looks today". */
export const proposalScreensSchema = z.object({ desktop: z.string().max(300).nullable(), mobile: z.string().max(300).nullable(), after: z.string().max(300).nullable().optional() });
export type ProposalScreens = z.infer<typeof proposalScreensSchema>;

export const deliverableSchema = z.object({ title: z.string().min(1).max(160), detail: z.string().max(500).default("") });
export type Deliverable = z.infer<typeof deliverableSchema>;

export type Branding = {
  companyName: string | null;
  consultantName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  whatsapp: string | null;
  logoDataUri: string | null;
  /** The agency's own colour, used by the "brand" theme. */
  brandColor?: string | null;
  /** QR code for the consultant's WhatsApp click-to-chat link (contains only the public wa.me URL). */
  whatsappQr?: string | null;
};

/** Section keys in default order. Every section is editable, can be hidden and reordered. */
export const SECTION_DEFS = [
  { key: "executive_summary", title: "Executive summary" },
  { key: "opportunity", title: "Why SEO matters for your business" },
  { key: "business_context", title: "Your business and market" },
  { key: "key_findings", title: "What is holding your website back" },
  { key: "audit_overview", title: "Your website today" },
  { key: "gbp", title: "Your Google Business Profile and Maps visibility" },
  { key: "reputation", title: "Protecting your online reputation" },
  { key: "what_you_get", title: "What you will get" },
  { key: "how_we_work", title: "How we will grow your business" },
  { key: "technical", title: "Technical SEO opportunities" },
  { key: "onpage", title: "On-page SEO recommendations" },
  { key: "content", title: "Content SEO strategy" },
  { key: "keywords", title: "Keyword research strategy" },
  { key: "competitors", title: "Competitor analysis" },
  { key: "local", title: "Local SEO strategy" },
  { key: "offpage", title: "Off-page SEO strategy" },
  { key: "conversion", title: "Conversion optimisation" },
  { key: "roadmap", title: "Implementation roadmap" },
  { key: "deliverables", title: "Monthly deliverables" },
  { key: "kpis", title: "How we will measure success" },
  { key: "why_us", title: "Why work with us" },
  { key: "client_responsibilities", title: "What we need from you" },
  { key: "exclusions", title: "Scope exclusions" },
  { key: "timeline", title: "Timeline and dependencies" },
  { key: "assumptions", title: "Assumptions and limitations" },
  { key: "next_steps", title: "Next steps" },
  { key: "acceptance", title: "Acceptance" },
  { key: "appendix", title: "Appendix: full audit findings" },
] as const;
export type SectionKey = (typeof SECTION_DEFS)[number]["key"];

export type SectionDraft = { key: string; title: string; body: string; included: boolean; data?: unknown };
