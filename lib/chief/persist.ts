import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight } from "@/lib/chief/types";

// Write Chief of Staff insights to the ai_insights table with deduplication.
// The unique index (user_id, insight_type, related_record_id, UTC-day) rejects
// same-day duplicates at the DB level, so upsert-on-conflict is the right move.

// Resolve the install's user for service-role cron writes. Single-user
// convention (same as /api/ingest/healthkit): first profile wins.
export async function resolveSingleUserId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export type PersistResult = {
  inserted: number;
  skipped: number;
  errors: string[];
};

// `userId` is REQUIRED when called with the service-role client: ai_insights.user_id
// defaults to auth.uid(), which is NULL for service role → NOT NULL violation.
// (Found live 2026-06-10: cron generated 14 insights, persisted 0.)
export async function persistInsights(
  supabase: SupabaseClient,
  insights: Insight[],
  userId?: string,
): Promise<PersistResult> {
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const insight of insights) {
    const row = {
      insight_type: insight.insight_type,
      title: insight.title,
      body: insight.body ?? null,
      confidence_score: insight.confidence_score ?? null,
      related_table: insight.related_table ?? null,
      related_record_id: insight.related_record_id ?? null,
      severity: insight.severity,
      status: "new",
      ...(userId ? { user_id: userId } : {}),
    };

    const { error } = await supabase.from("ai_insights").insert(row);

    if (error) {
      // 23505 = unique_violation → same-day duplicate, expected.
      if (error.code === "23505") {
        skipped++;
      } else {
        errors.push(`${insight.insight_type}: ${error.message}`);
      }
    } else {
      inserted++;
    }
  }

  return { inserted, skipped, errors };
}

// Format insights as a plain-text briefing for Telegram / email.
export function formatBriefing(insights: Insight[], date: Date): string {
  if (insights.length === 0) return "All clear — nothing flagged today.";

  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: process.env.USER_TIMEZONE || "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🔵",
    info: "⚪",
  };

  const lines = [
    `<b>Chief of Staff — ${dateStr}</b>`,
    "",
  ];

  // Group by severity.
  const groups = new Map<string, Insight[]>();
  for (const i of insights) {
    const group = groups.get(i.severity) ?? [];
    group.push(i);
    groups.set(i.severity, group);
  }

  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    const items = groups.get(sev);
    if (!items || items.length === 0) continue;
    const emoji = severityEmoji[sev] ?? "";
    for (const item of items) {
      lines.push(`${emoji} <b>${item.title}</b>`);
      if (item.body) lines.push(`   ${item.body}`);
    }
    lines.push("");
  }

  lines.push(`${insights.length} item(s) flagged.`);
  return lines.join("\n");
}
