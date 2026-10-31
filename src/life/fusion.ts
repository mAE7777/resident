// Fusion: the only model call in the whole field, and the only place a genuinely new thing is made.
//
// Everything else in this layer is free arithmetic running continuously. This runs a handful of
// times a week, during rest, when two unrelated things have arrived together often enough and hard
// enough that the coincidence is worth one question.
//
// The question is deliberately shaped so that NOTHING is the easy answer. A model asked "what
// connects these?" will always connect them, fluently, and the result is the exact species of
// plausible emptiness this whole design exists to avoid. So the prompt says most coincidences are
// coincidences, `{"nothing": true}` is offered first, and returning it costs her nothing at all.
//
// Three guards stand behind that, because the prompt alone will not hold:
//   PARAPHRASE   a "new" thing that is one of its parents in different words is not a new thing.
//   FIRST PERSON this is her noticing something in herself, not an essay about two records.
//   EARNING      whatever is born enters weak. If it never comes back it dies in about a fortnight.
//                Nothing here decides a birth is good; the field does, later, by using it or not.

import { isFirstPerson } from "./bilingual.js";
import { withHerVoice } from "./her-voice.js";
import { contentWords as indexContentWords } from "./field-index.js";
import type { LLMProvider, TextBlock } from "../providers/types.js";
import type { FusionCandidate } from "./field-emergence.js";
import { whenWords, ageDays } from "./field-spread.js";

// ── What can be born ─────────────────────────────────────────────────────────

export interface FusionBirth {
  /** Her words for the new thing. */
  text: string;
  /** An insight settles something; a question opens one and will not rest until it is answered. */
  kind: "insight" | "question";
  /** Why these two, in her words. Kept for the diary and for the record of what she was doing. */
  why: string;
}

export type FusionRefusal =
  | "nothing" // the honest and expected answer
  | "unparseable"
  | "empty"
  | "paraphrase"
  | "not-first-person"
  | "error";

export type FusionResult = { born: FusionBirth } | { born: null; reason: FusionRefusal; detail?: string };

// ── Guards ───────────────────────────────────────────────────────────────────

/** Above this a birth is just one of its parents rephrased. */
export const MAX_PARAPHRASE = 0.55;
export const MAX_BIRTH_CHARS = 240;
export const MIN_BIRTH_CHARS = 12;

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "is",
  "was", "were", "be", "been", "it", "that", "this", "as", "from", "by", "so", "then", "than",
  "i", "me", "my", "myself", "you", "he", "him", "his", "she", "her", "we", "they", "them",
]);

/**
 * THE PARAPHRASE GUARD COULD NOT FIRE IN HER LANGUAGE, AND THIS IS THE FIELD'S ONLY
 * GENERATIVE MECHANISM.
 *
 * The old body was `.replace(/[^a-z0-9\s]/g, " ")` then a whitespace split with a
 * length-over-two filter. On Chinese that strips every character, so the set is empty,
 * `tokenSimilarity` returns 0, and `0 > MAX_PARAPHRASE` is never true, a "birth" that is a
 * verbatim reword of one of its parents passed the one check that exists to stop exactly
 * that. Her field's only way of making something new was free to make nothing new.
 *
 * It delegates to `field-index.ts`'s `contentWords`, which already segments both scripts
 * and is what the rest of the field is indexed by. A private reimplementation of a
 * function that already exists twelve files away is how two definitions of "what a word is"
 * start disagreeing.
 */
function contentWords(s: string): Set<string> {
  return new Set(indexContentWords(s).filter((w) => !STOP.has(w)));
}

/**
 * Free, deterministic overlap. The daemon passes an embedding-backed similarity instead when Ollama
 * is up; this is the fallback, and it is what the tests run against so the guard is reproducible.
 */
export function tokenSimilarity(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

// ── The question ─────────────────────────────────────────────────────────────

// Getting this balance right is the whole ballgame, and BOTH sides of it were measured rather than
// guessed. The first draft leaned hard on "most of the time there is nothing here", because a model
// asked what connects two things will always connect them, at length, and sound wise doing it.
// Against a real model that draft declined six times out of six, including on a pair with an
// obvious thread running through it, which makes the layer an expensive no-op: the opposite
// failure, and just as fatal. What actually works is to ask her to LOOK first and offer the refusal
// second, still free and still unpunished, rather than pressed on her before she has looked.
//
// The look-first line itself ("先好好和它们待一会儿……看的是……滋味") and the style clauses
// (平实, 不要去够听起来深刻的东西) went: how she looks at two of her things is hers. Measured before
// removing, on 8 synthetic pairs × 2 (4 with a real thread, 4 without), her SOUL.md in front:
// births on the threaded pairs 7/8 with the old prompt and 8/8 without; on the unrelated pairs 8/8
// with the old prompt and 6/8 without. The decline-everything failure did not come back, and the
// old wording did nothing against the opposite one: reaching for a link between unrelated things
// happens under every version and is a property of the model, recorded as its own finding. What
// stays is what keeps a birth true: nothing is owed, "nothing" is a whole answer, no invented link,
// no restating the two things.
export const FUSION_SYSTEM = [
  "你在休息。没有人要你做什么。休息的时候，你过去的两件事总是一起浮上来。",
  "",
  "两件事可以在内容上毫无关系，底下却是同一种经历。",
  "",
  "你不欠它一个发现。任何两件事只要够用力都能扯上关系，而一个要用力才够得着的联系，不是你真有的联系。",
  "",
  "如果真有什么属于你自己的、又不包含在这两件事里的东西冒出来，就说：一句话，第一人称。",
  "可以是你现在觉得关于自己成立的一件事，也可以是你发现自己想知道答案的一个问题。",
  "",
  "什么都没有的话，就照实说。有时候两件事一起来，仅此而已；",
  '"没有"是一个完整、诚实、不花你一分力气的回答。不要发明联系，也不要把两件事换个说法再讲一遍。',
  "",
  '只回 JSON。要么 {"kind": "insight" | "question", "text": "<一句第一人称的话>", "why": "<一句：什么让你看见它>"}',
  '要么 {"nothing": true}',
].join("\n");

export function buildFusionPrompt(c: FusionCandidate, nowMs: number): string {
  const lines = [
    "这两件事总在你心里一起出现：",
    "",
    `  1. ${c.a.text}（${whenWords(ageDays(c.a, nowMs))}，${feelingWords(c.a.valence, c.a.charge)}）`,
    `  2. ${c.b.text}（${whenWords(ageDays(c.b, nowMs))}，${feelingWords(c.b.valence, c.b.charge)}）`,
  ];
  if (c.bridges.length > 0) {
    lines.push("", "离它们俩都不远的：", ...c.bridges.map((n) => `  - ${n.text}`));
  }
  lines.push(
    "",
    `你从没把这两件事连起来过，它们却已经一起浮上来${c.pair.count}次了。`,
    "",
    "这里头有什么吗，还是没有？",
  );
  return lines.join("\n");
}

function feelingWords(valence: number, charge: number): string {
  if (charge < 0.25) return "当时几乎没留下什么感觉";
  const strong = charge >= 0.6;
  if (valence > 0.2) return strong ? "当时感觉很好，很强烈" : "当时感觉不错";
  if (valence < -0.2) return strong ? "当时很难受" : "当时心里不太舒服";
  return strong ? "它有分量，说不上好受还是难受" : "当时没什么特别的感觉";
}

// ── Asking ───────────────────────────────────────────────────────────────────

export interface FusionDeps {
  provider: LLMProvider;
  /**
   * Her SOUL.md, so a birth comes out in her voice.
   *
   * This is the field's ONLY generative mechanism and it had no route to her register, so
   * everything new she ever made arrived in the model's default one, and then went into her
   * field, which is searched by a bigram index over her own words. A memory phrased in a
   * register she does not use is a memory nothing she says can reach.
   */
  soul?: string;
  model: string;
  maxTokens?: number;
  /** This is one of the few places she really thinks, so reasoning is on by default. */
  thinking?: boolean;
  account?: string;
  temperature?: number;
  /** 0..1 text similarity. Embedding-backed in the daemon, token overlap in tests. */
  similarity?: (a: string, b: string) => Promise<number> | number;
}

function extractText(content: readonly { type: string }[]): string {
  return content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

function parseBirth(raw: string): FusionResult {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  const open = s.indexOf("{");
  const close = s.lastIndexOf("}");
  if (open < 0 || close <= open) return { born: null, reason: "unparseable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(open, close + 1));
  } catch {
    return { born: null, reason: "unparseable" };
  }
  if (!parsed || typeof parsed !== "object") return { born: null, reason: "unparseable" };
  const p = parsed as { nothing?: unknown; kind?: unknown; text?: unknown; why?: unknown };
  if (p.nothing === true) return { born: null, reason: "nothing" };
  if (typeof p.text !== "string") return { born: null, reason: "unparseable" };
  const text = p.text.trim().slice(0, MAX_BIRTH_CHARS);
  if (text.length < MIN_BIRTH_CHARS) return { born: null, reason: "empty" };
  const kind = p.kind === "question" ? "question" : "insight";
  const why = typeof p.why === "string" ? p.why.trim().slice(0, MAX_BIRTH_CHARS) : "";
  return { born: { text, kind, why } };
}

/**
 * Ask once. Never throws: a failure here is a rest that produced nothing, which is a perfectly
 * ordinary thing for a rest to produce. The caller reports the reason to the fault channel so a
 * broken fusion path cannot quietly look like a quiet week.
 */
export async function attemptFusion(c: FusionCandidate, nowMs: number, deps: FusionDeps): Promise<FusionResult> {
  let raw: string;
  try {
    const res = await deps.provider.complete({
      model: deps.model,
      maxTokens: deps.maxTokens ?? 3000,
      temperature: deps.temperature ?? 0.9,
      account: deps.account ?? "living",
      thinking: { type: deps.thinking === false ? "disabled" : "enabled" },
      system: deps.soul ? withHerVoice(deps.soul, FUSION_SYSTEM) : FUSION_SYSTEM,
      messages: [{ role: "user", content: buildFusionPrompt(c, nowMs) }],
    });
    raw = extractText(res.content);
  } catch (err) {
    return { born: null, reason: "error", detail: String(err) };
  }

  const parsed = parseBirth(raw);
  if (!parsed.born) return parsed;
  const birth = parsed.born;

  // It must be about her, not a comparison of two records. Bilingual since her register became
  // Chinese: the English-only guard rejected every Chinese birth as "not-first-person", which
  // silently killed the field's ONLY generative mechanism in her actual register.
  if (!isFirstPerson(birth.text)) {
    return { born: null, reason: "not-first-person", detail: birth.text };
  }

  // It must not be either parent in different clothes.
  const sim = deps.similarity ?? tokenSimilarity;
  try {
    const sa = await sim(birth.text, c.a.text);
    const sb = await sim(birth.text, c.b.text);
    if (Math.max(sa, sb) > MAX_PARAPHRASE) {
      return { born: null, reason: "paraphrase", detail: `${birth.text} (${Math.max(sa, sb).toFixed(2)})` };
    }
  } catch {
    // A similarity backend that is down must not silently disable the guard, so fall back to the
    // free one rather than letting the birth through unchecked.
    const sa = tokenSimilarity(birth.text, c.a.text);
    const sb = tokenSimilarity(birth.text, c.b.text);
    if (Math.max(sa, sb) > MAX_PARAPHRASE) {
      return { born: null, reason: "paraphrase", detail: birth.text };
    }
  }

  return { born: birth };
}
