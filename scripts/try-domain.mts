// Manual check of the free domain overview: npx tsx --conditions=react-server scripts/try-domain.mts example.com
import { checkDomain } from "../src/lib/research/domain.ts";

const started = Date.now();
const o = await checkDomain(process.argv[2] ?? "python.org");
console.log(JSON.stringify({ ...o, signals: undefined }, null, 1));
console.log(`\nSignals (${Date.now() - started} ms):`);
for (const s of o.signals) console.log(` [${s.tone}] ${s.text}`);
