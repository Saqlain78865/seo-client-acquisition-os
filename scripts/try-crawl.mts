// Manual check against a real public website: npx tsx scripts/try-crawl.mts https://example.com [pageLimit]
import { crawlSite } from "../src/lib/crawler/crawl.ts";
import { extractContacts } from "../src/lib/crawler/contacts-extract.ts";
import { runRules } from "../src/lib/audit/rules.ts";

const url = process.argv[2];
const limit = Number(process.argv[3] ?? 10);
if (!url) throw new Error("Usage: tsx scripts/try-crawl.mts <url> [pageLimit]");

const started = Date.now();
const r = await crawlSite(url, { pageLimit: limit, delayMs: 500 });
console.log(`Crawled ${r.pages.length} pages in ${((Date.now() - started) / 1000).toFixed(1)}s ?? robots ${r.robots.found ? "found" : "missing"} ?? sitemap URLs ${r.sitemaps.urls.length} ?? skipped ${r.skipped.length}`);
for (const p of r.pages) console.log(`  ${p.status ?? "ERR"} ${(p.pageType ?? "-").padEnd(12)} ${String(p.page?.wordCount ?? "-").padStart(5)}w ${p.rendered ? "[JS] " : ""}${p.url}${p.error ? `  (${p.error})` : ""}`);
const contacts = extractContacts(r.pages.filter((p) => p.page).map((p) => ({ url: p.finalUrl!, pageType: p.pageType ?? "OTHER", page: p.page! })));
console.log(`Contacts: ${contacts.map((c) => `${c.type}=${c.value} [${c.confidence}]`).join(" | ") || "none"}`);
const findings = runRules({ ...r, robots: { ...r.robots }, pageLimit: limit, context: {}, collectedAt: new Date() });
console.log(`Findings (${findings.length}):`);
for (const f of findings) console.log(`  P${f.priority} ${f.severity.padEnd(18)} ${f.evidenceStatus.padEnd(10)} ${f.title} (${f.affectedUrls.length} URLs)`);
