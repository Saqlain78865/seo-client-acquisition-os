// Manual visual check of an audit report: node e2e/screenshot-audit.mjs <outDir> <url>  (app on :3100, e2e.db owner)
import { chromium } from "@playwright/test";

const [out = ".", site = "python.org"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/login");
await page.getByLabel("Email").fill("owner@e2e.example");
await page.getByLabel("Password").fill("E2eOwnerPass123");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("http://localhost:3100/");
await page.goto("http://localhost:3100/audits/new");
await page.getByLabel("Website URL").fill(site);
await page.getByRole("button", { name: "Start audit" }).click();
await page.waitForURL(/\/audits\/[a-z0-9]+$/);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/audit-progress.png` });
await page.getByRole("heading", { name: "Executive summary" }).waitFor({ timeout: 180_000 });
await page.locator("details").first().locator("summary").click();
await page.screenshot({ path: `${out}/audit-report.png`, fullPage: true });
await browser.close();
