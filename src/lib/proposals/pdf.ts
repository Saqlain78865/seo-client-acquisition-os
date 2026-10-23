import "server-only";

export class PdfError extends Error {}

/**
 * Prints our own proposal HTML to PDF with headless Chromium. The document is self-contained, so
 * JavaScript is disabled and every network request is refused.
 */
export async function htmlToPdf(html: string, footerTemplate: string): Promise<Buffer> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new PdfError("PDF engine is not installed. Run: npx playwright install chromium");
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    throw new PdfError(`Could not start the PDF engine: ${(e as Error).message.split("\n")[0]}. Run: npx playwright install chromium`);
  }
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: false });
    await context.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate,
    });
    await context.close();
    return pdf;
  } finally {
    await browser.close();
  }
}
