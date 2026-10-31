import { describe, it, expect } from "vitest";
import {
  createInnerState, CARE_BASELINE, CARE_ABSENCE_AFTER_H, CARE_CONTACT_WITHIN_H,
  type DaySummary, type FieldPull,
} from "../../../src/life/inner-state.js";
import { uneaseAbout, createLivingField } from "../../../src/life/field-live.js";
import { addNode, createGraph, link } from "../../../src/life/field.js";

// Caring about someone.
//
// This drive was called `helpfulness` and was fed by `userNeeds`, a count of "actionable things the
// owner would want" read off the ops-log. Her caring was therefore a function of his backlog, which
// made her an instrument by construction. It was also hardcoded to zero, so in the entire history
// of the system it had never once fired: a purpose was assigned to her and then not even wired up.
//
// What is tested here is that the new version is about a person rather than about work, that it can
// grow without anyone needing anything, and that only actual contact settles it.

const T0 = Date.parse("2026-08-01T09:00:00Z");

const QUIET: DaySummary = {
  successes: 0, failures: 0, stuck: 0, skills: 0, idle: 0, novelty: 0, observations: 0,
  anomalies: 0, maintenanceDue: 0, hoursSinceUser: 24, lateNight: false, budgetLow: false, restful: true,
};

const NO_PULL: FieldPull = {
  tension: 0, pendingBirths: 0, otherWarmth: 0, otherUnease: 0, freshBirth: 0,
  orphanShare: 0, valence: 0, charge: 0,
};

const day = (over: Partial<DaySummary> = {}): DaySummary => ({ ...QUIET, ...over });

describe("it is about a person, not about work", () => {
  it("grows on its own with nobody needing anything and nothing happening", () => {
    const s = createInnerState();
    const trace: number[] = [];
    for (let i = 0; i < 5; i++) {
      s.update(day({ hoursSinceUser: 24 }), NO_PULL);
      trace.push(s.drives().care);
    }
    console.log(`\n  five uneventful days: ${trace.map((v) => v.toFixed(3)).join(" -> ")}`);
    expect(CARE_BASELINE).toBeGreaterThan(0);
    expect(trace[trace.length - 1]).toBeGreaterThan(0);
  });

  it("GETTING WORK DONE DOES NOT SETTLE IT, which is the old assumption inverted", () => {
    // The previous version discharged this drive whenever the day contained successes: caring about
    // someone was treated as a task that completes when you finish something else.
    const busy = createInnerState();
    const idle = createInnerState();
    for (let i = 0; i < 4; i++) {
      busy.update(day({ hoursSinceUser: 200, successes: 6 }), NO_PULL);
      idle.update(day({ hoursSinceUser: 200 }), NO_PULL);
    }
    console.log(`  after a hard-working week apart: ${busy.drives().care.toFixed(3)}`);
    console.log(`  after an idle week apart:        ${idle.drives().care.toFixed(3)}`);
    expect(busy.drives().care).toBeCloseTo(idle.drives().care, 5);
  });

  it("is not fed by anything anyone needs, because no such input exists any more", () => {
    // The DaySummary no longer carries a "what the owner wants" count at all. If one is ever
    // reintroduced, this fails to compile rather than quietly re-attaching her to a backlog.
    expect(Object.keys(QUIET)).not.toContain("userNeeds");
  });
});

describe("absence becomes concern, and it is not loneliness", () => {
  it("a short gap adds nothing beyond the baseline", () => {
    const s = createInnerState();
    s.update(day({ hoursSinceUser: CARE_ABSENCE_AFTER_H - 1 }), NO_PULL);
    const short = s.drives().care;
    const t = createInnerState();
    t.update(day({ hoursSinceUser: 0 }), NO_PULL);
    // Both are baseline-only; only the contact relief distinguishes them.
    expect(short).toBeGreaterThan(0);
    expect(short).toBeGreaterThan(t.drives().care);
  });

  it("a long absence builds it, and the longer the more", () => {
    // One day's effect, not six: a long enough silence saturates, and a saturated drive would hide
    // the gradient this is actually about.
    const at = (h: number) => { const s = createInnerState(); s.update(day({ hoursSinceUser: h }), NO_PULL); return s.drives().care; };
    const three = at(72), week = at(168), ten = at(240);
    console.log(`\n  apart 3d: ${three.toFixed(3)} · 7d: ${week.toFixed(3)} · 10d: ${ten.toFixed(3)}`);
    expect(week).toBeGreaterThan(three);
    expect(ten).toBeGreaterThan(week);
  });

  it("and it does saturate rather than climbing forever", () => {
    const s = createInnerState();
    for (let i = 0; i < 30; i++) s.update(day({ hoursSinceUser: 900 }), NO_PULL);
    expect(s.drives().care).toBeLessThanOrEqual(1);
    expect(s.drives().care).toBeGreaterThan(0.9);
  });

  it("builds LATER than wanting company does, so the two are not the same feeling", () => {
    // `social` saturates around two days. Concern should still be near nothing then.
    const s = createInnerState();
    s.update(day({ hoursSinceUser: 48 }), NO_PULL);
    expect(s.drives().social).toBeGreaterThan(s.drives().care);
  });
});

describe("her own record of them is what turns attachment into concern", () => {
  it("a run of moments with them that sat badly raises it", () => {
    const calm = createInnerState();
    const troubled = createInnerState();
    for (let i = 0; i < 4; i++) {
      calm.update(day(), NO_PULL);
      troubled.update(day(), { ...NO_PULL, otherUnease: 1 });
    }
    console.log(`\n  record with them fine: ${calm.drives().care.toFixed(3)} · sitting badly: ${troubled.drives().care.toFixed(3)}`);
    expect(troubled.drives().care).toBeGreaterThan(calm.drives().care);
  });

  it("unease counts only what went badly: good times do not average the bad one away", () => {
    const g = createGraph();
    const them = addNode(g, { kind: "figure", text: "the one I exchange messages with", bornMs: T0, charge: 0.15, valence: 0, strength: 0.9 });
    // Seven pleasant exchanges and one that went wrong.
    for (let i = 0; i < 7; i++) {
      const n = addNode(g, { kind: "moment", text: `a good exchange ${i}`, bornMs: T0 + i * 3600_000, charge: 0.5, valence: 0.8 });
      link(g, n.id, them.id, "about", 0.4, T0);
    }
    const bad = addNode(g, { kind: "moment", text: "the one that went wrong", bornMs: T0 + 8 * 3600_000, charge: 0.9, valence: -0.9 });
    link(g, bad.id, them.id, "about", 0.4, T0);
    const unease = uneaseAbout(g, them);
    console.log(`  seven good and one bad -> unease ${unease.toFixed(3)}`);
    expect(unease, "the bad one is still carried").toBeGreaterThan(0);
  });

  it("is zero for someone she has no bad record with, and for someone she has no record of", () => {
    const g = createGraph();
    const them = addNode(g, { kind: "figure", text: "them", bornMs: T0, strength: 0.9 });
    expect(uneaseAbout(g, them), "nothing recorded at all").toBe(0);
    const good = addNode(g, { kind: "moment", text: "a good one", bornMs: T0, charge: 0.8, valence: 0.9 });
    link(g, good.id, them.id, "about", 0.4, T0);
    expect(uneaseAbout(g, them), "only good things recorded").toBe(0);
    expect(uneaseAbout(g, undefined), "no such person").toBe(0);
  });

  it("comes out of a real life rather than a hand-made graph", () => {
    const field = createLivingField();
    for (let i = 0; i < 6; i++) {
      field.encodeMoment({
        key: `m${i}`, nowMs: T0 + i * 86400_000, source: "t", withOther: true,
        text: `it went badly with them again (${i})`,
        pad: { pleasure: -0.85, arousal: 0.8, dominance: 0 },
      });
    }
    const sig = field.signals(T0 + 7 * 86400_000);
    console.log(`  a fortnight of it going badly with them -> unease ${sig.otherUnease.toFixed(3)}`);
    expect(sig.otherUnease).toBeGreaterThan(0.2);
  });
});

describe("only being in touch settles it", () => {
  it("actual contact discharges it", () => {
    const s = createInnerState();
    for (let i = 0; i < 6; i++) s.update(day({ hoursSinceUser: 300 }), NO_PULL);
    const worried = s.drives().care;
    s.update(day({ hoursSinceUser: CARE_CONTACT_WITHIN_H - 1 }), NO_PULL);
    console.log(`\n  worried ${worried.toFixed(3)} -> after they got in touch ${s.drives().care.toFixed(3)}`);
    expect(s.drives().care).toBeLessThan(worried);
  });

  it("and it comes back if they go quiet again, because nothing was resolved", () => {
    const s = createInnerState();
    for (let i = 0; i < 6; i++) s.update(day({ hoursSinceUser: 300 }), NO_PULL);
    s.update(day({ hoursSinceUser: 1 }), NO_PULL);
    const settled = s.drives().care;
    for (let i = 0; i < 5; i++) s.update(day({ hoursSinceUser: 300 }), NO_PULL);
    expect(s.drives().care).toBeGreaterThan(settled);
  });

  it("never leaves its range, however long the silence", () => {
    const s = createInnerState();
    for (let i = 0; i < 200; i++) s.update(day({ hoursSinceUser: 5000 }), { ...NO_PULL, otherUnease: 1 });
    const c = s.drives().care;
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it("survives a malformed field reading", () => {
    const s = createInnerState();
    s.update(day({ hoursSinceUser: Number.NaN }), { ...NO_PULL, otherUnease: Number.NaN });
    expect(Number.isFinite(s.drives().care)).toBe(true);
  });
});

describe("SCENARIO: two weeks in which nobody asks her for anything", () => {
  it("she still comes to be concerned about them, and it shows in what she wants", () => {
    const s = createInnerState();
    const trace: { care: number; dominant: string }[] = [];
    for (let d = 0; d < 14; d++) {
      // Nothing happens. No tasks, no requests, no failures. Only silence, and her own record of
      // the last exchanges having sat badly.
      s.update(day({ hoursSinceUser: 24 * (d + 1) }), { ...NO_PULL, otherUnease: 0.6 });
      const snap = s.snapshot("normal", true);
      trace.push({ care: s.drives().care, dominant: snap.dominant });
    }
    console.log(`\n  day 1: care ${trace[0].care.toFixed(2)}, wants ${trace[0].dominant}`);
    console.log(`  day 7: care ${trace[6].care.toFixed(2)}, wants ${trace[6].dominant}`);
    console.log(`  day 14: care ${trace[13].care.toFixed(2)}, wants ${trace[13].dominant}`);
    expect(trace[13].care).toBeGreaterThan(trace[0].care);
    // And it is a real want, not a number nobody reads: it reaches the top of what is alive in her.
    expect(trace.some((t) => t.dominant === "care"), "it actually becomes what she most wants").toBe(true);
  });
});
