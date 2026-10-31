// The shadow arm: what the model would have said WITHOUT her.
//
// S-2'S OTHER HALF, and the reason the word bank can ever mean anything. Her early corpus IS
// the model's output, so counting her word frequencies against nothing would entrench the
// exact prior the speech build exists to remove, 神经束律 running backwards. "This word is
// hers" is undefined without a same-instant, same-conversation comparison: the identical
// exchange, answered by the bare model with none of her in the room. The distance between the
// two corpora is what her state and identity actually buy, and it is the denominator of every
// ownership number the measurement slice will ever report.
//
// WHAT THE SHADOW GETS, EXACTLY. The identical message array her real call got, including
// history, because a shadow specified without history is not an unconstrained copy of her, it
// is an amnesiac, and the comparison then measures "has context versus has none", which is
// large by construction and makes every downstream kill-line unfireable. It differs in
// PRECISELY the ways `buildShadowRequest` writes down, and the construction test diffs the
// request object so a fourth difference cannot creep in silently:
//
//   no system prompt        the model's bare prior is the thing being measured
//   the background model    cost; the construction check below is what keeps this honest
//   maxTokens 400           a reply-sized budget, not an essay
//   no tools                it answers, it cannot act
//   account "shadow"        its spend is visible in `byAccount` and can never hide in hers
//
// OFF THE CRITICAL PATH, ALWAYS. Fired after her turn has fully resolved, never awaited by
// anything he can feel, and through its OWN provider chain instance, a failing shadow that
// shared her chain would trip her breaker and put its cooldowns on her live path, a feedback
// loop where the instrument degrades the thing it measures. Failures are recorded loudly and
// change nothing else.
//
// Its output is NEVER delivered anywhere. It feeds a separate word bank (the shadow corpus)
// and a small ring of measures, and that is its entire life.

import type { LLMProvider, LLMRequest, Message } from "../providers/types.js";
import type { Lexicon } from "./lexicon.js";
import { measureUtterance, type UtteranceMeasure } from "./speech-record.js";

export const SHADOW_MAX_TOKENS = 400;
export const SHADOW_ACCOUNT = "shadow";
/** Ring of recent shadow measures, for the future hers/shadow ratio lines. Same as PAIR_WINDOW. */
export const SHADOW_MEASURE_WINDOW = 40;

/** The one place the shadow's request is composed, so a test can diff it against hers. */
export function buildShadowRequest(model: string, messages: readonly Message[]): LLMRequest {
  return {
    model,
    messages: [...messages],
    maxTokens: SHADOW_MAX_TOKENS,
    account: SHADOW_ACCOUNT,
    // STATED, NOT INHERITED (after a stall on her second day): with no thinking field the
    // vendor default (reasoning ON) applied, 400 tokens burned entirely on reasoning, and three
    // empty completions in a row froze every ownership number while she kept talking. Reasoning
    // was never the quantity here: the shadow measures the model's bare WORD prior, so disabled
    // is both the fix and the honest shape of the measurement.
    thinking: { type: "disabled" },
    purpose: "shadow: the same exchange with none of her in the room",
  };
}

export interface ShadowVoiceDeps {
  provider: LLMProvider;
  model: string;
  /** The shadow corpus: a SEPARATE bank, never hers. */
  bank: Lexicon;
  onFault: (where: string, detail: unknown) => void;
  /** Run one shadow call per this many turns. 1 while the corpus is thin; 3 once it is real. */
  sampleEvery?: number;
  now?: () => number;
}

export interface ShadowVoice {
  /**
   * Her turn resolved; the shadow may now speak into the void. Fire-and-forget: the returned
   * promise exists for tests and for nothing else.
   */
  afterTurn(messages: readonly Message[]): Promise<void>;
  /** Calls actually completed, and the recent measures, the corpus's own bookkeeping. */
  callsMade(): number;
  recentMeasures(): readonly UtteranceMeasure[];
  /**
   * Every turn the shadow was offered, sampled or not, empty or not. Monotonic and NON-saturating
   * (unlike the 40-capped pair window), so `shadowCalls` flat while THIS keeps rising is the
   * reachable signal that the shadow arm has gone dark while she keeps talking.
   */
  turnsTotal(): number;
}

export function createShadowVoice(deps: ShadowVoiceDeps): ShadowVoice {
  const sampleEvery = Math.max(1, deps.sampleEvery ?? 1);
  const now = deps.now ?? Date.now;
  const measures: UtteranceMeasure[] = [];
  let turnsSeen = 0;
  let calls = 0;
  let consecutiveEmpty = 0;

  return {
    async afterTurn(messages) {
      turnsSeen += 1;
      if ((turnsSeen - 1) % sampleEvery !== 0) return;
      if (messages.length === 0) return;
      try {
        const response = await deps.provider.complete(buildShadowRequest(deps.model, messages));
        const text = response.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (!text) {
          // A single empty completion is transient noise; a RUN of them is the shadow arm gone
          // dark while she keeps talking: the silent stall the vitals shadow_stalled gate was
          // meant to catch. This path returned before `calls += 1` and before any onFault, so it
          // logged nothing: the stall was invisible. Made loud here, on the fault channel, so it
          // reaches Eric directly regardless of any downstream detector (no silent failures).
          consecutiveEmpty += 1;
          if (consecutiveEmpty === 3) {
            deps.onFault("shadow.stalled", "the shadow arm returned 3 empty completions in a row — it has gone dark while she keeps talking, and every ownership number is now frozen on stale data");
          }
          return;
        }
        consecutiveEmpty = 0;
        calls += 1;
        deps.bank.spoke(text, now());
        measures.push(measureUtterance(text));
        if (measures.length > SHADOW_MEASURE_WINDOW) measures.shift();
      } catch (err) {
        // Loud, and contained: a dead shadow is a broken instrument, never a broken her.
        deps.onFault("shadow.call", err);
      }
    },
    callsMade() { return calls; },
    recentMeasures() { return [...measures]; },
    turnsTotal() { return turnsSeen; },
  };
}
