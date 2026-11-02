import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Finder } from "./finder";

export const metadata: Metadata = { title: "Prospect Finder" };

export default async function ProspectFinderPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Prospect Finder" description="Find local businesses by type and city on OpenStreetMap (free) — those without a website come first. Open each one on Google Maps to see its reviews before you reach out." />
      <Finder />
    </>
  );
}
