import type { SupabaseClient } from "@supabase/supabase-js";

// Phase 8 — in-app demo mode.
//
// Loads a small, clearly-tagged showcase dataset through the *user-scoped*
// client (RLS applies; rows belong to the signed-in user). Every row's title
// starts with DEMO_TAG so demo data is unambiguous on screen and `clearDemo`
// can remove exactly what `loadDemo` created — and nothing else.
//
// This is the lightweight in-app counterpart to `supabase/seed.sql` (which is
// richer but requires the SQL editor). Fixtures are crafted to trigger the
// Chief-of-Staff rules and forecasters so the intelligence layer demos well:
// an overdue task, a serially-postponed task, a stale goal, a stalled project,
// an idle high-value opportunity, and an unmitigated high risk.

export const DEMO_TAG = "[demo]";

const t = (s: string) => `${DEMO_TAG} ${s}`;
const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Tables covered by demo mode — all have a `title` column we can tag.
export const DEMO_TABLES = [
  "tasks",
  "goals",
  "projects",
  "opportunities",
  "risks",
] as const;

export async function loadDemo(supabase: SupabaseClient): Promise<void> {
  await clearDemo(supabase); // idempotent: never duplicate fixtures

  const { error: gErr } = await supabase.from("goals").insert([
    {
      title: t("Ship Personal OS V2"),
      category: "career",
      status: "active",
      progress_percentage: 35,
      deadline: daysFromNow(45),
      why_it_matters: "My daily operating system",
      next_action: "Finish Phase 8",
    },
    {
      title: t("Run a half marathon"),
      category: "health",
      status: "active",
      progress_percentage: 60,
      deadline: daysFromNow(90),
      next_action: "Long run Saturday",
    },
  ]);
  if (gErr) throw gErr;

  const { error: pErr } = await supabase.from("projects").insert([
    {
      title: t("Personal OS build"),
      status: "active",
      priority: "high",
      progress_percentage: 35,
    },
    {
      title: t("Q2 tax filing"),
      status: "active",
      priority: "medium",
      progress_percentage: 10,
    },
  ]);
  if (pErr) throw pErr;

  const { error: tErr } = await supabase.from("tasks").insert([
    {
      title: t("Email accountant about Q2"),
      status: "todo",
      priority: "high",
      due_date: daysFromNow(-3), // overdue → deadline-risk forecast + chief rule
    },
    {
      title: t("Refactor capture pipeline"),
      status: "todo",
      priority: "medium",
      postpone_count: 4, // serial postponement rule
    },
    {
      title: t("Draft investor update"),
      status: "in_progress",
      priority: "high",
      due_date: daysFromNow(1),
    },
    { title: t("Book dentist"), status: "todo", priority: "low", due_date: daysFromNow(5) },
  ]);
  if (tErr) throw tErr;

  const { error: oErr } = await supabase.from("opportunities").insert([
    {
      title: t("Consulting retainer — Acme"),
      status: "negotiating",
      estimated_value: 50_000,
      probability: 0.6,
      deadline: daysFromNow(20),
      // no next_action → idle high-value opportunity rule
    },
    {
      title: t("Workshop — Northwind"),
      status: "contacted",
      estimated_value: 8_000,
      probability: 0.4,
      next_action: "Send proposal",
    },
  ]);
  if (oErr) throw oErr;

  const { error: rErr } = await supabase.from("risks").insert([
    {
      title: t("Single point of failure: no DB backups verified"),
      category: "data_loss",
      probability: 4,
      impact: 5, // score 20, no mitigation_plan → unmitigated-high rule + forecast
      status: "open",
    },
    {
      title: t("Key client concentration"),
      category: "business",
      probability: 3,
      impact: 4,
      mitigation_plan: "Diversify pipeline; 2 new leads/month",
      status: "mitigating",
    },
  ]);
  if (rErr) throw rErr;
}

export async function clearDemo(supabase: SupabaseClient): Promise<void> {
  for (const table of DEMO_TABLES) {
    const { error } = await supabase
      .from(table)
      .delete()
      .like("title", `${DEMO_TAG} %`);
    if (error) throw error;
  }
}
