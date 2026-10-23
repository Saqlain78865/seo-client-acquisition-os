import { describe, expect, it } from "vitest";
import { assertUrlShape, BlockedUrlError, isPublicAddress, assertPublicHost } from "@/lib/crawler/network-guard";
import { safeFetch } from "@/lib/crawler/safe-fetch";

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false], // cloud metadata
    ["100.64.0.1", false], // CGNAT
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["::1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["::ffff:127.0.0.1", false], // IPv4-mapped loopback
    ["::ffff:10.0.0.1", false],
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["2606:4700:4700::1111", true],
    ["not-an-ip", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("assertUrlShape", () => {
  const blocked = [
    "ftp://example.com/",
    "file:///etc/passwd",
    "http://user:pass@example.com/",
    "http://localhost/",
    "http://LOCALHOST./",
    "http://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://127.0.0.1/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f000001/", // hex 127.0.0.1
    "http://017700000001/", // octal 127.0.0.1
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://example.com:22/",
  ];
  it.each(blocked)("blocks %s", (u) => {
    expect(() => assertUrlShape(u)).toThrow(BlockedUrlError);
  });
  it("allows normal public URLs", () => {
    expect(assertUrlShape("https://example.com/page?x=1").hostname).toBe("example.com");
    expect(assertUrlShape("http://example.com:8080/").port).toBe("8080");
  });
});

describe("DNS-level protection", () => {
  it("refuses hostnames that resolve to loopback", async () => {
    await expect(assertPublicHost("localhost")).rejects.toThrow(BlockedUrlError);
  });
  it("safeFetch never connects to private addresses", async () => {
    await expect(safeFetch("http://127.0.0.1:9/")).rejects.toThrow(BlockedUrlError);
    await expect(safeFetch("http://localhost:3000/")).rejects.toThrow(BlockedUrlError);
  });
});
