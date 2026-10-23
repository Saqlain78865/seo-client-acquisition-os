import type { Browser, LaunchOptions, chromium as Chromium } from "playwright";

/**
 * Starts headless Chromium. When BROWSER_CHANNEL is set (the desktop app sets "msedge", which every
 * Windows 10/11 PC has), the installed browser is used first; Playwright's own download is the fallback.
 */
export async function launchChromium(chromium: typeof Chromium, options: LaunchOptions = {}): Promise<Browser> {
  const channel = process.env.BROWSER_CHANNEL?.trim();
  if (channel) {
    try {
      return await chromium.launch({ ...options, channel });
    } catch (e) {
      // Fall through to Playwright's bundled browser if it is installed.
      try {
        return await chromium.launch(options);
      } catch {
        throw e;
      }
    }
  }
  return chromium.launch(options);
}
