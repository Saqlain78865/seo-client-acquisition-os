// Manual visual check: npx tsx --conditions=react-server scripts/render-proposal.mts <outDir>
// Renders the most recent proposal in DATABASE_URL to HTML + PDF without storing anything.
import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db.ts";
import { getProposalWithVersion, toRenderVersion } from "../src/lib/proposals/service.ts";
import { renderProposalHtml, pdfFooterTemplate } from "../src/lib/proposals/render.ts";
import { htmlToPdf } from "../src/lib/proposals/pdf.ts";

const out = process.argv[2] ?? ".";
const p = await db.proposal.findFirstOrThrow({ orderBy: { updatedAt: "desc" } });
const found = (await getProposalWithVersion(p.workspaceId, p.id))!;
const rv = toRenderVersion(found.version, found.proposal.title);
const html = renderProposalHtml(rv, { businessName: found.proposal.prospect.businessName, websiteUrl: found.proposal.prospect.websiteUrl, contactName: null });
writeFileSync(`${out}/proposal.html`, html);
writeFileSync(`${out}/proposal.pdf`, await htmlToPdf(html, pdfFooterTemplate(rv)));
console.log(p.title, "→", out);
