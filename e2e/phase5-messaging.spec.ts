import { expect, test, type Page } from "@playwright/test";
import { SMTPServer } from "smtp-server";

// Runs after phase 2–4 specs (example.com prospect with a proposal at v2).
// A local SMTP server captures what the app really sends, so no real email leaves the machine.
const OWNER = { email: "owner@e2e.example", password: "E2eOwnerPass123" };
const SMTP_PORT = 2526;
const received: string[] = [];
let smtp: SMTPServer;

test.beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    onData: (stream, _s, cb) => {
      let raw = "";
      stream.on("data", (c) => (raw += c.toString()));
      stream.on("end", () => {
        received.push(raw);
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));
});
test.afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible({ timeout: 20_000 });
}

async function openProspect(page: Page) {
  await page.goto("/prospects?q=example.com");
  await page.getByRole("link", { name: /example/i }).first().click();
}

test.describe.serial("Phase 5 messaging journey", () => {
  test("integrations page shows honest states and connects an SMTP account after verifying it", async ({ page }) => {
    await login(page);
    await page.goto("/integrations");
    await expect(page.getByText("No email account connected yet")).toBeVisible();
    // Google sign-in (Gmail API and Search Console) needs the user's own OAuth client first.
    await expect(page.getByText("Add the Google sign-in app (Client ID and Secret) below first.")).toBeVisible();
    // Search Console, reply detection, Calendar and Drive all wait for it.
    await expect(page.getByText("Save the Google sign-in app first.")).toHaveCount(4);
    // WhatsApp was removed: email (Gmail) is the only sending channel.
    await expect(page.getByText("WhatsApp Business Platform")).toHaveCount(0);

    await page.getByLabel("SMTP server").fill("127.0.0.1");
    await page.getByLabel("Port", { exact: true }).fill(String(SMTP_PORT));
    await page.getByLabel("Sender email").fill("consultant@nova-seo.example");
    await page.getByLabel("Sender name", { exact: true }).fill("Saqlain");
    await page.getByRole("button", { name: "Connect SMTP" }).click();
    await expect(page.getByText("SMTP connected: consultant@nova-seo.example")).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("No email account connected yet")).toHaveCount(0);
    // Secrets are never echoed back.
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  });

  test("templates can be created with a live preview", async ({ page }) => {
    await login(page);
    await page.goto("/templates");
    const form = page.locator("form").last();
    await form.getByLabel("Name").fill("Short follow-up");
    await form.getByLabel("Subject").fill("Quick question about {{websiteUrl}}");
    await form.getByLabel("Message").fill("Hi {{clientName}}, did you get a chance to look at the proposal?");
    await expect(form.getByText("Hi Sara, did you get a chance")).toBeVisible();
    await form.getByRole("button", { name: "Create template" }).click();
    await expect(page.getByText("Template created")).toBeVisible();
    await expect(page.getByText("Short follow-up")).toBeVisible();
  });

  test("email: unverified address blocked, then sent once with the PDF and recorded", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await openProspect(page);
    await page.getByLabel("Contact type").selectOption("EMAIL");
    await page.getByLabel("Contact value").fill("owner@example.com");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Contact added")).toBeVisible();

    await page.goto("/proposals");
    await page.locator("tbody a").first().click();
    await page.waitForURL(/\/proposals\/[^/?]+$/);
    await page.getByRole("link", { name: "Send", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Send proposal" })).toBeVisible();
    // An address that is not a saved contact needs an explicit confirmation.
    await page.getByLabel("To", { exact: true }).fill("someone@elsewhere.example");
    await expect(page.getByText("I confirm this address is correct")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send email" })).toBeDisabled();

    // The saved contact (entered by the user, so verified) needs no confirmation.
    await page.getByLabel("To", { exact: true }).fill("owner@example.com");
    await expect(page.getByText("I confirm this address is correct")).toHaveCount(0);
    await expect(page.getByLabel("Subject")).toHaveValue(/SEO proposal for/);

    const before = received.length;
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Send email" }).click();
    await expect(page.getByText(/Email accepted by consultant@nova-seo\.example/)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => received.length).toBe(before + 1);
    const raw = received.at(-1)!;
    expect(raw).toMatch(/To: owner@example\.com/);
    expect(raw).toMatch(/From: Saqlain <consultant@nova-seo\.example>/);
    expect(raw).toContain("Content-Type: application/pdf");

    // Recorded on the proposal, which is now sent and locked.
    await expect(page.getByText("Sent").first()).toBeVisible();
    await expect(page.getByText("accepted").first()).toBeVisible();
    await expect(page.getByText("Sent version — read only")).toBeVisible();
    await expect(page.getByText(/to owner@example\.com · v2/)).toBeVisible();

    // Follow-up reminders were scheduled.
    await page.goto("/follow-ups?view=upcoming");
    await expect(page.getByText("Proposal reminder").first()).toBeVisible();
  });

  test("share link: public view works, then stops after revoking", async ({ page, browser }) => {
    await login(page);
    await page.goto("/proposals");
    await page.locator("tbody a").first().click();
    await page.getByRole("button", { name: "7 days" }).click();
    await expect(page.getByText("Share link created")).toBeVisible();
    const linkField = page.getByLabel("Proposal share link");
    await expect(linkField).toHaveValue(/\/p\/[A-Za-z0-9_-]{30,}$/);
    const url = await linkField.inputValue();
    await expect(page.getByAltText("QR code that opens the proposal link")).toBeVisible();

    const visitor = await browser.newContext();
    const v = await visitor.newPage();
    const path = new URL(url).pathname;
    await v.goto(path);
    await expect(v.getByRole("link", { name: "Download PDF" })).toBeVisible();
    await expect(v.frameLocator('iframe[title="Proposal"]').getByText(/Prepared for/)).toBeVisible();
    const pdf = await v.request.get(`${path}/pdf`);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    // The visitor cannot reach anything private.
    expect((await v.request.get("/api/prospects/export")).status()).toBe(401);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("Link revoked")).toBeVisible();
    await v.goto(path);
    await expect(v.getByText("This link is not available")).toBeVisible();
    await visitor.close();
  });

  test("sending is email only, CC/BCC stay tucked away, and opt-out blocks sending", async ({ page }) => {
    await login(page);
    await page.goto("/proposals");
    await page.locator("tbody a").first().click();
    await page.waitForURL(/\/proposals\/[^/?]+$/);
    await page.getByRole("link", { name: "Send", exact: true }).click();
    // WhatsApp sending was removed: no channel tabs, only the email form.
    await expect(page.getByRole("tab", { name: "WhatsApp" })).toHaveCount(0);
    await expect(page.getByText("Option 1 — Open in WhatsApp")).toHaveCount(0);
    // WhatsApp is free click-to-chat only (no API): a card under the email form.
    await expect(page.getByText("Or send on WhatsApp")).toBeVisible();
    await expect(page.getByLabel("CC", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /CC \/ BCC/ }).click();
    await expect(page.getByLabel("CC", { exact: true })).toBeVisible();
    await expect(page.getByLabel("BCC", { exact: true })).toBeVisible();

    await openProspect(page);
    await page.getByRole("button", { name: "Opt-out / do not contact" }).click();
    await page.getByLabel("Opt-out reason").fill("Asked not to be contacted");
    await page.getByRole("button", { name: "Mark do not contact" }).click();
    await expect(page.getByText("Do not contact")).toBeVisible();
    await page.goto("/proposals");
    await page.locator("tbody a").first().click();
    await page.waitForURL(/\/proposals\/[^/?]+$/);
    await page.getByRole("link", { name: "Send", exact: true }).click();
    await expect(page.getByText("This prospect has opted out")).toBeVisible();
  });
});
