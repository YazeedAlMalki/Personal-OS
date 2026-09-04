#!/usr/bin/env npx tsx
// Backfill Eisenhower quadrant scores on all existing tasks.
// Run once after applying migration 0012_eisenhower.sql:
//   npx tsx scripts/backfill-quadrants.ts
//
// Scoring is NOT reimplemented here — it imports the canonical OS-core modules
// (the same ones the capture pipeline uses), so a backfill can never drift from
// live scoring. tsx resolves the @/ path aliases from tsconfig with no flags.

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { classifyQuadrant, urgencyToPriority } from "@/lib/eisenhower";
import { buildScoringContext } from "@/lib/eisenhower/context";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const now = new Date();

  // Active goals/projects/high-value opps for importance scoring (canonical loader).
  const ctx = await buildScoringContext(sb, now);

  // Load all open tasks.
  const { data: tasks, error } = await sb
    .from("tasks")
    .select(
      "id, title, description, due_date, priority, postpone_count, related_goal_id, related_project_id, related_opportunity_id",
    )
    .not("status", "in", '("done","dropped")');

  if (error) {
    console.error("Failed to load tasks:", error.message);
    process.exit(1);
  }

  if (!tasks || tasks.length === 0) {
    console.log("No open tasks to backfill.");
    return;
  }

  console.log(`Backfilling ${tasks.length} task(s)...`);

  let updated = 0;
  for (const t of tasks) {
    const scored = classifyQuadrant(
      {
        title: t.title as string,
        description: t.description as string | null,
        due_date: t.due_date as string | null,
        priority: t.priority as string | null,
        postpone_count: (t.postpone_count as number) ?? 0,
        related_goal_id: t.related_goal_id as string | null,
        related_project_id: t.related_project_id as string | null,
        related_opportunity_id: t.related_opportunity_id as string | null,
      },
      ctx,
    );

    const { error: upErr } = await sb
      .from("tasks")
      .update({
        urgency_score: scored.urgency,
        importance_score: scored.importance,
        quadrant: scored.quadrant,
        quadrant_confidence: scored.confidence,
        quadrant_reason: scored.reason,
        priority: urgencyToPriority(scored.urgency),
        priority_score: scored.urgency,
      })
      .eq("id", t.id as string);

    if (upErr) {
      console.error(`  ✗ ${t.title}: ${upErr.message}`);
    } else {
      console.log(`  ✓ ${t.title} → ${scored.quadrant} (${Math.round(scored.confidence * 100)}%)`);
      updated++;
    }
  }

  console.log(`\nDone: ${updated}/${tasks.length} tasks scored.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
