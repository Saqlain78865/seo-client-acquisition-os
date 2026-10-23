import { NextResponse, type NextRequest } from "next/server";
import { resolveShareToken } from "@/lib/messaging/share";
import { ensurePdf } from "@/lib/proposals/service";

/** Public PDF for an active share link (also used as the WhatsApp document link). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await resolveShareToken(token);
  if (!proposal) return new NextResponse("Not found", { status: 404 });
  try {
    const { buffer, attachment } = await ensurePdf(proposal.workspaceId, null, proposal.id, proposal.shareVersion!);
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${attachment.fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("The document is temporarily unavailable.", { status: 503 });
  }
}
