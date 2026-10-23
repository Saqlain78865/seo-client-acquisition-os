import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveShareToken } from "@/lib/messaging/share";
import { getProposalWithVersion, toRenderVersion, withImages } from "@/lib/proposals/service";
import { renderProposalHtml } from "@/lib/proposals/render";
import { readTrackerScript } from "@/lib/proposals/reading";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await resolveShareToken(token);
  if (!proposal) return new NextResponse("Not found", { status: 404 });
  const found = await getProposalWithVersion(proposal.workspaceId, proposal.id, proposal.shareVersion!);
  if (!found) return new NextResponse("Not found", { status: 404 });
  const rendered = renderProposalHtml(await withImages(toRenderVersion(found.version, found.proposal.title), proposal.workspaceId), {
    businessName: found.proposal.prospect.businessName,
    websiteUrl: found.proposal.prospect.websiteUrl,
    contactName: found.proposal.prospect.contacts[0]?.value ?? null,
  });
  // Only this one script may run (nonce); it reports reading time to the page around the frame.
  const nonce = randomBytes(16).toString("base64");
  const html = rendered.replace("</body>", `<script nonce="${nonce}">${readTrackerScript()}</script></body>`);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
