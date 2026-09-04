import { describe, it, expect } from "vitest";
import { syncHaeWorkouts, ingestHealthkit } from "@/lib/domains/health";
import type { MappedWorkout } from "@/lib/domains/health-auto-export";

// In-memory fake of the Supabase slice syncHaeWorkouts touches:
// workouts (select/eq/in/insert), health_daily (upsert/select/update),
// profiles.targets, nutrition_logs. Same convention as health-ingest.test.ts.
function makeFakeSupabase() {
  const healthDaily: Record<string, Record<string, unknown>> = {}; // `${user_id}|${date}`
  const workouts: Record<string, unknown>[] = [];

  function table(name: string): unknown {
    if (name === "profiles") {
      return { select: () => ({ single: async () => ({ data: { targets: {} }, error: null }) }) };
    }
    if (name === "health_daily") return new HealthDailyBuilder(healthDaily);
    if (name === "workouts") return new WorkoutsBuilder(workouts);
    if (name === "nutrition_logs") {
      return { select: () => ({ gte: async () => ({ data: [], error: null }) }) };
    }
    throw new Error(`table(${name}) not stubbed`);
  }

  return {
    fake: { from: table } as unknown as import("@supabase/supabase-js").SupabaseClient,
    healthDaily,
    workouts,
  };
}

class WorkoutsBuilder {
  private rows: Record<string, unknown>[];
  private filters: Array<(r: Record<string, unknown>) => boolean> = [];
  private inserted: Record<string, unknown>[] | null = null;

  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
  }
  select(_cols?: string) {
    if (this.inserted) {
      const start = this.rows.length + 1;
      for (const r of this.inserted) this.rows.push({ id: `w${this.rows.length + 1}`, ...r });
      return Promise.resolve({ data: this.inserted.map((_, i) => ({ id: `w${start + i}` })), error: null });
    }
    return this;
  }
  insert(rows: Record<string, unknown>[] | Record<string, unknown>) {
    this.inserted = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: string) {
    this.filters.push((r) => String(r[col]) >= val);
    return this;
  }
  order() {
    return this;
  }
  then<T1 = unknown, T2 = never>(
    onfulfilled?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
    onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
  ): Promise<T1 | T2> {
    const data = this.rows.filter((r) => this.filters.every((f) => f(r)));
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

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
  order() {
    return this;
  }
  single() {
    return this.execute().then((r) => ({ data: r.data[0] ?? null, error: null }));
  }
  maybeSingle() {
    return this.single();
  }
  then<T1 = unknown, T2 = never>(
    onfulfilled?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
    onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
  ): Promise<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  private async execute(): Promise<{ data: Record<string, unknown>[]; error: unknown }> {
    if (this.mode === "upsert" && this.upsertRow) {
      const key = `${(this.upsertRow.user_id as string) ?? "anon"}|${this.upsertRow.date as string}`;
      const prev = this.store[key] ?? { id: `h${Object.keys(this.store).length + 1}`, user_id: this.upsertRow.user_id ?? "anon", date: this.upsertRow.date };
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
    let rows = Object.values(this.store);
    if (this.gteDate) rows = rows.filter((r) => (r.date as string) >= this.gteDate!);
    if (this.filterDate) rows = rows.filter((r) => r.date === this.filterDate);
    if (this.filterUser) rows = rows.filter((r) => r.user_id === this.filterUser);
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { data: rows, error: null };
  }
}

const run = (over: Partial<MappedWorkout> = {}): MappedWorkout => ({
  date: "2026-06-21",
  workout_type: "Outdoor Run",
  duration_minutes: 46,
  calories_burned: 363.3,
  distance: 7500,
  average_heart_rate: 152,
  max_heart_rate: 181,
  sync_key: "hae:2026-06-21T14:15:00.000Z:Outdoor Run",
  ...over,
});

describe("syncHaeWorkouts", () => {
  it("inserts new workouts with explicit user_id and rolls up counters", async () => {
    const { fake, healthDaily, workouts } = makeFakeSupabase();
    const r = await syncHaeWorkouts(fake, "user-1", [
      run(),
      run({ workout_type: "Walk", duration_minutes: 30, sync_key: "hae:2026-06-21T22:00:00.000Z:Walk" }),
    ]);
    expect(r.inserted).toBe(2);
    expect(r.skipped).toBe(0);
    expect(workouts).toHaveLength(2);
    expect(workouts[0]).toMatchObject({ user_id: "user-1", source: "healthkit", notes: "hae:2026-06-21T14:15:00.000Z:Outdoor Run" });
    const day = healthDaily["user-1|2026-06-21"]!;
    expect(day.workouts_count).toBe(2);
    expect(day.workout_minutes).toBe(76);
    expect(typeof day.activity_score).toBe("number"); // scores recomputed
  });

  it("is idempotent across HAE window re-posts (and within one batch)", async () => {
    const { fake, healthDaily, workouts } = makeFakeSupabase();
    await syncHaeWorkouts(fake, "user-1", [run(), run()]); // duplicate inside the batch
    expect(workouts).toHaveLength(1);
    const again = await syncHaeWorkouts(fake, "user-1", [run()]); // re-post
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(1);
    expect(workouts).toHaveLength(1);
    expect(healthDaily["user-1|2026-06-21"]!.workouts_count).toBe(1);
  });

  it("counts manual same-day workouts in the rollup without touching them", async () => {
    const { fake, healthDaily, workouts } = makeFakeSupabase();
    workouts.push({ id: "w0", user_id: "user-1", date: "2026-06-21", workout_type: "Yoga", duration_minutes: 20, source: "manual", notes: "studio class" });
    const r = await syncHaeWorkouts(fake, "user-1", [run()]);
    expect(r.inserted).toBe(1);
    expect(workouts).toHaveLength(2);
    expect(workouts[0]!.notes).toBe("studio class"); // untouched
    expect(healthDaily["user-1|2026-06-21"]!.workouts_count).toBe(2);
    expect(healthDaily["user-1|2026-06-21"]!.workout_minutes).toBe(66);
  });

  it("scopes dedupe and rollup to the target user", async () => {
    const { fake, healthDaily, workouts } = makeFakeSupabase();
    // Same sync_key exists for ANOTHER user — must not suppress user-1's insert.
    workouts.push({ id: "w0", user_id: "user-2", date: "2026-06-21", duration_minutes: 46, source: "healthkit", notes: "hae:2026-06-21T14:15:00.000Z:Outdoor Run" });
    const r = await syncHaeWorkouts(fake, "user-1", [run()]);
    expect(r.inserted).toBe(1);
    expect(healthDaily["user-1|2026-06-21"]!.workouts_count).toBe(1); // not 2
    expect(healthDaily["user-2|2026-06-21"]).toBeUndefined();
  });

  it("returns zeros on empty input without touching the DB", async () => {
    const fake = { from: () => { throw new Error("must not be called"); } } as unknown as import("@supabase/supabase-js").SupabaseClient;
    expect(await syncHaeWorkouts(fake, "user-1", [])).toEqual({ inserted: 0, skipped: 0, dates: [] });
  });
});

describe("ingestHealthkit workout-counter merge safety", () => {
  it("a metrics-only post no longer nulls workout counters rolled up earlier", async () => {
    const { fake, healthDaily } = makeFakeSupabase();
    await syncHaeWorkouts(fake, "user-1", [run()]);
    expect(healthDaily["user-1|2026-06-21"]!.workouts_count).toBe(1);
    // HAE metrics re-post for the same day, no workouts field at all:
    await ingestHealthkit(fake, "user-1", { date: "2026-06-21", source: "healthkit", steps: 9000 });
    expect(healthDaily["user-1|2026-06-21"]!.workouts_count).toBe(1); // preserved
    expect(healthDaily["user-1|2026-06-21"]!.workout_minutes).toBe(46);
    expect(healthDaily["user-1|2026-06-21"]!.steps).toBe(9000);
  });
});
