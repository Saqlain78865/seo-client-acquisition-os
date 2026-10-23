import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

// Runs after the phase 1–5 specs on the same database (owner account already exists).
const OWNER = { email: "owner@e2e.example", password: "E2eOwnerPass123" };
const MEMBER = { name: "Team Member", email: "member@e2e.example", temp: "TempPassword123", next: "MemberPassword456" };

// A failed job is inserted straight into the E2E database: real failures depend on remote sites.
const Database = createRequire(__filename)("better-sqlite3");
function insertFailedJob() {
  const sqlite = new Database("e2e.db");
  try {
    const { workspaceId } = sqlite
      .prepare("SELECT m.workspaceId FROM WorkspaceMembership m JOIN User u ON u.id = m.userId WHERE u.email = ? AND m.role = 'OWNER'")
      .get(OWNER.email);
    const now = Date.now();
    sqlite
      .prepare("INSERT INTO BackgroundJob (id, workspaceId, type, payload, status, attempts, maxAttempts, runAfter, lastError, correlationId, createdAt, updatedAt) VALUES (?, ?, 'audit.run', ?, 'FAILED', 1, 1, ?, ?, ?, ?, ?)")
      .run(`e2ejob${now}`, workspaceId, JSON.stringify({ auditId: "deleted-audit" }), now, "Crawl stage crashed (simulated)", "e2e-corr-0001", now, now);
  } finally {
    sqlite.close();
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("Phase 6 production readiness", () => {
  test("health endpoint, request ids and security headers", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const res = await request.get("/login");
    expect(res.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const csp = res.headers()["content-security-policy"];
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers()["strict-transport-security"]).toContain("max-age=");
    // A sane id from a load balancer is kept, a malformed one replaced.
    expect((await request.get("/login", { headers: { "x-request-id": "lb-12345678" } })).headers()["x-request-id"]).toBe("lb-12345678");
    expect((await request.get("/login", { headers: { "x-request-id": "<script>" } })).headers()["x-request-id"]).not.toBe("<script>");
  });

  test("system page: live health checks, failed job retry is refused safely, then dismissed", async ({ page }) => {
    insertFailedJob();
    await login(page, OWNER.email, OWNER.password);
    await page.getByRole("link", { name: "System" }).first().click();
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
    await expect(page.getByText(/Responded in \d+ ms/)).toBeVisible();
    await expect(page.getByText("ENCRYPTION_KEY is set and valid (AES-256-GCM)")).toBeVisible();
    await expect(page.getByText("Chromium is installed")).toBeVisible();

    // Opens on the Failed tab because something failed.
    await expect(page.getByRole("tab", { name: /Failed/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Crawl stage crashed (simulated)")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("The audit for this job was deleted. Dismiss the job instead.")).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("Job dismissed")).toBeVisible();
    // With nothing failed any more, the page falls back to the "All" view and counts the dismissed job.
    await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Dismissed 1" })).toBeVisible();
    await expect(page.getByText("Crawl stage crashed (simulated)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);

    await page.getByRole("button", { name: "Run clean-up now" }).click();
    await expect(page.getByText(/^Removed: \d+ expired sessions/)).toBeVisible({ timeout: 20_000 });
  });

  test("owner exports the workspace without secrets", async ({ page }) => {
    await login(page, OWNER.email, OWNER.password);
    const res = await page.request.get("/api/workspace/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="workspace-export-/);
    const body = await res.text();
    const data = JSON.parse(body);
    expect(data.format).toBe("seo-client-acquisition-os/export");
    expect(data.prospects.length).toBeGreaterThan(0);
    for (const secret of ["passwordHash", "tokenHash", "encryptedSecret", "shareToken", "storageKey"]) expect(body).not.toContain(secret);
  });

  test("team: owner adds a member; the member has limited access and changes their password", async ({ page, browser }) => {
    await login(page, OWNER.email, OWNER.password);
    await page.goto("/account");
    await page.getByLabel("Current password").fill("not-my-password");
    await page.getByLabel("New password", { exact: true }).fill("AnotherPass123");
    await page.getByLabel("Confirm new password").fill("AnotherPass123");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your current password is not correct.")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill(MEMBER.name);
    await page.getByLabel("Email", { exact: true }).fill(MEMBER.email);
    await page.getByLabel("Temporary password").fill(MEMBER.temp);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText(`${MEMBER.email} added. Share the temporary password privately`)).toBeVisible();
    await expect(page.getByLabel(`Role for ${MEMBER.name}`)).toHaveValue("MEMBER");

    const ctx = await browser.newContext();
    const m = await ctx.newPage();
    await login(m, MEMBER.email, MEMBER.temp);
    // Members see the CRM but not the admin pages.
    await expect(m.getByRole("link", { name: "Prospects" }).first()).toBeVisible();
    await expect(m.getByRole("link", { name: "System" })).toHaveCount(0);
    await m.goto("/system");
    await expect(m.getByText("Only owners and admins can view system health")).toBeVisible();
    expect((await m.request.get("/api/workspace/export")).status()).toBe(403);

    await m.goto("/account");
    await m.getByLabel("Current password").fill(MEMBER.temp);
    await m.getByLabel("New password", { exact: true }).fill(MEMBER.next);
    await m.getByLabel("Confirm new password").fill(MEMBER.next);
    await m.getByRole("button", { name: "Change password" }).click();
    await expect(m.getByText("Password changed.")).toBeVisible();
    await ctx.close();

    // Removing the member ends their access.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Member removed")).toBeVisible();
    const ctx2 = await browser.newContext();
    const m2 = await ctx2.newPage();
    await m2.goto("/login");
    await m2.getByLabel("Email").fill(MEMBER.email);
    await m2.getByLabel("Password").fill(MEMBER.next);
    await m2.getByRole("button", { name: "Sign in" }).click();
    await expect(m2.getByText("Incorrect email or password.")).toBeVisible();
    await ctx2.close();
  });

  test("no console or hydration errors on the main pages", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    let current = "";
    // Playwright's trace recorder injects a script into every frame; the sandboxed proposal preview
    // correctly refuses it. That message proves the sandbox works, so it is the only one ignored.
    const expected = /Blocked script execution in .* because the document's frame is sandboxed/;
    page.on("console", (m) => m.type() === "error" && !expected.test(m.text()) && errors.push(`${current}: ${m.text().split("\n")[0]}`));
    page.on("pageerror", (e) => errors.push(`${current}: ${e.message.split("\n")[0]}`));
    await login(page, OWNER.email, OWNER.password);
    const visit = async (path: string) => {
      current = path;
      await page.goto(path, { waitUntil: "networkidle" });
    };
    for (const path of ["/", "/prospects", "/audits", "/proposals", "/deals", "/follow-ups", "/templates", "/integrations", "/reports", "/settings", "/account", "/system"]) await visit(path);
    for (const list of ["/prospects", "/audits", "/proposals"]) {
      await visit(list);
      const href = await page.locator(`a[href^="${list}/c"]`).first().getAttribute("href");
      expect(href).toBeTruthy();
      await visit(href!);
    }
    expect(errors).toEqual([]);
  });
});
