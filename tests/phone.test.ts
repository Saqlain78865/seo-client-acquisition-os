import { describe, expect, it } from "vitest";
import { checkPhone, countryCode, countryFromDomain, whatsAppNumbers } from "@/lib/phone";
import { extractContacts } from "@/lib/crawler/contacts-extract";
import { extractPage } from "@/lib/crawler/extract";

describe("phone numbers and WhatsApp", () => {
  it("judges the chance of a number being on WhatsApp without claiming more than it knows", () => {
    expect(checkPhone("+971 50 206 8618")).toMatchObject({ valid: true, e164: "+971502068618", type: "MOBILE", whatsapp: "LIKELY" });
    expect(checkPhone("+971502068618", { fromWhatsAppLink: true })).toMatchObject({ whatsapp: "CONFIRMED" });
    expect(checkPhone("+44 20 7946 0958")).toMatchObject({ valid: true, type: "FIXED_LINE", whatsapp: "NO" });
    expect(checkPhone("+1 202 555 0123").whatsapp).toBe("POSSIBLE");
    // Text that only looks like a number is not valid.
    expect(checkPhone("+971 2024")).toMatchObject({ valid: false, whatsapp: "NO" });
    expect(checkPhone("width 1200px")).toMatchObject({ valid: false });
    // A local number becomes international when the country is known.
    expect(checkPhone("050 206 8618", { defaultCountry: "AE" })).toMatchObject({ valid: true, e164: "+971502068618" });
    expect(checkPhone("0300 1234567", { defaultCountry: "PK" })).toMatchObject({ e164: "+923001234567", whatsapp: "LIKELY" });
  });

  it("understands countries written as names, aliases, codes or domain endings", () => {
    expect(countryCode("UAE")).toBe("AE");
    expect(countryCode("United Arab Emirates")).toBe("AE");
    expect(countryCode("pakistan")).toBe("PK");
    expect(countryCode("uk")).toBe("GB");
    expect(countryCode("ae")).toBe("AE");
    expect(countryCode("Atlantis")).toBeNull();
    expect(countryFromDomain("dunebuggydubaiprice.ae")).toBe("AE");
    expect(countryFromDomain("shop.co.uk")).toBe("GB");
    expect(countryFromDomain("example.com")).toBeNull();
  });

  it("lists WhatsApp-able numbers best first, once each, without landlines", () => {
    const list = whatsAppNumbers(
      [
        { type: "PHONE", value: "+44 20 7946 0958", sourceMethod: "CRAWL" },
        { type: "PHONE", value: "050 206 8618", sourceMethod: "CRAWL" },
        { type: "WHATSAPP", value: "+971502068618", sourceMethod: "CRAWL" },
        { type: "PHONE", value: "+971 55 123 4567", sourceMethod: "CRAWL" },
      ],
      "AE",
    );
    expect(list.map((n) => [n.value, n.whatsapp])).toEqual([
      ["+971502068618", "CONFIRMED"],
      ["+971551234567", "LIKELY"],
    ]);
    expect(list[0].label).toMatch(/linked on their website/);
  });

  it("drops non-numbers during extraction and stores local numbers internationally", () => {
    const html = `<html><body><footer>Call us: 050 206 8618 · Fax: 04 1 · Order no. 2024-1234-5678</footer><a href="https://wa.me/971502068618">WhatsApp</a><a href="tel:+44 20 7946 0958">UK office</a></body></html>`;
    const page = extractPage(html, "https://dunes.example/");
    const phones = extractContacts([{ url: "https://dunes.example/", pageType: "HOMEPAGE", page }], { defaultCountry: "AE" }).filter((c) => c.type === "PHONE" || c.type === "WHATSAPP");
    const values = phones.map((c) => `${c.type}:${c.value}`).sort();
    expect(values).toEqual(["PHONE:+442079460958", "PHONE:+971502068618", "WHATSAPP:+971502068618"]);
  });
});
