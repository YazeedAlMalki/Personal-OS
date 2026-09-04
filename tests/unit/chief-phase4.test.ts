import { describe, it, expect } from "vitest";
import { runChiefOfStaff } from "@/lib/chief";
import { emptySnapshot, type Snapshot } from "@/lib/chief/types";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("Phase 4 chief rules", () => {
  it("sleep_decline fires after 3 nights below target", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      health: [
        { date: "2026-06-07", sleep_minutes: 360 },
        { date: "2026-06-08", sleep_minutes: 350 },
        { date: "2026-06-09", sleep_minutes: 340 },
      ],
    };
    const types = runChiefOfStaff(s).map((i) => i.insight_type);
    expect(types).toContain("sleep_decline");
  });

  it("sleep_decline silent when one night meets target", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      health: [
        { date: "2026-06-07", sleep_minutes: 360 },
        { date: "2026-06-08", sleep_minutes: 480 },
        { date: "2026-06-09", sleep_minutes: 340 },
      ],
    };
    const types = runChiefOfStaff(s).map((i) => i.insight_type);
    expect(types).not.toContain("sleep_decline");
  });

  it("low_activity fires under 80% of step target", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      health: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-06-0${i + 1}`,
        steps: 4000, // 50% of 8000
      })),
    };
    expect(runChiefOfStaff(s).map((i) => i.insight_type)).toContain("low_activity");
  });

  it("low_activity stays quiet at target", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      health: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-06-0${i + 1}`,
        steps: 10000,
      })),
    };
    expect(runChiefOfStaff(s).map((i) => i.insight_type)).not.toContain("low_activity");
  });

  it("overcommitted_day fires when load > capacity", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      tomorrow: {
        date: "2026-06-11",
        calendarBusyMinutes: 6 * 60,
        dueTaskEstimatedMinutes: 4 * 60, // 10h vs 8h capacity
        capacityMinutes: 8 * 60,
      },
    };
    expect(runChiefOfStaff(s).map((i) => i.insight_type)).toContain("overcommitted_day");
  });

  it("overcommitted_day silent when under capacity", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      tomorrow: {
        date: "2026-06-11",
        calendarBusyMinutes: 60,
        dueTaskEstimatedMinutes: 60,
        capacityMinutes: 8 * 60,
      },
    };
    expect(runChiefOfStaff(s).map((i) => i.insight_type)).not.toContain(
      "overcommitted_day",
    );
  });

  it("data_drift fires when key tables are stale", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      freshness: {
        health_daily: 5, // > 3-day threshold
        finance_snapshots: 5,
        journal_entries: 2,
        workouts: 2,
      },
    };
    const types = runChiefOfStaff(s).map((i) => i.insight_type);
    expect(types).toContain("data_drift");
  });

  it("data_drift silent when everything fresh", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      freshness: {
        health_daily: 0,
        finance_snapshots: 1,
        journal_entries: 1,
        workouts: 1,
      },
    };
    expect(runChiefOfStaff(s).map((i) => i.insight_type)).not.toContain(
      "data_drift",
    );
  });

  it("data_drift treats null (never seen) as stale", () => {
    const s: Snapshot = {
      ...emptySnapshot(NOW),
      freshness: {
        health_daily: null,
        finance_snapshots: 1,
        journal_entries: 1,
        workouts: 1,
      },
    };
    expect(runChiefOfStaff(s).map((i) => i.insight_type)).toContain("data_drift");
  });
});
