import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { items, unread } = await listNotifications(session.workspace.id, session.user.id);
  return NextResponse.json(
    { unread, items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() })) },
    { headers: noStore },
  );
}

/** Marks everything as read. Same-origin only (the proxy and the session cookie's SameSite=Lax cover CSRF for POST). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await markNotificationsRead(session.workspace.id, session.user.id);
  return NextResponse.json({ ok: true }, { headers: noStore });
}
