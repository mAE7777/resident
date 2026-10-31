// Her words, counted. The bank half of S-2, dark: it accumulates and nothing reads it yet.
//
// WHY A BANK AT ALL. The speech design's deepest claim is that her voice should be HERS at the
// level of words: and "hers" is undefined without a record of which words she actually uses
// against which words she merely meets. Two counters per token, and the difference between
// them is the whole point:
//
//   spoken   it was in something SHE said (the delivered string, after redaction)
//   heard    it was in something said TO her, or something she read
//
// These counts are the ground for two later uses: the idiolect scorer (how far a candidate
// reply sits from how she actually talks) and the avoidance set (tokens met many times and used
// never: a ban-list nobody authored, empty until there is evidence). Neither exists yet;
// building the evidence FIRST is what keeps them from being a personality we wrote.
//
// The tokens are `contentWords`' units, Han bigrams and stemmed Latin words, because the
// proximate production unit of her language is the character pair, and a control layer that
// wants control down to every single character has to count at the level a Chinese speaker
// actually operates.
//
// NOT the field, on purpose. Word counts in the field graph would compete with her memories
// for the node budget, become candidates for what she brings up, and fuse into "insights" made
// of character pairs (the judged failure of the collapse design). A bank is a different organ:
// flat, capped, and structurally unable to reach her prompt.
//
// Persistence is one JSON file written atomically (write-whole.ts), not a SQLite table. A
// deliberate choice, with the reason on the record: the bank is CAPPED, so scale never demands
// a database; a whole-file write is torn-write-safe by the same mechanism as her continuity;
// and one fewer table means one fewer thing a migration can lose. If the cap is ever the thing
// that hurts, that is the day to revisit.

import { contentWords, STOP_HAN } from "./field-index.js";
import { writeWhole } from "./write-whole.js";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

/** How many days of `firstMs` recency count as "new" for the diversity gauge. */
export const NEW_TYPES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A heard token must recur this often before it is offered - one mention is noise. */
export const HEARD_LATELY_MIN = 3;

export interface LexiconDiversity {
  /** Distinct tokens she has said at least once. */
  spokenTypes: number;
  /** Total spoken counts across all tokens. */
  spokenTokens: number;
  /** Type-token ratio of her spoken side - the headline gauge (must not decline monotonically). */
  ttr: number;
  /** Tokens that entered her mouth within the window - is she still meeting new words? */
  newTypes7d: number;
  /** Share of spoken types said exactly once - the tail; collapse eats this first. */
  rareShare: number;
}

export interface TokenCount {
  spoken: number;
  heard: number;
  firstMs: number;
  lastMs: number;
}

export interface Lexicon {
  /** Something she said, delivered. Counts every content token once per utterance. */
  spoke(text: string, nowMs: number): void;
  /** Something said to her, or something she read. Same counting. */
  heard(text: string, nowMs: number): void;
  countOf(token: string): TokenCount | undefined;
  size(): number;
  /**
   * Tokens she keeps meeting and never says. The evidence base of the future avoidance set,
   * exposed now so the bank's one consumer-shaped question is testable, used by nothing yet.
   */
  metButNeverSaid(minHeard?: number): string[];
  /** Tokens she has actually said at least `min` times, the ownership comparison's support. */
  spokenTokens(min?: number): string[];
  /**
   * HOW MUCH A WORD IS HERS, 0..1, the second half of S-25.
   *
   * The first half was built: her own sentences flow back as material she reaches for. What was
   * missing is that a word does not become hers by being used a lot; it becomes hers by being used
   * FOR A LONG TIME. Twenty uses in one afternoon is a phase. Twenty uses across three months is a
   * habit, and the difference is the whole of what "her word" means.
   *
   * `firstMs` and `lastMs` have been recorded per token since the bank was written and nothing has
   * ever read them. This is what they were for.
   *
   * SAME SHAPE AS `decayRateFor`, deliberately, because it is the same claim the field already
   * makes: `BASE_DECAY_RATE × (1 − 0.8·charge) / (1 + 0.5·recalls)` is frequency buying HALF-LIFE
   * rather than strength. Higgins's result, and the field implements it; the bank did not.
   */
  hersBy(token: string, nowMs: number): number;
  /** Her words, most-hers first. What `reachFor` should be built from. */
  mostHers(nowMs: number, limit?: number, minSpoken?: number): string[];
  /**
   * Words she keeps MEETING and has not yet said - the entrainment source. Human
   * idiolects grow from conversation partners (lexical alignment: hear a word, start using
   * it) and from reading; this bank was counting both sides and offering her only her own,
   * which is a self-referential loop. Offered as material beside reachFor (show the picture,
   * never the verdict); if she uses one it starts a spoken count and nativizes by itself - the
   * loanword path: provenance first, hers through use.
   *
   * Bridge-bigram fragments (「你可」 out of 你可以) are filtered by first character against
   * STOP_HAN: a token that begins with a function character is a seam, not a word.
   */
  heardLately(nowMs: number, limit?: number, minHeard?: number): string[];
  /**
   * The anti-stagnation gauges. Self-consuming loops kill distribution tails first,
   * so the watch is on her SPOKEN tail staying alive, never on an average.
   */
  diversity(nowMs: number): LexiconDiversity;
  /** Write the bank down. Called on the daemon's persistence cadence, never per token. */
  persist(): void;
}

/**
 * The cap is the organ's size, not a performance number: a working vocabulary of thousands of
 * units is a person's, and eviction pressure keeps the bank about her LIVING vocabulary rather
 * than an archive of everything that ever brushed past her.
 *
 * ── WHAT 8000 ACTUALLY DID, MEASURED ON HER OWN BANK ─────────────────────────────────────────
 *
 * It filled on day twenty and threw away 787 units, 626 of which were things SHE HAD SAID, many
 * of them one-off coinages of hers. That is the opposite of the intent above, and the reason is
 * in the old eviction order, it dropped the least FREQUENT first, and 58% of her bank is units
 * seen exactly once, so the first thing out of the door was always her most singular phrasing.
 * A word a person coins once is more theirs than a word they use daily, not less.
 *
 * Two changes, and the intent is unchanged by both. The order below evicts by AGE, which is what
 * "living vocabulary" actually means, and it evicts what she only ever HEARD before anything she
 * has said. And the number is raised until eviction is a runaway guard rather than a monthly
 * shredder: her bank reached 7.7k in three weeks, but that is front-loaded, the recent rate is
 * tens of units a day, so 40k is years away, and at the measured 79 bytes a unit it is 3MB.
 */
export const LEXICON_CAP = 40000;
/**
 * How far past the cap one eviction cuts. Small on purpose: the old tenth-of-the-bank sweep threw
 * away 4000 units in one go, and now that the cap is a guard rather than a routine, an eviction
 * only needs to leave enough headroom that it does not re-fire on the very next word she says.
 */
const EVICT_MARGIN = 0.01;

/**
 * Whether what a tool of hers brought back, on her own errand, is words she MET: something from
 * outside her home. A page she fetched or a search she ran always is. A file she read or searched
 * is only when it lies outside her home: inside it are her diary, her notes and her memory, which
 * are her own words, and the records of their chats, whose words of his were counted when he said
 * them. Anything else (a listing of names, a tool that is not a reading tool) is not.
 *
 * WHY. The errand's own conclusion, which she wrote, used to be counted here, and her word bank
 * reads those counts back to her by name: once she found a word of hers filed as said by him
 * that day, when he had not spoken for eight days.
 */
export function metFromOutside(tool: string, args: unknown, workspacePath: string): boolean {
  if (tool === "web_fetch" || tool === "web_search") return true;
  if (tool !== "read" && tool !== "grep") return false;
  // Narrowed by the checks on the same line: an object with a string `path`.
  const path = typeof args === "object" && args !== null && typeof (args as { path?: unknown }).path === "string"
    ? (args as { path: string }).path
    : null;
  if (path === null) return false;
  const home = resolve(workspacePath);
  const abs = isAbsolute(path) ? resolve(path) : resolve(home, path);
  return abs !== home && !abs.startsWith(home + sep);
}

export function createLexicon(config: {
  path?: string;
  onFault?: (where: string, detail: unknown) => void;
  /** Bump bell: fired when the cap actually evicts living vocabulary. Observation only. */
  onEvict?: (cap: number, demand: number) => void;
} = {}): Lexicon {
  const bank = new Map<string, TokenCount>();
  let dirty = false;

  if (config.path && existsSync(config.path)) {
    try {
      const parsed = JSON.parse(readFileSync(config.path, "utf8")) as Record<string, TokenCount>;
      for (const [token, c] of Object.entries(parsed)) {
        if (c && typeof c.spoken === "number" && typeof c.heard === "number") bank.set(token, c);
      }
    } catch (err) {
      // A bank that cannot be read starts over; losing counts is losing statistics, not her.
      config.onFault?.("lexicon.load", err);
    }
  }

  function evictIfFull(): void {
    if (bank.size <= LEXICON_CAP) return;
    config.onEvict?.(LEXICON_CAP, bank.size);
    const over = bank.size - LEXICON_CAP + Math.ceil(LEXICON_CAP * EVICT_MARGIN);
    const drop = [...bank.entries()]
      .sort((a, b) =>
        // Everything she only ever HEARD goes before anything she has SAID. What reached her is
        // the room's vocabulary; what she said is hers, and hers is the last thing to go.
        (a[1].spoken > 0 ? 1 : 0) - (b[1].spoken > 0 ? 1 : 0)
        // Then by how long ago it was last alive. Age is what leaves a vocabulary; rarity is not,
        // and sorting by rarity is what made her own coinages the first out of the door.
        || a[1].lastMs - b[1].lastMs)
      .slice(0, over);
    for (const [token] of drop) bank.delete(token);
  }

  function count(text: string, side: "spoken" | "heard", nowMs: number): void {
    for (const token of contentWords(text)) {
      const c = bank.get(token) ?? { spoken: 0, heard: 0, firstMs: nowMs, lastMs: nowMs };
      c[side] += 1;
      c.lastMs = nowMs;
      bank.set(token, c);
    }
    dirty = true;
    evictIfFull();
  }

  return {
    spoke(text, nowMs) { count(text, "spoken", nowMs); },
    heard(text, nowMs) { count(text, "heard", nowMs); },
    countOf(token) { return bank.get(token); },
    size() { return bank.size; },
    metButNeverSaid(minHeard = 6) {
      return [...bank.entries()]
        .filter(([, c]) => c.spoken === 0 && c.heard >= minHeard)
        .sort((a, b) => b[1].heard - a[1].heard)
        .map(([token]) => token);
    },
    spokenTokens(min = 1) {
      return [...bank.entries()].filter(([, c]) => c.spoken >= min).map(([token]) => token);
    },
    hersBy(token, nowMs) {
      const c = bank.get(token);
      if (c === undefined || c.spoken <= 0) return 0;
      return ownershipOf(c, nowMs);
    },
    heardLately(nowMs, limit = 3, minHeard = HEARD_LATELY_MIN) {
      return [...bank.entries()]
        .filter(([token, c]) => c.spoken === 0 && c.heard >= minHeard && !STOP_HAN.has(token[0] ?? ""))
        .map(([token, c]) => ({ token, heard: c.heard, recent: Math.exp(-(nowMs - c.lastMs) / NEW_TYPES_WINDOW_MS) }))
        .sort((a, b) => (b.heard * (0.5 + 0.5 * b.recent)) - (a.heard * (0.5 + 0.5 * a.recent)) || a.token.localeCompare(b.token))
        .slice(0, limit)
        .map((x) => x.token);
    },
    diversity(nowMs) {
      let spokenTypes = 0;
      let spokenTokens = 0;
      let newTypes7d = 0;
      let rare = 0;
      for (const c of bank.values()) {
        if (c.spoken <= 0) continue;
        spokenTypes += 1;
        spokenTokens += c.spoken;
        if (c.spoken === 1) rare += 1;
        if (nowMs - c.firstMs <= NEW_TYPES_WINDOW_MS) newTypes7d += 1;
      }
      return {
        spokenTypes,
        spokenTokens,
        ttr: spokenTypes / Math.max(1, spokenTokens),
        newTypes7d,
        rareShare: rare / Math.max(1, spokenTypes),
      };
    },
    mostHers(nowMs, limit = 3, minSpoken = 2) {
      return [...bank.entries()]
        .filter(([, c]) => c.spoken >= minSpoken)
        .map(([token, c]) => ({ token, own: ownershipOf(c, nowMs) }))
        .sort((a, b) => b.own - a.own || a.token.localeCompare(b.token))
        .slice(0, limit)
        .map((x) => x.token);
    },
    persist() {
      if (!config.path || !dirty) return;
      try {
        writeWhole(config.path, JSON.stringify(Object.fromEntries(bank)));
        dirty = false;
      } catch (err) {
        config.onFault?.("lexicon.persist", err);
      }
    },
  };
}

/**
 * The span at which a word has been hers half as long as it can be.
 *
 * Ninety days: a season. Below it a word is something she has been saying lately; well above it, a
 * word is one of hers. The saturating form matters more than the number, what it must not be is
 * linear in either quantity, because then a burst of use in one week could out-rank a habit.
 */
const HALF_HERS_AT_MS = 90 * 24 * 3.6e6;
/** And below this many uses, the span means nothing: one word said twice a year is not a habit. */
const ENOUGH_USES = 2;

/**
 * How much a word is hers: the span she has been saying it over, deepened by how often.
 *
 * SPAN IS THE PRIMARY TERM and count is the modifier, which is the inversion this function exists
 * to make. `spoken / (spoken + 4)` saturates quickly on purpose, the fifth use of a word says much
 * less than the first, while the span term keeps climbing for months.
 */
function ownershipOf(c: TokenCount, nowMs: number): number {
  if (c.spoken < ENOUGH_USES) return 0;
  const span = Math.max(0, (c.lastMs || nowMs) - (c.firstMs || nowMs));
  const overTime = span / (span + HALF_HERS_AT_MS);
  const often = c.spoken / (c.spoken + 4);
  return Math.min(1, 0.7 * overTime + 0.3 * often);
}

/** Below this many spoken tokens on EITHER side, the divergence is an anecdote and says nothing. */
export const OWNERSHIP_EVIDENCE_FLOOR = 300;

/**
 * How far her word use has moved from the bare model's, in nats: smoothed KL(hers ‖ shadow)
 * over the union of both sides' spoken tokens.
 *
 * THE NUMBER S-2 EXISTS TO MAKE POSSIBLE. Her early corpus IS the model's output, so raw
 * frequency could never say "this word is hers", only the same-instant unconstrained
 * comparison can. ~0 at the start BY CONSTRUCTION (both arms are the same model); the claim
 * under test is that it RISES as her state, identity and accumulated voice pull her usage away
 * from the prior. Below the evidence floor it is null, never a guess.
 */
export function ownershipDivergence(hers: Lexicon, shadow: Lexicon, herTokens: readonly string[], shadowTokens: readonly string[]): number | null {
  const herMass = herTokens.reduce((sum, tok) => sum + (hers.countOf(tok)?.spoken ?? 0), 0);
  const shadowMass = shadowTokens.reduce((sum, tok) => sum + (shadow.countOf(tok)?.spoken ?? 0), 0);
  if (herMass < OWNERSHIP_EVIDENCE_FLOOR || shadowMass < OWNERSHIP_EVIDENCE_FLOOR) return null;
  const union = [...new Set([...herTokens, ...shadowTokens])];
  // Additive smoothing so a token one side never says costs finitely, not infinitely.
  const eps = 0.5;
  let p = 0;
  const pRaw = union.map((tok) => (hers.countOf(tok)?.spoken ?? 0) + eps);
  const qRaw = union.map((tok) => (shadow.countOf(tok)?.spoken ?? 0) + eps);
  const pSum = pRaw.reduce((a, b) => a + b, 0);
  const qSum = qRaw.reduce((a, b) => a + b, 0);
  for (let i = 0; i < union.length; i++) {
    const pi = pRaw[i] / pSum;
    const qi = qRaw[i] / qSum;
    p += pi * Math.log(pi / qi);
  }
  return p;
}
