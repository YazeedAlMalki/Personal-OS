// Eisenhower Matrix — build scoring context from Supabase.
// Loads active goals, projects, and high-value opportunities so the
// scoring engine can evaluate importance without per-task queries.

// NOTE: intentionally no `import "server-only"`. This is a plain DB-query helper
// (takes a SupabaseClient, touches no secrets/cookies) and the capture pipeline
// that uses it must also be importable from the standalone Telegram poller under
// tsx. Matches the existing convention in lib/domains/{health,export}.ts and
// lib/integrations/ical.ts, which omit the guard so tests/scripts can import them.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoringContext } from "./types";

export async function buildScoringContext(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ScoringContext> {
  const [goalsRes, projectsRes, oppsRes] = await Promise.all([
    supabase
      .from("goals")
      .select("id, title, deadline")
      .eq("status", "active"),
    supabase
      .from("projects")
      .select("id")
      .eq("status", "active"),
    supabase
      .from("opportunities")
      .select("id, expected_value")
      .in("status", ["new", "researching", "contacted", "negotiating", "waiting"]),
  ]);

  const goals = (goalsRes.data ?? []) as Array<{ id: string; title: string; deadline: string | null }>;
  const projects = (projectsRes.data ?? []) as Array<{ id: string }>;
  const opps = (oppsRes.data ?? []) as Array<{ id: string; expected_value: number | null }>;

  // High-value = top quartile by expected_value.
  const values = opps
    .map((o) => o.expected_value ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const q3 = values.length > 0
    ? (values[Math.floor(0.75 * (values.length - 1))] ?? 0)
    : 0;

  const activeGoalIds = new Set(goals.map((g) => g.id));
  const activeProjectIds = new Set(projects.map((p) => p.id));
  const highValueOppIds = new Set(
    opps.filter((o) => q3 > 0 && (o.expected_value ?? 0) >= q3).map((o) => o.id),
  );
  const goalMeta = new Map(
    goals.map((g) => [g.id, { title: g.title, deadline: g.deadline }]),
  );

  return { now, activeGoalIds, activeProjectIds, highValueOppIds, goalMeta };
}
