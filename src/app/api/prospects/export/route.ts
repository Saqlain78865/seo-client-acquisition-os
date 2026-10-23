import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { exportProspectsCsv } from "@/lib/prospects";
import { logActivity } from "@/lib/activity";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const get = (k: string) => sp.get(k) || undefined;
  const csv = await exportProspectsCsv(session.workspace.id, {
    q: get("q"),
    status: get("status"),
    country: get("country"),
    service: get("service"),
    ownerId: get("owner"),
    from: get("from"),
    to: get("to"),
  });
  await logActivity({
    workspaceId: session.workspace.id,
    userId: session.user.id,
    type: "prospect.exported",
    message: "Prospects exported to CSV",
  });
  const date = new Date().toISOString().slice(0, 10);
  // BOM so Excel opens UTF-8 (Urdu, Arabic, accented names) correctly.
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospects-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
