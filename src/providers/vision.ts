// gap 2 (seeing), the eye's client: one frame in, one plain transcription out.
//
// A REGISTERED model-call station, never a dark path (E-1's law): the method is named
// `complete` so the layers census counts it, and it is classified in docs/layers.md as
// mechanical observation feeding her material layer, the model's words here are her EYE'S
// REPORT, never a surface value behaviour reads, and never her voice.
//
// Speaks the OpenAI-compatible wire (Gemini's /v1beta/openai/ endpoint, or anything else
// that takes image_url data URLs). Every successful look is appended to the look-log, the
// eye's forensic record; the frame itself is never kept (seeing.ts, design law 3).

export interface EyeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LookRecord {
  ts: number;
  model: string;
  outChars: number;
  transcription: string;
  /** Which surface looked: her window, a photo he handed over, an image file. */
  kind: "window" | "photo" | "document" | "canvas";
}

export interface Eye {
  /** Transcribe one JPEG frame (base64, no data: prefix) under the given system instruction. */
  complete(jpegBase64: string, system: string, kind?: LookRecord["kind"]): Promise<string>;
}

const LOOK_TIMEOUT_MS = 20_000;
const LOOK_MAX_TOKENS = 300;

export function createEye(
  cfg: EyeConfig,
  appendLookLog: (rec: LookRecord) => void,
  fetchImpl: typeof fetch = fetch,
): Eye {
  return {
    async complete(jpegBase64: string, system: string, kind: LookRecord["kind"] = "window"): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LOOK_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: LOOK_MAX_TOKENS,
            // The eye is a transducer: it must never reason, and on the DeepSeek wire a
            // thinking model would spend the whole budget reasoning and return empty content
            // (measured live, V-0). Gemini's compat layer does not take the field.
            ...(cfg.baseUrl.includes("deepseek") ? { thinking: { type: "disabled" } } : {}),
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
                ],
              },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`vision endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim() === "") throw new Error("vision endpoint returned no text");
        const transcription = content.trim();
        appendLookLog({ ts: Date.now(), model: cfg.model, outChars: transcription.length, transcription, kind });
        return transcription;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
