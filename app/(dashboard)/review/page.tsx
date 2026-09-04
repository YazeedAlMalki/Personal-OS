import { createClient } from "@/lib/supabase/server";
import { listOpenReviews } from "@/lib/ingestion/review";
import { Panel } from "@/components/ui/Panel";
import { ReviewItem } from "@/components/review/ReviewItem";

export default async function ReviewPage() {
  const supabase = await createClient();
  let items: Array<Record<string, unknown>> = [];
  try {
    items = (await listOpenReviews(supabase)) as Array<Record<string, unknown>>;
  } catch {
    return (
      <div className="mx-auto max-w-3xl">
        <Panel title="Review queue">
          <p className="text-sm text-danger">Could not load the review queue.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink-4">Review queue</h1>
      <Panel title={`Awaiting review (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm text-ink-3">
            Nothing to review. Low-confidence captures land here so nothing wrong is written silently.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((it) => (
              <ReviewItem
                key={String(it.id)}
                id={String(it.id)}
                proposedTable={String(it.proposed_table)}
                proposed={(it.proposed_record as Record<string, unknown>) ?? {}}
                confidence={(it.confidence as number | null) ?? null}
                reason={String(it.reason)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
