import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getApiKey } from "@/lib/integrations";
import { Alert, PageHeader } from "@/components/ui";
import { Finder } from "./finder";

export const metadata: Metadata = { title: "Prospect Finder" };

export default async function ProspectFinderPage() {
  const session = await requireSession();
  const ready = !!(await getApiKey(session.workspace.id, "PLACES"));
  return (
    <>
      <PageHeader title="Prospect Finder" description="Search Google Maps businesses by type and city — the weakest profiles (no website, low rating, few reviews) come first. Uses the official Places API with your own key." />
      {!ready && (
        <Alert tone="warning" className="mb-6" title="A Places API key is needed">
          Add a Google key with “Places API (New)” enabled on the{" "}
          <Link href="/integrations" className="font-medium underline">
            Integrations page
          </Link>
          . Google gives a free monthly allowance; a billing account must be linked to the Google Cloud project.
        </Alert>
      )}
      <Finder disabled={!ready} />
    </>
  );
}
