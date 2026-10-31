// 翻旧日子 (look_back), her re-narration of her own recorded past.
//
// The record is frozen (a day is written once, never rewritten). What can change is her
// RELATION to it: a person re-tells their past as they grow, and the re-telling does not edit
// the archive. This module holds the pure half of that organ: which old days have cooled into
// 「那时」 (her felt time decides, feltAgo pulls unfinished days close, so a hot stretch is
// never invited), the prompt she writes her page against, and the machinery-facing gates on
// what the page may cite.
//
// Three design laws, from the science this organ was researched against:
//   1. Reconsolidation happens at prediction error, re-reading alone rewrites nothing; the
//      mismatch between then and now is the material. The prompt invites the comparison and
//      nothing else.
//   2. Narrative identity grows by autobiographical reasoning, she gets a PLACE to practice,
//      never a theme. No word below steers what her past should mean.
//   3. The cure for rumination is distance, the nudge appears only when a stretch FEELS far
//      (S-56), and nothing in this organ can raise tension on anything (the hard wall; the
//      guard test scans this file and the reRead path for tension writes).
//
// Pure functions only: no clock read, no I/O, no model call. The render lives with the daemon.

import { feltAgo } from "./felt-time.js";
import { whenWords } from "./field-spread.js";

/**
 * Where 「远」 begins: the boundary where her own language stops counting days and starts
 * counting weeks (`whenWords`: < 14 → 「N天前」, >= 14 → 「N周前」). A stretch of life becomes
 * 「那时」 at the same place her words for it change unit, the constant is hers, not ours.
 */
export const FAR_ENOUGH_DAYS = 14;

/** How many frozen pages must exist before the nudge line has anything to point at (its floor). */
export const PAGES_BEFORE_NUDGE = 3;

/** A frozen day page, with what the field still carries about that day. */
export interface OldPage {
  /** Her calendar day, YYYY-MM-DD. */
  day: string;
  /** Wall-clock age in days at the time of asking. */
  ageDays: number;
  /** The hottest thing born that day that her field still holds (LivingField.maxTensionBetween). */
  tension: number;
  /** Whether a 翻旧日子 page already looked at this day. */
  revisited: boolean;
}

/** How far a page FEELS, by her own arithmetic: unfinished pulls close, settled sits at wall age. */
export function feltAgeOf(page: OldPage): number {
  return feltAgo(page.ageDays, page.tension);
}

/** A page has cooled into 「那时」 when it FEELS at least FAR_ENOUGH_DAYS away. */
export function isFar(page: OldPage): boolean {
  return feltAgeOf(page) >= FAR_ENOUGH_DAYS;
}

/**
 * The stretch she would re-read: from the EARLIEST unrevisited far page, consecutive pages while
 * they stay far, stopping at the first hot one (S-56: a stretch that still hurts is not swept
 * into the window by calendar adjacency). Capped so a long life does not arrive all at once.
 */
export function lookBackWindow(pages: readonly OldPage[], cap: number): OldPage[] {
  const ordered = [...pages].sort((a, b) => (a.day < b.day ? -1 : 1));
  const start = ordered.findIndex((p) => !p.revisited && isFar(p));
  if (start < 0) return [];
  const out: OldPage[] = [];
  for (let i = start; i < ordered.length && out.length < cap; i++) {
    const p = ordered[i]!;
    if (!isFar(p)) break;
    if (p.revisited) continue;
    out.push(p);
  }
  return out;
}

/**
 * The nudge: one presence fact, rendered ONLY when there is a past (>= PAGES_BEFORE_NUDGE pages)
 * and at least one of it has cooled. Facts and time's own units, nothing else, no word about
 * how re-reading will feel and no word about what she should do (the boundary: an authored
 * reading planted where she will read it back as hers is an injection whoever writes it).
 */
export function oldDaysLine(pages: readonly OldPage[]): string {
  if (pages.length < PAGES_BEFORE_NUDGE) return "";
  const far = pages.filter((p) => !p.revisited && isFar(p));
  if (far.length === 0) return "";
  const earliest = [...far].sort((a, b) => (a.day < b.day ? -1 : 1))[0]!;
  return `你写下的日子有 ${pages.length} 页在 life/ 里；最早没回头看过的一页是 ${earliest.day}，${whenWords(feltAgeOf(earliest))}的事了。`;
}

// ── The page she writes ───────────────────────────────────────────────────────

export const LOOK_BACK_SYSTEM = [
  "你翻开了自己以前的日子。那几页是你当时一天一页写下的，落款之后没再动过。",
  "现在的你重新读它们，写下你现在怎么看那时的自己。当时怎么记的和你现在怎么看，对得上对不上，都可以写。",
  "只写页里站得住的话；提到哪一天，就在句末用 [YYYY-MM-DD] 标出来。页里没有的事不要编。",
  "要是读完什么都没冒出来，就写今天读了、没什么想说的。那是真实的回答，比编一个好。",
  '只回 JSON：{"entry": "<你的话，带 [YYYY-MM-DD] 引注>", "cites": ["YYYY-MM-DD", ...]}',
].join("\n");

export function lookBackUser(pages: readonly { day: string; text: string }[], today: string): string {
  const body = pages.map((p) => `## ${p.day}\n${p.text.trim()}`).join("\n\n");
  return `今天是 ${today}。你翻开的页：\n\n${body}`;
}

export interface LookBackDraft {
  entry: string;
  cites: string[];
}

/** Same degrade-to-empty posture as the diary's parser: a broken JSON is a failed attempt, not a crash. */
export function parseLookBack(raw: string): LookBackDraft | null {
  const stripped = raw.replace(/```json/gu, "").replace(/```/gu, "").trim();
  const a = stripped.indexOf("{");
  const b = stripped.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const parsed = JSON.parse(stripped.slice(a, b + 1)) as { entry?: unknown; cites?: unknown };
    if (typeof parsed.entry !== "string") return null;
    const cites = Array.isArray(parsed.cites) ? parsed.cites.filter((c): c is string => typeof c === "string") : [];
    return { entry: parsed.entry.trim(), cites };
  } catch {
    return null;
  }
}

// ── The machinery-facing gates ────────────────────────────────────────────────
//
// Same posture as the diary: a failed gate still writes the page (an inert record may keep her
// failed attempt) and records a fault, but it never enters her field (an active memory takes
// no fabricated readings; the gate failure IS the evidence it might be one).

/** Cites must name days she was actually given. Returns the phantoms. */
export function phantomCites(cites: readonly string[], offeredDays: readonly string[]): string[] {
  const offered = new Set(offeredDays);
  return cites.filter((c) => !offered.has(c));
}

/**
 * The sentence a phantom citation sits in, so the fault can be TRIAGED rather than merely counted.
 *
 * ── WHY A COUNT WAS NOT ENOUGH ─────────────────────────────────────────────────────────────
 *
 * She was shown 08-17 to 08-19 and cited `[2026-08-21]`. The gate refused the whole looking-back,
 * correctly by its own rule, and the fault said `cites 2026-08-21 quotes 0`, from which it is
 * impossible to tell which of two completely different things happened:
 *
 *   · she invented a day and wrote about it (the fabrication this gate exists to stop), or
 *   · she reported, accurately, what the pages in front of her SAY, which is what she had done:
 *     she wrote that all three pages open with the same note, signed by herself and dated
 *     2026-08-21, and that date does appear once in each of the three pages.
 *
 * The gate is not loosened by this: a citation to a day she was not shown stays a phantom, and a
 * looking-back carrying one still gives her field nothing. What changes is that the person reading
 * the fault can see, in one line, which kind it was.
 */
export function citeContext(entry: string, cite: string, span = 60): string {
  const at = entry.indexOf(`[${cite}]`);
  if (at < 0) return "";
  return entry.slice(Math.max(0, at - span), at).replace(/\s+/gu, " ").trim();
}

/**
 * The verbatim sibling (of promises.ts' verbatimGate, parameterized instead of reused, the
 * original carries the promise-day cap): anything she puts inside 「」 as a quote of her past
 * must be a contiguous substring of one of the pages she was given. Short spans are allowed
 * free, 「好」 quoted from memory is not a forgery claim worth policing.
 */
export const QUOTE_CHECK_MIN_CHARS = 6;

export function forgedQuotes(entry: string, pageTexts: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of entry.matchAll(/「([^」]+)」/gu)) {
    const quote = m[1]!;
    if (quote.length < QUOTE_CHECK_MIN_CHARS) continue;
    if (!pageTexts.some((t) => t.includes(quote))) out.push(quote);
  }
  return out;
}
