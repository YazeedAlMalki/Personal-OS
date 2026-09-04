import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runCapturePipeline } from "@/lib/ingestion/pipeline";

// Step 2 smoke: the Telegram bot and the web Command Center now share ONE capture
// path — `runCapturePipeline`. This drives that pipeline directly (the same symbol
// `app/api/capture`, `app/api/telegram/webhook`, and `scripts/telegram-poll.ts`
// all import) and asserts the behavior Alfred's reply depends on:
//   - classification comes from the AI gateway (regex fallback when no model) — `via`
//   - routing matches the canonical router (risk → risks w/ category, not a NOT-NULL fail)
//   - the enriched result carries rawId + scored so the butler reply can render
//   - service-role captures write an owner-stamped audit_log row
//
// No model is reachable in the sandbox, so the gateway deterministically degrades
// to regexClassify and embeddings are skipped — making this fully offline.

// Permissive in-memory Supabase fake: every query resolves cleanly and inserts are
// recorded per-table. Insert→select→single yields a generated id; bare awaits and
// selects yield empty sets (enough for the scoring-context + best-effort graph steps).
function makeFakeSupabase() {
  const inserts: Record<string, Array<Record<string, unknown>>> = {};
  let idCounter = 0;

  function from(table: string): unknown {
    let mode: "insert" | "select" | "update" | "other" = "other";

    const termSingle = () => {
      if (mode === "insert") {
        idCounter += 1;
        return { data: { id: `id_${idCounter}` }, error: null };
      }
      return { data: null, error: null };
    };
    const termMany = () => ({ data: [], error: null });

    const api: Record<string, unknown> = {
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        mode = "insert";
        (inserts[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return proxy;
      },
      upsert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        mode = "insert";
        (inserts[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return proxy;
      },
      update() {
        mode = "update";
        return proxy;
      },
      select() {
        if (mode === "other") mode = "select";
        return proxy;
      },
      single: () => Promise.resolve(termSingle()),
      maybeSingle: () => Promise.resolve(termSingle()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(termMany()).then(res, rej),
    };

    // Any other chained filter (eq, in, is, neq, not, order, limit, ilike, …) → self.
    const proxy: unknown = new Proxy(api, {
      get(t, prop: string) {
        if (prop in t) return (t as Record<string, unknown>)[prop];
        return () => proxy;
      },
    });
    return proxy;
  }

  return { fake: { from } as unknown as SupabaseClient, inserts };
}

describe("runCapturePipeline (shared Telegram + web capture path)", () => {
  it("creates a task with the enriched reply contract (rawId + scored + gateway via)", async () => {
    const { fake, inserts } = makeFakeSupabase();
    const result = await runCapturePipeline({
      text: "Call Sam tomorrow about the project",
      source: "telegram",
      supabase: fake,
      userId: "u1",
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.table).toBe("tasks");
    expect(result.via).toBe("regex"); // AI gateway fell back to the deterministic classifier
    expect(result.rawId).toBeTruthy(); // review/undo buttons need this
    expect(result.scored).toBeDefined(); // task reply shows the quadrant
    expect(["do_now", "schedule", "delegate", "drop"]).toContain(result.scored?.quadrant);

    // Owner-stamped audit row was written for this service-role capture.
    const auditRows = inserts["audit_log"] ?? [];
    expect(auditRows[0]?.user_id).toBe("u1");
    expect(auditRows[0]?.table_name).toBe("tasks");
  });

  it("routes a risk through the canonical router (category set, no NOT-NULL failure)", async () => {
    const { fake, inserts } = makeFakeSupabase();
    const result = await runCapturePipeline({
      text: "Risk: the vendor contract might fail and we could lose the account",
      source: "telegram",
      supabase: fake,
      userId: "u1",
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.table).toBe("risks");
    const riskRows = inserts["risks"] ?? [];
    expect(riskRows[0]?.category).toBe("business"); // the old Telegram capture() omitted this
  });

  it("low-confidence input lands in the review queue (not auto-created)", async () => {
    const { fake, inserts } = makeFakeSupabase();
    const result = await runCapturePipeline({
      text: "the weather is rather pleasant out there",
      source: "telegram",
      supabase: fake,
      userId: "u1",
    });

    expect(result.status).toBe("review");
    if (result.status !== "review") return;
    expect(result.rawId).toBeTruthy();
    expect((inserts["review_queue"] ?? []).length).toBe(1);
  });
});
