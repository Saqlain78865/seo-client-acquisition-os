import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getApiKey } from "@/lib/integrations";
import { Alert, PageHeader } from "@/components/ui";
import { Finder } from "./finder";
import { placesProblem } from "@/lib/research/places-service";

export const metadata: Metadata = { title: "Prospect Finder" };

export default async function ProspectFinderPage() {
  const session = await requireSession();
  const hasKey = !!(await getApiKey(session.workspace.id, "PLACES"));
  const problem = hasKey ? await placesProblem(session.workspace.id) : null;
  const ready = hasKey && !problem;
  return (
    <>
      <PageHeader title="Prospect Finder" description="Find local businesses by type and city — the weakest ones (no website, low rating, few reviews) come first. Free with OpenStreetMap; Google ratings and reviews with your own Places API key." />
      {problem && (
        <Alert tone="warning" className="mb-6" title="Google Places is not available with your key">
          Google said: “{problem}” — Google Places needs “Places API (New)” allowed on the key and a billing account (card) on the Google Cloud project. Until then the Finder uses OpenStreetMap. After fixing it, save the key again on the{" "}
          <Link href="/integrations" className="font-medium underline">
            Integrations page
          </Link>
          .
        </Alert>
      )}
      {!ready && !problem && (
        <Alert tone="info" className="mb-6" title="Searching OpenStreetMap (free)">
          For Google ratings and review counts, add a Google key with “Places API (New)” on the{" "}
          <Link href="/integrations" className="font-medium underline">
            Integrations page
          </Link>{" "}
          (Google needs a billing account on the project).
        </Alert>
      )}
      <Finder googleReady={ready} />
    </>
  );
}
