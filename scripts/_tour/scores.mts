// Recomputes the lead scores in tour.db (after a change to the wording).
import { db } from "../../src/lib/db.ts";
import { refreshLeadScores } from "../../src/lib/lead-score.ts";
const ws = await db.workspace.findFirstOrThrow();
await db.prospect.updateMany({ data: { leadScoreReasons: [] } });
await refreshLeadScores(ws.id);
console.log("scores refreshed");
process.exit(0);
