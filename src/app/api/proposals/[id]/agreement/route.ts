import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { PdfError } from "@/lib/proposals/pdf";
import { AgreementError, agreementPdf } from "@/lib/proposals/agreement";

/** The service agreement made from a proposal (with the client's online signature once accepted). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const { pdf, fileName } = await agreementPdf(session.workspace.id, id);
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AgreementError) return NextResponse.json({ error: e.message }, { status: 404 });
    const message = e instanceof PdfError ? e.message : withReference("The agreement could not be generated.", await reportError("agreement", e));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
