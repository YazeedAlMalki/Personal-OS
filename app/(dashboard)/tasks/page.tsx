import { createClient } from "@/lib/supabase/server";
import { listTasks } from "@/lib/domains/tasks";
import { Panel } from "@/components/ui/Panel";
import { AddTask } from "@/components/tasks/AddTask";
import { TaskRow } from "@/components/tasks/TaskRow";
import { ModuleForecasts } from "@/components/insights/ModuleForecasts";

export default async function TasksPage() {
  const supabase = await createClient();
  let tasks;
  try {
    tasks = await listTasks(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Tasks">
          <p className="text-sm text-danger">
            Could not load tasks. Check your Supabase env vars and that migrations have run.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink-4">Tasks</h1>
      <ModuleForecasts tables={["tasks"]} title="Deadline & completion risk" />
      <Panel>
        <AddTask />
      </Panel>
      <Panel title={`All tasks (${tasks.length})`}>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-3">No tasks yet. Add your first above.</p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
