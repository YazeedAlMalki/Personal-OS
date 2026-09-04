import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui/Panel";
import { CommandCenter } from "@/components/dashboard/CommandCenter";
import { buildSnapshot } from "@/lib/chief/snapshot";
import { runChiefOfStaff } from "@/lib/chief";

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-ink-1 p-5 hover:bg-ink-2">
      <p className="font-mono text-3xl text-ink-4">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-ink-3">{label}</p>
    </Link>
  );
}

export default async function TodayPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [priorities, openTasks, activeGoals, activeProjects, dueToday, reviewCount] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id,title,priority,priority_score,due_date")
        .neq("status", "done")
        .order("priority_score", { ascending: false })
        .limit(5),
      supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "done"),
      supabase.from("goals").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("tasks").select("id,title").eq("due_date", today).neq("status", "done"),
      supabase.from("review_queue").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);

  const topTasks = priorities.data ?? [];
  const due = dueToday.data ?? [];
  const insights = runChiefOfStaff(await buildSnapshot(supabase)).slice(0, 4);

  // Most recent persisted forecast + correlation rows for the dashboard cards.
  const [{ data: fRows }, { data: cRows }] = await Promise.all([
    supabase
      .from("ai_insights")
      .select("id,title,severity")
      .eq("insight_type", "forecast")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("ai_insights")
      .select("id,title,body")
      .eq("insight_type", "correlation")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);
  const forecasts = (fRows ?? []) as { id: string; title: string; severity: string }[];
  const correlations = (cRows ?? []) as { id: string; title: string; body: string | null }[];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-4">Today</h1>
        <p className="text-sm text-ink-3">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </header>

      <Panel title="Command center">
        <CommandCenter />
      </Panel>

      {(reviewCount.count ?? 0) > 0 && (
        <Link
          href="/review"
          className="block rounded-2xl border border-line bg-ink-1 p-4 text-sm text-warn hover:bg-ink-2"
        >
          {reviewCount.count} capture{(reviewCount.count ?? 0) === 1 ? "" : "s"} awaiting your review →
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Open tasks" value={openTasks.count ?? 0} href="/tasks" />
        <Stat label="Active goals" value={activeGoals.count ?? 0} href="/goals" />
        <Stat label="Active projects" value={activeProjects.count ?? 0} href="/projects" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top priorities" action={<Link href="/tasks" className="text-xs text-accent hover:underline">All tasks</Link>}>
          {topTasks.length === 0 ? (
            <p className="text-sm text-ink-3">No open tasks. Add one under Tasks.</p>
          ) : (
            <ul className="space-y-2">
              {topTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-ink-4">{t.title}</span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-ink-3">
                    {t.priority}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Due today">
          {due.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing due today.</p>
          ) : (
            <ul className="space-y-2">
              {due.map((t) => (
                <li key={t.id} className="truncate text-sm text-ink-4">
                  {t.title}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Chief of Staff"
          action={
            <Link href="/insights" className="text-xs text-accent hover:underline">
              All
            </Link>
          }
        >
          {insights.length === 0 ? (
            <p className="text-sm text-ink-3">All clear — nothing flagged.</p>
          ) : (
            <ul className="space-y-2">
              {insights.map((i, idx) => (
                <li key={idx} className="text-sm">
                  <span
                    className={`mr-1 text-xs font-semibold uppercase ${
                      i.severity === "high" || i.severity === "critical"
                        ? "text-danger"
                        : i.severity === "medium"
                          ? "text-warn"
                          : "text-ink-3"
                    }`}
                  >
                    •
                  </span>
                  <span className="text-ink-4">{i.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Forecasts"
          action={
            <Link href="/insights" className="text-xs text-accent hover:underline">
              All
            </Link>
          }
        >
          {forecasts.length === 0 ? (
            <p className="text-sm text-ink-3">
              No forecasts yet. The daily cron writes here.
            </p>
          ) : (
            <ul className="space-y-2">
              {forecasts.map((f) => (
                <li key={f.id} className="text-sm">
                  <span
                    className={`mr-1 text-xs font-semibold uppercase ${
                      f.severity === "high" || f.severity === "critical"
                        ? "text-danger"
                        : f.severity === "medium"
                          ? "text-warn"
                          : "text-ink-3"
                    }`}
                  >
                    •
                  </span>
                  <span className="text-ink-4">{f.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Correlations"
          action={
            <Link href="/insights" className="text-xs text-accent hover:underline">
              All
            </Link>
          }
        >
          {correlations.length === 0 ? (
            <p className="text-sm text-ink-3">
              Weekly analytics cron will populate this. Association ≠ causation.
            </p>
          ) : (
            <ul className="space-y-2">
              {correlations.map((c) => (
                <li key={c.id} className="text-sm">
                  <p className="text-ink-4">{c.title}</p>
                  {c.body && (
                    <p className="text-xs text-ink-3 line-clamp-2">{c.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
