import { describe, it, expect } from "vitest";

// We can't import server-only modules in vitest directly, so we test the pure
// functions by inlining the logic (same as the production code).

// ---- extractText ------------------------------------------------------------

function extractText(msg: { text?: string; caption?: string }): string | null {
  return msg.text ?? msg.caption ?? null;
}

describe("extractText", () => {
  it("returns text when present", () => {
    expect(extractText({ text: "hello" })).toBe("hello");
  });
  it("returns caption when text is absent", () => {
    expect(extractText({ caption: "photo note" })).toBe("photo note");
  });
  it("prefers text over caption", () => {
    expect(extractText({ text: "a", caption: "b" })).toBe("a");
  });
  it("returns null when both missing", () => {
    expect(extractText({})).toBeNull();
  });
});

// ---- contentType ------------------------------------------------------------

function contentType(msg: { voice?: unknown; photo?: unknown[]; document?: unknown }): string {
  if (msg.voice) return "audio";
  if (msg.photo && (msg.photo as unknown[]).length > 0) return "photo";
  if (msg.document) return "file";
  return "text";
}

describe("contentType", () => {
  it("voice → audio", () => {
    expect(contentType({ voice: { file_id: "x", duration: 5 } })).toBe("audio");
  });
  it("photo → photo", () => {
    expect(contentType({ photo: [{ file_id: "x", width: 100, height: 100 }] })).toBe("photo");
  });
  it("document → file", () => {
    expect(contentType({ document: { file_id: "x" } })).toBe("file");
  });
  it("text message → text", () => {
    expect(contentType({})).toBe("text");
  });
});

// ---- isAuthorizedSender -----------------------------------------------------

function isAuthorizedSender(msg: { from?: { id: number } }, allowedId: string): boolean {
  return String(msg.from?.id) === allowedId;
}

describe("isAuthorizedSender", () => {
  it("matches correct user ID", () => {
    expect(isAuthorizedSender({ from: { id: 123456 } }, "123456")).toBe(true);
  });
  it("rejects wrong user ID", () => {
    expect(isAuthorizedSender({ from: { id: 999 } }, "123456")).toBe(false);
  });
  it("rejects missing from", () => {
    expect(isAuthorizedSender({}, "123456")).toBe(false);
  });
});
