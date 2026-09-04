import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/memory";

describe("chunkText", () => {
  it("empty/whitespace → no chunks", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("short text → single chunk, whitespace normalized", () => {
    expect(chunkText("hello   world\n\nfoo")).toEqual(["hello world foo"]);
  });

  it("long text splits on sentence boundaries under the chunk budget", () => {
    const sentence = "This is a reasonably sized sentence about my day. ";
    const text = sentence.repeat(40); // ~2000 chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(700);
    // No content lost across the kept chunks (joined ≈ prefix of normalized input).
    expect(chunks.join(" ").startsWith("This is a reasonably sized sentence")).toBe(true);
  });

  it("hard-splits a single monster sentence", () => {
    const monster = "x".repeat(2000);
    const chunks = chunkText(monster);
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.length).toBe(700);
  });

  it("caps chunks per source", () => {
    const text = "A sentence here. ".repeat(600); // would be many chunks
    expect(chunkText(text).length).toBeLessThanOrEqual(6);
  });
});
