import { Badge, type BadgeTone } from "@/components/ui";

const TONES: Record<string, BadgeTone> = {
  NEW_PROSPECT: "neutral",
  AUDIT_IN_PROGRESS: "info",
  AUDIT_COMPLETED: "info",
  PROPOSAL_DRAFT: "primary",
  PROPOSAL_READY: "primary",
  PROPOSAL_SENT: "primary",
  REPLIED: "success",
  FOLLOW_UP_DUE: "warning",
  MEETING_SCHEDULED: "warning",
  NEGOTIATION: "warning",
  WON: "success",
  LOST: "danger",
  NOT_INTERESTED: "danger",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={TONES[status] ?? "neutral"} dot>
      {label ?? status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}
