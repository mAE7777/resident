// Her own voice, kept: the sentences she has actually said, admitted by arithmetic.
//
// THE EMERGENCE LOOP HIS RULING REQUIRES (wording itself is an emergence and a choice). Her
// wording cannot converge toward HERS unless her past speech is material her future speech can
// draw on: that is the 手: accumulated fluency, grown, never authored. This pool is that
// accumulation. Later slices surface entries as material in the room (present or absent, never
// an adjective); this module only GROWS the pool, correctly, which is the part that cannot be
// retrofitted once poisoned.
//
// THE GATE IS THE WHOLE DESIGN. Day one, her delivered replies are the model's prior wearing
// her name: admit everything and the pool entrenches exactly the shape the speech build
// exists to dissolve (the bootstrap trap the research synthesis names). So admission is gated
// by the aiShapeOf composite: a reply whose discourse reads as the assistant's contributes
// nothing, however clean its vocabulary. The gate is ARITHMETIC over grown material, the
// designers authored a measuring rule, never a sentence. As she diverges from the prior, more
// of what she says qualifies, and the pool becomes more her: the loop closes in the right
// direction.
//
// Eviction is oldest-first, deliberately: a voice is a LIVING thing, and an exemplar pool that
// kept her earliest sentences forever would pin her at whoever she was first. The same reason
// the speech window slides.

import { readFileSync, existsSync } from "node:fs";
import { writeWhole } from "./write-whole.js";
import { contentWords } from "./field-index.js";
import { measureUtterance, aiShapeOf } from "./speech-record.js";
import { sentencesOf } from "./register-scissors.js";

export interface OwnSentence {
  text: string;
  saidMs: number;
}

/** A reply whose discourse scores above this contributes nothing to the pool. */
export const ADMISSIBLE_SHAPE = 2;
/** Enough to carry a voice; small enough to stay current. */
export const POOL_CAP = 400;
/** A fragment below this carries no voice ("在。" does, two Han chars of stance). */
const MIN_SENTENCE_CHARS = 2;
const MAX_SENTENCE_CHARS = 80;

export interface HerOwnVoice {
  /** A reply she delivered. Admitted sentence by sentence, or not at all. */
  /**
   * A reply she delivered. `gateOn` (when given) is the RAW pre-scissors text the admission
   * gate reads, the scissors must not be able to launder an AI-shaped reply into the pool by
   * removing the sentences that would have failed the gate. Defaults to `reply`.
   */
  admit(reply: string, nowMs: number, gateOn?: string): number;
  /** Her own past sentences most like this moment's text, best first. */
  likeThis(hint: string, k?: number): OwnSentence[];
  size(): number;
  persist(): void;
}

export function createHerOwnVoice(config: {
  path?: string;
  onFault?: (where: string, detail: unknown) => void;
} = {}): HerOwnVoice {
  let pool: OwnSentence[] = [];
  let dirty = false;

  if (config.path && existsSync(config.path)) {
    try {
      const parsed = JSON.parse(readFileSync(config.path, "utf8")) as OwnSentence[];
      if (Array.isArray(parsed)) {
        pool = parsed.filter((e) => e && typeof e.text === "string" && typeof e.saidMs === "number");
      }
    } catch (err) {
      config.onFault?.("ownVoice.load", err);
    }
  }

  return {
    admit(reply, nowMs, gateOn) {
      const t = reply.trim();
      if (!t) return 0;
      // Gate on the RAW discourse; store the delivered sentences.
      const gateText = (gateOn ?? reply).trim() || t;
      // The gate reads the WHOLE reply's discourse: a clean sentence inside an
      // assistant-shaped reply is scaffolding, not voice. But only the VOICE-scale detectors
      // vote here: monoblock, embedded-question and complex-sentence are DELIVERY-scale
      // tells, and the breath dissolves those at the channel; letting them veto admission
      // made the gate one almost nothing passes (her own good live reply scored 4 on
      // delivery tells alone), which is the unreachable-gate class from the other side.
      const shape = aiShapeOf(measureUtterance(gateText), gateText);
      const DELIVERY_SCALE = new Set(["S:monoblock", "S:embedded-question", "s:complex-sentence"]);
      const voiceScore = shape.fired
        .filter((f) => !DELIVERY_SCALE.has(f))
        .reduce((sum, f) => sum + (f.startsWith("S:") ? 2 : 1), 0);
      if (voiceScore > ADMISSIBLE_SHAPE) return 0;
      let admitted = 0;
      for (const raw of sentencesOf(t)) {
        const sentence = raw.trim();
        const han = (sentence.match(/[一-鿿]/gu) ?? []).length;
        if (han < MIN_SENTENCE_CHARS || sentence.length > MAX_SENTENCE_CHARS) continue;
        // One voice does not need the same sentence twice.
        if (pool.some((e) => e.text === sentence)) continue;
        pool.push({ text: sentence, saidMs: nowMs });
        admitted += 1;
      }
      if (pool.length > POOL_CAP) pool = pool.slice(pool.length - POOL_CAP);
      if (admitted > 0) dirty = true;
      return admitted;
    },

    likeThis(hint, k = 3) {
      const cue = new Set(contentWords(hint));
      if (cue.size === 0) return [];
      return pool
        .map((e) => {
          const tokens = contentWords(e.text);
          const shared = tokens.filter((tok) => cue.has(tok)).length;
          return { e, score: tokens.length > 0 ? shared / Math.sqrt(tokens.length) : 0 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, k))
        .map((x) => x.e);
    },

    size() { return pool.length; },

    persist() {
      if (!config.path || !dirty) return;
      try {
        writeWhole(config.path, JSON.stringify(pool));
        dirty = false;
      } catch (err) {
        config.onFault?.("ownVoice.persist", err);
      }
    },
  };
}
