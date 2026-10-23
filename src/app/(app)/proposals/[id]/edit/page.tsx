import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { currentBranding, getProposalWithVersion, toRenderVersion } from "@/lib/proposals/service";
import type { RoadmapKey } from "@/lib/proposals/types";
import { ProposalEditor, type EditorState } from "./editor";

export const metadata: Metadata = { title: "Edit proposal" };

// Calendar date in the server's local time zone (toISOString would shift late-evening dates to the previous day).
const dateInput = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

export default async function EditProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const found = await getProposalWithVersion(session.workspace.id, id, sp.v ? Number(sp.v) : undefined);
  if (!found) notFound();
  const { proposal, version } = found;
  const rv = toRenderVersion(version, proposal.title);
  const branding = await currentBranding(session.workspace.id);

  const initial: EditorState = {
    title: rv.title,
    proposalDate: dateInput(rv.proposalDate),
    validUntil: dateInput(rv.validUntil),
    currency: rv.currency,
    monthlyPrice: rv.monthlyPrice?.toString() ?? "",
    setupFee: rv.setupFee?.toString() ?? "",
    durationMonths: String(rv.durationMonths),
    paymentTerms: rv.paymentTerms ?? "",
    roadmap: version.roadmap as RoadmapKey,
    theme: rv.theme,
    services: rv.services,
    deliverables: rv.deliverables,
    clientNotes: rv.clientNotes ?? "",
    includeAppendix: rv.includeAppendix,
    sections: rv.sections.map((s) => ({ ...s, data: (s.data as EditorState["sections"][number]["data"]) ?? null })),
  };

  return (
    <ProposalEditor
      proposalId={proposal.id}
      baseVersion={version.version}
      latestVersion={proposal.currentVersion}
      locked={version.locked}
      clientName={proposal.prospect.businessName}
      initial={initial}
      brand={{ color: branding.brandColor ?? null, logo: branding.logoDataUri }}
      researchHref={`/prospects/${proposal.prospect.id}/research`}
    />
  );
}
