import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Layers } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { listBatches, MAX_BULK_SITES } from "@/lib/audit/bulk";
import { formatDate } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { BulkAuditForm } from "./bulk-form";

export const metadata: Metadata = { title: "Bulk Audit" };

export default async function BulkAuditPage() {
  const session = await requireSession();
  const batches = await listBatches(session.workspace.id);
  return (
    <>
      <PageHeader
        title="Bulk Audit"
        description="Paste a list of websites. Each gets a quick audit (12 pages), and the list is ranked by opportunity score so you can contact the best leads first."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="p-6">
          <BulkAuditForm max={MAX_BULK_SITES} />
        </Card>
        <Card>
          <CardHeader title="Previous lists" />
          {batches.length === 0 ? (
            <EmptyState icon={<Layers className="h-5 w-5" />} title="No bulk audits yet" description="Your ranked lists will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/audits/bulk/${b.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium group-hover:text-primary">{b.name}</p>
                      <p className="text-xs text-muted">{formatDate(b.createdAt)}</p>
                    </div>
                    <Badge tone={b.done < b.total ? "info" : "success"}>
                      {b.done}/{b.total}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
