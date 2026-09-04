import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, _resetRateLimits } from "@/lib/security/ratelimit";

describe("rateLimit (token bucket)", () => {
  beforeEach(() => _resetRateLimits());

  it("allows up to capacity, then blocks", () => {
    const opts = { capacity: 3, windowMs: 60_000 };
    expect(rateLimit("k", opts).ok).toBe(true);
    expect(rateLimit("k", opts).ok).toBe(true);
    expect(rateLimit("k", opts).ok).toBe(true);
    const blocked = rateLimit("k", opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps separate buckets per key", () => {
    const opts = { capacity: 1, windowMs: 60_000 };
    expect(rateLimit("a", opts).ok).toBe(true);
    expect(rateLimit("a", opts).ok).toBe(false);
    expect(rateLimit("b", opts).ok).toBe(true); // independent
  });

  it("refills over elapsed time", () => {
    const base = 1_000_000;
    let now = base;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const opts = { capacity: 2, windowMs: 1000 }; // refills 2 tokens/sec
      expect(rateLimit("t", opts).ok).toBe(true);
      expect(rateLimit("t", opts).ok).toBe(true);
      expect(rateLimit("t", opts).ok).toBe(false); // empty
      now += 600; // 0.6s → +1.2 tokens
      expect(rateLimit("t", opts).ok).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});
