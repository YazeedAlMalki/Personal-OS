import { createClient } from "@/lib/supabase/server";
import { listRisks } from "@/lib/domains/risks";
import { Panel } from "@/components/ui/Panel";
import { AddItem } from "@/components/crud/AddItem";
import { ItemRow } from "@/components/crud/ItemRow";
import { ModuleForecasts } from "@/components/insights/ModuleForecasts";

export default async function RisksPage() {
  const supabase = await createClient();
  let risks;
  try {
    risks = await listRisks(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Risk Register">
          <p className="text-sm text-danger">
            Could not load risks. Check Supabase env vars and migrations.
          </p>
        </Panel>
      </div>
    );
  }

  const open = risks.filter((r) => r.status !== "closed");
  const exposure = open.reduce((sum, r) => sum + (r.risk_score ?? 0), 0);
  const unmitigated = open.filter(
    (r) => (r.risk_score ?? 0) >= 15 && !r.mitigation_plan,
  ).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Risk Register</h1>
        <p className="text-sm text-ink-3">
          Exposure:{" "}
          <span className="font-semibold text-ink-4">{exposure} pts</span> ·{" "}
          {unmitigated > 0 ? (
            <span className="text-danger">{unmitigated} high w/o mitigation</span>
          ) : (
            "no unmitigated highs"
          )}
        </p>
      </div>
      <ModuleForecasts tables={["risks"]} title="Risk forecasts" />
      <Panel>
        <AddItem endpoint="/api/risks" placeholder="New risk…" />
      </Panel>
      <Panel title={`All risks (${risks.length})`}>
        {risks.length === 0 ? (
          <p className="text-sm text-ink-3">No risks logged.</p>
        ) : (
          <ul className="divide-y divide-line">
            {risks.map((r) => (
              <ItemRow
                key={r.id}
                endpoint="/api/risks"
                id={r.id}
                title={r.title}
                badge={r.status}
                subtitle={`score ${r.risk_score ?? 0}/25 · ${r.category}${
                  r.mitigation_plan ? " · mitigated" : " · no mitigation plan"
                }`}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
