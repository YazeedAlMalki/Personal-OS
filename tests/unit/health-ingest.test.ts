import { describe, it, expect } from "vitest";
import { ingestHealthkit } from "@/lib/domains/health";

// Minimal in-memory fake of the slice of the Supabase API our domain layer uses.
// We only need: profiles.targets, health_daily (upsert/list/update), workouts insert,
// nutrition_logs (date list). Anything else throws — keeps the test honest.
function makeFakeSupabase() {
  const targets: Record<string, unknown> = { steps: 10000, sleepMinutes: 420 };
  const healthDaily: Record<string, Record<string, unknown>> = {}; // key = `${user_id}|${date}`
  const workouts: Record<string, unknown>[] = [];
  const nutrition: Record<string, unknown>[] = [];

  function table(name: string): unknown {
    if (name === "profiles") {
      return {
        select: () => ({
          single: async () => ({ data: { targets }, error: null }),
        }),
      };
    }
    if (name === "health_daily") {
      return new HealthDailyBuilder(healthDaily);
    }
    if (name === "workouts") {
      return {
        insert: (rows: Record<string, unknown>[]) => ({
          select: () => {
            const arr = Array.isArray(rows) ? rows : [rows];
            for (const r of arr) workouts.push({ id: `w${workouts.length + 1}`, ...r });
            return { data: arr.map((_, i) => ({ id: `w${workouts.length - arr.length + i + 1}` })), error: null };
          },
        }),
      };
    }
    if (name === "nutrition_logs") {
      return {
        select: () => ({
          gte: () => ({ data: nutrition, error: null }),
        }),
      };
    }
    throw new Error(`table(${name}) not stubbed`);
  }

  return {
    fake: { from: table } as unknown as import("@supabase/supabase-js").SupabaseClient,
    healthDaily,
    workouts,
  };
}

// `supabase.from("health_daily")` returns a chainable builder. Real Supabase
// resolves on `await`; we expose `.upsert/.select/.update/.eq/.gte/.order` as
// thenables so the domain code can call them naturally.
class HealthDailyBuilder {
  private store: Record<string, Record<string, unknown>>;
  private mode: "noop" | "upsert" | "select" | "update" = "noop";
  private upsertRow: Record<string, unknown> | null = null;
  private updatePatch: Record<string, unknown> = {};
  private filterDate: string | null = null;
  private filterUser: string | null = null;
  private gteDate: string | null = null;

  constructor(store: Record<string, Record<string, unknown>>) {
    this.store = store;
  }

  upsert(row: Record<string, unknown>) {
    this.mode = "upsert";
    this.upsertRow = row;
    return this;
  }

  select(_cols?: string) {
    if (this.mode === "noop") this.mode = "select";
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.mode = "update";
    this.updatePatch = patch;
    return this;
  }

  eq(col: string, val: string) {
    if (col === "date") this.filterDate = val;
    if (col === "user_id") this.filterUser = val;
    return this;
  }

  gte(_col: string, val: string) {
    this.gteDate = val;
    return this;
  }

  order(_col: string, _opts?: unknown) {
    return this;
  }

  single() {
    return this.execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error }));
  }

  maybeSingle() {
    return this.single();
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: (value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: Record<string, unknown>[]; error: unknown }> {
    if (this.mode === "upsert" && this.upsertRow) {
      const date = this.upsertRow.date as string;
      const userId = (this.upsertRow.user_id as string) ?? "anon";
      const key = `${userId}|${date}`;
      const prev = this.store[key] ?? { id: `h${Object.keys(this.store).length + 1}`, user_id: userId, date };
      const merged = { ...prev, ...this.upsertRow };
      this.store[key] = merged;
      return { data: [merged], error: null };
    }
    if (this.mode === "update") {
      const rows = Object.values(this.store).filter((r) => {
        if (this.filterDate && r.date !== this.filterDate) return false;
        if (this.filterUser && r.user_id !== this.filterUser) return false;
        return true;
      });
      for (const r of rows) Object.assign(r, this.updatePatch);
      return { data: rows, error: null };
    }
    // select mode
    let rows = Object.values(this.store);
    if (this.gteDate) rows = rows.filter((r) => (r.date as string) >= this.gteDate!);
    if (this.filterDate) rows = rows.filter((r) => r.date === this.filterDate);
    if (this.filterUser) rows = rows.filter((r) => r.user_id === this.filterUser);
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { data: rows, error: null };
  }
}

describe("ingestHealthkit", () => {
  it("upserts (user_id,date) idempotently — second POST overwrites, no dupes", async () => {
    const { fake, healthDaily } = makeFakeSupabase();
    const body = {
      date: "2026-06-10",
      source: "healthkit" as const,
      steps: 8200,
      sleep_minutes: 420,
      resting_heart_rate: 56,
      hrv: 65,
      active_energy_burned: 480,
    };
    const r1 = await ingestHealthkit(fake, "user-1", body);
    expect(r1.healthDaily.date).toBe("2026-06-10");
    expect(Object.keys(healthDaily)).toHaveLength(1);
    expect(r1.healthDaily.steps).toBe(8200);

    // Resend a fresher reading for the same day with an updated step count.
    const r2 = await ingestHealthkit(fake, "user-1", { ...body, steps: 11_000 });
    expect(Object.keys(healthDaily)).toHaveLength(1); // still one row
    expect(r2.healthDaily.steps).toBe(11_000);
  });

  it("rolls embedded workouts[] into the health_daily counters", async () => {
    const { fake } = makeFakeSupabase();
    const r = await ingestHealthkit(fake, "user-2", {
      date: "2026-06-10",
      source: "healthkit",
      sleep_minutes: 420,
      workouts: [
        { workout_type: "run", duration_minutes: 30 },
        { workout_type: "lift", duration_minutes: 45 },
      ],
    });
    expect(r.workoutsInserted).toBe(2);
    expect(r.healthDaily.workouts_count).toBe(2);
    expect(r.healthDaily.workout_minutes).toBe(75);
  });

  it("computes recovery/activity/nutrition scores on ingest", async () => {
    const { fake } = makeFakeSupabase();
    const r = await ingestHealthkit(fake, "user-3", {
      date: "2026-06-10",
      source: "healthkit",
      steps: 10_000,
      sleep_minutes: 420,
      resting_heart_rate: 58,
      hrv: 65,
      active_energy_burned: 500,
      calories_consumed: 2200,
      protein_grams: 140,
    });
    expect(typeof r.healthDaily.recovery_score).toBe("number");
    expect(r.healthDaily.activity_score).toBeGreaterThan(0);
    expect(r.healthDaily.nutrition_score).toBeGreaterThan(0);
  });
});
