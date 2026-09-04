import { createClient } from "@/lib/supabase/server";
import { buildSnapshot } from "@/lib/chief/snapshot";
import { runChiefOfStaff, type Insight } from "@/lib/chief";
import { Panel } from "@/components/ui/Panel";
import { InsightActions } from "@/components/insights/InsightActions";
import { AskPanel } from "@/components/ask/AskPanel";

const SEV: Record<string, string> = {
  critical: "text-danger",
  high: "text-danger",
  medium: "text-warn",
  low: "text-ink-3",
  info: "text-ink-3",
};

type PersistedInsight = {
  id: string;
  insight_type: string;
  title: string;
  body: string | null;
  severity: string;
  status: string;
  confidence_score: number | null;
  created_at: string;
};

export default async function InsightsPage() {
  const supabase = await createClient();
  let liveInsights: Insight[] = [];
  let failed = false;
  try {
    liveInsights = runChiefOfStaff(await buildSnapshot(supabase));
  } catch {
    failed = true;
  }

  // Read persisted forecast + correlation rows (written by cron jobs).
  const [{ data: forecastRows }, { data: corrRows }] = await Promise.all([
    supabase
      .from("ai_insights")
      .select("id,insight_type,title,body,severity,status,confidence_score,created_at")
      .eq("insight_type", "forecast")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ai_insights")
      .select("id,insight_type,title,body,severity,status,confidence_score,created_at")
      .eq("insight_type", "correlation")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const forecasts = (forecastRows ?? []) as PersistedInsight[];
  const correlations = (corrRows ?? []) as PersistedInsight[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-4">Insights</h1>
        <p className="text-sm text-ink-3">
          Chief of Staff (live rules), forecasts (daily cron), correlations
          (weekly cron). All deterministic.
        </p>
      </header>

      <Panel title="Ask your OS — answers come only from your captured memory">
        <AskPanel />
      </Panel>

      {failed ? (
        <Panel>
          <p className="text-sm text-danger">
            Could not load data. Check Supabase env and migrations.
          </p>
        </Panel>
      ) : (
        <Panel title={`Chief of Staff (${liveInsights.length})`}>
          {liveInsights.length === 0 ? (
            <p className="text-sm text-ink-3">
              All clear — nothing needs your attention right now.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {liveInsights.map((i, idx) => (
                <li key={idx} className="flex items-start gap-3 py-3">
                  <span
                    className={`mt-0.5 text-xs font-semibold uppercase ${SEV[i.severity] ?? "text-ink-3"}`}
                  >
                    {i.severity}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-4">{i.title}</p>
                    {i.body && <p className="text-xs text-ink-3">{i.body}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title={`Forecasts (${forecasts.length})`}>
        {forecasts.length === 0 ? (
          <p className="text-sm text-ink-3">
            No forecasts yet. The daily forecast cron writes here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {forecasts.map((f) => (
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
                <InsightActions
                  id={f.id}
                  initialStatus={f.status as "new" | "seen" | "acted" | "dismissed" | "snoozed"}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Correlations (${correlations.length})`}>
        {correlations.length === 0 ? (
          <p className="text-sm text-ink-3">
            No correlations yet. The weekly analytics cron writes here.
            Association ≠ causation — these are pattern hints only.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {correlations.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-4">{c.title}</p>
                  {c.body && <p className="text-xs text-ink-3">{c.body}</p>}
                </div>
                <InsightActions
                  id={c.id}
                  initialStatus={c.status as "new" | "seen" | "acted" | "dismissed" | "snoozed"}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
