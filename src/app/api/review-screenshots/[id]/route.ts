import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** A review screenshot uploaded by the user, for signed-in members of its workspace only. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const shot = await db.reviewScreenshot.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!shot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = await getFile(shot.storageKey);
    const type = TYPES[shot.storageKey.split(".").pop() ?? ""] ?? "image/jpeg";
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
