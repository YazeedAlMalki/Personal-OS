import { describe, it, expect } from "vitest";
import {
  healthDailyCreate,
  healthkitIngest,
  nutritionCreate,
  targetsUpdate,
  workoutCreate,
} from "@/lib/security/validation";

describe("healthDailyCreate", () => {
  it("accepts a minimal manual row", () => {
    const r = healthDailyCreate.safeParse({ date: "2026-06-10" });
    expect(r.success).toBe(true);
  });
  it("rejects unparseable date", () => {
    expect(healthDailyCreate.safeParse({ date: "not-a-date" }).success).toBe(false);
  });
  it("rejects out-of-range sleep_minutes", () => {
    expect(
      healthDailyCreate.safeParse({ date: "2026-06-10", sleep_minutes: 9999 }).success,
    ).toBe(false);
  });
  it("rejects negative steps", () => {
    expect(
      healthDailyCreate.safeParse({ date: "2026-06-10", steps: -1 }).success,
    ).toBe(false);
  });
  it("rejects unknown source enum", () => {
    expect(
      healthDailyCreate.safeParse({ date: "2026-06-10", source: "weirdo" }).success,
    ).toBe(false);
  });
});

describe("healthkitIngest", () => {
  it("defaults source to healthkit", () => {
    const r = healthkitIngest.safeParse({ date: "2026-06-10", steps: 12000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe("healthkit");
  });
  it("accepts an embedded workouts[] array", () => {
    const r = healthkitIngest.safeParse({
      date: "2026-06-10",
      source: "shortcut",
      sleep_minutes: 430,
      resting_heart_rate: 54,
      workouts: [
        { workout_type: "run", duration_minutes: 32, calories_burned: 310 },
        { workout_type: "yoga", duration_minutes: 20 },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects a 51-element workouts array", () => {
    const big = Array.from({ length: 51 }, () => ({ duration_minutes: 30 }));
    expect(
      healthkitIngest.safeParse({ date: "2026-06-10", workouts: big }).success,
    ).toBe(false);
  });
  it("drops empty/null metrics and coerces stringified numbers (phone payloads)", () => {
    const r = healthkitIngest.safeParse({
      date: "2026-06-21",
      source: "shortcut",
      steps: "10243", // Shortcuts can stringify numbers
      active_energy_burned: "512",
      body_fat_percentage: "17.5",
      hrv: "", // no reading today
      resting_heart_rate: null,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.steps).toBe(10243);
      expect(r.data.active_energy_burned).toBe(512);
      expect(r.data.body_fat_percentage).toBe(17.5);
      expect("hrv" in r.data).toBe(false);
      expect("resting_heart_rate" in r.data).toBe(false);
    }
  });
});

describe("workoutCreate", () => {
  it("accepts a single typed workout", () => {
    const r = workoutCreate.safeParse({
      date: "2026-06-10",
      workout_type: "lift",
      duration_minutes: 60,
    });
    expect(r.success).toBe(true);
  });
  it("rejects negative durations", () => {
    expect(
      workoutCreate.safeParse({ date: "2026-06-10", duration_minutes: -5 }).success,
    ).toBe(false);
  });
});

describe("nutritionCreate", () => {
  it("accepts a simple meal", () => {
    expect(
      nutritionCreate.safeParse({
        date: "2026-06-10",
        meal_name: "breakfast",
        calories: 600,
        protein: 35,
      }).success,
    ).toBe(true);
  });
});

describe("targetsUpdate", () => {
  it("accepts a partial patch", () => {
    expect(targetsUpdate.safeParse({ steps: 10000 }).success).toBe(true);
  });
  it("rejects junk", () => {
    expect(targetsUpdate.safeParse({ steps: "lots" }).success).toBe(false);
  });
});
