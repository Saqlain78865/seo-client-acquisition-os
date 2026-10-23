// Manual visual check: node e2e/screenshots.mjs <outDir>  (expects the app on :3100 with the demo seed)
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/login");
await page.screenshot({ path: `${out}/login.png` });
await page.getByLabel("Email").fill("demo@seo-os.example");
await page.getByLabel("Password").fill("DemoWorkspace2026");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("http://localhost:3100/");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/dashboard.png`, fullPage: true });
await page.goto("http://localhost:3100/prospects");
await page.screenshot({ path: `${out}/prospects.png`, fullPage: true });
await page.getByRole("link", { name: "Bright Smile Dental (demo)" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/prospect.png`, fullPage: true });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.context().addCookies(await page.context().cookies());
await mobile.goto("http://localhost:3100/");
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${out}/dashboard-mobile.png` });
await browser.close();
