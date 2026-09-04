import { createClient } from "@/lib/supabase/server";
import { listEvents } from "@/lib/domains/calendar";
import { Panel } from "@/components/ui/Panel";
import { AddRecord } from "@/components/crud/AddRecord";
import { ItemRow } from "@/components/crud/ItemRow";
import { SyncButton } from "@/components/calendar/SyncButton";

export default async function CalendarPage() {
  const supabase = await createClient();
  let events;
  const from = new Date(Date.now() - 86_400_000).toISOString();
  try {
    events = await listEvents(supabase, { from, limit: 100 });
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Calendar">
          <p className="text-sm text-danger">Could not load events. Check Supabase env vars and migrations.</p>
        </Panel>
      </div>
    );
  }

  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const day = e.start_time.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Calendar</h1>
        <SyncButton />
      </div>
      <Panel title="Add event">
        <AddRecord
          endpoint="/api/calendar"
          submitLabel="Add"
          fields={[
            { name: "title", placeholder: "Event", required: true, width: "full" },
            { name: "start_time", placeholder: "Starts", type: "datetime-local", required: true, width: "third" },
            { name: "end_time", placeholder: "Ends", type: "datetime-local", width: "third" },
            { name: "location", placeholder: "Location", width: "third" },
          ]}
        />
      </Panel>
      {events.length === 0 ? (
        <Panel title="Upcoming">
          <p className="text-sm text-ink-3">
            Nothing scheduled. Add events manually, or set CALENDAR_ICS_URL in .env.local (your
            calendar’s private ICS address) and hit “Sync ICS feed” — read-only, no OAuth needed.
          </p>
        </Panel>
      ) : (
        [...byDay.entries()].map(([day, dayEvents]) => (
          <Panel key={day} title={day}>
            <ul className="divide-y divide-line">
              {dayEvents.map((e) => (
                <ItemRow
                  key={e.id}
                  endpoint="/api/calendar"
                  id={e.id}
                  title={e.title ?? "(untitled)"}
                  badge={e.source}
                  subtitle={[
                    `${e.start_time.slice(11, 16)}${e.end_time ? "–" + e.end_time.slice(11, 16) : ""} UTC`,
                    e.location,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
