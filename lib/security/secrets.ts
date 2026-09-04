import { timingSafeEqual } from "node:crypto";

// Constant-time secret comparison. `!==` leaks match-length timing; this doesn't.
// Length mismatch returns early — revealing the length of a high-entropy secret
// is not actionable, and timingSafeEqual requires equal-length buffers.
export function secretEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
