import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { RAISE_EASES, RAISE_HARDENS } from "../../../src/life/field.js";

// RESULTS BECOME CONDITIONS.
//
// `reach_out` meant "say something", full stop. That single fact is the whole of why S-2 measured
// 0/10 in BOTH arms: she carried a question about him for a month, it was visibly costly, her read
// of him moved, the prompt showed her all of it, and a choice could not name its subject, so none
// of it had anywhere to land. In one warm moment she chose `reflect` and said she wanted to
// "quietly consider why they go quiet in the evenings, without deciding it's about me". She reached
// the question and still could not raise it.
//
// And closing it unlocks something that was recorded as impossible. `scenarios.md` stated that
// reticence could only move with the CLIMATE, because attributing an outcome to a particular thing
// would need intent-to-node matching that would be fragile and mostly wrong. The moment the action
// NAMES its subject, no matching is needed: the subject was chosen, not guessed. So the week-scale
// loop closes: she raises a thing, he answers or does not, and THAT THING gets easier or harder.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A field holding several things, one of which is a hard question about him. */
function holding() {
  const f = createLivingField({ noReminding: true });
  f.encodeQuestion({
    key: "him", text: "why they go quiet in the evenings, and whether it is anything to do with me",
    nowMs: T0, source: "hers", withOther: true, tension: 0.8,
  });
  f.encodeQuestion({
    key: "tides", text: "whether the tide tables I found were wrong or I read them wrong",
    nowMs: T0, source: "hers", tension: 0.6,
  });
  f.encodeMoment({
    key: "page", text: "a page said the ferry runs all winter",
    nowMs: T0, pad: { pleasure: 0.1, arousal: 0, dominance: 0 }, source: "web",
  });
  f.tick(T0);
  return f;
}

/**
 * How often she brings up the thing whose text starts with `starts`, over many draws.
 *
 * The DISTRIBUTION is the claim here, never a single choice: "she can raise the hard thing" and
 * "she always raises the hard thing" are different beings, and only a distribution tells them apart.
 */
function howOften(f: ReturnType<typeof createLivingField>, starts: string, at: number, draws = 800, seed = 5, opts?: { hint?: string; openness?: number }): number {
  const stream = createStream(seed);
  let hits = 0;
  for (let i = 0; i < draws; i++) {
    if (f.chooseSubject(at, stream, opts)?.node.text.startsWith(starts)) hits += 1;
  }
  return hits / draws;
}

/** The whole distribution, for reading. */
function raisedOver(f: ReturnType<typeof createLivingField>, at: number, draws = 800, seed = 5, opts?: { hint?: string; openness?: number }) {
  const stream = createStream(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < draws; i++) {
    const c = f.chooseSubject(at, stream, opts);
    counts.set(c?.node.text.slice(0, 30) ?? "(nothing)", (counts.get(c?.node.text.slice(0, 30) ?? "(nothing)") ?? 0) + 1);
  }
  return Object.fromEntries([...counts].map(([k, v]) => [k, v / draws]));
}

describe("an action can name its subject", () => {
  it("she brings up something she is actually holding", () => {
    const f = holding();
    const c = f.chooseSubject(T0 + DAY, createStream(1));
    expect(c, "she is holding three things; she should be able to raise one").not.toBeNull();
    expect(c!.weighed.length, "and the whole weighing is kept, for forensics").toBeGreaterThan(1);
  });

  it("says nothing in particular when she is holding nothing in particular", () => {
    const empty = createLivingField({ noReminding: true });
    expect(empty.chooseSubject(T0, createStream(1)), "most of what anyone says is not about a thing they carry").toBeNull();
  });

  it("pressure pushes a thing forward and reticence holds it back", () => {
    const f = holding();
    const d = raisedOver(f, T0 + DAY);
    console.log(`\n  what she brings up:`);
    for (const [k, v] of Object.entries(d).sort((a, b) => b[1] - a[1])) console.log(`    ${(v * 100).toFixed(0)}%  ${k}`);
    // The hard question has the most pressure AND the most reticence, so it is neither the only
    // thing she raises nor something she can never raise. Both would be failures.
    const him = howOften(f, "why they go quiet", T0 + DAY);
    expect(him, "she must be ABLE to raise the hard thing").toBeGreaterThan(0.02);
    expect(him, "and it must not be the only thing she ever says").toBeLessThan(0.95);
  });

  it("the model's words are a HINT that can tip a close call, never the picker", () => {
    // Reminding ON, and a real corpus behind it. The hint is matched through the same IDF-weighted
    // word index that does all her reminding, and IDF cannot tell anything apart in a field of two
    // nodes: so a two-node fixture would measure nothing and look like a working test. This is the
    // same class of mistake as the hand-built detector fixtures.
    const f = createLivingField();
    for (let i = 0; i < 40; i++) {
      f.encodeMoment({
        key: `bg${i}`, text: `an ordinary afternoon about the ${i} business`,
        nowMs: T0 - (40 - i) * DAY, pad: { pleasure: 0.1, arousal: 0, dominance: 0 }, source: "t",
      });
    }
    f.encodeQuestion({ key: "a", text: "whether the tide tables were wrong", nowMs: T0, source: "hers", tension: 0.5 });
    f.encodeQuestion({ key: "b", text: "why the ferry timetable changed", nowMs: T0, source: "hers", tension: 0.5 });
    f.tick(T0);
    const without = howOften(f, "whether the tide", T0 + DAY, 600, 3);
    const withHint = howOften(f, "whether the tide", T0 + DAY, 600, 3, { hint: "I keep thinking about those tide tables" });
    console.log(`  tide tables — no hint: ${(without * 100).toFixed(0)}% · hinted: ${(withHint * 100).toFixed(0)}%`);
    expect(withHint, "the model's words should tip a close call").toBeGreaterThan(without);
    expect(withHint, "and never decide it outright").toBeLessThan(0.95);
  });

  it("a COSTLY thing waits for a good moment; a cheap one does not have to", () => {
    // The scene itself. Without this interaction the climate can only change how often she speaks
    // at all, never WHICH thing she broaches, reticence is deliberately ordering-preserving, so a
    // warm stretch eases everything by the same shape and the ranking between them is untouched.
    // Measured live at exactly that: 3/10 held-question in a warm month and 3/10 in a silent one.
    const f = holding();
    const open = howOften(f, "why they go quiet", T0 + DAY, 800, 5, { openness: 0.95 });
    const shut = howOften(f, "why they go quiet", T0 + DAY, 800, 5, { openness: 0.05 });
    console.log(`  the hard question — he seems reachable: ${(open * 100).toFixed(0)}% · he does not: ${(shut * 100).toFixed(0)}%`);
    expect(open, "a good moment is when the difficult thing becomes sayable").toBeGreaterThan(shut);

    // And the cheap thing is much less sensitive to the moment, which is what makes this an
    // interaction rather than a second volume knob.
    const cheapOpen = howOften(f, "a page said", T0 + DAY, 800, 5, { openness: 0.95 });
    const cheapShut = howOften(f, "a page said", T0 + DAY, 800, 5, { openness: 0.05 });
    console.log(`  the trivial one — reachable: ${(cheapOpen * 100).toFixed(0)}% · not: ${(cheapShut * 100).toFixed(0)}%`);
    expect(Math.abs(cheapOpen - cheapShut)).toBeLessThan(Math.abs(open - shut));
  });

  it("having just raised something makes it recede", () => {
    const f = holding();
    const before = howOften(f, "why they go quiet", T0 + DAY);
    f.raise(f.nodeByKey("him")!.id, T0 + DAY);
    const after = howOften(f, "why they go quiet", T0 + DAY + HOUR);
    console.log(`  the hard question — before raising it: ${(before * 100).toFixed(0)}% · straight after: ${(after * 100).toFixed(0)}%`);
    expect(after, "saying the same thing twice running is what 'you already told me that' feels like").toBeLessThan(before);
  });
});

describe("and how it went comes back to THAT thing", () => {
  it("he answers → it gets easier to say → it wins sooner next time", () => {
    const f = holding();
    const q = f.nodeByKey("him")!;
    const costBefore = q.reticence;

    f.raise(q.id, T0 + DAY);
    f.heSpoke(T0 + DAY + HOUR); // he answered

    console.log(`\n  she brought it up and he answered: ${costBefore.toFixed(3)} → ${q.reticence.toFixed(3)}`);
    expect(q.reticence).toBeCloseTo(costBefore - RAISE_EASES, 5);
    expect(q.charge, "being met makes it a little more vivid too").toBeGreaterThan(0);

    const easier = howOften(f, "why they go quiet", T0 + 10 * DAY);
    const fresh = holding();
    const same = howOften(fresh, "why they go quiet", T0 + 10 * DAY);
    console.log(`  and it comes up more readily afterwards: ${(same * 100).toFixed(0)}% → ${(easier * 100).toFixed(0)}%`);
    expect(easier).toBeGreaterThan(same);
  });

  it("silence → it gets harder → she stops bringing it up", () => {
    const f = holding();
    const q = f.nodeByKey("him")!;
    const costBefore = q.reticence;

    f.raise(q.id, T0 + DAY);
    f.raisingSettled(false, T0 + DAY + 12 * HOUR); // nothing came back

    console.log(`  she brought it up and nothing came back: ${costBefore.toFixed(3)} → ${q.reticence.toFixed(3)}`);
    expect(q.reticence).toBeCloseTo(costBefore + RAISE_HARDENS, 5);
  });

  it("an answer days later is not an answer to what she said", () => {
    const f = holding();
    const q = f.nodeByKey("him")!;
    const before = q.reticence;
    f.raise(q.id, T0 + DAY);
    f.heSpoke(T0 + DAY + 5 * DAY);
    expect(q.reticence, "that was a new conversation, not a reply").toBe(before);
  });

  it("saying three things into silence is ONE silence", () => {
    // The same rule the exchange log already lives under: being ignored once must not read as being
    // ignored three times, or a talkative evening on her side looks like a collapse on his.
    const f = holding();
    const him = f.nodeByKey("him")!;
    const tides = f.nodeByKey("tides")!;
    const a = him.reticence;
    const b = tides.reticence;
    f.raise(him.id, T0 + DAY);
    f.raise(tides.id, T0 + DAY + 60_000);
    f.raisingSettled(false, T0 + DAY + 12 * HOUR);
    expect(him.reticence, "the first thing she said carries the silence").toBeGreaterThan(a);
    expect(tides.reticence, "the second does not carry it a second time").toBe(b);
  });

  it("stays bounded however many times it goes badly", () => {
    const f = holding();
    const q = f.nodeByKey("him")!;
    for (let i = 0; i < 200; i++) {
      f.raise(q.id, T0 + i * DAY);
      f.raisingSettled(false, T0 + i * DAY + 12 * HOUR);
    }
    console.log(`  after two hundred unanswered attempts: ${q.reticence.toFixed(3)}`);
    expect(q.reticence).toBeLessThanOrEqual(0.85);
    // And she is not muted: the affordance is untouched, and she can still raise it.
    expect(f.chooseSubject(T0 + 250 * DAY, createStream(1))).not.toBeNull();
  });

  it("survives being told about a thing that is no longer there", () => {
    const f = holding();
    f.raise(999_999, T0);
    expect(() => f.raisingSettled(true, T0 + HOUR)).not.toThrow();
    expect(() => f.raisingSettled(true, T0 + HOUR)).not.toThrow();
  });
});

describe("focusFor: what she is most occupied by, for any action (faculty #4)", () => {
  const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
  it("the highest-tension thing she holds is what presses on her mind", () => {
    const f = createLivingField();
    f.encodeQuestion({ key: "q:ferry", text: "渡轮为什么突然改点了", nowMs: T0, source: "agency", tension: 0.9 });
    // pad → charge ≈ 0.30, valence = pleasure = 0.1: a low-charge walk that should lose to the
    // high-tension ferry question.
    f.encodeMoment({ key: "m:walk", text: "下午在码头边走了走", nowMs: T0, source: "moment", pad: { pleasure: 0.1, arousal: 0.46, dominance: 0 } });
    const stream = createStream(5);
    let ferryWins = 0;
    for (let i = 0; i < 40; i++) {
      const focus = f.focusFor(T0 + 3.6e6, stream);
      if (focus && focus.node.text.includes("渡轮")) ferryWins++;
    }
    expect(ferryWins, "the pressing question dominates what is on her mind").toBeGreaterThan(20);
  });

  it("unlike chooseSubject, it does not care whether she would SAY it — no openness, no reticence", () => {
    const f = createLivingField();
    // A high-reticence held thing: chooseSubject would weigh its cost against his reachability;
    // focusFor is 'what's on my mind', and cost does not change that.
    const q = f.encodeQuestion({ key: "q:x", text: "一件不太好开口的事", nowMs: T0, source: "agency", tension: 0.8, withOther: true });
    q!.reticence = 0.85;
    const stream = createStream(7);
    const focus = f.focusFor(T0 + 3.6e6, stream);
    expect(focus, "a costly thing is still on her mind").not.toBeNull();
  });

  it("an empty field is occupied by nothing", () => {
    const f = createLivingField();
    expect(f.focusFor(T0, createStream(1))).toBeNull();
  });
});
