// Phase 8 — in-process token-bucket rate limiter.
//
// Single-instance friendly (self-host / one Vercel lambda warm instance). State is
// a module-level Map, so it resets on cold start — fine as a guardrail against
// runaway loops and accidental hammering, not a distributed quota. For multi-instance
// enforcement, swap the store for Postgres or Upstash behind the same interface.

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitOptions {
  // Sustained rate: `capacity` requests per `windowMs`, refilled continuously.
  capacity: number;
  windowMs: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const { capacity, windowMs } = opts;
  const now = Date.now();
  const refillPerMs = capacity / windowMs;

  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  // Refill based on elapsed time.
  b.tokens = Math.min(capacity, b.tokens + (now - b.updatedAt) * refillPerMs);
  b.updatedAt = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    buckets.set(key, b);
    return { ok: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
  }

  buckets.set(key, b);
  const deficit = 1 - b.tokens;
  return { ok: false, remaining: 0, retryAfterMs: Math.ceil(deficit / refillPerMs) };
}

// Build a 429 Response (or null when allowed). Convenience for route handlers.
export function rateLimitResponse(key: string, opts: RateLimitOptions): Response | null {
  const r = rateLimit(key, opts);
  if (r.ok) return null;
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.ceil(r.retryAfterMs / 1000)),
    },
  });
}

// Test/maintenance helper.
export function _resetRateLimits(): void {
  buckets.clear();
}
