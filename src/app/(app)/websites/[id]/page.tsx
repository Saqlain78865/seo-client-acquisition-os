import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, FileText, Trash2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWebsite } from "@/lib/websites";
import { propertyMatches } from "@/lib/search-console";
import { CHANGE_LABELS, type ChangeKind } from "@/lib/site-changes";
import { isMonthKey, monthKey, shiftMonth } from "@/lib/client-work";
import { WORK_CATEGORIES, monthWork } from "@/lib/work-log";
import { WorkLog } from "./work-log";
import { Alert, Badge, Card, CardHeader, PageHeader, buttonClass } from "@/components/ui";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { deleteWebsiteAction } from "../actions";
import { Explorer } from "./explorer";
import { PropertyPicker } from "./property-picker";
import { WebsiteChanges } from "./changes";
import { Alerts, InternalLinks, KeywordTracking, ReportEmail } from "./monitoring";
import { MAX_KEYWORDS, trackedKeywords } from "@/lib/rank-tracking";
import { resolveSender } from "@/lib/messaging/email";
import { ALERT_LABELS, openAlerts, type AlertKind } from "@/lib/site-alerts";

export const metadata: Metadata = { title: "Website" };

export default async function WebsitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // The work log opens on the current month; the report on the last complete one.
  const month = isMonthKey(sp.month) ? sp.month : monthKey();
  const session = await requireSession();
  const w = await getWebsite(session.workspace.id, id);
  if (!w) notFound();
  const [gsc, changes, work, keywords, alerts, deliveries, gmail] = await Promise.all([
    db.integrationConnection.findFirst({ where: { workspaceId: session.workspace.id, provider: "SEARCH_CONSOLE", status: "CONNECTED", encryptedSecret: { not: null } }, select: { accountLabel: true } }),
    db.siteChange.findMany({ where: { websiteId: w.id, workspaceId: session.workspace.id }, orderBy: { detectedAt: "desc" }, take: 60 }),
    monthWork(session.workspace.id, w.id, month),
    trackedKeywords(session.workspace.id, w.id),
    openAlerts(session.workspace.id, w.id),
    db.reportDelivery.findMany({ where: { websiteId: w.id, workspaceId: session.workspace.id }, orderBy: { month: "desc" }, take: 6 }),
    resolveSender(session.workspace.id).then((s) => !!s),
  ]);
  const linked = w.gscSiteUrl && propertyMatches(w.gscSiteUrl, w.domain) ? w.gscSiteUrl : null;

  return (
    <>
      <RefreshOnFocus />
      <PageHeader
        title={w.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <a href={w.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
              {w.domain} <ExternalLink className="h-3 w-3" />
            </a>
            <Badge tone={w.kind === "OWN" ? "primary" : "info"}>{w.kind === "OWN" ? "My site" : "Client site"}</Badge>
            {linked && <Badge tone="success">{linked}</Badge>}
          </span>
        }
        actions={
          <>
            <Link href={`/website-report?site=${w.id}&month=${shiftMonth(monthKey(), -1)}`} className={buttonClass("primary")}>
              <FileText className="h-4 w-4" /> Monthly report
            </Link>
            <form action={deleteWebsiteAction.bind(null, w.id)}>
              <button type="submit" className={buttonClass("ghost")} title="Remove from My Websites">
                <Trash2 className="h-4 w-4" />
              </button>
            </form>
          </>
        }
      />

      {!gsc ? (
        <Alert tone="info" className="mb-6" title="Connect Search Console">
          Connect your Google account (read-only) on the{" "}
          <Link href="/integrations" className="font-medium underline">
            Integrations page
          </Link>{" "}
          to see this website&apos;s clicks, impressions, keywords and pages here.
        </Alert>
      ) : !linked ? (
        <Card className="mb-6">
          <CardHeader title="Search Console" description={`Connected as ${gsc.accountLabel ?? "your Google account"}. Only ${w.domain}'s own property can be linked here.`} />
          <div className="p-5">
            <PropertyPicker websiteId={w.id} domain={w.domain} current={null} />
          </div>
        </Card>
      ) : (
        <div className="mb-6 space-y-3">
          <Explorer websiteId={w.id} domain={w.domain} />
          <PropertyPicker websiteId={w.id} domain={w.domain} current={linked} />
        </div>
      )}

      <div className="mb-6">
        <Alerts
          websiteId={w.id}
          status={w.siteStatus}
          checkedAt={w.siteCheckedAt?.toISOString() ?? null}
          alerts={alerts.map((a) => ({ id: a.id, kind: a.kind, label: ALERT_LABELS[a.kind as AlertKind] ?? a.kind, title: a.title, detail: a.detail, url: a.url, at: a.createdAt.toISOString(), resolved: !!a.resolvedAt }))}
        />
      </div>

      <div className="mb-6">
        <KeywordTracking websiteId={w.id} linked={!!linked} syncedAt={w.keywordsSyncedAt?.toISOString() ?? null} keywords={keywords} max={MAX_KEYWORDS} />
      </div>

      <div className="mb-6">
        <WorkLog websiteId={w.id} month={month} entries={work.map((e) => ({ id: e.id, category: e.category, title: e.title, detail: e.detail, url: e.url, count: e.count }))} categories={WORK_CATEGORIES} />
      </div>

      <div className="mb-6">
        <ReportEmail
          websiteId={w.id}
          day={w.reportDay}
          email={w.reportEmail}
          approval={w.reportApproval}
          gmail={!!gmail}
          deliveries={deliveries.map((d) => ({ id: d.id, month: d.month, to: d.to, status: d.status, error: d.error, sentAt: d.sentAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString() }))}
        />
      </div>

      <div className="mb-6">
        <InternalLinks websiteId={w.id} />
      </div>

      <Card>
        <CardHeader title="Change log" description="What changed on the live website, found by the weekly check — no login to the site is needed." />
        <div className="p-5">
          <WebsiteChanges
            websiteId={w.id}
            checkedAt={w.changesCheckedAt?.toISOString() ?? null}
            changes={changes.map((c) => ({ id: c.id, url: c.url, label: CHANGE_LABELS[c.kind as ChangeKind] ?? c.kind, before: c.before, after: c.after, at: c.detectedAt.toISOString() }))}
          />
        </div>
      </Card>
    </>
  );
}
