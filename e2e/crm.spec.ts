import { expect, test, type Page } from "@playwright/test";

const OWNER = { name: "Saqlain Test", email: "owner@e2e.example", password: "E2eOwnerPass123", workspace: "E2E Agency" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("Phase 1 CRM journey", () => {
  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/prospects");
    await expect(page).toHaveURL(/\/login$/);
    const res = await page.request.get("/api/prospects/export");
    expect(res.status()).toBe(401);
  });

  test("first-run owner registration creates a workspace", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Your name").fill(OWNER.name);
    await page.getByLabel("Agency / workspace name").fill(OWNER.workspace);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back, Saqlain" })).toBeVisible();
    await expect(page.getByText(OWNER.workspace)).toBeVisible();
    // Empty workspace shows zeros from the database, not sample numbers.
    await expect(page.getByText("Total prospects").locator("..").locator("..")).toContainText("0");
  });

  test("registration is closed after the first owner", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Your name").fill("Intruder");
    await page.getByLabel("Agency / workspace name").fill("Other");
    await page.getByLabel("Email").fill("intruder@e2e.example");
    await page.getByLabel("Password").fill("Intruder12345");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Registration is closed")).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill("wrong-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("create, find, follow up and win a prospect", async ({ page }) => {
    await login(page);

    // Create
    await page.goto("/prospects/new");
    await page.getByLabel("Business name").fill("Karachi Smiles Dental");
    await page.getByLabel("Website URL").fill("karachi-smiles.example");
    await page.getByLabel("Country").fill("Pakistan");
    await page.getByLabel("Estimated deal value").fill("750");
    await page.getByLabel("Email").fill("hello@karachi-smiles.example");
    await page.getByLabel("WhatsApp number").fill("+92 300 1234567");
    await page.getByRole("button", { name: "Create prospect" }).click();
    await expect(page.getByRole("heading", { name: "Karachi Smiles Dental" })).toBeVisible();
    await expect(page.getByText("+923001234567")).toBeVisible();
    await expect(page.getByText("Prospect Karachi Smiles Dental created")).toBeVisible();

    // Duplicate detection
    await page.goto("/prospects/new");
    await page.getByLabel("Business name").fill("Karachi Smiles (again)");
    await page.getByLabel("Website URL").fill("https://www.karachi-smiles.example/contact");
    await page.getByRole("button", { name: "Create prospect" }).click();
    await expect(page.getByText("This prospect may already exist")).toBeVisible();

    // Search by phone digits
    await page.goto("/prospects?q=3001234567");
    await expect(page.getByRole("link", { name: "Karachi Smiles Dental" })).toBeVisible();
    await page.getByRole("link", { name: "Karachi Smiles Dental" }).click();

    // Follow-up
    await page.getByLabel("Due").fill("2030-01-15T10:00");
    await page.getByRole("button", { name: "Schedule follow-up" }).click();
    await expect(page.getByText(/Custom follow-up scheduled for 2030-01-15/)).toBeVisible();

    // Note
    await page.getByLabel("New note").fill("Owner wants local SEO for 2 branches.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Owner wants local SEO for 2 branches.")).toBeVisible();

    // Win requires a value
    await page.getByLabel("Status").selectOption("WON");
    await page.getByLabel(/Agreed value/).fill("900");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("Status changed to Won")).toBeVisible();

    // Dashboard reflects saved records
    await page.goto("/");
    const kpi = (label: string) => page.getByText(label, { exact: true }).locator("..").locator("..");
    await expect(kpi("Total prospects")).toContainText("1");
    await expect(kpi("Deals won")).toContainText("1");
    await expect(kpi("Total won value")).toContainText("$900");
    // "Recent websites" lists audited sites only; this prospect was never audited.
    await expect(page.getByRole("heading", { name: "Recent websites" })).toBeVisible();
    await expect(page.getByText("Get set up in a few minutes")).toHaveCount(0);

    // Deal appears on the deals page
    await page.goto("/deals");
    await expect(page.getByRole("link", { name: "Karachi Smiles Dental" })).toBeVisible();
  });

  test("CSV export downloads saved prospects", async ({ page }) => {
    await login(page);
    const res = await page.request.get("/api/prospects/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(await res.text()).toContain("Karachi Smiles Dental");
  });
});
