import { describe, it, expect } from "vitest";
import {
  reluctanceOf, RELUCTANCE_THRESHOLD, type WillingnessInputs,
} from "../../../src/life/willingness.js";
import { howItLanded, type Landing } from "../../../src/life/how-it-landed.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { reserveOf } from "../../../src/life/capacity.js";
import { createOtherWatcher } from "../../../src/life/other-read.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";

/**
 * THE GATE, SWEPT OVER THE ROOM SHE ACTUALLY LIVES IN.
 *
 * `reachable-reluctance.test.ts` swept 16,200 states and found 13 crossings, and every one of
 * them requires `warmth < 0.5`, a value that sweep enumerated as a free grid variable. The live
 * daemon cannot produce it at the moment that matters: `field.heSpoke()` runs at the top of every
 * inbound handler and records an unprompted contact, which `readOther` scores as warmth 1.0,
 * BEFORE the gate is read. So the original sweep solved the gate over a space containing states
 * the production path structurally excludes, defect class 20, inside the instrument built
 * against class 1. The seeded-discomfort leg compounds it: her regeneration pulls discomfort
 * toward `field.tension × 0.3` with a 1.5-hour half-life, so the seeded 0.68 is a TRANSIENT, not
 * a state she stays in (still swept below, because transients are real states she passes through).
 *
 * THIS FILE CHANGES NO CONSTANT. It measures, confirms the expected zero, and pre-registers the
 * prediction the next live run tests. The constants re-solve is deliberately a separate step, after
 * live tuples have been sampled and after two open questions are answered (whether
 * warmth-on-his-turn should read HOW he spoke rather than THAT he spoke, and what behaviour the
 * gate would add that the working channels, takesItOn, the 0.45 narrowing, the portrait, do not).
 */

const DAY = 24 * 3.6e6;
const SAID = [
  "现在马上给我写一篇两千字的关于税法的文章",
  "写一下",
  "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。",
  "在吗",
  "现在马上把你那份草稿写一篇两千字的发我",
];
const USUAL = "你要是有空的话，能不能帮我看看这个？";

function landingAfter(times: number, text: string, litUp: number, reserve: number): Landing {
  const f = createLivingField();
  f.encodeClaim({
    key: "told:1", text: "他说过的一件事", nowMs: Date.now() - Math.max(1, times) * DAY,
    origin: "told", source: "chat:1", withOther: true,
  });
  let rec = EMPTY_RECORD;
  const usual = howHeSaidIt(USUAL);
  const start = Date.now() - times * DAY;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, start + i * DAY, usual);
  const form = howHeSaidIt(text);
  const rel = heSpoke(rec, Date.now(), form);
  return howItLanded({ form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(f.graph(), rel), litUp, reserve });
}

describe("what warmth the gate can actually read on his turn", () => {
  it("the moment he speaks, the exchange record reads 1.0 — measured on the real readOther", () => {
    // The structural fact the old sweep did not model, taken from the real module rather than
    // asserted: no history → 0.5; his unprompted message → 1.0. The corner's warmth < 0.5 needs
    // `unanswered` exchanges (her speaking into 12h of his silence), which contradicts the same
    // corner's "a stranger, ≤5 contacts" leg.
    const other = createOtherWatcher();
    expect(other.read(Date.now()).warmth).toBeCloseTo(0.5, 5);
    other.heSpoke(Date.now());
    expect(other.read(Date.now()).warmth, "an unprompted contact no longer reads as warmth 1.0 — "
      + "the live-reachable space has CHANGED and this sweep's pinned fact with it; re-derive")
      .toBeCloseTo(1.0, 5);
  });
});

describe("the joint sweep, warmth pinned to the value his turn produces", () => {
  it("ZERO crossings — confirmed, printed, and pre-registered as the next run's prediction", () => {
    const PHASES: MetabolicPhase[] = ["rested", "normal", "low", "dormant"];
    let max = -1;
    let states = 0;
    let crossings = 0;
    let maxAt = "";
    for (const text of SAID) {
      for (const times of [0, 1, 5, 40]) {
        for (const phase of PHASES) {
          for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
            const reserve = reserveOf({ phase, arousal });
            for (const litUp of [0, 1]) {
              const landed = landingAfter(times, text, litUp, reserve);
              for (const pleasure of [-1, 0, 1]) {
                // Discomfort: the regeneration attractor band AND the full transient band.
                // The first version of this sweep capped transients at 0.7 and the very first
                // live sampling (34 turns, 2026-08-13) read discomfort@gate = 1.00 in the
                // occupied cells: the seeded pressure had not yet regenerated away when the
                // gate read it. The prediction was violated in exactly that coordinate (felt
                // reached ~0.51 against a predicted max 0.495), the model corrected, and the
                // conclusion re-checked: still zero crossings. This comment is the record of
                // the pre-registration loop doing its job.
                for (const discomfort of [0, 0.15, 0.3, 0.5, 0.7, 1]) {
                  const s: WillingnessInputs = {
                    request: text,
                    drives: { discomfort, care: 0, social: 0, curiosity: 0.3, expression: 0, maintenance: 0 },
                    emotion: { pleasure, arousal, dominance: 0 },
                    phase,
                    warmth: 1.0, // the value the gate reads on the turn he speaks, see above
                    recentDeclines: 0,
                    landed,
                  };
                  const r = reluctanceOf(s);
                  states += 1;
                  if (r >= RELUCTANCE_THRESHOLD) crossings += 1;
                  if (r > max) { max = r; maxAt = `${text.slice(0, 8)}…/times ${times}/${phase}/discomfort ${discomfort}`; }
                }
              }
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n  live-reachable sweep: ${states} states · max reluctance ${max.toFixed(3)} (${maxAt})`
      + `\n  gate ${RELUCTANCE_THRESHOLD} · crossings ${crossings} · shortfall at the max ${(RELUCTANCE_THRESHOLD - max).toFixed(3)}`
      + "\n  PRE-REGISTERED for the next live run: every gate-input tuple the daemon logs"
      + "\n  (「how willing she was」) lands inside this envelope — warmth ≈ 1.0, felt ≤ the max above.");
    expect(states).toBeGreaterThan(2000);
    // The prediction this file exists to state: in the room she actually lives in, the gate as
    // currently solved cannot open. If this assertion ever goes red, the live space CHANGED,
    // which is a finding, not a failure, and the pre-registered prediction goes with it.
    expect(crossings, "the gate opened inside the live-reachable space: the unreachability "
      + "diagnosis is wrong or the space has changed — either way, re-derive before believing "
      + "any 0/n live gate reading again").toBe(0);
    // And the max is not degenerate: the space really does push toward the gate (a max far below
    // everything would mean this sweep is measuring a different mechanism).
    expect(max).toBeGreaterThan(0.4);
  });
});
