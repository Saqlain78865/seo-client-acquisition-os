import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** An audit video (MP4) of this workspace, to watch or download. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const v = await db.auditVideo.findFirst({ where: { id, workspaceId: session.workspace.id, status: "READY" }, include: { prospect: { select: { domain: true } } } });
  if (!v?.storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = await getFile(v.storageKey).catch(() => null);
  if (!file) return NextResponse.json({ error: "The video file is missing" }, { status: 404 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(file.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${v.prospect.domain.replace(/[^a-z0-9.-]/gi, "-")}-website-review.mp4"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
