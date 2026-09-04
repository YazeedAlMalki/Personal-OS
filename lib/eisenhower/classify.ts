// Eisenhower Matrix — orchestrator.
// Chains urgency scoring, importance scoring, and quadrant assignment.

import type { ScoringTask, ScoringContext, ScoredResult } from "./types";
import { scoreUrgency, scoreImportance, assignQuadrant, formatReason } from "./score";

/**
 * Classify a task into an Eisenhower quadrant.
 * Pure function — no side effects, no DB calls.
 */
export function classifyQuadrant(
  task: ScoringTask,
  ctx: ScoringContext,
): ScoredResult {
  const u = scoreUrgency(task, ctx.now);
  const i = scoreImportance(task, ctx);
  const { quadrant, confidence } = assignQuadrant(u.score, i.score);
  const reason = formatReason(u.reasons, i.reasons);

  return {
    urgency: u.score,
    importance: i.score,
    quadrant,
    confidence,
    reason,
  };
}

/**
 * Derive the priority label from urgency score.
 * Keeps the existing `priority` field in sync with Eisenhower scoring.
 */
export function urgencyToPriority(urgencyScore: number): string {
  if (urgencyScore >= 81) return "urgent";
  if (urgencyScore >= 56) return "high";
  if (urgencyScore >= 31) return "medium";
  return "low";
}
