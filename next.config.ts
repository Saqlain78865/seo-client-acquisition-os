import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Scripts are limited to this origin. 'unsafe-inline' is still needed for the theme bootstrap and Next.js
// streaming payloads; everything else (frames, forms, plugins, base URL, connections) is locked down.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore HSTS on plain HTTP, so this only takes effect once the site is served over HTTPS.
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  // SAMEORIGIN (not DENY) so the proposal preview can be shown in an in-app iframe.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The app is almost entirely per-user, database-backed data, so we use classic
  // request-time rendering instead of Cache Components.
  poweredByHeader: false,
  // Logo uploads are capped at 1 MB in the action; leave room for multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "1.2mb" } },
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "playwright", "playwright-core"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
