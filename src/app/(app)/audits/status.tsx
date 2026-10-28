import { Badge, type BadgeTone } from "@/components/ui";
import { SEVERITY_LABELS, type Severity } from "@/lib/audit/types";

const AUDIT_TONES: Record<string, BadgeTone> = { QUEUED: "neutral", RUNNING: "info", COMPLETED: "success", PARTIAL: "warning", FAILED: "danger" };
const AUDIT_LABELS: Record<string, string> = { QUEUED: "Queued", RUNNING: "Running", COMPLETED: "Completed", PARTIAL: "Partially completed", FAILED: "Failed" };

export function AuditStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={AUDIT_TONES[status] ?? "neutral"} title={status === "PARTIAL" ? "Findings are ready; one or more steps (often the AI summary when Gemini is busy) did not finish. Open the audit to see which, and Retry." : undefined}>
      {AUDIT_LABELS[status] ?? status}
    </Badge>
  );
}

const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
  OPPORTUNITY: "primary",
  NEEDS_VERIFICATION: "info",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge tone={SEVERITY_TONES[severity as Severity] ?? "neutral"} className={severity === "CRITICAL" ? "font-semibold uppercase" : undefined}>
      {SEVERITY_LABELS[severity as Severity] ?? severity}
    </Badge>
  );
}

const EVIDENCE_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  CONFIRMED: { label: "Confirmed", tone: "success" },
  POTENTIAL: { label: "Potential — review", tone: "warning" },
  HYPOTHESIS: { label: "Needs data", tone: "neutral" },
};

export function EvidenceBadge({ status }: { status: string }) {
  const e = EVIDENCE_LABELS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={e.tone}>{e.label}</Badge>;
}
