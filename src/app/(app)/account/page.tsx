import type { Metadata } from "next";
import { hasRole, requireSession } from "@/lib/auth";
import { listMembers, listSessions } from "@/lib/team";
import { formatDate } from "@/lib/utils";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { AddMemberForm, MemberControls, PasswordForm, SignOutOthersButton } from "./forms";

export const metadata: Metadata = { title: "Account & Team" };

/** "Chrome on Windows" from a user-agent string — enough to recognise a device, nothing more. */
function deviceLabel(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export default async function AccountPage() {
  const session = await requireSession();
  const isOwner = hasRole(session, "OWNER");
  const [sessions, members] = await Promise.all([listSessions(session.user.id), listMembers(session.workspace.id)]);

  return (
    <>
      <PageHeader title="Account & Team" description={`Signed in as ${session.user.email} · ${session.role.toLowerCase()}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Team members" description={isOwner ? "Add people who work with you. Members can use the CRM; admins can also change settings and integrations." : "Only owners can add or remove members."} />
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {m.user.name} {m.user.id === session.user.id && <span className="text-xs text-muted">(you)</span>}
                    </p>
                    <p className="break-all text-xs text-muted">
                      {m.user.email} · since {formatDate(m.createdAt)}
                    </p>
                  </div>
                  {isOwner && m.user.id !== session.user.id ? (
                    <MemberControls membershipId={m.id} role={m.role} name={m.user.name} />
                  ) : (
                    <Badge tone={m.role === "OWNER" ? "primary" : "neutral"}>{m.role.toLowerCase()}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {isOwner && (
              <div className="border-t border-border p-5">
                <AddMemberForm />
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Change password" description="Other devices are signed out when you change it." />
            <div className="p-5">
              <PasswordForm />
            </div>
          </Card>
          <Card>
            <CardHeader title="Where you're signed in" action={<SignOutOthersButton disabled={sessions.length <= 1} />} />
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id} className="px-5 py-3 text-sm">
                  <p className="font-medium">
                    {deviceLabel(s.userAgent)} {s.id === session.sessionId && <Badge tone="success">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {s.workspace.name} · last active {formatDate(s.lastSeenAt, true)}
                    {s.ip ? ` · ${s.ip}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
