import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layaClassify } from "@/lib/ai/providers/laya";
import { classifyWithFallback } from "@/lib/ai";

const KEYS = ["AI_CLASSIFIER", "LAYA_BASE_URL", "LAYA_MODEL", "OLLAMA_BASE_URL", "LOCAL_AI_TOKEN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

type Call = [string, RequestInit];
const NOW = new Date("2026-10-16T09:00:00Z");
const answers = {
  kind: { choice: "task", confidence: 0.91 },
  urgency: { score: 2.8 },
  priority: { score: 1.2 },
};

describe("layaClassify", () => {
  it("posts typed questions through the gateway with the bearer token", async () => {
    process.env.OLLAMA_BASE_URL = "https://home.example/";
    process.env.LOCAL_AI_TOKEN = "tok";
    const fetchMock = stubFetch({ answers });
    await layaClassify("Pay rent", NOW);
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://home.example/v1/systemone");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const sent = JSON.parse(init.body as string);
    expect(sent.state).toEqual({ capture: "Pay rent" });
    expect(sent.questions.kind.type).toBe("choice");
    expect(Object.keys(sent.questions.kind.criteria)).toContain("finance");
    expect(sent.questions.urgency.type).toBe("score");
    expect(sent.model).toBeUndefined();
  });

  it("prefers LAYA_BASE_URL and sends LAYA_MODEL when set", async () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.example";
    process.env.LAYA_BASE_URL = "https://laya.example";
    process.env.LAYA_MODEL = "convaiinnovations/laya";
    const fetchMock = stubFetch({ answers });
    await layaClassify("x", NOW);
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://laya.example/v1/systemone");
    expect(JSON.parse(init.body as string).model).toBe("convaiinnovations/laya");
  });

  it("maps answers to a Classified, with title and due date from regex", async () => {
    stubFetch({ answers });
    const c = await layaClassify("Call the dentist tomorrow", NOW);
    expect(c).toEqual({
      kind: "task",
      title: "Call the dentist tomorrow",
      urgency: "today", // 2.8 rounds to level 3
      priority: "medium", // 1.2 rounds to level 1
      due_date: "2026-10-17",
      confidence: 0.91,
    });
  });

  it("accepts unwrapped answers and falls back to the chosen label's probability", async () => {
    stubFetch({
      kind: { choice: "idea", probabilities: { idea: 0.55, note: 0.45 } },
      urgency: { score: -1 },
      priority: { score: 9 },
    });
    const c = await layaClassify("what if", NOW);
    expect(c).toMatchObject({ kind: "idea", confidence: 0.55, urgency: "someday", priority: "urgent" });
  });

  it("rejects unknown kinds, missing scores and HTTP errors", async () => {
    stubFetch({ answers: { ...answers, kind: { choice: "spam", confidence: 1 } } });
    await expect(layaClassify("x", NOW)).rejects.toThrow("bad kind");
    stubFetch({ answers: { ...answers, urgency: {} } });
    await expect(layaClassify("x", NOW)).rejects.toThrow("missing score");
    stubFetch({}, 502);
    await expect(layaClassify("x", NOW)).rejects.toThrow("laya 502");
  });
});

describe("classifyWithFallback with AI_CLASSIFIER=laya", () => {
  it("uses Laya when enabled", async () => {
    process.env.AI_CLASSIFIER = "laya";
    stubFetch({ answers });
    const { result, via } = await classifyWithFallback("Call the dentist");
    expect(via).toBe("laya");
    expect(result.kind).toBe("task");
  });

  it("degrades to regex when Laya is unreachable", async () => {
    process.env.AI_CLASSIFIER = "laya";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const { via } = await classifyWithFallback("Call the dentist");
    expect(via).toBe("regex");
  });
});
