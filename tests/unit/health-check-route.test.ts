import { describe, it, expect, vi, beforeEach } from "vitest";

// The route must report what the probes actually saw. A hardcoded `ai: "healthy"`
// once slipped in and would have shipped a liveness check that cannot fail.
const dbResult = vi.hoisted(() => ({ error: null as unknown }));
const aiHealth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ limit: async () => dbResult }) }),
  }),
}));
vi.mock("@/lib/ai", () => ({ getProvider: () => ({ health: aiHealth }) }));

import { GET } from "@/app/api/health-check/route";

beforeEach(() => {
  dbResult.error = null;
  aiHealth.mockReset();
});

describe("GET /api/health-check", () => {
  it("reports an unreachable AI provider as unavailable without failing liveness", async () => {
    aiHealth.mockResolvedValue({ ok: false, model: "llama3.1:8b" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "ok", ai: "unavailable", ai_model: "llama3.1:8b" });
  });

  it("reports a healthy AI provider with its model", async () => {
    aiHealth.mockResolvedValue({ ok: true, model: "claude-x" });
    expect(await (await GET()).json()).toMatchObject({ ai: "ok", ai_model: "claude-x" });
  });

  it("treats a throwing provider as unavailable", async () => {
    aiHealth.mockRejectedValue(new Error("boom"));
    expect(await (await GET()).json()).toMatchObject({ ok: true, ai: "unavailable", ai_model: "unconfigured" });
  });

  it("reports a provider that never answers as unavailable instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      aiHealth.mockReturnValue(new Promise(() => {}));
      const pending = GET();
      await vi.advanceTimersByTimeAsync(3_000);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, db: "ok", ai: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 503 when the database is unreachable", async () => {
    dbResult.error = { message: "down" };
    aiHealth.mockResolvedValue({ ok: true, model: "m" });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: "error" });
  });
});
