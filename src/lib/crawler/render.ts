import { launchChromium } from "./browser";
import { assertPublicHost, assertUrlShape, type GuardOptions } from "./network-guard";
import { CRAWLER_USER_AGENT } from "./safe-fetch";

/**
 * Renders a JavaScript-heavy page in an isolated headless browser. Used selectively — only for
 * pages whose raw HTML has almost no text but looks like a client-side app.
 *
 * Isolation: fresh context per page (no cookies, storage or credentials), no downloads, service
 * workers blocked, and every request the page makes is checked against the same SSRF rules as the
 * crawler; images, media and fonts are not loaded at all.
 */
export async function renderPage(url: string, guard: GuardOptions, timeoutMs = 20_000): Promise<{ html: string; finalUrl: string } | null> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null; // browser rendering not installed — caller records the page as not rendered
  }
  const browser = await launchChromium(chromium, { headless: true, args: ["--disable-dev-shm-usage", "--no-first-run"] });
  try {
    const context = await browser.newContext({
      userAgent: CRAWLER_USER_AGENT,
      acceptDownloads: false,
      serviceWorkers: "block",
      javaScriptEnabled: true,
      viewport: { width: 1366, height: 900 },
    });
    const hostChecks = new Map<string, Promise<boolean>>();
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (["image", "media", "font"].includes(req.resourceType())) return route.abort();
      try {
        const u = assertUrlShape(req.url(), guard);
        let ok = hostChecks.get(u.hostname);
        if (!ok) {
          ok = assertPublicHost(u.hostname, guard).then(
            () => true,
            () => false,
          );
          hostChecks.set(u.hostname, ok);
        }
        return (await ok) ? route.continue() : route.abort("blockedbyclient");
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs }).catch(() => page.waitForLoadState("domcontentloaded"));
    const html = await page.content();
    const finalUrl = page.url();
    await context.close();
    return { html, finalUrl };
  } finally {
    await browser.close();
  }
}
