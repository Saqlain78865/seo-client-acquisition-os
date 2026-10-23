// Manual check of the configured Gemini key and model: npx tsx --conditions=react-server scripts/try-gemini.mts
import { z } from "zod";
import { geminiModel, getAiProvider } from "../src/lib/ai/provider.ts";

process.loadEnvFile?.(".env");
const ai = getAiProvider();
if (!ai) throw new Error("GEMINI_API_KEY is not set");
const started = Date.now();
const out = await ai.generateJson({
  system: "You write one-sentence summaries for small business owners.",
  prompt: "Summarise in one friendly sentence: the website has duplicate page titles and 15 pages without a main heading.",
  schema: z.object({ summary: z.string().min(10) }),
});
console.log(`model ${geminiModel()} answered in ${Date.now() - started} ms:`, out.summary);
