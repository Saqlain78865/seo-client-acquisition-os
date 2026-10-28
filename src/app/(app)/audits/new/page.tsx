import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { NewAuditForm } from "./new-audit-form";
import { NewAuditReel } from "../../page-reels";

export const metadata: Metadata = { title: "New Website Audit" };

export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ prospectId?: string }> }) {
  const session = await requireSession();
  const { prospectId } = await searchParams;
  const prospect = prospectId
    ? await db.prospect.findFirst({ where: { id: prospectId, workspaceId: session.workspace.id }, select: { id: true, businessName: true, websiteUrl: true, country: true, city: true, primaryServices: true, currency: true } })
    : null;
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id } });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Website Audit"
        description={`Crawls up to ${settings?.crawlPageLimit ?? 40} public pages, respecting robots.txt, and reports only findings backed by collected evidence.`}
      />
      <NewAuditReel className="mb-6" />
      <Card className="p-6">
        <NewAuditForm prospect={prospect} defaultCurrency={prospect?.currency ?? settings?.defaultCurrency ?? "USD"} />
      </Card>
    </div>
  );
}
