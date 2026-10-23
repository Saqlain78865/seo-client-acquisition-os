import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { reportError, withReference } from "@/lib/log";
import { exportWorkspace } from "@/lib/system";

/** Owner-only JSON export of the whole workspace (secrets excluded — see exportWorkspace). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, "OWNER")) return NextResponse.json({ error: "Only workspace owners can export data." }, { status: 403 });
  try {
    const data = await exportWorkspace(session.workspace.id);
    await logActivity({ workspaceId: session.workspace.id, userId: session.user.id, type: "workspace.exported", message: "Workspace data exported" });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="workspace-export-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: withReference("The export failed.", await reportError("export", e)) }, { status: 500 });
  }
}
