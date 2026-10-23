import "server-only";
import { fileModifiedAt, getFile, putFile } from "../storage";

/**
 * Tranco (tranco-list.eu) is a free research ranking of the top 1 million websites, combined from
 * several traffic and DNS sources and published daily under a permissive licence. It answers "how
 * popular is this site worldwide?" — not traffic numbers. The list is downloaded at most once a
 * week (22 MB CSV) and searched in memory.
 */

const CACHE_KEY = "cache/tranco-top-1m.csv";
const MAX_AGE_MS = 7 * 86_400_000;

type Loaded = { buffer: Buffer; listId: string | null; downloadedAt: Date };
let loaded: Promise<Loaded> | null = null;

async function download(fetchImpl: typeof fetch): Promise<Loaded> {
  const id = (await (await fetchImpl("https://tranco-list.eu/top-1m-id", { signal: AbortSignal.timeout(20_000) })).text()).trim();
  if (!/^[A-Z0-9]{3,10}$/.test(id)) throw new Error("Tranco did not return a list id");
  const res = await fetchImpl(`https://tranco-list.eu/download/${id}/1000000`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Tranco download failed (HTTP ${res.status})`);
  // The list uses CRLF line endings; they are normalised to LF so lookups need only one form.
  const body = Buffer.from(Buffer.from(await res.arrayBuffer()).toString("latin1").replace(/\r/g, ""), "latin1");
  // A header line with the list id, and a final newline so the last domain is found like the others.
  const buffer = Buffer.concat([Buffer.from(`#${id}\n`), body, Buffer.from(body.at(-1) === 10 ? "" : "\n")]);
  await putFile(CACHE_KEY, buffer);
  return { buffer, listId: id, downloadedAt: new Date() };
}

async function load(fetchImpl: typeof fetch): Promise<Loaded> {
  const modified = await fileModifiedAt(CACHE_KEY);
  if (modified !== null && Date.now() - modified < MAX_AGE_MS) {
    const buffer = await getFile(CACHE_KEY);
    const header = buffer.subarray(0, 16).toString().match(/^#([A-Z0-9]+)\n/);
    // A cache written before line endings were normalised is downloaded again.
    if (header && buffer.indexOf("\r") < 0) return { buffer, listId: header[1], downloadedAt: new Date(modified) };
  }
  return download(fetchImpl);
}

export type TrancoResult = { rank: number | null; listId: string | null; listDate: string };

/** Rank of the domain (with or without "www."), or null when it is outside the top 1M. */
export async function trancoRank(domain: string, fetchImpl: typeof fetch = fetch): Promise<TrancoResult> {
  loaded ??= load(fetchImpl).catch((e) => {
    loaded = null;
    throw e;
  });
  const { buffer, listId, downloadedAt } = await loaded;
  if (Date.now() - downloadedAt.getTime() > MAX_AGE_MS) loaded = null; // refresh on the next lookup
  const bare = domain.toLowerCase().replace(/^www\./, "");
  for (const candidate of [bare, `www.${bare}`]) {
    const at = buffer.indexOf(`,${candidate}\n`);
    if (at < 0) continue;
    const lineStart = buffer.lastIndexOf("\n", at) + 1;
    const rank = Number(buffer.subarray(lineStart, at).toString());
    if (Number.isInteger(rank)) return { rank, listId, listDate: downloadedAt.toISOString().slice(0, 10) };
  }
  return { rank: null, listId, listDate: downloadedAt.toISOString().slice(0, 10) };
}
