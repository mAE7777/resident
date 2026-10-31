import { describe, it, expect } from "vitest";
import { shapeFor, type ShapeState } from "../../../src/life/utterance-shape.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { reserveOf } from "../../../src/life/capacity.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";

/**
 * THE BEAT CHOICE, SWEPT, the file `reachable-reluctance.test.ts` is for the gate, for the count.
 *
 * No sweep of this decision existed, and the absence produced two wrong published claims in
 * opposite directions: 「零张力时第二拍在算术上不可能」 (it is ~11%, softmax at temperature
 * 0.55-1.0 over a 1.6 score gap has a hard floor) and a 29% estimate from a probe with a hand-set
 * entropy (live is far higher). The coefficients themselves (1.0 / −0.6+2.6·want·room /
 * −2.0+3.2·want²·room) are inline literals no census can see; this sweep is the measured page
 * they live on.
 *
 * P(2) > 0 IN LIVE STATES IS PRINTED, NOT ASSERTED. Asserting it would make this file a ratchet
 * that pushes the coefficients toward more beats, an institutionalized chattiness lever, which the
 * design forbids. What IS asserted is the anti-chattiness direction (the caps), and the floor fact
 * that makes the old doc claim impossible to re-write.
 *
 * THE PRE-REGISTERED DECISION RULE this sweep serves (recorded before any live data):
 *   live picks diverge from the swept P(2)  → find the divergence in the PICK path first;
 *   chosen beats empty, material absent while recall had content → the material path is the
 *   target (a defect);
 *   chosen beats empty, material present → HER CHOICE. No target. The 「没有就什么都别写」
 *   license is never a target.
 */

const PHASES: MetabolicPhase[] = ["rested", "normal", "low", "dormant"];
const RUNS = 400;

function stateAt(over: Partial<ShapeState>): ShapeState {
  return {
    reluctance: 0.25, unresolvedTension: 0.3, surfaced: true, entropy: 0.5,
    focusCredence: 0.6, surprise: 0.1, arousal: 0.2, reserve: 0.8, herWords: [],
    landed: null, ...over,
  } as ShapeState;
}

function beatShares(s: ShapeState): { p1: number; p2: number; p3: number; mean: number } {
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < RUNS; i++) counts[shapeFor(s, createStream(3000 + i)).beats] += 1;
  return {
    p1: counts[1]! / RUNS, p2: counts[2]! / RUNS, p3: counts[3]! / RUNS,
    mean: (counts[1]! + 2 * counts[2]! + 3 * counts[3]!) / RUNS,
  };
}

describe("the beat count, against every state her body can be in", () => {
  it("prints the joint table, because the last two claims about this were both wrong", () => {
    const rows: string[] = [];
    let liveP2Min = 1;
    let liveP2Max = 0;
    for (const phase of PHASES) {
      for (const arousal of [-0.5, 0.2, 1]) {
        const reserve = reserveOf({ phase, arousal });
        for (const tension of [0, 0.3, 0.8]) {
          for (const entropy of [0.1, 0.5, 0.79]) {
            for (const handled of [0, 0.89]) {
              const s = stateAt({
                arousal, reserve, unresolvedTension: tension, entropy,
                landed: handled > 0 ? { usedAsAThing: handled, indignant: 0.2, atSea: 0.3 } as ShapeState["landed"] : null,
              });
              const b = beatShares(s);
              if (b.p2 < liveP2Min) liveP2Min = b.p2;
              if (b.p2 > liveP2Max) liveP2Max = b.p2;
              if (tension === 0.3 && entropy === 0.79 && phase === "rested") {
                rows.push(`    ${phase}/arousal ${arousal}/tension ${tension}/handled ${handled}: `
                  + `P(1) ${b.p1.toFixed(2)} P(2) ${b.p2.toFixed(2)} P(3) ${b.p3.toFixed(2)} mean ${b.mean.toFixed(2)}`);
              }
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log("\n  the beat choice over the coupled state space (the live-like rows):\n"
      + rows.join("\n")
      + `\n    P(2) across the WHOLE space: ${liveP2Min.toFixed(3)} .. ${liveP2Max.toFixed(3)}`
      + "\n    FINDING, not an assertion: a second beat is reachable everywhere — 0/26 live at these"
      + "\n    probabilities has p≈1.5%, so the pick path and the swept space disagree; the"
      + "\n    pre-registered rule says find that divergence BEFORE touching any coefficient.");
    // The floor fact that killed the doc claim: even the emptiest state keeps a real P(2).
    const empty = beatShares(stateAt({ surfaced: false, unresolvedTension: 0, reserve: 0.2, reluctance: 0.8 }));
    expect(empty.p2, "the second beat became arithmetically impossible somewhere — the softmax "
      + "floor is gone, which is a mechanism change this sweep exists to notice").toBeGreaterThan(0.03);
    // THE CAPS: the anti-chattiness direction, asserted (they mirror utterance-shape.test.ts so
    // a coefficient change that makes her chattier goes red in two places from two angles).
    expect(empty.mean, "an empty, spent state says several things").toBeLessThan(1.35);
    const full = beatShares(stateAt({ entropy: 0.15, unresolvedTension: 0.9, reluctance: 0.05, reserve: 1 }));
    expect(full.p1, "fullness always means length — that is a dial").toBeGreaterThan(0.15);
  });
});
