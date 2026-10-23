/**
 * Opportunity score (0–100) for ranking audited websites as prospects: how much confirmed SEO work
 * the site needs, plus whether the business can actually be contacted. It ranks leads; it is not a
 * measure of the site's traffic or rankings.
 */

type ScoreFinding = { severity: string; evidenceStatus: string; title: string; priority: number; ruleId: string };

const WEIGHT: Record<string, number> = { CRITICAL: 14, HIGH: 9, MEDIUM: 5, LOW: 2, OPPORTUNITY: 3 };

export type Opportunity = { score: number; grade: "HOT" | "WARM" | "COLD"; reasons: string[] };

export function opportunityScore(findings: ScoreFinding[], hasContact: boolean): Opportunity {
  const usable = findings.filter((f) => f.severity in WEIGHT && f.evidenceStatus !== "HYPOTHESIS");
  const issues = usable.reduce((sum, f) => sum + WEIGHT[f.severity] * (f.evidenceStatus === "POTENTIAL" ? 0.6 : 1), 0);
  const signals = (usable.some((f) => f.ruleId === "domain.no-analytics") ? 5 : 0) + (usable.some((f) => f.ruleId.startsWith("local.")) ? 5 : 0);
  const score = Math.round(Math.min(75, issues) + Math.min(10, signals) + (hasContact ? 15 : 0));
  const reasons = [...usable].sort((a, b) => b.priority - a.priority).slice(0, 3).map((f) => f.title);
  if (!hasContact) reasons.push("No email or phone found yet");
  return { score: Math.min(100, score), grade: score >= 60 ? "HOT" : score >= 35 ? "WARM" : "COLD", reasons };
}
