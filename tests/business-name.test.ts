import { describe, expect, it } from "vitest";
import { extractPage } from "@/lib/crawler/extract";
import { identifyBusiness } from "@/lib/audit/business";
import type { CrawledRecord } from "@/lib/crawler/crawl";

const home = (html: string) =>
  ({ url: "https://site.example/", finalUrl: "https://site.example/", status: 200, pageType: "HOMEPAGE", page: extractPage(html, "https://site.example/") }) as unknown as CrawledRecord;

describe("business name from the homepage", () => {
  it("falls back to the logo, the footer copyright, or a short title — never to generic words", () => {
    const logo = home(`<html><head><title>Home</title></head><body><img src="/logo.png" alt="Dune Riders Logo"><footer>Thanks</footer></body></html>`);
    expect(identifyBusiness([logo], []).name?.value).toBe("Dune Riders");

    const copyright = home(`<html><head><title>Welcome</title></head><body><p>Tours</p><footer>© 2025 Sky Balloons Dubai. All rights reserved.</footer></body></html>`);
    expect(identifyBusiness([copyright], []).name?.value).toBe("Sky Balloons Dubai");

    const title = home(`<html><head><title>Karachi City Movers</title></head><body><p>We move.</p></body></html>`);
    expect(identifyBusiness([title], []).name?.value).toBe("Karachi City Movers");

    const nothing = home(`<html><head><title>Home</title></head><body><p>Hello</p></body></html>`);
    expect(identifyBusiness([nothing], []).name).toBeNull();
  });
});
