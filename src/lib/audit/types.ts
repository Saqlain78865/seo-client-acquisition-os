import type { CrawledRecord } from "../crawler/crawl";
import type { SitemapInfo } from "../crawler/robots-sitemap";

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "OPPORTUNITY", "NEEDS_VERIFICATION"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  OPPORTUNITY: "Opportunity",
  NEEDS_VERIFICATION: "Needs verification",
};

/** CONFIRMED: directly observed. POTENTIAL: observed signal that needs human judgement. HYPOTHESIS: cannot be checked with current data. */
export type EvidenceStatus = "CONFIRMED" | "POTENTIAL" | "HYPOTHESIS";

export const CATEGORIES = ["Technical SEO", "AI search", "On-Page SEO", "Content", "Local SEO", "Conversion", "Data & access"] as const;
export type Category = (typeof CATEGORIES)[number];

export type EvidenceDraft = {
  kind: "HTML" | "HTTP_HEADER" | "HTTP_STATUS" | "ROBOTS_TXT" | "SITEMAP" | "CRAWL_SCOPE" | "MEASUREMENT";
  url?: string;
  excerpt?: string;
  measurement?: Record<string, unknown>;
  method: string;
};

export type FindingDraft = {
  ruleId: string;
  category: Category;
  title: string;
  severity: Severity;
  evidenceStatus: EvidenceStatus;
  affectedUrls: string[];
  observedFacts: string;
  businessImpact: string;
  recommendation: string;
  complexity: "LOW" | "MEDIUM" | "HIGH";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  verificationMethod: string;
  requiresAccess?: boolean;
  requiresHumanReview?: boolean;
  evidence: EvidenceDraft[];
};

export type AuditContext = {
  targetCountry?: string;
  targetCity?: string;
  primaryService?: string;
  secondaryServices?: string;
  businessType?: string;
  preferredLanguage?: string;
  /** Bulk audits: a smaller crawl, enough to score the opportunity quickly. */
  quick?: boolean;
};

/** Everything the rules need. Built from the live crawl or, on retry, from saved records. */
export type AuditInput = {
  homepageUrl: string;
  origin: string;
  robots: {
    found: boolean;
    status: number | null;
    error: string | null;
    body: string | null;
    sitemaps: string[];
    blocksEverything: boolean;
    blocksGooglebotHomepage: boolean;
  };
  sitemaps: SitemapInfo;
  /** /llms.txt check; missing on audits made before it existed. */
  llmsTxt?: { found: boolean; status: number | null };
  httpToHttps: { checked: boolean; redirectsToHttps: boolean | null; finalUrl: string | null; error?: string };
  pages: CrawledRecord[];
  skipped: { url: string; reason: string }[];
  limitReached: boolean;
  pageLimit: number;
  context: AuditContext;
  collectedAt: Date;
};
