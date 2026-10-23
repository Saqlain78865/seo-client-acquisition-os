import { expect, test, type Page } from "@playwright/test";

// Runs after phase2-audit.spec.ts, which leaves a completed audit of example.com.
const OWNER = { email: "owner@e2e.example", password: "E2eOwnerPass123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
}

test.describe.serial("Phase 3 proposal journey", () => {
  test("company settings, with no pricing packages", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByLabel("Company / agency name").fill("Nova SEO Studio");
    await page.getByLabel("Consultant name").fill("Saqlain");
    await page.getByLabel("Business email").fill("hello@nova-seo.example");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();

    // Pricing is agreed at the deal stage, so there are no pricing packages here.
    await expect(page.getByText("Pricing packages")).toHaveCount(0);
  });

  test("create, edit, version and export a proposal", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/audits");
    await page.getByRole("link", { name: "example.com" }).first().click();
    await page.getByRole("button", { name: "Create proposal" }).click();
    await expect(page.getByRole("heading", { name: "Edit proposal" })).toBeVisible();

    // The details tab has the document settings only: no pricing.
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
    await expect(page.getByLabel("Monthly fee")).toHaveCount(0);
    await page.getByLabel("Proposal title").fill("SEO proposal for example.com");

    // Edit a section, hide another, add a custom finding.
    await page.getByRole("tab", { name: "Sections" }).click();
    await page.getByLabel("Executive summary text").fill("We reviewed example.com and found clear, fixable issues.");
    await page.getByRole("button", { name: "Hide section: Why work with us" }).click();
    await page.getByRole("button", { name: "Add custom finding" }).first().click();
    const newFinding = page.locator("details", { hasText: "New finding" }).first();
    await newFinding.locator("summary").click();
    await newFinding.getByLabel("What was observed").fill("Opening hours are not shown on the contact page.");
    await newFinding.getByLabel("Title", { exact: true }).fill("Contact page has no opening hours");

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();
    await expect(page).toHaveURL(/\/proposals\/[a-z0-9]+\?v=1$/);

    // The preview is the real document.
    const preview = page.frameLocator('iframe[title="Proposal preview"]');
    await expect(preview.getByText("We reviewed example.com and found clear, fixable issues.")).toBeVisible();
    await expect(preview.getByText("Contact page has no opening hours")).toBeVisible();
    await expect(preview.getByRole("heading", { name: /Investment/ })).toHaveCount(0);
    await expect(preview.getByText("Nova SEO Studio").first()).toBeVisible();
    await expect(preview.getByRole("heading", { name: /Why work with us/ })).toHaveCount(0);

    // Real PDF.
    await page.getByRole("button", { name: "Generate PDF" }).click();
    await expect(page.getByText(/PDF generated \(\d+ KB\)/)).toBeVisible({ timeout: 60_000 });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^SEO-Proposal-.+-v1\.pdf$/);
    const res = await page.request.get(page.url().replace(/\/proposals\/([a-z0-9]+).*/, "/api/proposals/$1/pdf?v=1"));
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // Mark ready, then save a new version and keep v1.
    await page.getByRole("button", { name: "Mark ready to send" }).click();
    await expect(page.getByText("Ready to send").first()).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Proposal title").fill("Updated SEO proposal for example.com");
    await page.getByLabel("Change note (optional)").fill("Updated the title");
    await page.getByRole("button", { name: "Save as version 2" }).click();
    await expect(page.getByText("Saved as version 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Version 1" })).toBeVisible();
    await expect(page.getByText("Updated the title")).toBeVisible();
    await page.getByRole("link", { name: "Version 1" }).click();
    await expect(page.frameLocator('iframe[title="Proposal preview"]').getByText("SEO proposal for example.com", { exact: true }).first()).toBeVisible();

    // Prospect history records the proposal work.
    await page.goto("/proposals");
    await expect(page.getByText("v2").first()).toBeVisible();
  });

  test("other users cannot fetch a proposal PDF without a session", async ({ request }) => {
    const res = await request.get("/api/proposals/anything/pdf");
    expect(res.status()).toBe(401);
  });
});
