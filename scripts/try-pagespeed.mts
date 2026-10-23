// Manual check against the real PageSpeed Insights API: npx tsx scripts/try-pagespeed.mts https://example.com [mobile|desktop]
import { performanceFinding, runPageSpeed } from "../src/lib/research/pagespeed.ts";

const url = process.argv[2] ?? "https://www.python.org/";
const strategy = (process.argv[3] ?? "mobile").toUpperCase() as "MOBILE" | "DESKTOP";
const r = await runPageSpeed(url, strategy, fetch, process.env.PAGESPEED_API_KEY);
console.log(JSON.stringify({ lab: r.lab, fieldScope: r.fieldScope, field: r.field, lighthouse: r.lighthouseVersion }, null, 1));
const f = performanceFinding(r);
console.log(f ? `Finding: [${f.severity}/${f.evidenceStatus}] ${f.title}\n  ${f.observedFacts}` : "No performance finding (passes).");
