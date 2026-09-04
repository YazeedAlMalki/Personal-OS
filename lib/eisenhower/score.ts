// Eisenhower Matrix — scoring functions.
// Pure + deterministic. No LLM, no DB calls. Fully unit-testable.

import { clamp, calendarDaysUntil } from "@/lib/scoring/util";
import type { Quadrant, ScoringTask, ScoringContext } from "./types";

// ---- Urgency ----------------------------------------------------------------

const URGENT_WORDS = /\b(asap|urgent|immediately|right now|critical|emergency)\b/i;
const NOT_URGENT_WORDS = /\b(no rush|someday|eventually|when possible|low priority|no hurry|whenever)\b/i;
const TODAY_WORDS = /\b(today|tonight|this evening|this morning)\b/i;

export type ScoreBreakdown = { score: number; reasons: string[] };

export function scoreUrgency(task: ScoringTask, now: Date): ScoreBreakdown {
  let score = 30; // default: no signal → slightly below midpoint
  const reasons: string[] = [];

  // Layer 1: Deadline proximity (most authoritative).
  if (task.due_date) {
    const d = calendarDaysUntil(task.due_date, now);
    if (d !== null) {
      if (d < 0) {
        score = 95;
        reasons.push(`Overdue by ${Math.abs(Math.round(d))}d`);
      } else if (d < 1) {
        score = 90;
        reasons.push("Due today");
      } else if (d < 3) {
        score = 75;
        reasons.push(`Due in ${Math.round(d)}d`);
      } else if (d < 7) {
        score = 60;
        reasons.push("Due this week");
      } else if (d < 30) {
        score = 40;
        reasons.push(`Due in ${Math.round(d)}d`);
      } else {
        score = 25;
        reasons.push(`Due in ${Math.round(d)}d — no rush`);
      }
    }
  }

  // Layer 1: Explicit language.
  const text = `${task.title} ${task.description ?? ""}`;
  if (URGENT_WORDS.test(text)) {
    score = Math.min(100, score + 30);
    reasons.push("Marked urgent in text");
  } else if (TODAY_WORDS.test(text) && score < 85) {
    score = Math.max(score, 85);
    reasons.push("Mentions today");
  } else if (NOT_URGENT_WORDS.test(text)) {
    score = Math.min(score, 20);
    reasons.push("Explicitly low urgency");
  }

  // Layer 2: Postponement history.
  const postpones = task.postpone_count ?? 0;
  if (postpones >= 3) {
    score = Math.min(100, score + 15);
    reasons.push(`Postponed ${postpones}× — becoming urgent by neglect`);
  }

  // Layer 2: Existing priority field as weak signal.
  if (task.priority === "urgent" && score < 70) {
    score = Math.max(score, 70);
    reasons.push("Priority set to urgent");
  }

  return { score: clamp(score, 0, 100), reasons };
}

// ---- Importance -------------------------------------------------------------

const IMPORTANT_WORDS = /\b(important|critical|must|essential|key|strategic|high.?impact|vital|crucial)\b/i;
const NOT_IMPORTANT_WORDS = /\b(optional|nice to have|if time|low.?impact|minor|trivial|unimportant)\b/i;

export function scoreImportance(task: ScoringTask, ctx: ScoringContext): ScoreBreakdown {
  let score = 40; // default: slightly below midpoint → "we don't know"
  const reasons: string[] = [];

  // Layer 2: Goal linkage (strongest importance signal).
  if (task.related_goal_id && ctx.activeGoalIds.has(task.related_goal_id)) {
    score += 30;
    const goal = ctx.goalMeta.get(task.related_goal_id);
    reasons.push(`Linked to goal: "${goal?.title ?? "?"}"`);

    if (goal?.deadline) {
      const d = calendarDaysUntil(goal.deadline, ctx.now);
      if (d !== null && d < 30) {
        score += 10;
        reasons.push("Goal deadline within 30d");
      }
    }
  }

  // Layer 2: Project linkage.
  if (task.related_project_id && ctx.activeProjectIds.has(task.related_project_id)) {
    score += 15;
    reasons.push("Linked to active project");
  }

  // Layer 2: High-value opportunity linkage.
  if (task.related_opportunity_id && ctx.highValueOppIds.has(task.related_opportunity_id)) {
    score += 20;
    reasons.push("Linked to high-value opportunity");
  }

  // Layer 1: Explicit language.
  const text = `${task.title} ${task.description ?? ""}`;
  if (IMPORTANT_WORDS.test(text)) {
    score += 25;
    reasons.push("Marked important in text");
  } else if (NOT_IMPORTANT_WORDS.test(text)) {
    score = Math.max(10, score - 20);
    reasons.push("Explicitly optional/minor");
  }

  return { score: clamp(score, 0, 100), reasons };
}

// ---- Quadrant assignment ----------------------------------------------------

const URGENCY_THRESHOLD = 55;
const IMPORTANCE_THRESHOLD = 55;

export function assignQuadrant(
  urgency: number,
  importance: number,
): { quadrant: Quadrant; confidence: number } {
  const distU = Math.abs(urgency - URGENCY_THRESHOLD);
  const distI = Math.abs(importance - IMPORTANCE_THRESHOLD);
  const minDist = Math.min(distU, distI);

  // Confidence: 0.50 at threshold edge → 0.95 at max distance (45).
  const confidence = clamp(0.5 + (minDist / 45) * 0.45, 0.5, 0.95);

  let quadrant: Quadrant;
  if (urgency >= URGENCY_THRESHOLD && importance >= IMPORTANCE_THRESHOLD) {
    quadrant = "do_now";
  } else if (urgency < URGENCY_THRESHOLD && importance >= IMPORTANCE_THRESHOLD) {
    quadrant = "schedule";
  } else if (urgency >= URGENCY_THRESHOLD && importance < IMPORTANCE_THRESHOLD) {
    quadrant = "delegate";
  } else {
    quadrant = "drop";
  }

  return { quadrant, confidence: Math.round(confidence * 100) / 100 };
}

// ---- Reason formatter -------------------------------------------------------

export function formatReason(
  urgencyReasons: string[],
  importanceReasons: string[],
): string {
  const u = urgencyReasons.length > 0
    ? `Urgent: ${urgencyReasons.join("; ")}`
    : "Urgent: no signal";
  const i = importanceReasons.length > 0
    ? `Important: ${importanceReasons.join("; ")}`
    : "Important: no signal";
  return `${u} | ${i}`;
}
