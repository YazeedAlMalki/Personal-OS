import { createClient } from "@/lib/supabase/server";
import { listLearningItems } from "@/lib/domains/learning";
import { Panel } from "@/components/ui/Panel";
import { AddRecord } from "@/components/crud/AddRecord";
import { ItemRow } from "@/components/crud/ItemRow";

export default async function LearningPage() {
  const supabase = await createClient();
  let items;
  try {
    items = await listLearningItems(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Learning">
          <p className="text-sm text-danger">Could not load learning items. Check Supabase env vars and migrations.</p>
        </Panel>
      </div>
    );
  }

  const active = items.filter((i) => i.status === "active");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Learning</h1>
        <p className="text-sm text-ink-3">{active.length} active of {items.length}</p>
      </div>
      <Panel>
        <AddRecord
          endpoint="/api/learning"
          submitLabel="Add"
          fields={[
            { name: "title", placeholder: "What are you learning?", required: true, width: "full" },
            { name: "subject", placeholder: "Subject", width: "third" },
            { name: "type", placeholder: "Type", options: ["course", "book", "skill", "language", "certification"], width: "third" },
            { name: "next_action", placeholder: "Next action", width: "third" },
          ]}
        />
      </Panel>
      <Panel title={`All items (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing in the learning queue.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <ItemRow
                key={i.id}
                endpoint="/api/learning"
                id={i.id}
                title={i.title}
                badge={i.status}
                subtitle={[
                  i.subject,
                  i.type,
                  `${Math.round(i.progress_percentage)}%`,
                  i.next_action ? `next: ${i.next_action}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
