import { expect, test } from "@playwright/test";

// Runs after crm.spec.ts (files run alphabetically), which creates this owner account.
// Uses https://example.com (IANA-reserved, stable) so the real crawler runs against the real internet.
const OWNER = { email: "owner@e2e.example", password: "E2eOwnerPass123" };

test.describe.serial("Phase 2 audit journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  });

  test("private and invalid URLs are rejected before anything is crawled", async ({ page }) => {
    await page.goto("/audits/new");
    await page.getByLabel("Website URL").fill("http://127.0.0.1:3100/");
    await page.getByRole("button", { name: "Start audit" }).click();
    await expect(page.getByText(/cannot be audited/)).toBeVisible();

    await page.getByLabel("Website URL").fill("not a url");
    await page.getByRole("button", { name: "Start audit" }).click();
    await expect(page.getByText("Enter a valid http(s) website URL")).toBeVisible();
  });

  test("audit a real website and review evidence-backed findings", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/audits/new");
    await page.getByLabel("Website URL").fill("example.com");
    await page.getByLabel("Target city or region").fill("Lahore");
    // The manual journey: the proposal is created by hand in the Phase 3 spec.
    await page.getByLabel(/Prepare the proposal automatically/).uncheck();
    await page.getByRole("button", { name: "Start audit" }).click();

    await expect(page).toHaveURL(/\/audits\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "Audit: example.com" })).toBeVisible();
    await expect(page.getByText("Page crawling")).toBeVisible();

    // Progress refreshes by itself; wait for the report.
    await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Source: Rule-based")).toBeVisible();
    await expect(page.getByText(/Rankings, organic traffic, index coverage and backlinks were not measured/)).toBeVisible();

    // Findings carry evidence and honest labels.
    const access = page.locator("details", { hasText: "Indexing, rankings and organic traffic not yet verified" });
    await expect(access).toBeVisible();
    const city = page.locator("details", { hasText: 'The target area "Lahore" is not mentioned on the site' });
    await city.locator("summary").click();
    await expect(city.getByText("Case-insensitive search of visible page text")).toBeVisible();
    await expect(city.getByText("Confirmed")).toBeVisible();

    // Reviewer can exclude a finding from the proposal.
    await city.getByRole("button", { name: "Exclude from proposal" }).click();
    await expect(page.locator("details", { hasText: 'The target area "Lahore"' }).getByText("not in proposal")).toBeVisible();

    // Crawled pages are listed with status and type.
    await page.getByRole("tab", { name: /Crawled pages/ }).click();
    await expect(page.getByRole("cell", { name: "/" }).first()).toBeVisible();
    await expect(page.getByText("Homepage").first()).toBeVisible();

    // The prospect was created and its history shows the audit.
    await page.goto("/prospects?q=example.com");
    await page.getByRole("link", { name: /example/i }).first().click();
    await expect(page.getByText("Audit Completed").first()).toBeVisible();
    await expect(page.getByText(/Website audit (completed|started)/).first()).toBeVisible();

    await page.goto("/audits");
    await expect(page.getByRole("link", { name: "example.com" })).toBeVisible();
  });
});
