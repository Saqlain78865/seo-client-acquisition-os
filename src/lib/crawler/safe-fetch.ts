import { Agent, fetch as undiciFetch } from "undici";
import { assertUrlShape, BlockedUrlError, guardedLookup, type GuardOptions } from "./network-guard";

export const CRAWLER_USER_AGENT =
  "Mozilla/5.0 (compatible; SEOClientAcquisitionOS/1.0; website audit requested by an SEO consultant)";
/** Token matched against robots.txt user-agent groups. */
export const ROBOTS_USER_AGENT = "SEOClientAcquisitionOS";

export type FetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  /** Each hop as [url, status]; the last entry is the final response. */
  redirectChain: { url: string; status: number }[];
  body: string;
  bytes: number;
  truncated: boolean;
  contentType: string;
  /** Time to response headers for the final hop, measured from this server. */
  responseTimeMs: number;
};

export type SafeFetchOptions = GuardOptions & {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD";
  /** Read the body only when the content type matches; other bodies are discarded unread. */
  acceptBody?: (contentType: string) => boolean;
  /** Extra attempts after a dropped or timed-out connection (not after an HTTP error status). Default 2. */
  retries?: number;
};

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean) {
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent({
      // Generous socket limits: the per-request timeout below decides when to give up (slow sites can take 10–30 s).
      connect: { lookup: guardedLookup({ allowPrivateNetworks: allowPrivate }), timeout: 20_000 },
      connections: 4,
      headersTimeout: 60_000,
      bodyTimeout: 60_000,
    });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

async function readLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) return { text: "", bytes: 0, truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (bytes - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes: Math.min(bytes, maxBytes), truncated };
}

// Connection-level failures that usually pass on a second try: busy shared hosting, a reset
// keep-alive socket, a slow TLS handshake. HTTP error statuses are real answers and never retried.
const TRANSIENT_CODES = new Set(["TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_CLOSED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"]);
export const isTransient = (e: unknown) =>
  e instanceof FetchError && (TRANSIENT_CODES.has(e.code) || /other side closed|socket hang up|Connect Timeout/i.test(e.message));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches a public URL with SSRF protection, manual redirect handling (every hop is
 * re-validated), a timeout, a response-size cap, and a couple of retries with back-off when the
 * connection itself fails.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const retries = options.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await safeFetchOnce(rawUrl, options);
    } catch (e) {
      if (attempt >= retries || !isTransient(e)) throw e;
      await wait(1500 * 2 ** attempt);
    }
  }
}

async function safeFetchOnce(rawUrl: string, options: SafeFetchOptions): Promise<FetchResult> {
  const { timeoutMs = 30_000, maxBytes = 3 * 1024 * 1024, maxRedirects = 5, method = "GET", allowPrivateNetworks = false } = options;
  const acceptBody = options.acceptBody ?? (() => true);
  const chain: { url: string; status: number }[] = [];
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = assertUrlShape(current, { allowPrivateNetworks });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const res = await undiciFetch(url, {
        method,
        redirect: "manual",
        signal: controller.signal,
        dispatcher: agentFor(allowPrivateNetworks),
        headers: {
          "user-agent": CRAWLER_USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
      });
      const responseTimeMs = Math.round(performance.now() - started);
      chain.push({ url: url.toString(), status: res.status });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        current = new URL(res.headers.get("location")!, url).toString();
        continue;
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const contentType = headers["content-type"] ?? "";
      let read = { text: "", bytes: 0, truncated: false };
      if (method === "GET" && acceptBody(contentType)) {
        read = await readLimited(res.body as ReadableStream<Uint8Array> | null, maxBytes);
      } else {
        await res.body?.cancel();
      }
      return {
        requestedUrl: rawUrl,
        finalUrl: url.toString(),
        status: res.status,
        headers,
        redirectChain: chain,
        body: read.text,
        bytes: read.bytes || Number(headers["content-length"] ?? 0),
        truncated: read.truncated,
        contentType,
        responseTimeMs,
      };
    } catch (e) {
      if (e instanceof BlockedUrlError) throw e;
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      if (cause?.code === "EBLOCKED") throw new BlockedUrlError(cause.message ?? "Blocked address", url.toString());
      if (controller.signal.aborted) throw new FetchError(`Timed out after ${timeoutMs / 1000}s`, url.toString(), "TIMEOUT");
      throw new FetchError(cause?.message ?? (e as Error).message, url.toString(), cause?.code ?? "NETWORK");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new FetchError(`More than ${maxRedirects} redirects`, current, "TOO_MANY_REDIRECTS");
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export const isHtml = (contentType: string) => /text\/html|application\/xhtml\+xml/i.test(contentType);
export const isXmlOrText = (contentType: string) => /xml|text\/plain/i.test(contentType) || contentType === "";
