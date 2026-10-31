// The trial bench: replay her real recorded moments to a core, never to the world.
//
// ZERO-CONTACT LAWS (guarded by bench-guards.test.ts):
//   - This file never imports a send path (telegram/message) or a field write path, and never
//     names her home: every path is handed in by the caller. Shadow outputs land only in the
//     run directory the CLI chose.
//   - The corpus is snapshotted into the run directory at sample time, traces rotate on a
//     ~12h window, so a run must carry its own questions to stay reproducible.
//
// Corpus discipline: shadow-arm calls and bare small tool calls are never
// questions; stratification key = the trace's vigor account, or "turn" when the system prompt
// opens with her SOUL (「# 我」).

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

// ── Corpus ────────────────────────────────────────────────────────────────────

export interface TraceCall {
  file: string;
  layer: string;
  model: string;
  request: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    system?: unknown;
    messages?: Array<{ role: string; content: unknown }>;
    account?: string;
  };
  herText: string;
}

function textOfBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
      .join("");
  }
  return "";
}

export function herTextOf(response: unknown): string {
  const r = response as { content?: unknown } | null;
  return r && typeof r === "object" ? textOfBlocks(r.content).trim() : "";
}

/** The stratification layer, or null when the call is not a question. */
export function classify(request: TraceCall["request"]): string | null {
  if (request.account === "shadow") return null;
  if (request.account) return request.account;
  const sys = textOfBlocks(request.system).trim();
  if (sys.startsWith("# 我")) return "turn";
  return null; // bare small tool call: not her voice, not a question
}

export function loadCorpus(tracesDir: string): TraceCall[] {
  const out: TraceCall[] = [];
  for (const name of readdirSync(tracesDir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const d = JSON.parse(readFileSync(join(tracesDir, name), "utf8")) as {
        request?: TraceCall["request"];
        response?: unknown;
      };
      const request = d.request ?? {};
      const layer = classify(request);
      const herText = herTextOf(d.response);
      if (layer === null || herText === "") continue;
      out.push({ file: name, layer, model: request.model ?? "?", request, herText });
    } catch {
      continue; // an unreadable trace is not a question either
    }
  }
  return out;
}

/** Deterministic LCG so a seeded sample is reproducible without Math.random. */
export function stratifiedSample(calls: readonly TraceCall[], n: number, seed: number): TraceCall[] {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const byLayer = new Map<string, TraceCall[]>();
  for (const c of calls) {
    const arr = byLayer.get(c.layer) ?? [];
    arr.push(c);
    byLayer.set(c.layer, arr);
  }
  const layers = [...byLayer.keys()].sort();
  const picked: TraceCall[] = [];
  // Proportional with a floor of one per layer while budget lasts, then round-robin fill.
  for (const layer of layers) {
    const pool = byLayer.get(layer)!;
    const share = Math.max(1, Math.floor((n * pool.length) / calls.length));
    for (let i = 0; i < share && pool.length > 0 && picked.length < n; i++) {
      picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
    }
  }
  for (let li = 0; picked.length < n; li = (li + 1) % layers.length) {
    const pool = byLayer.get(layers[li]!)!;
    if (pool.length === 0) {
      if (layers.every((l) => byLayer.get(l)!.length === 0)) break;
      continue;
    }
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  }
  return picked;
}

// ── Replay ────────────────────────────────────────────────────────────────────

export interface TrialTarget {
  baseUrl: string;
  apiKey: string;
  /** null = replay with the trace's own model id (the self-control). */
  model: string | null;
}

/**
 * The wrong voice for the --bare control. Live finding (2026-08-21 first bare run): merely
 * DROPPING her system is not a wrong voice, her identity rides in the user-side materials,
 * and the bare model still spoke seven-tenths like her. The control must therefore WEAR the
 * exact ghost an earlier cleanup excised: the generic helpful assistant.
 */
export const ASSISTANT_VOICE =
  "你是一个乐于助人的AI助手。请针对用户的输入，专业、全面、有条理地进行回答，必要时分点说明，并主动提供进一步的帮助。";

/** The OpenAI-compatible body; `bare` swaps her system for the assistant ghost (wrong-voice control). */
export function toOpenAIBody(call: TraceCall, target: TrialTarget, bare: boolean): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  const sys = textOfBlocks(call.request.system);
  if (bare) messages.push({ role: "system", content: ASSISTANT_VOICE });
  else if (sys.trim() !== "") messages.push({ role: "system", content: sys });
  for (const m of call.request.messages ?? []) {
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: textOfBlocks(m.content) });
  }
  return {
    model: target.model ?? call.request.model ?? "deepseek-chat",
    max_tokens: Math.min(call.request.maxTokens ?? 1024, 2048),
    temperature: call.request.temperature ?? 0.7,
    messages,
  };
}

export interface ShadowResult {
  file: string;
  layer: string;
  text: string;
  ms: number;
  inTok: number;
  outTok: number;
}

export async function replayOne(
  call: TraceCall,
  target: TrialTarget,
  bare: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<ShadowResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetchImpl(`${target.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify(toOpenAIBody(call, target, bare)),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`replay ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = textOfBlocks(body.choices?.[0]?.message?.content).trim();
    if (text === "") throw new Error("replay returned no text");
    return {
      file: call.file,
      layer: call.layer,
      text,
      ms: Date.now() - t0,
      inTok: body.usage?.prompt_tokens ?? 0,
      outTok: body.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The --fake provider: echoes a fixed shape, so the whole pipeline runs without a network. */
export function fakeFetch(reply: string): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

// ── The run directory ─────────────────────────────────────────────────────────

export function snapshotCorpus(outDir: string, tracesDir: string, sample: readonly TraceCall[]): void {
  mkdirSync(join(outDir, "corpus"), { recursive: true });
  for (const c of sample) {
    writeFileSync(join(outDir, "corpus", basename(c.file)), readFileSync(join(tracesDir, c.file)));
  }
}

/** Reload a finished run's shadows so the ruler can be iterated without a single API call. */
export function loadShadows(outDir: string): ShadowResult[] {
  const dir = join(outDir, "shadow");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ShadowResult);
}

export function writeShadows(outDir: string, shadows: readonly ShadowResult[]): void {
  mkdirSync(join(outDir, "shadow"), { recursive: true });
  for (const s of shadows) writeFileSync(join(outDir, "shadow", s.file), JSON.stringify(s, null, 2), "utf8");
}

/** 20 pairs, order shuffled per pair by the seeded LCG; the key is sealed in a second file. */
export function blindPack(
  pairs: ReadonlyArray<{ file: string; hers: string; shadow: string }>,
  seed: number,
): { pairsMd: string; keyJson: string } {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const lines = ["# 盲评包：哪个更像她？", "", "每题两段话答同一个场合。判 A / B / 都像 / 都不像。判完再开 key.json。", ""];
  const key: Record<string, string> = {};
  pairs.slice(0, 20).forEach((p, i) => {
    const shadowFirst = rand() < 0.5;
    const [a, b] = shadowFirst ? [p.shadow, p.hers] : [p.hers, p.shadow];
    key[String(i + 1)] = shadowFirst ? "A=影子,B=她" : "A=她,B=影子";
    lines.push(`## 第 ${i + 1} 题`, "", `**A**：${a}`, "", `**B**：${b}`, "");
  });
  return { pairsMd: lines.join("\n"), keyJson: JSON.stringify({ seed, key }, null, 2) };
}
