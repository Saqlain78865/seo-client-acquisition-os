import "server-only";
import { registerJobHandler } from "./queue";
import { runAudit } from "../audit/runner";
import { afterAudit } from "../audit/after";

export const JOB_TYPES = { AUDIT_RUN: "audit.run" } as const;

registerJobHandler(JOB_TYPES.AUDIT_RUN, async (payload) => {
  try {
    await runAudit(String(payload.auditId));
  } finally {
    await afterAudit(String(payload.auditId));
  }
});

registerJobHandler("audit.video", async (payload) => {
  const { generateAuditVideo } = await import("../video/audit-video");
  await generateAuditVideo(String(payload.videoId));
});
