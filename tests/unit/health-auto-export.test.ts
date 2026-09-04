import { describe, it, expect } from "vitest";
import { mapHealthAutoExport, mapHaeWorkouts } from "@/lib/domains/health-auto-export";

describe("mapHealthAutoExport", () => {
  it("maps a representative payload to one day with normalized units", () => {
    const days = mapHealthAutoExport({
      data: {
        metrics: [
          { name: "step_count", units: "count", data: [
            { qty: 3000, date: "2026-06-21 08:00:00 -0700" },
            { qty: 7243, date: "2026-06-21 18:00:00 -0700" },
          ] },
          { name: "active_energy", units: "kJ", data: [ { qty: 2142.0, date: "2026-06-21 20:00:00 -0700" } ] },
          { name: "dietary_energy", units: "kcal", data: [ { qty: 2200, date: "2026-06-21 20:00:00 -0700" } ] },
          { name: "protein", units: "g", data: [
            { qty: 60, date: "2026-06-21 08:00:00 -0700" },
            { qty: 78, date: "2026-06-21 19:00:00 -0700" },
          ] },
          { name: "weight_body_mass", units: "lb", data: [
            { qty: 181.7, date: "2026-06-20 07:00:00 -0700" },
            { qty: 181.0, date: "2026-06-21 07:00:00 -0700" },
          ] },
          { name: "resting_heart_rate", units: "bpm", data: [
            { qty: 58, date: "2026-06-21 03:00:00 -0700" },
            { qty: 56, date: "2026-06-21 06:00:00 -0700" },
          ] },
          { name: "heart_rate_variability", units: "ms", data: [ { qty: 67.2, date: "2026-06-21 06:00:00 -0700" } ] },
          { name: "vo2max", units: "mL/min·kg", data: [ { qty: 47.8, date: "2026-06-21 06:00:00 -0700" } ] },
          { name: "body_fat_percentage", units: "%", data: [ { qty: 0.175, date: "2026-06-21 06:00:00 -0700" } ] },
          { name: "sleep_analysis", units: "hr", data: [ { date: "2026-06-21", totalSleep: 7.2, deep: 1.2, rem: 1.6, core: 4.4 } ] },
        ],
      },
    });
    const d21 = days.find((d) => d.date === "2026-06-21")!;
    expect(d21).toBeTruthy();
    expect(d21.fields.steps).toBe(10243);
    expect(d21.fields.active_energy_burned).toBe(512); // 2142 kJ -> kcal
    expect(d21.fields.calories_consumed).toBe(2200);
    expect(d21.fields.protein_grams).toBe(138);
    expect(d21.fields.weight).toBe(82.1); // 181 lb -> kg
    expect(d21.fields.resting_heart_rate).toBe(56); // latest
    expect(d21.fields.hrv).toBe(67.2);
    expect(d21.fields.vo2_max).toBe(47.8);
    expect(d21.fields.body_fat_percentage).toBe(17.5); // fraction -> percent
    expect(d21.fields.sleep_minutes).toBe(432); // 7.2h -> min
  });

  it("splits points across local dates", () => {
    const days = mapHealthAutoExport({
      data: { metrics: [ { name: "step_count", units: "count", data: [
        { qty: 5000, date: "2026-06-20 12:00:00 -0700" },
        { qty: 8000, date: "2026-06-21 12:00:00 -0700" },
      ] } ] },
    });
    expect(days.map((d) => d.date)).toEqual(["2026-06-20", "2026-06-21"]);
    expect(days[0]!.fields.steps).toBe(5000);
    expect(days[1]!.fields.steps).toBe(8000);
  });

  it("picks the most-recent value for 'latest' metrics regardless of array order", () => {
    const days = mapHealthAutoExport({
      data: { metrics: [ { name: "resting_heart_rate", units: "bpm", data: [
        { qty: 56, date: "2026-06-21 06:00:00 -0700" }, // later, listed first
        { qty: 61, date: "2026-06-21 02:00:00 -0700" },
      ] } ] },
    });
    expect(days[0]!.fields.resting_heart_rate).toBe(56);
  });

  it("sums unaggregated sleep segments (asleep phases only)", () => {
    const days = mapHealthAutoExport({
      data: { metrics: [ { name: "sleep_analysis", units: "hr", data: [
        { value: "Core", qty: 4.4, startDate: "2026-06-21 01:00:00 -0700" },
        { value: "REM", qty: 1.6, startDate: "2026-06-21 03:00:00 -0700" },
        { value: "Deep", qty: 1.2, startDate: "2026-06-21 02:00:00 -0700" },
        { value: "Awake", qty: 0.3, startDate: "2026-06-21 04:00:00 -0700" }, // ignored
      ] } ] },
    });
    expect(days[0]!.fields.sleep_minutes).toBe(432); // (4.4+1.6+1.2)h
  });

  it("ignores unknown metrics and tolerates empty/garbage", () => {
    expect(mapHealthAutoExport({ data: { metrics: [{ name: "blood_oxygen_saturation", units: "%", data: [{ qty: 98, date: "2026-06-21 06:00:00 -0700" }] }] } })).toEqual([]);
    expect(mapHealthAutoExport({})).toEqual([]);
    expect(mapHealthAutoExport(null)).toEqual([]);
    expect(mapHealthAutoExport({ data: { metrics: [] } })).toEqual([]);
  });
});

describe("mapHaeWorkouts", () => {
  it("maps a representative workout: qty objects, kJ→kcal, km→m, end−start duration", () => {
    const ws = mapHaeWorkouts({
      data: {
        workouts: [
          {
            name: "Outdoor Run",
            start: "2026-06-21 07:15:00 -0700",
            end: "2026-06-21 08:00:30 -0700",
            duration: 9999, // must be ignored — end−start wins
            distance: { qty: 7.5, units: "km" },
            activeEnergyBurned: { qty: 1520, units: "kJ" },
            avgHeartRate: { qty: 152.4, units: "bpm" },
            maxHeartRate: { qty: 181, units: "bpm" },
          },
        ],
      },
    });
    expect(ws).toHaveLength(1);
    const w = ws[0]!;
    expect(w.date).toBe("2026-06-21");
    expect(w.workout_type).toBe("Outdoor Run");
    expect(w.duration_minutes).toBe(46); // 45.5 min rounds up
    expect(w.calories_burned).toBe(363.3); // 1520 kJ -> kcal, 1dp
    expect(w.distance).toBe(7500); // km -> meters
    expect(w.average_heart_rate).toBe(152);
    expect(w.max_heart_rate).toBe(181);
    expect(w.sync_key).toBe("hae:2026-06-21T14:15:00.000Z:Outdoor Run");
  });

  it("falls back to bare duration (>1440 ⇒ seconds), bare numbers, mi→m", () => {
    const ws = mapHaeWorkouts({
      data: {
        workouts: [
          { name: "Walk", start: "2026-06-20 18:00:00 -0700", duration: 1800, distance: { qty: 1.2, units: "mi" }, activeEnergy: 130, avgHeartRate: 101 },
          { name: "Stretch", start: "2026-06-20 21:00:00 -0700", duration: 12 },
        ],
      },
    });
    expect(ws[0]!.duration_minutes).toBe(30); // 1800 s
    expect(ws[0]!.distance).toBe(1931); // 1.2 mi
    expect(ws[0]!.calories_burned).toBe(130);
    expect(ws[0]!.average_heart_rate).toBe(101);
    expect(ws[1]!.duration_minutes).toBe(12); // ≤1440 ⇒ minutes
  });

  it("is identity-stable across re-posts and reads top-level workouts[]", () => {
    const body = { workouts: [{ name: "Ride", start: "2026-06-21 06:00:00 -0700", end: "2026-06-21 07:00:00 -0700" }] };
    const a = mapHaeWorkouts(body);
    const b = mapHaeWorkouts(body);
    expect(a).toHaveLength(1);
    expect(a[0]!.sync_key).toBe(b[0]!.sync_key);
  });

  it("skips entries without a parseable start; drops out-of-range fields, keeps the workout", () => {
    const ws = mapHaeWorkouts({
      data: {
        workouts: [
          null as never,
          {},
          { name: "NoDate", duration: 30 },
          { name: "Odd", start: "2026-06-21 06:00:00 -0700", avgHeartRate: { qty: 999 }, duration: 30 },
        ],
      },
    });
    expect(ws).toHaveLength(1);
    expect(ws[0]!.workout_type).toBe("Odd");
    expect(ws[0]!.average_heart_rate).toBeNull();
    expect(ws[0]!.duration_minutes).toBe(30);
  });

  it("tolerates empty/garbage bodies", () => {
    expect(mapHaeWorkouts({})).toEqual([]);
    expect(mapHaeWorkouts(null)).toEqual([]);
    expect(mapHaeWorkouts({ data: { workouts: "nope" as never } })).toEqual([]);
  });
});
