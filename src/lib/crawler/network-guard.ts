import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";

/**
 * SSRF protection. Every hostname the crawler connects to is resolved here and the
 * connection is made to the *validated* address, so DNS rebinding cannot swap in an
 * internal IP between the check and the connect.
 */

export class BlockedUrlError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

export type GuardOptions = {
  /** Test-only escape hatch so the crawler can be exercised against a local fixture server. */
  allowPrivateNetworks?: boolean;
};

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^metadata\.google\.internal$/i];

/** Only globally routable unicast addresses are allowed. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  // "unicast" is ipaddr's label for addresses outside every special-purpose range
  // (private, loopback, link-local incl. 169.254.169.254 metadata, CGNAT, multicast, reserved, ULA, …).
  return ip.range() === "unicast";
}

/** Static checks that need no network access: protocol, credentials, port, hostname. */
export function assertUrlShape(raw: string, options: GuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("Invalid URL", raw);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("Only http and https URLs are allowed", raw);
  if (url.username || url.password) throw new BlockedUrlError("URLs with embedded credentials are not allowed", raw);
  if (options.allowPrivateNetworks) return url;
  if (!ALLOWED_PORTS.has(url.port)) throw new BlockedUrlError(`Port ${url.port} is not allowed`, raw);
  // "localhost." (trailing dot) is the same host as "localhost".
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) throw new BlockedUrlError("Internal hostnames are not allowed", raw);
  if (net.isIP(host) && !isPublicAddress(host)) throw new BlockedUrlError("Private or reserved IP addresses are not allowed", raw);
  // WHATWG URL parsing already normalises decimal/octal/hex IPv4 forms ("2130706433" → 127.0.0.1).
  return url;
}

/** A `dns.lookup`-compatible function that refuses to return non-public addresses. */
export function guardedLookup(options: GuardOptions = {}) {
  return function lookup(
    hostname: string,
    opts: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ) {
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      const allowed = options.allowPrivateNetworks ? list : list.filter((a) => isPublicAddress(a.address));
      if (allowed.length === 0) {
        const e = new BlockedUrlError(`${hostname} resolves only to private or reserved addresses`, hostname) as Error & { code?: string };
        e.code = "EBLOCKED";
        return callback(e, "", 0);
      }
      if (opts.all) return callback(null, allowed);
      callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

/** Resolves a hostname up front, for clear error messages before the crawl starts. */
export async function assertPublicHost(hostname: string, options: GuardOptions = {}) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!options.allowPrivateNetworks && !isPublicAddress(host)) throw new BlockedUrlError("Private or reserved IP addresses are not allowed", host);
    return [host];
  }
  const addresses = await dns.promises.lookup(host, { all: true });
  const ok = options.allowPrivateNetworks ? addresses : addresses.filter((a) => isPublicAddress(a.address));
  if (ok.length === 0) throw new BlockedUrlError(`${host} resolves only to private or reserved addresses`, host);
  return ok.map((a) => a.address);
}
