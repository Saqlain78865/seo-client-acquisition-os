import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getProposalWithVersion, toRenderVersion, withImages } from "@/lib/proposals/service";
import { renderProposalHtml } from "@/lib/proposals/render";

/** The exact HTML used for the PDF, for the in-app preview iframe. Locked down with a strict CSP. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const v = request.nextUrl.searchParams.get("v");
  const found = await getProposalWithVersion(session.workspace.id, id, v ? Number(v) : undefined);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { proposal, version } = found;
  const html = renderProposalHtml(await withImages(toRenderVersion(version, proposal.title), session.workspace.id), {
    businessName: proposal.prospect.businessName,
    websiteUrl: proposal.prospect.websiteUrl,
    contactName: proposal.prospect.contacts[0]?.value ?? null,
  });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, no-store",
    },
  });
}
