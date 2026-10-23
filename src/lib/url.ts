/** Lowercased hostname without a leading "www.", used to detect duplicate prospects. */
export function normalizeDomain(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const host = new URL(withProtocol).hostname.toLowerCase().replace(/\.$/, "");
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Canonical form of a user-entered website URL: https by default, no fragment, no trailing slash on the root. */
export function normalizeWebsiteUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const u = new URL(withProtocol);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  const s = u.toString();
  return u.pathname === "/" && !u.search ? s.replace(/\/$/, "") : s;
}
