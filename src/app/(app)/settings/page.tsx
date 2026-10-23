import type { Metadata } from "next";
import { hasRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentBranding } from "@/lib/proposals/service";
import { gettingStarted } from "@/lib/onboarding";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { removeLogoAction } from "./actions";
import { LogoForm, ProfileForm } from "./forms";
import { StatusManager } from "./statuses";
import { GettingStarted } from "../getting-started";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  const canEdit = hasRole(session, "ADMIN");
  const [settings, branding, statuses, statusCounts, steps] = await Promise.all([
    db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id } }),
    currentBranding(session.workspace.id),
    db.pipelineStatus.findMany({ where: { workspaceId: session.workspace.id }, orderBy: { sortOrder: "asc" } }),
    db.prospect.groupBy({ by: ["status"], where: { workspaceId: session.workspace.id }, _count: { _all: true } }),
    gettingStarted(session.workspace.id),
  ]);
  const countByStatus = new Map(statusCounts.map((s) => [s.status, s._count._all]));

  return (
    <>
      <PageHeader title="Settings" description="These details appear on proposal covers, footers and signatures." />
      {!canEdit && (
        <Alert tone="info" className="mb-4">
          Only owners and admins can change settings.
        </Alert>
      )}
      <GettingStarted steps={steps} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
        <Card>
          <CardHeader title="Company profile and defaults" />
          <div className="p-5">
            <ProfileForm
              disabled={!canEdit}
              logo={branding.logoDataUri}
              defaults={{
                companyName: settings?.companyName ?? "",
                consultantName: settings?.consultantName ?? "",
                companyEmail: settings?.companyEmail ?? "",
                companyPhone: settings?.companyPhone ?? "",
                companyWebsite: settings?.companyWebsite ?? "",
                defaultCurrency: settings?.defaultCurrency ?? "USD",
                proposalTheme: settings?.proposalTheme ?? "navy",
                brandColor: settings?.brandColor ?? "",
                weeklyDigest: settings?.weeklyDigest ?? true,
                crawlPageLimit: settings?.crawlPageLimit ?? 40,
                crawlDelayMs: settings?.crawlDelayMs ?? 800,
              }}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Pipeline statuses" description="Rename, reorder or add your own stages. Built-in stages are used by audits, proposals and deals." />
          <StatusManager
            canEdit={canEdit}
            statuses={statuses.map((s) => ({ id: s.id, key: s.key, label: s.label, isSystem: s.isSystem, isTerminal: s.isTerminal, count: countByStatus.get(s.key) ?? 0 }))}
          />
        </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Logo" description="PNG, JPG or WebP, up to 1 MB." />
            <div className="space-y-3 p-5">
              {branding.logoDataUri ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URI from private storage
                <img src={branding.logoDataUri} alt="Current logo" className="max-h-20 rounded border border-border bg-white p-2" />
              ) : (
                <p className="text-sm text-muted">No logo uploaded.</p>
              )}
              {canEdit && <LogoForm />}
              {canEdit && branding.logoDataUri && (
                <form action={removeLogoAction}>
                  <button type="submit" className="text-xs text-danger hover:underline">
                    Remove logo
                  </button>
                </form>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
