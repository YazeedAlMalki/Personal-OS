import { createClient } from "@/lib/supabase/server";
import { listDecisions } from "@/lib/domains/decisions";
import { Panel } from "@/components/ui/Panel";
import { AddRecord } from "@/components/crud/AddRecord";
import { ItemRow } from "@/components/crud/ItemRow";

export default async function DecisionsPage() {
  const supabase = await createClient();
  let decisions;
  try {
    decisions = await listDecisions(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Decision Journal">
          <p className="text-sm text-danger">Could not load decisions. Check Supabase env vars and migrations.</p>
        </Panel>
      </div>
    );
  }

  const open = decisions.filter((d) => d.status === "open" || d.status === "reviewing");
  const today = new Date().toISOString().slice(0, 10);
  const dueReview = decisions.filter(
    (d) => d.status !== "reviewed" && d.review_date != null && d.review_date <= today,
  ).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Decision Journal</h1>
        <p className="text-sm text-ink-3">
          {open.length} open ·{" "}
          {dueReview > 0 ? (
            <span className="text-danger">{dueReview} due for review</span>
          ) : (
            "none due for review"
          )}
        </p>
      </div>
      <Panel>
        <AddRecord
          endpoint="/api/decisions"
          submitLabel="Log decision"
          fields={[
            { name: "title", placeholder: "What did you decide?", required: true, width: "full" },
            { name: "expected_outcome", placeholder: "Expected outcome", width: "half" },
            { name: "review_date", placeholder: "Review on", type: "date", width: "half" },
          ]}
        />
      </Panel>
      <Panel title={`All decisions (${decisions.length})`}>
        {decisions.length === 0 ? (
          <p className="text-sm text-ink-3">
            No decisions logged. Logging decisions + a review date is how the system learns your judgment —
            the decision-review sweep nags you when a review comes due.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {decisions.map((d) => (
              <ItemRow
                key={d.id}
                endpoint="/api/decisions"
                id={d.id}
                title={d.title}
                badge={d.status}
                subtitle={[
                  d.review_date ? `review ${d.review_date}` : null,
                  d.expected_outcome ? `expects: ${d.expected_outcome}` : null,
                  d.lesson_learned ? `lesson: ${d.lesson_learned}` : null,
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
