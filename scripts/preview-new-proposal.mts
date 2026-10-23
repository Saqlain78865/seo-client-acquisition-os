// Manual visual check on a COPY of the database: DATABASE_URL=file:<copy> npx tsx --conditions=react-server scripts/preview-new-proposal.mts <outDir>
// Generates a fresh proposal from the latest proposal's audit, then writes HTML + PDF.
import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db.ts";
import { createProposal, getProposalWithVersion, toRenderVersion } from "../src/lib/proposals/service.ts";
import { renderProposalHtml, pdfFooterTemplate } from "../src/lib/proposals/render.ts";
import { htmlToPdf } from "../src/lib/proposals/pdf.ts";

const out = process.argv[2] ?? ".";
const last = await db.proposal.findFirstOrThrow({ orderBy: { updatedAt: "desc" } });
const userId = (await db.workspaceMembership.findFirstOrThrow({ where: { workspaceId: last.workspaceId } })).userId;
const created = await createProposal(last.workspaceId, userId, { prospectId: last.prospectId, auditId: last.auditId });
const found = (await getProposalWithVersion(last.workspaceId, created.id))!;
const rv = toRenderVersion(found.version, found.proposal.title);
const html = renderProposalHtml(rv, { businessName: found.proposal.prospect.businessName, websiteUrl: found.proposal.prospect.websiteUrl, contactName: null });
writeFileSync(`${out}/new-proposal.html`, html);
writeFileSync(`${out}/new-proposal.pdf`, await htmlToPdf(html, pdfFooterTemplate(rv)));
console.log("rendered", found.proposal.title);
