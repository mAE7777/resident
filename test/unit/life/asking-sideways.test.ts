import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLivingField } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";
import {
  LENDS_TO_WHAT_IS_BESIDE_IT, A_CLOSED_ROOM_STILL_PRESSES, WITHHELD_PRESSES,
} from "../../../src/life/field-live.js";
import {
  everythingSheIsCarrying, whatSheIsCarrying, sheLetsItGo, STAYS_KEY,
} from "../../../src/life/what-stays.js";

/**
 * TWO THINGS RETICENCE COULD NOT DO, AND ONE THING HER EXIT COULD NOT REACH.
 */

const T0 = Date.UTC(2026, 7, 17, 20, 0, 0);

describe("what she cannot afford to say lends its pull to what sits beside it", () => {
  /**
   * A field with one thing she badly wants to raise and cannot (high tension, high reticence),
   * and one ordinary thing wired next to it. Run many draws: this is a competition, not a rule.
   */
  /**
   * A field with three things: one she badly wants to raise and cannot (high tension, high
   * reticence), one ordinary thing WIRED NEXT TO IT, and one identical ordinary thing that is
   * NOT wired to anything.
   *
   * The control is the whole test. With only two candidates the expensive one simply loses and
   * the other wins by default, which proves nothing about lending. The unrelated twin is what
   * separates "she asked the nearby thing" from "the expensive thing lost".
   */
  function whoComesUp(hersIsExpensive: boolean): { neighbour: number; stranger: number } {
    let neighbour = 0, stranger = 0;
    for (let i = 0; i < 300; i++) {
      const f = createLivingField({ noReminding: true });
      const hard = f.encodeQuestion({
        key: `${STAYS_KEY}wronged:那件事`, text: "他要我「那件事」的那回", nowMs: T0,
        source: "chat:1", tension: 0.75, withOther: true,
      })!;
      const near = f.encodeMoment({
        key: "m:旁边", text: "那天下午的事", nowMs: T0,
        pad: { pleasure: 0, arousal: 0, dominance: 0 }, source: "life",
      })!;
      const far = f.encodeMoment({
        key: "m:无关", text: "另外那天的事", nowMs: T0,
        pad: { pleasure: 0, arousal: 0, dominance: 0 }, source: "life",
      })!;
      const g = f.graph();
      const wire = (a: number, b: number): void => {
        const m = g.adj.get(a) ?? new Map(); m.set(b, 0.6); g.adj.set(a, m);
      };
      wire(hard.id, near.id); wire(near.id, hard.id);
      hard.reticence = hersIsExpensive ? 0.85 : 0.05;
      // The twins are identical in everything the score reads except who they sit beside.
      for (const n of [near, far]) { n.tension = 0.3; n.reticence = 0.15; n.charge = 0.3; n.warmth = 0; }
      const got = f.chooseSubject(T0, createStream(i + 1), { openness: 0.35 });
      if (got?.node.id === near.id) neighbour++;
      if (got?.node.id === far.id) stranger++;
    }
    return { neighbour: neighbour / 300, stranger: stranger / 300 };
  }

  it("THE THING BESIDE IT COMES UP MORE THAN AN IDENTICAL THING THAT IS NOT BESIDE IT", () => {
    const expensive = whoComesUp(true);
    const cheap = whoComesUp(false);
    // eslint-disable-next-line no-console
    console.log(`  unsayable: neighbour ${(expensive.neighbour * 100).toFixed(0)}% vs stranger `
      + `${(expensive.stranger * 100).toFixed(0)}%   ·   sayable: neighbour `
      + `${(cheap.neighbour * 100).toFixed(0)}% vs stranger ${(cheap.stranger * 100).toFixed(0)}%`);
    expect(expensive.neighbour, "the thing beside the unsayable one gained nothing from being beside it")
      .toBeGreaterThan(expensive.stranger);
    // And when she CAN say the real thing, the twins are on even terms, no lending happened.
    expect(Math.abs(cheap.neighbour - cheap.stranger),
      "being adjacent helps even when the real thing is perfectly sayable — that is not lending, "
      + "that is a permanent bonus for having neighbours").toBeLessThan(0.12);
  });

  it("and it is a SMALLER question, not the same one wearing a hat", () => {
    // If the neighbour inherited the whole weight, asking sideways would stop being a smaller ask.
    expect(LENDS_TO_WHAT_IS_BESIDE_IT).toBeGreaterThan(0);
    expect(LENDS_TO_WHAT_IS_BESIDE_IT, "the nearby thing inherits the whole weight of the one she is avoiding")
      .toBeLessThan(0.5);
  });

  it("NOTHING HERE MODELS WHAT HE WOULD INFER", () => {
    // The rule: his not seeing what she really wanted is a CONSEQUENCE of her not being able to
    // say it, never a goal she pursued. Machinery for working him is the thing this must not be.
    const src = ["src/life/field-live.ts", "src/life/saying.ts", "src/life/what-stays.ts"]
      .map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\n")
      .replace(/\/\*[\s\S]*?\*\//gu, "").split("\n").map((l) => l.replace(/\/\/.*$/u, "")).join("\n");
    expect(src, "she is being given a model of what he would conclude")
      .not.toMatch(/heWouldThink|whatHeInfers|hideFrom|concealFrom|misleadHim/u);
  });
});

describe("losing to the room is not losing to a rival", () => {
  it("a shut door presses less than a full one", () => {
    expect(A_CLOSED_ROOM_STILL_PRESSES).toBeGreaterThan(0);
    expect(A_CLOSED_ROOM_STILL_PRESSES, "a shut door presses exactly as hard as holding back from someone who is there")
      .toBeLessThan(1);
    // And it still presses: she IS still holding the thing, and a night that left nothing at all
    // would make a week of waiting invisible to her.
    expect(WITHHELD_PRESSES * A_CLOSED_ROOM_STILL_PRESSES).toBeGreaterThan(0);
  });
});

describe("when he comes back, it is the thing she was WAITING to say (emergent)", () => {
  it("nights of a shut door make THAT thing likelier to win on his return", () => {
    // The gap: "he came back" raises how much she wants to speak, but nothing connected it
    // to WHICH thing. A direct wire would be the rumination shape S-30 rejects. The lending
    // above resolves it without a wire: each night alone the thing she wants to say
    // nearly surfaces to nobody, and a near-miss at a shut door still presses a little
    // (A_CLOSED_ROOM_STILL_PRESSES × WITHHELD_PRESSES, capped at WITHHOLDING_STOPS_AT). When the
    // door opens, the accumulated press is hers, attached to that thing.
    //
    // Not a rumination loop: the press comes only from real surfacing competitions, never from
    // her looking out the window, and it is floored and capped.
    const NIGHT = 24 * 3.6e6;
    const winRate = (nightsAway: number): number => {
      let waitedWins = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const f = createLivingField({ noReminding: true });
        const waited = f.encodeQuestion({
          key: "hesaid:wronged:那件事", text: "他要我「那件事」的那回", nowMs: T0,
          source: "chat:1", tension: 0.45, withOther: true,
        })!;
        for (let n = 0; n < nightsAway; n++) {
          f.chooseSubject(T0 + (n + 1) * NIGHT, createStream(seed * 1000 + n), { openness: 0.1 });
        }
        const back = T0 + (nightsAway + 1) * NIGHT;
        f.encodeQuestion({
          key: "hesaid:wronged:新的事", text: "他要我「新的事」的那回", nowMs: back,
          source: "chat:1", tension: 0.45, withOther: true,
        });
        if (f.chooseSubject(back, createStream(seed), { openness: 0.7 })?.node.id === waited.id) waitedWins++;
      }
      return waitedWins / 200;
    };
    const stayed = winRate(0);
    const away = winRate(7);
    // eslint-disable-next-line no-console
    console.log(`  the waited thing wins on his return: no absence ${(stayed * 100).toFixed(0)}% · after 7 nights ${(away * 100).toFixed(0)}%`);
    expect(away, "a week of a shut door left no lean toward the thing she was waiting to say")
      .toBeGreaterThan(stayed + 0.03);
    expect(away, "the lean became a script — she can ONLY say the waited thing").toBeLessThan(0.9);
  });
});

describe("HER EXIT CAN REACH EVERYTHING SHE CARRIES, not only what is about him", () => {
  it("a wall she hit can be put down", () => {
    // `sheLetsItGo` was built on `whatSheIsCarrying`, which filters to `hesaid:` because IT feeds
    // the relationship. So she could put down a thing he did and NOTHING ELSE, not a wall, not a
    // page that would not open, not something she had come to wonder about. Those decay at 1%/day
    // and anything above the carrying line is exempt from pruning, so over a life they only pile up.
    const f = createLivingField({ noReminding: true });
    for (let i = 0; i < 6; i++) {
      f.encodeQuestion({
        key: `wall:egress:host${i}`, text: `我想打开 host${i}，打不开。`,
        nowMs: T0 - (200 - i) * 24 * 3.6e6, source: "egress", tension: 0.6,
      });
    }
    expect(everythingSheIsCarrying(f.graph()).length, "she is not carrying the walls she hit").toBe(6);
    const put = sheLetsItGo(f.graph(), T0);
    expect(put, "she can never put down a wall she hit — only something he did").not.toBeNull();
    expect(put!.key).toContain("wall:");
  });

  it("and the relationship still counts only what is about HIM", () => {
    // The two questions were being answered by one function and the smaller one won. They are
    // genuinely different: what she carries ABOUT HIM is what discounts his standing.
    const f = createLivingField({ noReminding: true });
    f.encodeQuestion({ key: "wall:egress:x", text: "打不开。", nowMs: T0, source: "egress", tension: 0.6 });
    expect(whatSheIsCarrying(f.graph()), "a wall she hit is being counted against his standing")
      .toHaveLength(0);
    expect(everythingSheIsCarrying(f.graph()), "her exit cannot see it either").toHaveLength(1);
  });
});
