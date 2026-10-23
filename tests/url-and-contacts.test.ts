import { describe, expect, it } from "vitest";
import { normalizeDomain, normalizeWebsiteUrl } from "@/lib/url";
import { hasInternationalPrefix, isValidEmailFormat, isValidPhoneFormat, normalizePhone, validateContactValue } from "@/lib/contacts";
import { prospectSchema, registerSchema, websiteUrlSchema } from "@/lib/validation";

describe("URL normalisation", () => {
  it("strips www, case and trailing dot from domains", () => {
    expect(normalizeDomain("https://WWW.Example.com./about")).toBe("example.com");
    expect(normalizeDomain("example.co.uk")).toBe("example.co.uk");
  });
  it("defaults to https and drops fragments and the root slash", () => {
    expect(normalizeWebsiteUrl("Example.com")).toBe("https://example.com");
    expect(normalizeWebsiteUrl("http://example.com/services/#top")).toBe("http://example.com/services/");
  });
  it("rejects non-http protocols and hostless input", () => {
    expect(websiteUrlSchema.safeParse("ftp://example.com").success).toBe(false);
    expect(websiteUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(websiteUrlSchema.safeParse("localhost").success).toBe(false);
    expect(websiteUrlSchema.parse("example.com")).toBe("https://example.com");
  });
});

describe("contact validation", () => {
  it("checks email format", () => {
    expect(isValidEmailFormat("info@business.com")).toBe(true);
    expect(isValidEmailFormat("info@business")).toBe(false);
  });
  it("preserves international dialling codes", () => {
    expect(normalizePhone("+92 300 123-4567")).toBe("+923001234567");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(hasInternationalPrefix("0300 1234567")).toBe(false);
  });
  it("rejects too short and too long numbers", () => {
    expect(isValidPhoneFormat("12345")).toBe(false);
    expect(isValidPhoneFormat("+1234567890123456")).toBe(false);
    expect(isValidPhoneFormat("+1 312 555 0100")).toBe(true);
  });
  it("only format-checks types it understands", () => {
    expect(validateContactValue("ADDRESS", "anything")).toBe("UNCHECKED");
    expect(validateContactValue("WHATSAPP", "abc")).toBe("INVALID_FORMAT");
  });
});

describe("form schemas", () => {
  it("treats empty optional fields as missing, not zero", () => {
    const r = prospectSchema.parse({ businessName: "A", websiteUrl: "a.com", estimatedValue: "", email: "" });
    expect(r.estimatedValue).toBeUndefined();
    expect(r.email).toBeUndefined();
  });
  it("enforces password strength on registration", () => {
    const base = { name: "Ali", email: "a@b.com", workspaceName: "Agency" };
    expect(registerSchema.safeParse({ ...base, password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "onlyletters" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "letters1234" }).success).toBe(true);
  });
});
