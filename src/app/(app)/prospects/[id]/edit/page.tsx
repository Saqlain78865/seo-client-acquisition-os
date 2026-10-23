import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { updateProspectAction } from "../../actions";
import { ProspectForm } from "../../prospect-form";

export const metadata: Metadata = { title: "Edit prospect" };

export default async function EditProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const p = await db.prospect.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${p.businessName}`} description="Contact details are managed from the prospect's contact panel." />
      <Card className="p-6">
        <ProspectForm
          action={updateProspectAction.bind(null, p.id)}
          withContacts={false}
          submitLabel="Save changes"
          cancelHref={`/prospects/${p.id}`}
          defaults={{
            businessName: p.businessName,
            websiteUrl: p.websiteUrl,
            industry: p.industry ?? undefined,
            country: p.country ?? undefined,
            city: p.city ?? undefined,
            primaryServices: p.primaryServices ?? undefined,
            leadSource: p.leadSource ?? undefined,
            notes: p.notes ?? undefined,
            estimatedValue: p.estimatedValue ?? undefined,
            currency: p.currency,
          }}
        />
      </Card>
    </div>
  );
}
