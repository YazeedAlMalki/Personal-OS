import { describe, it, expect } from "vitest";
import { taskCreate, goalCreate, projectCreate } from "@/lib/security/validation";

describe("taskCreate", () => {
  it("accepts a minimal valid task", () => {
    expect(taskCreate.safeParse({ title: "Write spec" }).success).toBe(true);
  });
  it("rejects an empty title", () => {
    expect(taskCreate.safeParse({ title: "" }).success).toBe(false);
  });
  it("rejects an invalid priority", () => {
    expect(taskCreate.safeParse({ title: "x", priority: "nope" }).success).toBe(false);
  });
  it("rejects a non-ISO due_date", () => {
    expect(taskCreate.safeParse({ title: "x", due_date: "06/08/2026" }).success).toBe(false);
  });
  it("accepts an ISO due_date", () => {
    expect(taskCreate.safeParse({ title: "x", due_date: "2026-06-08" }).success).toBe(true);
  });
});

describe("goalCreate / projectCreate", () => {
  it("clamps progress range", () => {
    expect(goalCreate.safeParse({ title: "g", progress_percentage: 150 }).success).toBe(false);
    expect(projectCreate.safeParse({ title: "p", progress_percentage: 50 }).success).toBe(true);
  });
  it("rejects bad project priority", () => {
    expect(projectCreate.safeParse({ title: "p", priority: "huge" }).success).toBe(false);
  });
});
