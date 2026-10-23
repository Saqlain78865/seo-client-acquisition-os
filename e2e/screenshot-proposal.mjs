// Manual visual check of the proposal pages: node e2e/screenshot-proposal.mjs <outDir>  (app on :3100 with e2e.db after the e2e run)
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/login");
await page.getByLabel("Email").fill("owner@e2e.example");
await page.getByLabel("Password").fill("E2eOwnerPass123");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("http://localhost:3100/");
await page.goto("http://localhost:3100/proposals");
await page.locator("tbody a").first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/proposal-overview.png` });
await page.getByRole("link", { name: /Edit/ }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/proposal-editor.png` });
await page.getByRole("tab", { name: "Sections" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/proposal-sections.png` });
await browser.close();
