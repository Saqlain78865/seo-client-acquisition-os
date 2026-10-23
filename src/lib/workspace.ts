import "server-only";
import { db } from "./db";
import { DEFAULT_PIPELINE_STATUSES } from "./constants";

export const DEFAULT_TEMPLATES = [
  {
    channel: "EMAIL",
    name: "Proposal — first send",
    subject: "SEO proposal for {{businessName}}",
    body: `Hi {{clientName}},

I reviewed {{websiteUrl}} and put together an SEO proposal for {{businessName}} based on what I found on the site.

{{auditSummary}}

The full proposal is attached as a PDF. I'd be glad to walk you through it on a short call.

Best regards,
{{consultantName}}`,
    isDefault: true,
  },
] as const;

/** Creates a workspace with its default settings, pipeline statuses and message templates. */
export async function createWorkspace(name: string, ownerId: string, isDemo = false) {
  return db.workspace.create({
    data: {
      name,
      isDemo,
      memberships: { create: { userId: ownerId, role: "OWNER" } },
      settings: { create: {} },
      pipelineStatuses: {
        create: DEFAULT_PIPELINE_STATUSES.map((s, i) => ({
          key: s.key,
          label: s.label,
          sortOrder: i,
          isTerminal: s.isTerminal ?? false,
          isSystem: true,
        })),
      },
      templates: { create: DEFAULT_TEMPLATES.map((t) => ({ ...t })) },
    },
  });
}

export async function getPipelineStatuses(workspaceId: string) {
  return db.pipelineStatus.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" } });
}
