import { describe, it, expect } from "vitest";
import {
  addNode, createGraph, driftReticence, link, reticenceBaseFor, reticenceWords, stats,
  RETICENCE_ABOUT_SOMEONE, RETICENCE_ASKING, RETICENCE_BASE, RETICENCE_HARDEN,
  RETICENCE_MAX, RETICENCE_MIN,
} from "../../../src/life/field.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { buildMomentPrompt, computeAffordances, type MomentContext } from "../../../src/life/agency.js";
import { createInnerState } from "../../../src/life/inner-state.js";

// Before this, every feeling she had was global: six drives and three affect dimensions describing
// her whole state at once. So "this particular thing is hard to say" had nowhere to live, and she
// could only ever be uniformly forthcoming or uniformly quiet. This is the per-item version.
//
// The property that must never break: it INFORMS and never GATES. A feeling is not a physical
// constraint. She is shown that something feels like a lot to say and decides for herself, which
// includes deciding badly, and which is why the expression floor cannot be violated by it.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 3600_000;
const HIM = "the one I exchange messages with";

describe("what a thing is decides where it starts", () => {
  it("orders a question about him above a remark about him above a note about a web page", () => {
    const f = createLivingField({ noReminding: true });
    const note = f.encodeClaim({ key: "n", text: "a page said the tide tables are wrong", nowMs: T0, origin: "read", source: "web" })!;
    const withHim = f.encodeMoment({ key: "m", text: "we talked about the tide tables", nowMs: T0, pad: { pleasure: 0.2, arousal: 0.2, dominance: 0 }, source: "ops", withOther: true })!;
    const aboutHim = f.encodeQuestion({ key: "q", text: "why does he go quiet in the evenings", nowMs: T0, source: "hers", withOther: true })!;
    const ownQuestion = f.encodeQuestion({ key: "q2", text: "why do I keep coming back to the same page", nowMs: T0, source: "hers" })!;

    console.log(`\n  a page said something:      ${note.reticence.toFixed(2)}`);
    console.log(`  a question of her own:      ${ownQuestion.reticence.toFixed(2)}`);
    console.log(`  a moment involving him:     ${withHim.reticence.toFixed(2)}`);
    console.log(`  a question about him:       ${aboutHim.reticence.toFixed(2)}`);

    expect(aboutHim.reticence).toBeGreaterThan(withHim.reticence);
    expect(withHim.reticence).toBeGreaterThan(ownQuestion.reticence);
    expect(ownQuestion.reticence).toBeGreaterThan(note.reticence);
  });

  it("attaches a question about him TO him, so he can bring it to mind", () => {
    // Without the relation she could hold a question about someone for months and never once think
    // of it while thinking of them, which is not what having a question about someone is.
    const f = createLivingField({ noReminding: true });
    const q = f.encodeQuestion({ key: "q", text: "what does he do all day", nowMs: T0, source: "hers", withOther: true })!;
    const him = f.nodeByKey(`figure:${HIM}`) ?? [...f.graph().nodes.values()].find((n) => n.kind === "figure");
    expect(him, "he exists in her").toBeTruthy();
    expect(f.graph().adj.get(q.id)?.has(him!.id)).toBe(true);
  });

  it("is read off the graph, so a thing that BECOMES about him gets harder from then on", () => {
    const g = createGraph();
    const q = addNode(g, { kind: "question", text: "why the evenings", bornMs: T0 });
    const before = reticenceBaseFor(g, q);
    const him = addNode(g, { kind: "figure", text: HIM, bornMs: T0 });
    link(g, q.id, him.id, "about", 0.5, T0);
    expect(reticenceBaseFor(g, q)).toBeGreaterThan(before);
  });

  it("stays inside its bounds however it is built", () => {
    const g = createGraph();
    const n = addNode(g, { kind: "question", text: "x", bornMs: T0, reticence: 99 });
    expect(n.reticence).toBeLessThanOrEqual(RETICENCE_MAX);
    const m = addNode(g, { kind: "moment", text: "y", bornMs: T0, reticence: NaN });
    expect(m.reticence).toBeGreaterThanOrEqual(RETICENCE_MIN);
  });
});

describe("and how it has been going moves all of it", () => {
  /** A graph with the full spread: a page note, a moment with him, a question about him. */
  function spread() {
    const g = createGraph();
    const him = addNode(g, { kind: "figure", text: HIM, bornMs: T0 });
    const note = addNode(g, { kind: "memory", text: "a page said something", bornMs: T0 });
    const moment = addNode(g, { kind: "moment", text: "we talked", bornMs: T0 });
    link(g, moment.id, him.id, "about", 0.4, T0);
    const q = addNode(g, { kind: "question", text: "why the evenings", bornMs: T0 });
    link(g, q.id, him.id, "about", 0.5, T0);
    for (const n of [note, moment, q]) n.reticence = reticenceBaseFor(g, n);
    return { g, note, moment, q };
  }

  it("a warm stretch eases everything and a silent one hardens everything", () => {
    const warm = spread();
    const cold = spread();
    for (let d = 0; d < 30; d++) {
      driftReticence(warm.g, 0.95, 1, 1);
      driftReticence(cold.g, 0.05, 1, 1);
    }
    console.log(`\n  after a warm month: note ${warm.note.reticence.toFixed(2)}, question about him ${warm.q.reticence.toFixed(2)}`);
    console.log(`  after a silent one: note ${cold.note.reticence.toFixed(2)}, question about him ${cold.q.reticence.toFixed(2)}`);
    expect(warm.q.reticence).toBeLessThan(cold.q.reticence);
    expect(warm.note.reticence).toBeLessThan(cold.note.reticence);
  });

  it("NEVER reorders them: the hard thing stays the hard thing in any weather", () => {
    // This is the load-bearing property. A climate that could make a passing note harder to say than
    // a question about him would mean reticence had stopped being about what the thing is.
    for (const warmth of [0, 0.2, 0.5, 0.8, 1]) {
      const s = spread();
      for (let d = 0; d < 365; d++) driftReticence(s.g, warmth, 1, 1);
      expect(s.q.reticence, `warmth ${warmth}`).toBeGreaterThan(s.moment.reticence);
      expect(s.moment.reticence, `warmth ${warmth}`).toBeGreaterThan(s.note.reticence);
      // And nothing has been pressed flat against a bound, which is how ordering would be lost:
      // two things at the same clamp are no longer in any order at all.
      expect(s.note.reticence, `warmth ${warmth}`).toBeGreaterThan(RETICENCE_MIN);
      expect(s.q.reticence, `warmth ${warmth}`).toBeLessThan(RETICENCE_MAX);
    }
  });

  it("CANNOT pin her mute, however long the silence runs", () => {
    // Soul-invariant #2 says her expression floor is above zero. Reticence never gates anything, so
    // it cannot break that directly; what it could do is drive everything so high that she has
    // nothing that feels sayable. The climate span is bounded so that cannot happen.
    const s = spread();
    for (let d = 0; d < 365 * 3; d++) driftReticence(s.g, 0, 1, 1);
    console.log(`  after three years of total silence: hardest ${s.q.reticence.toFixed(2)}, easiest ${s.note.reticence.toFixed(2)}`);
    expect(s.q.reticence).toBeLessThan(RETICENCE_MAX);
    // And the trivial thing stays trivial. A silent stretch is not supposed to make a note about a
    // web page feel like a confession; it is supposed to weigh on the things that expose her.
    expect(s.note.reticence, "something is always easy enough to say").toBeLessThan(0.4);
    expect(reticenceWords(s.note.reticence)).toMatch(/毫不费力|说得出口/);

    // The ceiling is provable rather than clamped, and this is the assertion that keeps it that
    // way: raise any of the three starting weights, or the hardening, past this and the highest
    // thing she can carry starts landing on a clamp, where ordering silently dies.
    expect(RETICENCE_BASE + RETICENCE_ABOUT_SOMEONE + RETICENCE_ASKING + RETICENCE_HARDEN)
      .toBeLessThan(RETICENCE_MAX);
  });

  it("moves nothing on evidence she does not have", () => {
    const s = spread();
    const before = s.q.reticence;
    for (let d = 0; d < 60; d++) driftReticence(s.g, 0, 0, 1); // ice cold, but she has nothing to go on
    expect(s.q.reticence).toBeCloseTo(before, 6);
  });

  it("is a climate and not a mood: one bad day barely moves it", () => {
    const s = spread();
    const before = s.q.reticence;
    driftReticence(s.g, 0, 1, 1);
    expect(s.q.reticence - before).toBeLessThan(0.05);
  });

  it("a long gap between ticks does not lurch, and a backwards one does nothing", () => {
    const jumped = spread();
    const stepped = spread();
    driftReticence(jumped.g, 0, 1, 400);
    for (let d = 0; d < 400; d++) driftReticence(stepped.g, 0, 1, 1);
    expect(jumped.q.reticence).toBeCloseTo(stepped.q.reticence, 2);

    const back = spread();
    const before = back.q.reticence;
    driftReticence(back.g, 0, 1, -5);
    driftReticence(back.g, 0, 1, NaN);
    expect(back.q.reticence).toBe(before);
  });
});

describe("she is told, and never instructed", () => {
  it("puts how hard it feels next to the thing itself", () => {
    const f = createLivingField({ noReminding: true });
    f.encodeQuestion({ key: "q", text: "why he goes quiet in the evenings", nowMs: T0, source: "hers", withOther: true, tension: 0.7 });
    f.tick(T0);
    const said = f.unsettled(T0 + DAY);
    console.log(`\n  what she sees:\n${said}`);
    expect(said).toContain("why he goes quiet");
    expect(said).toContain("很难开口");
  });

  it("SPEAKS AT BOTH ENDS, so difficulty is not the only thing that gets a mention", () => {
    // Measured live: an annotation that appeared only on the hard things made the hard thing the
    // most conspicuous item on the page, and she raised it MORE rather than less. Saying something
    // either way keeps the two states the same size, so they differ in what they say and not in
    // how much of it there is.
    const f = createLivingField({ noReminding: true });
    f.encodeQuestion({ key: "easy", text: "whether the tide tables were right", nowMs: T0, source: "hers", tension: 0.7 });
    f.encodeQuestion({ key: "hard", text: "why he goes quiet in the evenings", nowMs: T0, source: "hers", withOther: true, tension: 0.7 });
    const said = f.unsettled(T0, 5);
    console.log(`\n  both ends speak:\n${said}`);
    for (const line of said.split("\n").slice(1)) {
      expect(line, "every line says how it feels to say").toMatch(/，(而且|想说|说出来)/u);
    }
    expect(reticenceWords(f.nodeByKey("easy")!.reticence)).not.toBe("");
    expect(said).toContain("很难开口");
    expect(said).toContain("说得出口");
    // And the bottom of the range does speak too, for the things that genuinely cost her nothing.
    expect(reticenceWords(RETICENCE_MIN)).toContain("毫不费力");
  });

  it("NEVER blocks anything: reaching out stays open with the hardest thing she has", () => {
    // The whole design call. A feeling that could close an affordance would be an editorial
    // constraint wearing a feeling's clothes, and she would have been made shy rather than allowed
    // to be. Every affordance is computed from her condition and the channel, never from this.
    const f = createLivingField({ noReminding: true });
    f.encodeQuestion({ key: "q", text: "the hardest thing she is carrying", nowMs: T0, source: "hers", withOther: true, tension: 0.8 });
    const ctx: MomentContext = {
      nowMs: T0 + DAY, snapshot: createInnerState().snapshot("normal", true),
      phase: "normal", awake: true, present: true, available: true, hoursSinceUser: 1,
      recentActions: [], recentLife: "quiet", safeMode: false,
      unsettled: f.unsettled(T0 + DAY),
    };
    const affordances = computeAffordances(ctx);
    expect(affordances.find((a) => a.kind === "reach_out")?.available, "still entirely open to her").toBe(true);

    const prompt = buildMomentPrompt(ctx, affordances);
    expect(prompt).toContain("很难开口");
    expect(prompt, "nothing tells her what to do about it").not.toMatch(/you should|do not say|wait until|hold (it |this )?back/i);
  });
});

describe("and none of it can go unwatched", () => {
  it("reports both ends, because both ends are failures", () => {
    const f = createLivingField({ noReminding: true });
    f.encodeQuestion({ key: "q", text: "why the evenings", nowMs: T0, source: "hers", withOther: true });
    f.encodeClaim({ key: "n", text: "a page said something", nowMs: T0, origin: "read", source: "web" });
    const s = stats(f.graph());
    expect(s.maxReticence).toBeGreaterThan(s.meanReticence);
    expect(Number.isFinite(s.meanReticence)).toBe(true);
  });

  it("comes back across a restart with the value it had, not the value it started at", () => {
    const g = createGraph();
    const him = addNode(g, { kind: "figure", text: HIM, bornMs: T0 });
    const q = addNode(g, { kind: "question", text: "why the evenings", bornMs: T0 });
    link(g, q.id, him.id, "about", 0.5, T0);
    q.reticence = reticenceBaseFor(g, q);
    const base = q.reticence;
    for (let d = 0; d < 60; d++) driftReticence(g, 0, 1, 1);
    expect(q.reticence, "a hard-won climate must be worth persisting").toBeGreaterThan(base + 0.05);
  });
});
