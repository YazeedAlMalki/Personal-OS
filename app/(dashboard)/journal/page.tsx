import { createClient } from "@/lib/supabase/server";
import { listJournalEntries } from "@/lib/domains/journal";
import { Panel } from "@/components/ui/Panel";
import { JournalCompose } from "@/components/journal/JournalCompose";
import { ItemRow } from "@/components/crud/ItemRow";

export default async function JournalPage() {
  const supabase = await createClient();
  let entries;
  try {
    entries = await listJournalEntries(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Journal">
          <p className="text-sm text-danger">Could not load the journal. Check Supabase env vars and migrations.</p>
        </Panel>
      </div>
    );
  }

  const last7 = entries.filter(
    (e) => Date.now() - new Date(e.entry_date).getTime() < 7 * 86_400_000,
  );
  const moods = last7.map((e) => e.mood).filter((m): m is number => m != null);
  const avgMood = moods.length ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Journal</h1>
        <p className="text-sm text-ink-3">
          {last7.length} entries this week{avgMood ? ` · mood ${avgMood}/5` : ""}
        </p>
      </div>
      <Panel title="New entry">
        <JournalCompose />
      </Panel>
      <Panel title={`Entries (${entries.length})`}>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-3">
            No entries yet. Journal entries are embedded into memory — /api/ask can answer questions
            about what you wrote.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <ItemRow
                key={e.id}
                endpoint="/api/journal"
                id={e.id}
                title={e.raw_text.length > 140 ? e.raw_text.slice(0, 140) + "…" : e.raw_text}
                badge={e.mood != null ? `mood ${e.mood}/5` : undefined}
                subtitle={[
                  e.entry_date,
                  e.energy_level != null ? `energy ${e.energy_level}/5` : null,
                  e.stress_level != null ? `stress ${e.stress_level}/5` : null,
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
