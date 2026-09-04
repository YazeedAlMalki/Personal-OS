import { createClient } from "@/lib/supabase/server";
import { listGoals } from "@/lib/domains/goals";
import { Panel } from "@/components/ui/Panel";
import { AddItem } from "@/components/crud/AddItem";
import { ItemRow } from "@/components/crud/ItemRow";
import { ModuleForecasts } from "@/components/insights/ModuleForecasts";

export default async function GoalsPage() {
  const supabase = await createClient();
  let goals;
  try {
    goals = await listGoals(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Goals">
          <p className="text-sm text-danger">
            Could not load goals. Check Supabase env vars and migrations.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink-4">Goals</h1>
      <ModuleForecasts tables={["goals"]} title="Goal trajectory" />
      <Panel>
        <AddItem endpoint="/api/goals" placeholder="New goal…" />
      </Panel>
      <Panel title={`All goals (${goals.length})`}>
        {goals.length === 0 ? (
          <p className="text-sm text-ink-3">No goals yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {goals.map((g) => (
              <ItemRow
                key={g.id}
                endpoint="/api/goals"
                id={g.id}
                title={g.title}
                badge={g.status}
                subtitle={`${g.progress_percentage}% complete`}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
