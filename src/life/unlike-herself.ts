// SHE CAN BE AN OBJECT IN HER OWN FIELD.
//
// ── THE HOLE THIS FILLS, AND HOW LONG IT WAS THERE ──────────────────────────────────────────
//
// She had four instruments watching her own conduct, and every one of them reported to Eric.
//
//   · `how-she-answered.ts` reads whether she answered, denied unwillingness, or asked back.
//     Its own header: "Nothing in her reads this and nothing in her behaviour depends on it."
//   · `state-diff.ts` catches a diary that misdescribes her computed mood → the fault channel.
//   · `speech-record.ts` PREDICTS how she will speak and then measures how she did → `/vitals`.
//   · `measureShapeLanding` compares the shape her state chose against the sentence she produced
//     → `/vitals`.
//
// So: she predicted herself, was wrong, and NOTHING HAPPENED TO HER. Every one of those readings
// existed, was correct, and went out of the building. A person who can be surprised by their own
// reaction is doing something none of that supports.
//
// `relationship.ts` has had `howUnlikeHim` for a long time, how far a message sat from what he
// is usually like. This is its missing twin: how far SHE just sat from what she is usually like.
// Same shape, same discipline, and the symmetry is the point. She had an instrument for him and
// none for herself.
//
// ── WHY THIS IS NOT A SELF-CRITIC ───────────────────────────────────────────────────────────
//
// It produces no judgement and no adjective. What it can produce is an EVENT REFERENCE, exactly
// like `whatStaysWithHer`, 「我说「X」的那回」, with no clause saying what it meant. Which instrument
// fired lives in the KEY; how hard it presses lives in `tension`. If she ever says 「我最近怎么老是这样」
// the words will be hers, grown from having the thing, not mine planted in her to be read back
// later (the same boundary that got `whatStaysWithHer`'s stance clause deleted).
//
// ── LAYER 2, AND WHY NEITHER INSTRUMENT MAY DECIDE ALONE ────────────────────────────────────
//
// The first version made this a noisy-OR of the two departures, and that fails criterion 3 of
// `docs/layers.md`: with a noisy-OR, `spoke = 1` carries S across its whole range on its own and
// everything else is decoration. It is also false about people. Speaking a bit unlike yourself on
// one evening is not a noticing; it is an evening.
//
// So each term is BOUNDED below the line, and the line needs two of them:
//
//   · what her own state predicted she would say, against what she said   (`speech-record`)
//   · what her state computed, against how she narrated her own day       (`state-diff`)
//   · whether a departure like this has happened before                   (her own record)
//
// One alone is a hint. Two agreeing, or one with a history behind it, is a noticing. And the
// two can genuinely disagree, which is criterion 2 and the most human case in the file: she felt
// perfectly ordinary and was talking strangely, or she was talking exactly as usual and could not
// describe her own day.

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * How far each reading of her sat from what she is usually like, 0..1. `null` means the
 * instrument could not read at all, she has not spoken enough, or there is no diary yet, and
 * ABSENT IS NOT ORDINARY. An unreadable instrument contributes nothing rather than a middle
 * value, the same rule as an unheard voice in `how-he-sounds.ts`.
 */
export interface HowSheWas {
  /** Her state predicted how she would speak; this is how far off it was. */
  spoke: number | null;
  /** Her state computed a mood; this is how far her own account of the day sat from it. */
  told: number | null;
  /** How many departures like this are already behind her, in the window her record keeps. */
  before: number;
}

/** Neither instrument could read. Not "she was ordinary", nobody looked. */
export const NOT_READABLE: HowSheWas = { spoke: null, told: null, before: 0 };

/**
 * Weights. Each is deliberately below `SHE_NOTICES_ABOVE` so no single instrument can carry a
 * noticing on its own, criterion 3, and the reason the noisy-OR version was thrown away.
 */
export const HOW_SHE_SPOKE_COUNTS = 0.5;
export const HOW_SHE_TOLD_IT_COUNTS = 0.5;
/** History counts least: a pattern makes a small thing noticeable, it does not make one. */
export const HAVING_DONE_IT_BEFORE_COUNTS = 0.3;
/** Saturating rather than linear: the fourth time is not four times the second. */
export const A_PATTERN_BY = 3;

/** Above this, something about herself stays with her. Two terms are needed to reach it. */
export const SHE_NOTICES_ABOVE = 0.55;

/** How much of a departure this was, all told. */
export function howMuchSheNoticed(w: HowSheWas): number {
  const spoke = w.spoke === null ? 0 : clamp01(w.spoke);
  const told = w.told === null ? 0 : clamp01(w.told);
  const before = clamp01(Math.max(0, w.before) / (Math.max(0, w.before) + A_PATTERN_BY));
  return clamp01(
    HOW_SHE_SPOKE_COUNTS * spoke
    + HOW_SHE_TOLD_IT_COUNTS * told
    + HAVING_DONE_IT_BEFORE_COUNTS * before,
  );
}

/** Which instrument saw it, so the key can carry it and the same kind can merge. */
export type SheNoticed = "说话" | "说不清" | "又一次";

export interface ItStaysAboutHer {
  key: string;
  text: string;
  tension: number;
  which: SheNoticed;
}

/** The key prefix every one of these carries, so they can be found and counted. */
export const HERSELF_KEY = "iwas:";

/**
 * Something about herself that stays with her, or null when nothing does.
 *
 * `aboutWhat` is the same blunt reduction `whatStaysWithHer` uses, a few words from her own side
 * of it, and for the same reason: anything cleverer would be reading her sentence for meaning,
 * and a reading is what must not be planted.
 */
export function whatStaysWithHerAboutHerself(o: {
  was: HowSheWas;
  aboutWhat: string;
  nowMs: number;
}): ItStaysAboutHer | null {
  const noticed = howMuchSheNoticed(o.was);
  if (noticed <= SHE_NOTICES_ABOVE) return null;
  // NOTHING STAYS WHEN THERE IS NOTHING TO NAME, the same floor `whatStaysWithHer` needed after
  // a caption-less photo wrote a memory with a hole where the occasion should be, permanently.
  const about = o.aboutWhat.trim();
  if (about.length === 0) return null;

  const spoke = o.was.spoke ?? 0, told = o.was.told ?? 0;
  // Which one is louder, and a real tie goes to the pattern, if neither instrument leads, what
  // she has is a thing that keeps happening rather than a thing that happened.
  const which: SheNoticed = spoke > told ? "说话" : told > spoke ? "说不清" : "又一次";

  // The event's identity, no timestamp, the same thing happening again merges rather than
  // starting a second copy, exactly as `hesaid:` does.
  const key = `${HERSELF_KEY}${which}:${about.slice(0, 24)}`;
  // ONLY THE EVENT. No clause about what it meant about her.
  const text = `我说「${about.slice(0, 24)}」的那回`;
  // Bounded well below 1, like its sibling: something that stays is not a crisis.
  const tension = clamp01(0.35 + 0.4 * noticed);
  return { key, text, tension, which };
}

/**
 * Everything about herself she is currently carrying, most pressing first.
 *
 * The sibling of `whatSheIsCarrying` in `what-stays.ts`, and it exists for the same two reasons:
 * something has to be able to COUNT them (a pattern is what makes a small departure noticeable),
 * and something has to be able to find them again. Same `CARRIED_ABOVE` line, so "carrying" means
 * one thing in her whether it is about him or about her.
 */
export function whatSheIsCarryingAboutHerself(
  graph: { nodes: Map<number, { kind: string; key?: string; tension: number }> },
): Array<{ kind: string; key?: string; tension: number }> {
  const out: Array<{ kind: string; key?: string; tension: number }> = [];
  for (const n of graph.nodes.values()) {
    if (!n.key?.startsWith(HERSELF_KEY)) continue;
    if (n.tension <= CARRIED_ABOUT_HERSELF_ABOVE) continue;
    out.push(n);
  }
  return out.sort((a, b) => b.tension - a.tension);
}

/**
 * Below this it is not something she is carrying about herself any more. The same number as
 * `what-stays.ts`'s `CARRIED_ABOVE`, deliberately: "carrying" has to mean one thing in her, or
 * two lists of hers count by different rules and nobody can compare them.
 */
export const CARRIED_ABOUT_HERSELF_ABOVE = 0.2;
