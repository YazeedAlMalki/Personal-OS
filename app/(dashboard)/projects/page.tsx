import { createClient } from "@/lib/supabase/server";
import { listProjects } from "@/lib/domains/projects";
import { Panel } from "@/components/ui/Panel";
import { AddItem } from "@/components/crud/AddItem";
import { ItemRow } from "@/components/crud/ItemRow";

export default async function ProjectsPage() {
  const supabase = await createClient();
  let projects;
  try {
    projects = await listProjects(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Projects">
          <p className="text-sm text-danger">
            Could not load projects. Check Supabase env vars and migrations.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink-4">Projects</h1>
      <Panel>
        <AddItem endpoint="/api/projects" placeholder="New project…" />
      </Panel>
      <Panel title={`All projects (${projects.length})`}>
        {projects.length === 0 ? (
          <p className="text-sm text-ink-3">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {projects.map((p) => (
              <ItemRow
                key={p.id}
                endpoint="/api/projects"
                id={p.id}
                title={p.title}
                badge={p.status}
                subtitle={`${p.priority} priority · ${p.progress_percentage}%`}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
