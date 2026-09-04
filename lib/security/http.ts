// Body-size-capped JSON reader (spec §13: payload cap on every unauthenticated
// ingress). Vercel caps request bodies platform-side (~4.5MB) but self-host has
// no limit — an unbounded request.json() is a memory-DoS vector.

export const INGRESS_MAX_BYTES = 1_000_000; // 1MB — telegram/healthkit payloads are KBs.
export const IMPORT_MAX_BYTES = 50_000_000; // 50MB — a full export restore is large.

export async function readJsonCapped<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  const tooLarge = () =>
    ({
      ok: false as const,
      response: new Response(JSON.stringify({ error: "payload too large" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      }),
    });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return tooLarge();

  // content-length can be absent/lied about (chunked encoding) — enforce while reading.
  const reader = request.body?.getReader();
  if (!reader) {
    try {
      return { ok: true, body: (await request.json()) as T };
    } catch {
      return { ok: true, body: null as T };
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    return { ok: true, body: JSON.parse(text) as T };
  } catch {
    return { ok: true, body: null as T };
  }
}
