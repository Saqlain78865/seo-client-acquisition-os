import { assertPublicHost, assertUrlShape, type GuardOptions } from "./network-guard";
import { CRAWLER_USER_AGENT } from "./safe-fetch";

/**
 * Screenshots of public pages for the audit report and proposal. Same isolation as page rendering
 * (fresh context, no downloads, every request checked against the SSRF rules), but images and fonts
 * load so the page looks as a visitor sees it. A finding can be marked on the page: matching
 * elements get a red outline and a red banner names the issue.
 */

export type ShotTarget = {
  url: string;
  device: "desktop" | "mobile";
  /** Red banner text shown at the top of the screenshot. */
  label?: string;
  /** CSS selector of elements to outline (e.g. images without alt text). */
  highlight?: string;
};

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
} as const;

// Runs inside the screenshot browser only (never in the app). Plain strings, so no bundler helpers leak in.
const MARK_SCRIPT = `([label, selector]) => {
  let first = null;
  if (selector) {
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 40)) {
      el.style.setProperty("outline", "4px solid #ef4444", "important");
      el.style.setProperty("outline-offset", "2px", "important");
      if (!first) first = el;
    }
  }
  if (first) first.scrollIntoView({ block: "center" });
  if (label) {
    const bar = document.createElement("div");
    bar.textContent = "\\u26A0  " + label;
    bar.setAttribute("style", "position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#dc2626;color:#fff;font:600 15px/1.35 Arial,sans-serif;padding:10px 14px;box-shadow:0 2px 10px rgba(0,0,0,.35)");
    document.body.appendChild(bar);
  }
}`;

export async function captureScreenshots(targets: ShotTarget[], guard: GuardOptions = {}, timeoutMs = 25_000): Promise<(Buffer | null)[]> {
  if (!targets.length) return [];
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return targets.map(() => null);
  }
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-first-run"] });
  const hostChecks = new Map<string, Promise<boolean>>();
  const allowed = (url: string) => {
    try {
      const u = assertUrlShape(url, guard);
      let ok = hostChecks.get(u.hostname);
      if (!ok) {
        ok = assertPublicHost(u.hostname, guard).then(
          () => true,
          () => false,
        );
        hostChecks.set(u.hostname, ok);
      }
      return ok;
    } catch {
      return Promise.resolve(false);
    }
  };
  const out: (Buffer | null)[] = [];
  try {
    for (const t of targets) {
      try {
        if (!(await allowed(t.url))) {
          out.push(null);
          continue;
        }
        const context = await browser.newContext({ ...DEVICES[t.device], userAgent: CRAWLER_USER_AGENT, acceptDownloads: false, serviceWorkers: "block" });
        try {
          await context.route("**/*", async (route) => {
            const u = route.request().url();
            if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
            return (await allowed(u)) ? route.continue() : route.abort("blockedbyclient");
          });
          const page = await context.newPage();
          await page.goto(t.url, { waitUntil: "load", timeout: timeoutMs }).catch(() => page.waitForLoadState("domcontentloaded", { timeout: 5_000 }));
          await page.waitForTimeout(1200);
          if (t.label || t.highlight) await page.evaluate(`(${MARK_SCRIPT})(${JSON.stringify([t.label ?? "", t.highlight ?? ""])})`).catch(() => undefined);
          out.push(await page.screenshot({ type: "jpeg", quality: 62, fullPage: false, timeout: 15_000 }));
        } finally {
          await context.close();
        }
      } catch {
        out.push(null);
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}
