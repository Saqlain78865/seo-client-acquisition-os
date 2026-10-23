import "server-only";
import { db } from "./db";

/** In-app alerts for the whole workspace (userId null) or one member. Shown by the header bell. */
export async function notify(input: { workspaceId: string; title: string; body?: string; link?: string; userId?: string | null }) {
  return db.notification.create({
    data: { workspaceId: input.workspaceId, userId: input.userId ?? null, title: input.title.slice(0, 200), body: input.body?.slice(0, 1000), link: input.link },
  });
}

const visibleTo = (workspaceId: string, userId: string) => ({ workspaceId, OR: [{ userId: null }, { userId }] });

export async function listNotifications(workspaceId: string, userId: string, take = 15) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: visibleTo(workspaceId, userId), orderBy: { createdAt: "desc" }, take }),
    db.notification.count({ where: { ...visibleTo(workspaceId, userId), readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(workspaceId: string, userId: string) {
  await db.notification.updateMany({ where: { ...visibleTo(workspaceId, userId), readAt: null }, data: { readAt: new Date() } });
}
