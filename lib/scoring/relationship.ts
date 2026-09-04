import { clamp, clamp01, daysSince } from "@/lib/scoring/util";

// Relationship health 0..100: starts from stored strength, decays with time since
// last contact, lightly boosted by recent interactions. Surfaces "drifting" contacts.
export function relationshipHealth(input: {
  baseStrength?: number | null; // 1..5
  lastContactedAt?: string | null;
  interactions90d?: number;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const base = clamp01((input.baseStrength ?? 3) / 5);
  const days = daysSince(input.lastContactedAt ?? null, now) ?? 999;
  const decay = Math.exp(-days / 45); // ~31-day half-life
  const boost = Math.min(0.2, (input.interactions90d ?? 0) * 0.04);
  return Math.round(clamp(100 * (0.8 * base * decay + 0.2 * decay) + 100 * boost * decay, 0, 100));
}

// True when a contact is "drifting": meaningful relationship, no recent contact.
export function isDrifting(input: {
  baseStrength?: number | null;
  lastContactedAt?: string | null;
  thresholdDays?: number;
  now?: Date;
}): boolean {
  const strong = (input.baseStrength ?? 3) >= 3;
  const days = daysSince(input.lastContactedAt ?? null, input.now ?? new Date());
  return strong && (days === null || days > (input.thresholdDays ?? 21));
}
