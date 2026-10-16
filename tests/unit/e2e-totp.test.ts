import { describe, it, expect } from "vitest";
import { totp } from "../../e2e/totp";

describe("e2e totp helper", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of "12345678901234567890"
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1_111_111_109_000)).toBe("081804");
    expect(totp(secret, 2_000_000_000_000)).toBe("279037");
  });

  it("rejects a non-base32 secret", () => {
    expect(() => totp("not base32!")).toThrow("base32");
  });
});
