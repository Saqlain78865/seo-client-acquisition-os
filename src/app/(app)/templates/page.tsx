import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { TemplateCard, TemplateEditor } from "./editor";

export const metadata: Metadata = { title: "Message Templates" };

export default async function TemplatesPage() {
  const session = await requireSession();
  const templates = await db.messageTemplate.findMany({ where: { workspaceId: session.workspace.id, channel: "EMAIL" }, orderBy: [{ channel: "asc" }, { isDefault: "desc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="Message Templates" description="Reusable email messages. Placeholders are filled from the prospect and proposal; empty ones block sending until you fix them." />
      <div className="space-y-4">
        {templates.map((t) => (
          <TemplateCard key={t.id} t={{ ...t, updatedAt: t.updatedAt.toISOString() }} />
        ))}
        <Card>
          <CardHeader title="New template" />
          <div className="p-5">
            <TemplateEditor template={null} />
          </div>
        </Card>
      </div>
    </>
  );
}
