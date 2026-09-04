import { createClient } from "@/lib/supabase/server";
import { listOpportunities } from "@/lib/domains/opportunities";
import { Panel } from "@/components/ui/Panel";
import { AddItem } from "@/components/crud/AddItem";
import { ItemRow } from "@/components/crud/ItemRow";
import { ModuleForecasts } from "@/components/insights/ModuleForecasts";

const ACTIVE = new Set(["new", "researching", "contacted", "negotiating", "waiting"]);

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export default async function OpportunitiesPage() {
  const supabase = await createClient();
  let opps;
  try {
    opps = await listOpportunities(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Opportunities">
          <p className="text-sm text-danger">
            Could not load opportunities. Check Supabase env vars and migrations.
          </p>
        </Panel>
      </div>
    );
  }

  const active = opps.filter((o) => ACTIVE.has(o.status));
  const pipeline = active.reduce((sum, o) => sum + (o.expected_value ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Opportunities</h1>
        <p className="text-sm text-ink-3">
          Active pipeline:{" "}
          <span className="font-semibold text-ink-4">{money(pipeline)}</span>{" "}
          expected · {active.length} open
        </p>
      </div>
      <ModuleForecasts tables={["opportunities"]} title="Pipeline forecasts" />
      <Panel>
        <AddItem endpoint="/api/opportunities" placeholder="New opportunity…" />
      </Panel>
      <Panel title={`All opportunities (${opps.length})`}>
        {opps.length === 0 ? (
          <p className="text-sm text-ink-3">No opportunities yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {opps.map((o) => (
              <ItemRow
                key={o.id}
                endpoint="/api/opportunities"
                id={o.id}
                title={o.title}
                badge={o.status}
                subtitle={`${money(o.expected_value)} expected${
                  o.probability != null
                    ? ` (${Math.round(o.probability * 100)}% of ${money(o.estimated_value)})`
                    : ""
                }${o.deadline ? ` · due ${o.deadline}` : ""}`}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
