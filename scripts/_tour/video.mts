// Makes the Desert Sky audit video in tour.db (after seed.mts).
import { db } from "../../src/lib/db.ts";
import { generateAuditVideo } from "../../src/lib/video/audit-video.ts";
const v = await db.auditVideo.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
await generateAuditVideo(v.id, "female");
console.log(JSON.stringify(await db.auditVideo.findUnique({ where: { id: v.id }, select: { status: true, seconds: true, error: true } })));
process.exit(0);
