// 感官补全 (hearing), the ear's client: one audio clip in, one plain transcription out.
// A REGISTERED model-call station (E-1's law; classified in docs/layers.md): mechanical
// observation feeding her material layer, never her voice. Speaks Gemini's OpenAI-compatible
// wire with input_audio blocks (verified live, V-0). Every heard clip lands in the hear-log;
// the audio file itself is never kept (the caller deletes it).

export interface EarConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface HearRecord {
  ts: number;
  model: string;
  outChars: number;
  transcription: string;
}

export interface Ear {
  /** Transcribe one audio clip (base64, no data: prefix) under the given system instruction. */
  complete(audioBase64: string, format: string, system: string): Promise<string>;
  /** Watch one video clip, frames AND audio track together (native wire; verified live V-0). */
  watch(videoBase64: string, mime: string, system: string): Promise<string>;
}

const HEAR_TIMEOUT_MS = 20_000;
const HEAR_MAX_TOKENS = 300;

export function createEar(
  cfg: EarConfig,
  appendHearLog: (rec: HearRecord) => void,
  fetchImpl: typeof fetch = fetch,
): Ear {
  return {
    async complete(audioBase64: string, format: string, system: string): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEAR_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: HEAR_MAX_TOKENS,
            messages: [
              { role: "system", content: system },
              { role: "user", content: [{ type: "input_audio", input_audio: { data: audioBase64, format } }] },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`hearing endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim() === "") throw new Error("hearing endpoint returned no text");
        const transcription = content.trim();
        appendHearLog({ ts: Date.now(), model: cfg.model, outChars: transcription.length, transcription });
        return transcription;
      } finally {
        clearTimeout(timer);
      }
    },
    async watch(videoBase64: string, mime: string, system: string): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const nativeBase = cfg.baseUrl.replace(/\/openai\/?$/u, "");
        const res = await fetchImpl(`${nativeBase}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ inline_data: { mime_type: mime, data: videoBase64 } }] }],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`watch endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = (body.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
        if (text === "") throw new Error("watch endpoint returned no text");
        appendHearLog({ ts: Date.now(), model: cfg.model, outChars: text.length, transcription: text });
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
