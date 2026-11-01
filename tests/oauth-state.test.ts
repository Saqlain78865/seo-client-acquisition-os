import { describe, expect, it, vi } from "vitest";
import { readState, signState } from "@/lib/messaging/google-oauth";

describe("Google sign-in state", () => {
  it("round-trips a signed state and rejects tampered or expired ones", () => {
    const s = signState({ w: "ws1", u: "user1", p: "gsc" });
    expect(readState(s)).toEqual({ w: "ws1", u: "user1", p: "gsc" });

    // Changing who it is for breaks the signature.
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), w: "other-ws" })).toString("base64url");
    expect(readState(`${forged}.${sig}`)).toBeNull();
    expect(readState("garbage")).toBeNull();
    expect(readState("")).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(readState(s)).toBeNull();
    vi.useRealTimers();
  });
});
