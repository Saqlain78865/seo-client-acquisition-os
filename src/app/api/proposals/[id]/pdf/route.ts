import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { reportError, withReference } from "@/lib/log";
import { db } from "@/lib/db";
import { PdfError } from "@/lib/proposals/pdf";
import { ProposalError, ensurePdf } from "@/lib/proposals/service";

/** Authenticated PDF download/preview. Generates the file on first request if it does not exist. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const proposal = await db.proposal.findFirst({ where: { id, workspaceId: session.workspace.id }, select: { currentVersion: true, prospectId: true } });
  if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const version = Number(request.nextUrl.searchParams.get("v") ?? proposal.currentVersion);
  const download = request.nextUrl.searchParams.get("download") === "1";

  try {
    const { buffer, attachment } = await ensurePdf(session.workspace.id, session.user.id, id, version);
    if (download) {
      await logActivity({ workspaceId: session.workspace.id, prospectId: proposal.prospectId, userId: session.user.id, type: "proposal.pdf_downloaded", message: `PDF downloaded (v${version})` });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${attachment.fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const message = e instanceof ProposalError || e instanceof PdfError ? e.message : withReference("The PDF could not be generated.", await reportError("pdf", e));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
