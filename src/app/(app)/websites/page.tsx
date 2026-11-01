import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Globe2, SearchCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { listWebsites } from "@/lib/websites";
import { formatDate } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AddWebsiteForm } from "./add-form";

export const metadata: Metadata = { title: "My Websites" };

export default async function WebsitesPage() {
  const session = await requireSession();
  const sites = await listWebsites(session.workspace.id);
  return (
    <>
      <PageHeader title="My Websites" description="Your own sites and the client sites you manage — with their Search Console data, weekly change log and monthly report. Separate from prospects and proposals." />
      <Card className="mb-6 p-5">
        <AddWebsiteForm />
      </Card>
      <Card>
        <CardHeader title={`${sites.length} website${sites.length === 1 ? "" : "s"}`} />
        {sites.length === 0 ? (
          <EmptyState icon={<Globe2 className="h-5 w-5" />} title="No websites yet" description="Add your blog or a client site above." />
        ) : (
          <ul className="divide-y divide-border">
            {sites.map((w) => (
              <li key={w.id}>
                <Link href={`/websites/${w.id}`} className="group flex flex-wrap items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-2/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium group-hover:text-primary">{w.name}</span>
                    <span className="text-xs text-muted">
                      {w.domain}
                      {w.changesCheckedAt ? ` · checked ${formatDate(w.changesCheckedAt)}` : ""}
                    </span>
                  </span>
                  <Badge tone={w.kind === "OWN" ? "primary" : "info"}>{w.kind === "OWN" ? "My site" : "Client"}</Badge>
                  {w.gscSiteUrl ? (
                    <Badge tone="success">
                      <SearchCheck className="h-3 w-3" /> Search Console
                    </Badge>
                  ) : (
                    <Badge>Not linked</Badge>
                  )}
                  {w._count.siteChanges > 0 && <Badge tone="neutral">{w._count.siteChanges} changes</Badge>}
                  <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
