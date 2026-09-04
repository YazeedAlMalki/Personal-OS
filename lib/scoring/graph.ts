import { DAY_MS } from "@/lib/scoring/util";

// Entity importance scoring (architecture §"Entity importance", nightly):
//   importance = degree_centrality·50 + linkedOpportunityValue_normalized·30 + recentMentions·20
// Pure, deterministic, no LLM. All component scores are 0..1; result is 0..100.

export type ImportanceInputs = {
  degree: number; // number of edges touching this entity
  maxDegree: number; // max degree across the user's graph (>=1 when any edges exist)
  linkedOpportunityValue: number; // Σ estimated_value of opportunities linked to this entity
  maxLinkedOpportunityValue: number; // max of the above across the graph
  mentionCount: number; // lifetime capture mentions
  lastMentionedAt: string | null; // ISO timestamp of most recent mention
  now?: Date;
};

// Degree centrality, normalized against the densest node in this user's graph.
export function degreeCentrality(degree: number, maxDegree: number): number {
  if (maxDegree <= 0 || degree <= 0) return 0;
  return Math.min(1, degree / maxDegree);
}

// Opportunity value, normalized against the highest-value-linked entity.
export function opportunityValueScore(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 0;
  return Math.min(1, value / maxValue);
}

// Recent-mention score: volume (log-scaled, saturates ~20 mentions) damped by
// recency (half-life 14 days). Never mentioned → 0.
export function recentMentionScore(
  mentionCount: number,
  lastMentionedAt: string | null,
  now: Date = new Date(),
): number {
  if (mentionCount <= 0 || !lastMentionedAt) return 0;
  const volume = Math.min(1, Math.log10(1 + mentionCount) / Math.log10(21));
  const ageMs = now.getTime() - new Date(lastMentionedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return volume; // future/bad ts → no damping
  const halfLives = ageMs / (14 * DAY_MS);
  const recency = Math.pow(0.5, halfLives);
  return volume * recency;
}

export function importanceScore(inp: ImportanceInputs): number {
  const deg = degreeCentrality(inp.degree, inp.maxDegree);
  const opp = opportunityValueScore(inp.linkedOpportunityValue, inp.maxLinkedOpportunityValue);
  const men = recentMentionScore(inp.mentionCount, inp.lastMentionedAt, inp.now ?? new Date());
  const score = deg * 50 + opp * 30 + men * 20;
  return Math.round(score * 100) / 100; // numeric(5,2)
}
