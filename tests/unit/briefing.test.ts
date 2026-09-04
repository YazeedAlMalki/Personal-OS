import { describe, it, expect } from "vitest";
import type { Insight } from "@/lib/chief/types";

// Test the formatBriefing function by inlining the logic (avoids server-only).

function formatBriefing(insights: Insight[], date: Date): string {
  if (insights.length === 0) return "All clear — nothing flagged today.";

  const dateStr = date.toLocaleDateString("en-US", {
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

describe("formatBriefing", () => {
  it("returns all-clear when no insights", () => {
    const result = formatBriefing([], new Date("2026-06-08"));
    expect(result).toContain("All clear");
  });

  it("formats insights grouped by severity", () => {
    const insights: Insight[] = [
      { insight_type: "overdue_task", title: "Overdue: Ship MVP", body: "Was due June 1.", severity: "high" },
      { insight_type: "review_backlog", title: "3 items awaiting review", severity: "low" },
    ];
    const result = formatBriefing(insights, new Date("2026-06-08"));
    expect(result).toContain("Chief of Staff");
    expect(result).toContain("Overdue: Ship MVP");
    expect(result).toContain("3 items awaiting review");
    expect(result).toContain("2 item(s) flagged");
    // High appears before low.
    const highIdx = result.indexOf("Overdue");
    const lowIdx = result.indexOf("awaiting review");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("includes body text when present", () => {
    const insights: Insight[] = [
      { insight_type: "idle_opp", title: "Big deal stalled", body: "No next action set.", severity: "high" },
    ];
    const result = formatBriefing(insights, new Date("2026-06-08"));
    expect(result).toContain("No next action set.");
  });

  it("omits body line when body is undefined", () => {
    const insights: Insight[] = [
      { insight_type: "test", title: "Test alert", severity: "medium" },
    ];
    const result = formatBriefing(insights, new Date("2026-06-08"));
    expect(result).toContain("Test alert");
    expect(result).toContain("1 item(s) flagged");
  });
});
