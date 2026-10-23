/**
 * Structured logging: one JSON object per line on stdout/stderr, so any log collector (Docker,
 * systemd journal, Vercel, Render…) can search by level, scope or requestId. Values whose key looks
 * like a secret are replaced, and secret-shaped strings are masked inside messages, so credentials
 * never reach the logs even when an error message happens to contain one.
 */

type Level = "debug" | "info" | "warn" | "error";
type Context = Record<string, unknown>;

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|refresh/i;
const SECRET_VALUES: [RegExp, string][] = [
  [/AIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]"],
  [/ya29\.[0-9A-Za-z._-]+/g, "ya29.[redacted]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/([?&](?:key|token|access_token|code)=)[^&\s"']+/gi, "$1[redacted]"],
];

export function maskSecrets(s: string) {
  return SECRET_VALUES.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

function clean(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const out: Context = { name: value.name, message: maskSecrets(value.message) };
    if (value.stack) out.stack = maskSecrets(value.stack.split("\n").slice(0, 8).join("\n"));
    if (value.cause) out.cause = clean(value.cause, depth + 1);
    return out;
  }
  if (typeof value === "string") return maskSecrets(value.length > 4000 ? value.slice(0, 4000) + "…" : value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clean(v, depth + 1));
  const out: Context = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : clean(v, depth + 1);
  return out;
}

const MIN_LEVEL: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = () => MIN_LEVEL[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function write(level: Level, scope: string, msg: string, ctx?: Context) {
  if (MIN_LEVEL[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, msg: maskSecrets(msg), ...(ctx ? (clean(ctx) as Context) : {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logger(scope: string, base?: Context) {
  return {
    debug: (msg: string, ctx?: Context) => write("debug", scope, msg, { ...base, ...ctx }),
    info: (msg: string, ctx?: Context) => write("info", scope, msg, { ...base, ...ctx }),
    warn: (msg: string, ctx?: Context) => write("warn", scope, msg, { ...base, ...ctx }),
    error: (msg: string, ctx?: Context) => write("error", scope, msg, { ...base, ...ctx }),
  };
}

export const REQUEST_ID_HEADER = "x-request-id";

/** The id the proxy attached to this request, or undefined outside a request (jobs, scripts, tests). */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Logs an unexpected error with the request id and returns that id, so the message shown to the
 * user can include "Reference: …" and the matching log line can be found.
 */
export async function reportError(scope: string, error: unknown, ctx?: Context) {
  const requestId = await currentRequestId();
  write("error", scope, error instanceof Error ? error.message : "Unexpected error", { requestId, err: error, ...ctx });
  return requestId;
}

/** "Please try again." plus a short reference the user can quote when asking for help. */
export function withReference(message: string, requestId: string | undefined) {
  return requestId ? `${message} (Reference: ${requestId.slice(0, 8)})` : message;
}
