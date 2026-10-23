import "server-only";
import { z } from "zod";

/**
 * Provider abstraction for structured AI output. The model only ever receives the data needed for
 * the task, never credentials, and its output is validated against a Zod schema before use.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateJson<T>(args: { system: string; prompt: string; schema: z.ZodType<T>; maxOutputTokens?: number }): Promise<T>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "HTTP" | "INVALID_OUTPUT" | "RATE_LIMITED" | "NETWORK",
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Pauses before retrying a request Gemini rejected as temporarily overloaded. */
const RETRY_DELAYS_MS = [3_000, 8_000];

class GeminiProvider implements AiProvider {
  readonly name = "Google Gemini";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fallbackModel: string | null = null,
  ) {}

  /**
   * One request, retried with a pause when Gemini is briefly overloaded (429 / 5xx), which is common
   * on the free tier. If the main model stays overloaded, the lighter fallback model is tried once.
   */
  private async post(body: unknown, delays = RETRY_DELAYS_MS, model = this.model): Promise<Response> {
    const canFallBack = !!this.fallbackModel && model !== this.fallbackModel;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          // The main model gets less time when a fallback exists: an overloaded model can hang for minutes.
          signal: AbortSignal.timeout(canFallBack ? 60_000 : 90_000),
        });
      } catch (e) {
        if (canFallBack) return this.post(body, delays.slice(0, 1), this.fallbackModel!);
        throw new AiError(`Could not reach Gemini: ${(e as Error).message}`, "NETWORK");
      }
      if (res.ok) return res;
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      if (transient && canFallBack) return this.post(body, delays.slice(0, 1), this.fallbackModel!);
      if (res.status === 429) throw new AiError("Gemini rate limit reached. Try again later.", "RATE_LIMITED");
      if (res.status === 503) throw new AiError("Gemini is overloaded right now (HTTP 503). Please try again in a few minutes.", "HTTP");
      const text = await res.text().catch(() => "");
      // Never echo request headers (which hold the key); the response body does not contain it.
      throw new AiError(`Gemini returned HTTP ${res.status}: ${text.slice(0, 300)}`, "HTTP");
    }
  }

  async generateJson<T>({ system, prompt, schema, maxOutputTokens = 4096 }: { system: string; prompt: string; schema: z.ZodType<T>; maxOutputTokens?: number }) {
    const jsonSchema = z.toJSONSchema(schema);
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.post({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: `${prompt}

Return only JSON matching this JSON Schema:
${JSON.stringify(jsonSchema)}${lastError ? `

Your previous answer was invalid: ${lastError}` : ""}` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens },
      });
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      try {
        return schema.parse(JSON.parse(text));
      } catch (e) {
        lastError = e instanceof z.ZodError ? e.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "Response was not valid JSON";
      }
    }
    throw new AiError(`AI output failed validation: ${lastError}`, "INVALID_OUTPUT");
  }
}

/** "gemini-flash-latest" follows Google's current Flash model, so retired model names never break audits. */
export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
/** Lighter model used when the main one is overloaded; GEMINI_FALLBACK_MODEL="" turns it off. */
export const geminiFallbackModel = () => (process.env.GEMINI_FALLBACK_MODEL ?? "gemini-flash-lite-latest").trim() || null;

/** Returns a provider for the given key (workspace key or GEMINI_API_KEY), or null when there is none. */
export function getAiProvider(apiKey: string | null = process.env.GEMINI_API_KEY?.trim() || null): AiProvider | null {
  const key = apiKey;
  if (key) return new GeminiProvider(key, geminiModel(), geminiFallbackModel());
  return null;
}
