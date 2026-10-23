import { Badge, type BadgeTone } from "@/components/ui";

const TONES: Record<string, BadgeTone> = { DRAFT: "neutral", READY: "primary", SENT: "info", ACCEPTED: "success", DECLINED: "danger" };
const LABELS: Record<string, string> = { DRAFT: "Draft", READY: "Ready to send", SENT: "Sent", ACCEPTED: "Accepted", DECLINED: "Declined" };

export function ProposalStatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{LABELS[status] ?? status}</Badge>;
}
