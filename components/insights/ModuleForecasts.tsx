import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui/Panel";
import { InsightActions } from "@/components/insights/InsightActions";

// Per-module forecast surfacing (Phase 7). Drops the deterministic forecast
// insights that belong to a given module onto that module's page, so a
// deadline/goal/health warning shows up where you'd act on it — not only on the
// dashboard and /insights. Reads the rows the daily forecast cron persists to
// ai_insights (insight_type = "forecast"); no model is called here.
//
// Renders NOTHING when there are no live forecasts for these tables, so module
// pages stay clean until something actually needs attention.

const SEV: Record<string, string> = {
  critical: "text-danger",
  high: "text-danger",
  medium: "text-warn",
  low: "text-ink-3",
  info: "text-ink-3",
};

type Status = "new" | "seen" | "acted" | "dismissed" | "snoozed";

type ForecastRow = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  status: Status;
  confidence_score: number | null;
  related_table: string | null;
  created_at: string;
};

export async function ModuleForecasts({
  tables,
  title = "Forecasts",
  limit = 6,
}: {
  tables: string[];
  title?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  let rows: ForecastRow[] = [];
  try {
    const { data } = await supabase
      .from("ai_insights")
      .select(
        "id,title,body,severity,status,confidence_score,related_table,created_at",
      )
      .eq("insight_type", "forecast")
      .in("related_table", tables)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(limit);
    rows = (data ?? []) as ForecastRow[];
  } catch {
    return null; // never break a module page on a forecast read
  }

  if (rows.length === 0) return null;

  return (
    <Panel title={title}>
      <ul className="divide-y divide-line">
        {rows.map((f) => (
          <li key={f.id} className="flex items-start gap-3 py-3">
            <span
              className={`mt-0.5 text-xs font-semibold uppercase ${SEV[f.severity] ?? "text-ink-3"}`}
            >
              {f.severity}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-4">{f.title}</p>
              {f.body && <p className="text-xs text-ink-3">{f.body}</p>}
            </div>
            <InsightActions id={f.id} initialStatus={f.status} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
