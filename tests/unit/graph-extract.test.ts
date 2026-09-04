import { describe, it, expect } from "vitest";
import { regexExtractEntities } from "@/lib/ai/regex";
import { parseExtraction } from "@/lib/ai/types";
import { ENTITY_AUTOCREATE_THRESHOLD } from "@/lib/domains/entities";

describe("regexExtractEntities (zero-model fallback)", () => {
  it("finds a person after a cue verb at sentence start", () => {
    const got = regexExtractEntities("Call Sam Rivera about the proposal");
    const sam = got.find((e) => e.name === "Sam Rivera");
    expect(sam).toBeDefined();
    expect(sam!.entity_type).toBe("person");
    expect(sam!.confidence).toBeGreaterThanOrEqual(ENTITY_AUTOCREATE_THRESHOLD);
  });

  it("types company-suffix names as company", () => {
    const got = regexExtractEntities("Follow up with Dana about Acme Inc");
    const acme = got.find((e) => e.name.startsWith("Acme"));
    expect(acme).toBeDefined();
    expect(acme!.entity_type).toBe("company");
    expect(acme!.confidence).toBeGreaterThanOrEqual(ENTITY_AUTOCREATE_THRESHOLD);
  });

  it("finds a person after a mid-sentence cue", () => {
    const got = regexExtractEntities("schedule lunch with Dana Lee next week");
    const dana = got.find((e) => e.name === "Dana Lee");
    expect(dana).toBeDefined();
    expect(dana!.entity_type).toBe("person");
  });

  it("does not invent entities from a plain lowercase sentence", () => {
    expect(regexExtractEntities("buy milk and eggs tomorrow")).toEqual([]);
  });

  it("skips bare sentence-start capitalization", () => {
    const got = regexExtractEntities("Remember to stretch before running");
    expect(got.find((e) => e.name.startsWith("Remember"))).toBeUndefined();
  });

  it("ignores stopword-only capitalized words (days, months)", () => {
    const got = regexExtractEntities("meet with Tuesday"); // pathological input
    expect(got.find((e) => e.name === "Tuesday")).toBeUndefined();
  });

  it("dedupes repeated names", () => {
    const got = regexExtractEntities("Email Sam, then thank Sam");
    expect(got.filter((e) => e.name === "Sam")).toHaveLength(1);
  });
});

describe("parseExtraction (P1: validate model output)", () => {
  it("accepts a valid payload and trims/dedupes", () => {
    const got = parseExtraction({
      entities: [
        { name: "  Acme ", entity_type: "company", confidence: 0.9 },
        { name: "acme", entity_type: "company", confidence: 0.8 },
        { name: "Sam", entity_type: "person", confidence: 0.7 },
      ],
    });
    expect(got).toHaveLength(2);
    expect(got[0]!.name).toBe("Acme");
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(parseExtraction(null)).toEqual([]);
    expect(parseExtraction("nonsense")).toEqual([]);
    expect(parseExtraction({ entities: [{ name: "X", entity_type: "alien" }] })).toEqual([]);
  });

  it("defaults a missing confidence to 0.5", () => {
    const got = parseExtraction({ entities: [{ name: "X", entity_type: "tool" }] });
    expect(got[0]!.confidence).toBe(0.5);
  });
});
