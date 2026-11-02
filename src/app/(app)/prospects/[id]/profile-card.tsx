"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cpu, Lightbulb, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { EmailHealthView } from "@/components/email-health-view";
import type { EmailHealth } from "@/lib/email-health";
import type { TechStack } from "@/lib/tech-stack";
import { checkProfileAction } from "./profile-actions";

/** What the prospect's website is built with and how healthy their email domain is, with pitch notes. */
export function ProfileCard({ prospectId, tech, email, pitch, checkedAt }: { prospectId: string; tech: TechStack | null; email: EmailHealth | null; pitch: string[]; checkedAt: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = () =>
    start(async () => {
      const r = await checkProfileAction(prospectId);
      if (!r.ok) return void toast.error(r.error);
      if (r.techError) toast.warning(`The website could not be read: ${r.techError}`);
      else toast.success("Checked");
      router.refresh();
    });
  const groups = new Map<string, string[]>();
  for (const t of tech?.technologies ?? []) groups.set(t.group, [...(groups.get(t.group) ?? []), t.version ? `${t.name} ${t.version}` : t.name]);
  return (
    <Card id="tech">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Cpu className="h-4 w-4" /> Website technology & email health
          </span>
        }
        description="What the site is built with (platform, plugins, analytics, chat) and whether their email domain has SPF, DKIM and DMARC — so the pitch fits their setup."
        action={
          <Button size="sm" variant="secondary" disabled={pending} onClick={run}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {checkedAt ? "Check again" : "Check"}
          </Button>
        }
      />
      <div className="space-y-4 p-5 text-sm">
        {!checkedAt && <p className="text-muted">Not checked yet — takes a few seconds.</p>}
        {pitch.length > 0 && (
          <div className="rounded-xl bg-primary-soft p-3">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-primary">
              <Lightbulb className="h-4 w-4" /> Pitch notes
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {pitch.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {tech && (
          <div className="space-y-1.5">
            {groups.size === 0 ? (
              <p className="text-xs text-muted">No known platform or tools could be recognised from the home page.</p>
            ) : (
              [...groups].map(([g, names]) => (
                <p key={g} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="w-28 shrink-0 text-muted">{g}</span>
                  {names.map((n) => (
                    <Badge key={n} tone={g === "Platform" ? "primary" : "neutral"}>
                      {n}
                    </Badge>
                  ))}
                </p>
              ))
            )}
            {tech.wpPlugins.length > 0 && (
              <p className="text-xs text-muted">
                <span className="text-text">WordPress plugins seen:</span> {tech.wpPlugins.join(", ")}
              </p>
            )}
          </div>
        )}
        {email && <EmailHealthView health={email} />}
        {checkedAt && <p className="text-[11px] text-muted">Checked {new Date(checkedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
      </div>
    </Card>
  );
}
