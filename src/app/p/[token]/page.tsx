import type { Metadata } from "next";
import { Download, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordShareView, resolveShareToken } from "@/lib/messaging/share";
import type { Branding } from "@/lib/proposals/types";
import { buttonClass } from "@/components/ui";
import { RespondButtons } from "./respond";
import { ProposalViewer } from "./viewer";

export const metadata: Metadata = { title: "Proposal", robots: { index: false, follow: false } };

/** Public, read-only view of one shared proposal version. Shows nothing else from the workspace. */
export default async function SharedProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await resolveShareToken(token);
  if (!proposal) {
    return (
      <main className="theme-light flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="max-w-sm text-center">
          <FileText className="mx-auto h-8 w-8 text-muted" />
          <h1 className="mt-3 text-lg font-semibold">This link is not available</h1>
          <p className="mt-1 text-sm text-muted">It may have expired or been withdrawn. Please contact the sender for a new link.</p>
        </div>
      </main>
    );
  }
  // The team previewing its own link is not counted as the client opening it.
  const session = await getSession();
  const isClient = session?.workspace.id !== proposal.workspaceId;
  if (isClient) await recordShareView(proposal.id);
  const version = await db.proposalVersion.findUniqueOrThrow({ where: { proposalId_version: { proposalId: proposal.id, version: proposal.shareVersion! } }, select: { title: true, branding: true } });
  const branding = (version.branding ?? {}) as Partial<Branding>;

  return (
    <div className="theme-light min-h-screen bg-[#e9edf3]">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[#e3e8f0] bg-white px-4 py-3 text-[#0f1b2d] shadow-sm sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{version.title ?? proposal.title}</p>
          <p className="text-xs text-[#5b6b82]">
            Prepared for {proposal.prospect.businessName}
            {branding.companyName ? ` by ${branding.companyName}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a href={`/p/${token}/pdf?download=1`} className={buttonClass("secondary", "sm")} aria-label="Download PDF">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download PDF</span>
          </a>
          <RespondButtons token={token} accepted={!!proposal.acceptedAt} companyName={branding.companyName ?? null} />
        </div>
      </header>
      <ProposalViewer token={token} track={isClient} />
    </div>
  );
}
