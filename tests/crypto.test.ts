import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, sha256 } from "@/lib/crypto";

describe("secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret('{"token":"abc123"}');
    expect(enc).not.toContain("abc123");
    expect(decryptSecret(enc)).toBe('{"token":"abc123"}');
  });
  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("detects tampering", () => {
    const parts = encryptSecret("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("hashes deterministically", () => {
    expect(sha256("a")).toBe(sha256("a"));
    expect(sha256("a")).toHaveLength(64);
  });
});
