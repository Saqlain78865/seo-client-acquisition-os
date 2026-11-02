import { Badge } from "@/components/ui";
import type { EmailHealth } from "@/lib/email-health";

/** SPF / DKIM / DMARC / MX results with what each means. */
export function EmailHealthView({ health }: { health: EmailHealth }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {health.domain}
        {health.provider ? ` · email by ${health.provider}` : ""} · score <b className={health.score >= 80 ? "text-success" : health.score >= 50 ? "text-warning" : "text-danger"}>{health.score}/100</b>
      </p>
      <ul className="space-y-1.5">
        {health.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            <Badge tone={c.status === "OK" ? "success" : c.status === "WARN" ? "warning" : "danger"}>{c.key}</Badge>
            <span className="min-w-0 text-xs">
              {c.detail}
              {c.record && <span className="mt-0.5 block truncate font-mono text-[10px] text-muted" title={c.record}>{c.record}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
