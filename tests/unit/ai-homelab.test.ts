import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const KEYS = [
  "OLLAMA_BASE_URL",
  "LOCAL_AI_TOKEN",
  "STT_PROVIDER",
  "STT_BASE_URL",
  "STT_MODEL",
  "OPENAI_API_KEY",
] as const;
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

function stubFetch(body: unknown = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

type Call = [string, RequestInit];
const headersOf = (c: Call) => c[1].headers as Record<string, string>;

describe("local model behind the homelab tunnel", () => {
  it("sends no authorization header when LOCAL_AI_TOKEN is unset", async () => {
    const { localProvider } = await import("@/lib/ai/providers/local");
    const fetchMock = stubFetch({});
    await localProvider().health();
    const call = fetchMock.mock.calls[0] as unknown as Call;
    expect(headersOf(call).authorization).toBeUndefined();
  });

  it("sends the bearer token on health and embed", async () => {
    process.env.OLLAMA_BASE_URL = "https://home.example";
    process.env.LOCAL_AI_TOKEN = "tok-123";
    const { localProvider } = await import("@/lib/ai/providers/local");
    const fetchMock = stubFetch({ embedding: [0.1, 0.2] });
    const p = localProvider();
    await p.health();
    await p.embed(["hello"]);
    const health = fetchMock.mock.calls[0] as unknown as Call;
    const embed = fetchMock.mock.calls[1] as unknown as Call;
    expect(health[0]).toBe("https://home.example/api/tags");
    expect(headersOf(health).authorization).toBe("Bearer tok-123");
    expect(embed[0]).toBe("https://home.example/api/embeddings");
    expect(headersOf(embed)["content-type"]).toBe("application/json");
    expect(headersOf(embed).authorization).toBe("Bearer tok-123");
  });
});

describe("speech-to-text", () => {
  const audio = new ArrayBuffer(8);

  it("is unavailable when STT_PROVIDER is unset", async () => {
    const { transcribeAudio } = await import("@/lib/ai/stt");
    const fetchMock = stubFetch({ text: "x" });
    expect(await transcribeAudio(audio)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("local provider needs STT_BASE_URL before it counts as configured", async () => {
    process.env.STT_PROVIDER = "local";
    const { sttConfigured, transcribeAudio } = await import("@/lib/ai/stt");
    expect(sttConfigured()).toBe(false);
    const fetchMock = stubFetch({ text: "x" });
    expect(await transcribeAudio(audio)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the homelab with the token and returns trimmed text", async () => {
    process.env.STT_PROVIDER = "local";
    process.env.STT_BASE_URL = "https://home.example/";
    process.env.LOCAL_AI_TOKEN = "tok-123";
    const { transcribeAudio } = await import("@/lib/ai/stt");
    const fetchMock = stubFetch({ text: "  buy milk  " });
    expect(await transcribeAudio(audio)).toBe("buy milk");
    const call = fetchMock.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("https://home.example/v1/audio/transcriptions");
    expect(headersOf(call).authorization).toBe("Bearer tok-123");
    expect(call[1].body).toBeInstanceOf(FormData);
  });

  it("does not double /v1 when STT_BASE_URL already ends in /v1", async () => {
    process.env.STT_PROVIDER = "local";
    process.env.STT_BASE_URL = "https://home.example/v1";
    const { transcribeAudio } = await import("@/lib/ai/stt");
    const fetchMock = stubFetch({ text: "ok" });
    await transcribeAudio(audio);
    const call = fetchMock.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("https://home.example/v1/audio/transcriptions");
  });

  it("keeps the OpenAI path unchanged", async () => {
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const { transcribeAudio } = await import("@/lib/ai/stt");
    const fetchMock = stubFetch({ text: "hi" });
    expect(await transcribeAudio(audio)).toBe("hi");
    const call = fetchMock.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(headersOf(call).authorization).toBe("Bearer sk-test");
  });

  it("returns null when the server errors, so the note is parked, not lost", async () => {
    process.env.STT_PROVIDER = "local";
    process.env.STT_BASE_URL = "https://home.example";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { transcribeAudio } = await import("@/lib/ai/stt");
    expect(await transcribeAudio(audio)).toBeNull();
  });
});
