import "server-only";

// Speech-to-text adapter (§12.2). Env-gated like everything else in the AI layer:
//   STT_PROVIDER=openai  + OPENAI_API_KEY  → Whisper API
//   STT_PROVIDER=none|local / unset         → transcription unavailable (voice
//                                            notes park in review queue, as before;
//                                            "local" reserves whisper.cpp for later)

export function sttConfigured(): boolean {
  return (
    (process.env.STT_PROVIDER ?? "none").toLowerCase() === "openai" &&
    !!process.env.OPENAI_API_KEY
  );
}

// Returns the transcript, or null when STT is unconfigured/failed — callers
// fall back to parking the voice note for review. Never throws.
export async function transcribeAudio(
  audio: ArrayBuffer,
  filename = "voice.ogg",
): Promise<string | null> {
  if (!sttConfigured()) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([audio]), filename);
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`[stt] whisper failed ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    const json = (await res.json()) as { text?: string };
    const text = json.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (e) {
    console.error("[stt] transcription error:", e);
    return null;
  }
}
