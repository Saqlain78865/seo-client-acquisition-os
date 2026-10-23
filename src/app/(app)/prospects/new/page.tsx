import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { createProspectAction } from "../actions";
import { ProspectForm } from "../prospect-form";

export const metadata: Metadata = { title: "Add prospect" };

export default function NewProspectPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add prospect" description="Create a CRM record. You can run a website audit for it afterwards." />
      <Card className="p-6">
        <ProspectForm action={createProspectAction} withContacts submitLabel="Create prospect" cancelHref="/prospects" />
      </Card>
    </div>
  );
}
