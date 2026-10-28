import { launchChromium } from "./browser";
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
  /** Draws the proposed improvements on the page (illustrative "after" mockup), each with a green tag. */
  mockup?: { headline?: string; phone?: string | null; whatsapp?: string | null; rating?: { value: number; count: number } | null };
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

// Runs inside the screenshot browser only. Every change is tagged in green so it reads as a proposal, not a fact.
const MOCKUP_SCRIPT = `(m) => {
  const tag = (text) => {
    const t = document.createElement("span");
    t.textContent = "\u2713 " + text;
    t.setAttribute("style", "display:inline-block;margin:6px 0 0;background:#16a34a;color:#fff;font:700 12px/1 Arial,sans-serif;padding:5px 8px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.25);letter-spacing:.2px");
    return t;
  };
  const top = document.createElement("div");
  top.textContent = "Illustrative \u2014 how we would improve this page";
  top.setAttribute("style", "position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#15803d;color:#fff;font:600 15px/1.35 Arial,sans-serif;padding:10px 14px;box-shadow:0 2px 10px rgba(0,0,0,.35)");
  document.body.appendChild(top);
  if (m.headline) {
    // The heading a visitor actually sees first: the largest visible heading in the first screen
    // (sliders often hide the real H1), falling back to the H1, or a new one at the top.
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!(r.width > 40 && r.height > 10 && r.top < innerHeight && r.bottom > 0 && cs.visibility !== "hidden" && cs.display !== "none")) return false;
      // Sliders stack their slides: only the heading actually on top at its own position counts.
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 30), 1), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };
    const candidates = Array.from(document.querySelectorAll("h1, h2, h3, [class*=title], [class*=heading]")).filter((el) => visible(el) && el.textContent.trim().length > 3 && el.children.length < 6);
    candidates.sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize));
    let h = candidates[0] || document.querySelector("h1");
    if (!h) {
      h = document.createElement("h1");
      const host = document.querySelector("main") || document.body;
      host.insertBefore(h, host.firstChild);
    }
    h.textContent = m.headline;
    h.setAttribute("style", (h.getAttribute("style") || "") + ";outline:4px solid #22c55e;outline-offset:4px;background:rgba(255,255,255,.94);color:#0f172a;padding:10px 14px;border-radius:10px;font:800 34px/1.15 Arial,sans-serif;max-width:720px;position:relative;z-index:2147483000;text-transform:none;letter-spacing:0");
    h.after(tag("Clear headline: service + area"));
    if (h.getBoundingClientRect().top > innerHeight - 120 || h.getBoundingClientRect().top < 60) {
      h.scrollIntoView({ block: "center" });
      window.scrollBy(0, -40);
    }
  }
  const dock = document.createElement("div");
  dock.setAttribute("style", "position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px");
  if (m.rating) {
    const r = document.createElement("div");
    r.textContent = "\u2605 " + m.rating.value.toFixed(1) + "  \u00b7  " + m.rating.count + " Google reviews";
    r.setAttribute("style", "background:#fff;color:#0f172a;font:700 14px/1 Arial,sans-serif;padding:10px 14px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);outline:3px solid #22c55e");
    dock.appendChild(r);
    dock.appendChild(tag("Trust badge"));
  }
  if (m.phone || m.whatsapp) {
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:8px");
    const btn = (label, bg) => {
      const b = document.createElement("span");
      b.textContent = label;
      b.setAttribute("style", "background:" + bg + ";color:#fff;font:800 15px/1 Arial,sans-serif;padding:13px 18px;border-radius:999px;box-shadow:0 8px 22px rgba(0,0,0,.3)");
      return b;
    };
    if (m.phone) row.appendChild(btn("\u260E Call now", "#2563eb"));
    if (m.whatsapp) row.appendChild(btn("WhatsApp us", "#25D366"));
    dock.appendChild(row);
    dock.appendChild(tag("One-tap call & WhatsApp"));
  }
  document.body.appendChild(dock);
}`;

export async function captureScreenshots(targets: ShotTarget[], guard: GuardOptions = {}, timeoutMs = 25_000): Promise<(Buffer | null)[]> {
  if (!targets.length) return [];
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return targets.map(() => null);
  }
  const browser = await launchChromium(chromium, { headless: true, args: ["--disable-dev-shm-usage", "--no-first-run"] });
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
          if (t.mockup) await page.evaluate(`(${MOCKUP_SCRIPT})(${JSON.stringify(t.mockup)})`).catch((e) => process.env.DEBUG_SHOTS && console.error("mockup failed", e));
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
