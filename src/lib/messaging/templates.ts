export const PLACEHOLDERS = {
  clientName: "Contact person's name (or “there” if unknown)",
  businessName: "Prospect business name",
  websiteUrl: "Prospect website",
  proposalTitle: "Proposal title",
  proposalDate: "Proposal date",
  proposalLink: "Secure proposal link (create one on the proposal page)",
  auditSummary: "One-sentence summary of the key findings",
  consultantName: "Your name (Settings)",
  companyName: "Your company (Settings)",
} as const;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;
export type TemplateVars = Partial<Record<PlaceholderKey, string | null>>;

/** Fills {{placeholders}}. Unknown or empty ones are left visible and reported, never silently dropped. */
export function renderTemplate(template: string, vars: TemplateVars) {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in PLACEHOLDERS)) {
      unknown.add(key);
      return match;
    }
    const v = vars[key as PlaceholderKey];
    if (v == null || v === "") {
      missing.add(key);
      return match;
    }
    return v;
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

/** "The review found 4 confirmed issues, including slow mobile pages and duplicate titles." */
export function summariseFindings(titles: string[]) {
  if (!titles.length) return "";
  const top = titles.slice(0, 2).map((t) => t.charAt(0).toLowerCase() + t.slice(1));
  return `I found ${titles.length} specific improvement${titles.length === 1 ? "" : "s"}, including ${top.join(" and ")}.`;
}
