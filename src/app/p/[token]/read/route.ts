import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveShareToken } from "@/lib/messaging/share";
import { readBeatSchema, recordReadBeat } from "@/lib/proposals/reading";

/** Reading-time beats from the client's view of a shared proposal. Always answers 204: nothing to show the reader. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const done = new NextResponse(null, { status: 204 });
  const text = await req.text().catch(() => "");
  if (!text || text.length > 4000) return done;
  let parsed;
  try {
    parsed = readBeatSchema.safeParse(JSON.parse(text));
  } catch {
    return done;
  }
  if (!parsed.success) return done;
  const { token } = await params;
  const proposal = await resolveShareToken(token);
  if (!proposal) return done;
  // The team previewing its own link is not the client reading it.
  const session = await getSession();
  if (session?.workspace.id === proposal.workspaceId) return done;
  await recordReadBeat(proposal.id, proposal.shareVersion!, parsed.data);
  return done;
}
