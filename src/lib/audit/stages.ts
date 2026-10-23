export const AUDIT_STAGES = [
  { key: "URL_VALIDATION", label: "URL validation" },
  { key: "DISCOVERY", label: "Website discovery (robots.txt, sitemaps)" },
  { key: "CRAWL", label: "Page crawling" },
  { key: "BUSINESS_IDENTIFICATION", label: "Business identification" },
  { key: "TECHNICAL", label: "Technical & on-page inspection" },
  { key: "CONTENT", label: "Content, local & conversion analysis" },
  { key: "DOMAIN", label: "Domain health (registration, SSL, email, analytics)" },
  { key: "KEYWORDS", label: "Keyword research" },
  { key: "COMPETITORS", label: "Competitor research" },
  { key: "CONTACTS", label: "Contact extraction" },
  { key: "EVIDENCE_VALIDATION", label: "Evidence validation" },
  { key: "SCREENSHOTS", label: "Screenshots of the site and its issues" },
  { key: "AI_ANALYSIS", label: "AI analysis" },
  { key: "REPORT", label: "Report generation" },
  { key: "PROPOSAL_READINESS", label: "Proposal readiness" },
] as const;
export type StageKey = (typeof AUDIT_STAGES)[number]["key"];

export const STAGE_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "SKIPPED", "FAILED"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
