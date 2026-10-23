import { expect, test, type Page } from "@playwright/test";

// Runs after phase2/phase3 specs, which leave an audited example.com prospect.
const OWNER = { email: "owner@e2e.example", password: "E2eOwnerPass123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible({ timeout: 20_000 });
}

async function openResearch(page: Page) {
  await page.goto("/prospects?q=example.com");
  await page.getByRole("link", { name: /example/i }).first().click();
  await page.getByRole("link", { name: "Research" }).click();
  await expect(page.getByRole("heading", { name: "Research" })).toBeVisible();
}

const KEYWORDS_CSV = `Keyword,KD,Volume,CPC,Position,URL
example domain,3,2400,0.50,1,https://example.com/
illustrative example website,8,90,0.20,,
example domain documentation,4,140,,12,`;

const GSC_CSV = `Top queries,Clicks,Impressions,CTR,Position
example domain,310,9800,3.16%,1.4
example domain documentation,12,1500,0.8%,9.2`;

test.describe.serial("Phase 4 research journey", () => {
  test("keywords: manual entry, CSV import with provenance, clustering", async ({ page }) => {
    await login(page);
    await openResearch(page);

    await page.getByLabel("Keywords to add").fill("example domain\nreserved domain names");
    await page.getByRole("button", { name: "Add keywords" }).click();
    await expect(page.getByText("2 keywords added")).toBeVisible();
    await expect(page.getByText("No search volumes yet")).toBeVisible();

    await page.getByRole("tab", { name: "Imports" }).click();
    await page.getByLabel("CSV export").setInputFiles({ name: "ahrefs-keywords.csv", mimeType: "text/csv", buffer: Buffer.from(KEYWORDS_CSV) });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Imported 3 rows from Ahrefs")).toBeVisible();
    await expect(page.getByText("ahrefs-keywords.csv")).toBeVisible();
    await expect(page.getByText("estimates").first()).toBeVisible();

    await page.getByLabel("CSV export").setInputFiles({ name: "Queries.csv", mimeType: "text/csv", buffer: Buffer.from(GSC_CSV) });
    await page.getByLabel("Date range (Search Console)").fill("Last 3 months");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Imported 2 rows from Google Search Console")).toBeVisible();
    await expect(page.getByText("measured").first()).toBeVisible();

    await page.getByRole("tab", { name: "Keywords" }).click();
    await expect(page.getByRole("cell", { name: /^example domain\b/ }).first()).toBeVisible();
    await expect(page.getByText("2,400")).toBeVisible();
    await expect(page.getByText("est.").first()).toBeVisible();
    await expect(page.getByText(/Ahrefs export \(ahrefs-keywords\.csv\)/).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^reserved domain names/ })).toBeVisible();

    await page.getByRole("tab", { name: "Search Console" }).click();
    await expect(page.getByText("Measured by Google")).toBeVisible();
    await expect(page.getByRole("cell", { name: "9,800" })).toBeVisible();

    await page.getByRole("tab", { name: "Backlinks" }).click();
    await expect(page.getByText("No backlink data")).toBeVisible();
  });

  test("competitors: add and observe a real public site", async ({ page }) => {
    test.setTimeout(200_000);
    await login(page);
    await openResearch(page);
    await page.getByRole("tab", { name: "Competitors" }).click();
    await page.getByLabel("Competitor website").fill("iana.org");
    await page.getByRole("button", { name: "Add competitor" }).click();
    await expect(page.getByText(/iana\.org added/)).toBeVisible();
    await page.getByRole("button", { name: "Observe site" }).click();
    await expect(page.getByText(/\d+ public pages observed/)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText("Pages observed", { exact: true })).toBeVisible();
    await expect(page.getByText(/Public website crawl/)).toBeVisible();
  });

  test("domain overview from free public sources, compared with a competitor", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    await openResearch(page);
    await page.getByRole("tab", { name: "Domain overview" }).click();
    await expect(page.getByText("Not checked yet")).toBeVisible();
    // The first check downloads the Tranco list (22 MB), so it can take a while.
    await page.getByRole("button", { name: "Check domain" }).click();
    await expect(page.getByText(/Domain overview for example\.com updated/)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText(/Domain registered .* years? old/)).toBeVisible();
    await expect(page.getByText(/checked \d/).first()).toBeVisible();

    // The competitor added earlier (iana.org) gets its own row and check.
    const row = page.getByRole("row", { name: /iana\.org/ });
    await row.getByRole("button", { name: "Check" }).click();
    await expect(page.getByText(/Domain overview for iana\.org updated/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("row", { name: /iana\.org/ }).getByText(/^#[\d,]+$|Not in top 1M/)).toBeVisible();
  });

  test("custom pipeline status and reports", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByLabel("New status").fill("Waiting for access");
    await page.getByRole("button", { name: "Add status" }).click();
    await expect(page.getByText("Status added")).toBeVisible();
    await expect(page.getByLabel("Status name: Waiting for access")).toBeVisible();
    await page.getByRole("button", { name: "Delete status: Won" }).isDisabled();

    await page.goto("/prospects");
    await page.getByLabel("Filter by status").selectOption({ label: "Waiting for access" });

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Monthly activity" })).toBeVisible();
    await expect(page.getByText("Lead source performance")).toBeVisible();
    await expect(page.getByText("Most common confirmed issues")).toBeVisible();
  });
});
