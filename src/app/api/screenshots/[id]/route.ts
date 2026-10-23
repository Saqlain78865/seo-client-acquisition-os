import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** An audit screenshot, for signed-in members of the audit's workspace only. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const shot = await db.auditScreenshot.findFirst({ where: { id, audit: { workspaceId: session.workspace.id } } });
  if (!shot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = await getFile(shot.storageKey);
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
