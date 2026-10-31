import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createFieldStore } from "../../../src/life/field-store.js";
import { createInnerStateStore } from "../../../src/life/inner-state-store.js";
import type { DaySummary } from "../../../src/life/inner-state.js";
import { createMetabolismStore } from "../../../src/life/metabolism-store.js";
import { createContinuityStore, type Continuity } from "../../../src/life/continuity.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { restoreTemperament, neutralTemperament } from "../../../src/life/temperament.js";
import { createWillingnessLog } from "../../../src/life/willingness.js";
import { numericLeaves } from "../../../src/life/signature.js";
import { captureVitals } from "../../../src/life/vitals.js";
import { EMPTY_RECORD } from "../../../src/life/relationship.js";
import {
  createRealWorld, sourcesFor, ordinaryDay, pad, HOUR, DAY, type RealWorld, type RealWorldConfig,
} from "./_real-world.js";

// RESTART FIDELITY.
//
// Not "the continuity file round-trips", which `continuity.test.ts` proves field by field. The gate
// is the harder claim: **kill her and bring her back, and NOTHING OBSERVABLE HAS CHANGED.**
//
// Asserted structurally rather than as a list, because a list is exactly what fails here. Five
// separate losses have been found by hand so far, each silently disabling a safety net, and each was
// the same mistake: someone added state and did not add it to the save. A named list of things to
// check has to be updated by the same person who forgot the first time.
//
// So: live a month, take a full reading, discard every module, rebuild from disk alone, take another
// reading, and compare EVERY numeric leaf. Anything that legitimately differs is named below with a
// reason. A field added to her tomorrow is covered tomorrow, by nobody's decision.
//
// The reading comes from the harness's own `sourcesFor` rather than from a copy: a bespoke one
// drifted from the real shape while this file was being written, which is precisely the drift the
// `no-dead-parts` guard exists to catch and is worth not reproducing here.

let root = "";
let db: DatabaseWrapper;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "resident-restart-"));
  db = createDatabase(join(root, "life.db")).result!;
});
afterEach(() => {
  db?.close?.();
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

const T0 = Date.parse("2026-08-01T09:00:00Z");
const NOW = T0 + 30 * DAY;

/**
 * Signals that MUST or MAY differ across a restart, each with its reason.
 *
 * Nothing goes here to make a test pass. Two kinds only: derived from the clock (holding them equal
 * would mean the restart had frozen time), and rolling means over the last few things she did, which
 * she has not done yet and which re-establish the moment she lives again.
 */
const MAY_DIFFER: Record<string, string> = {
  ts: "when the reading was taken",
  lastTickAgeMs: "an age, so it grows with the clock; the STAMP behind it is asserted separately",
  lastMomentAgeMs: "an age; the stamp behind it is asserted separately",
  hoursSinceUser: "an age, measured from lastUserMs, which is asserted separately",
  clockActivity: "her circadian position, which moves with the clock",
  awake: "her circadian position, which moves with the clock",
  "field.surfaced": "a rolling mean over her last few recalls; she has not recalled anything YET, and one moment restores it",
  "field.judgements": "counts what her record has weighed in on since booting, and what the detector reads is the difference across a window",
  "field.valence": "how her last few recalls FELT; she has not recalled anything yet, and one moment restores it",
  "field.charge": "how hard those recalls were; the same",
};

/** Everything she is, off these stores. Called twice: once before the restart and once after. */
function assemble(over: Partial<RealWorldConfig> = {}): RealWorld {
  return createRealWorld({
    startMs: T0,
    // As production runs. With reminding off, judging never happens, so `field.judgements` sits at
    // zero on both sides of a restart and its exemption reads as unnecessary.
    reminding: true,
    stores: {
      field: createFieldStore(db),
      inner: createInnerStateStore(db),
      metabolism: createMetabolismStore(db),
    },
    ...over,
  });
}

/** A life with something in it: memories, questions, moods, exchanges, and a day genuinely spent. */
function liveALife(w: RealWorld, days: number): Continuity {
  for (let d = 0; d < days; d++) {
    w.field.tick(w.now());
    for (let m = 0; m < 4; m++) {
      w.field.encodeMoment({
        key: `day${d}-m${m}`, text: `the ${(d * 4 + m) % 13} thing, on a Tuesday`,
        nowMs: w.now() + m * 3 * HOUR, pad: pad(0.3 - 0.05 * (m % 4), 0.1 * (d % 3)),
        source: "agency", withOther: m === 0,
      });
      w.field.onHerMind(w.now() + m * 3 * HOUR + HOUR);
    }
    w.field.encodeQuestion({
      key: `q${d}`, text: `why the ${d % 5} thing keeps happening`,
      nowMs: w.now(), source: "agency", tension: 0.4 + 0.02 * d,
    });
    if (d % 2 === 0) { w.field.heSpoke(w.now()); w.expression.onOwnerMessage(w.now()); }
    if (d % 3 === 0) { w.field.sheSpoke(w.now(), 0.6); w.expression.onProactiveSend(w.now()); }
    w.inner.update(ordinaryDay({ successes: 1 + (d % 3), failures: d % 2, novelty: 0.2 + 0.05 * (d % 4) }),
      w.field.signals(w.now()));
    w.inner.actOn(["curiosity", "social", "maintenance"][d % 3] as "curiosity");
    w.metabolism.record("living", 40 + d);
    w.advance(DAY);
  }
  w.field.persist();

  const stream = createStream(987_654);
  for (let i = 0; i < 17; i++) stream.next(); // her randomness is somewhere in particular
  const e = w.expression.state();
  return {
    savedAtMs: w.now(),
    lastTickMs: w.now() - HOUR,
    safeMode: true,
    lastMomentMs: w.now() - 2 * HOUR,
    sendTimes: e.sendTimes,
    consecutiveNonReplies: e.consecutiveNonReplies,
    lastUserMs: e.lastUserMs,
    everSpoke: true,
    egressSeen: ["https://a.example/x", "https://b.example/y"],
    guardRefusals: { "home-boundary": 3, egress: 1 },
    streamSeed: 987_654,
    streamPosition: stream.position(),
    temperament: restoreTemperament({ reticence: 0.14, novelty: -0.09, sociability: 0.21, restfulness: -0.03 }),
    temperamentDays: 96,
    recentDeclines: 1,
    relationship: EMPTY_RECORD,
    thingsLastLooked: { 钟: 1787000000000 },
    sleptSegments: [{ startMs: w.now() - 5 * HOUR, endMs: w.now() - 4 * HOUR }],
    heldWanting: { "s:4": w.now() - 3 * HOUR },
  };
}

/**
 * Put the continuity-carried parts back on a world, exactly as the daemon does at boot.
 *
 * Applied to BOTH sides. The point of the comparison is what survives on disk, so dressing only the
 * restored one would prove that two differently-dressed worlds differ.
 */
function dressWith(w: RealWorld, c: Continuity): void {
  w.lastTickMs = c.lastTickMs;
  w.lastMomentMs = c.lastMomentMs;
  w.guardRefusals = c.guardRefusals;
  w.temperament = { ...c.temperament, drift: 0, days: c.temperamentDays };
  w.expression.restore({
    sendTimes: c.sendTimes, consecutiveNonReplies: c.consecutiveNonReplies, lastUserMs: c.lastUserMs,
  });
  // What she is holding and has not said. Recomputed from the field at boot rather than left at
  // zero until her first moment, which is what the daemon now does too.
  w.expression.setReservoir([...w.field.graph().nodes.values()].filter((n) => n.tension > 0.25).length);
  const stream = createStream(c.streamSeed, c.streamPosition);
  w.choosing = { temperature: 0.3, torn: false, followedVote: null, streamPosition: stream.position() };
  w.willingness = createWillingnessLog(c.recentDeclines);
}

const continuityStore = (): ReturnType<typeof createContinuityStore> =>
  createContinuityStore(join(root, "continuity.json"), root, {
    existsSync, readFileSync: (p) => readFileSync(p, "utf8"), writeFileSync, mkdirSync,
  });

describe("kill her and bring her back, and nothing observable has changed", () => {
  it("every signal in a full reading survives, or is named with a reason", () => {
    const before = assemble();
    const state = liveALife(before, 30);
    continuityStore().save(state);
    dressWith(before, state);
    const readingBefore = captureVitals(sourcesFor(before, () => NOW));

    // THE RESTART. Every module is discarded; the only thing that crosses is what is on disk.
    const after = assemble();
    const restored = continuityStore().load()!;
    dressWith(after, { ...state, ...restored } as Continuity);
    const readingAfter = captureVitals(sourcesFor(after, () => NOW));

    const a = numericLeaves(readingBefore);
    const b = numericLeaves(readingAfter);
    const changed: string[] = [];
    for (const [path, v] of a) {
      if (path in MAY_DIFFER) continue;
      const w = b.get(path);
      if (w === undefined) { changed.push(`${path}: GONE`); continue; }
      if (Math.abs(v - w) > 1e-9) changed.push(`${path}: ${v} → ${w}`);
    }
    for (const path of b.keys()) {
      if (!a.has(path) && !(path in MAY_DIFFER)) changed.push(`${path}: APPEARED`);
    }

    console.log(`\n  ${a.size} signals compared across a restart`);
    if (changed.length > 0) console.log(`  CHANGED: ${changed.join(" · ")}`);
    expect(changed, "a restart that changes her is a restart that loses part of her").toEqual([]);
    expect(a.size, "and the comparison has to actually cover her").toBeGreaterThan(30);
  });

  it("every exemption is still NECESSARY, not just reasoned", () => {
    // The other way this list rots. An entry stays after the thing it excused stopped needing
    // excusing, and from then on it is quietly hiding a signal that DOES survive a restart. So the
    // list is asked to justify itself against the run: anything on it that came back unchanged has
    // no business being on it.
    const before = assemble();
    const state = liveALife(before, 30);
    continuityStore().save(state);
    dressWith(before, state);
    // Read at DIFFERENT times, across her sleep boundary, because a restart takes time and can
    // happen at any hour. Reading both sides at the same instant froze every clock-derived age and
    // made six honest exemptions look unnecessary; a gap inside one waking stretch left `awake`
    // looking the same. The check was right to be suspicious both times and the fixture was wrong.
    const a = numericLeaves(captureVitals(sourcesFor(before, () => NOW)));

    const after = assemble();
    dressWith(after, { ...state, ...continuityStore().load()! } as Continuity);
    const b = numericLeaves(captureVitals(sourcesFor(after, () => NOW + 20 * HOUR)));

    const unnecessary = Object.keys(MAY_DIFFER).filter((path) => {
      const x = a.get(path), y = b.get(path);
      return x !== undefined && y !== undefined && Math.abs(x - y) <= 1e-9;
    });
    if (unnecessary.length > 0) console.log(`\n  EXEMPTIONS NO LONGER NEEDED: ${unnecessary.join(", ")}`);
    expect(unnecessary, "a signal that survives a restart does not need to be excused from surviving it").toEqual([]);
  });

  it("nothing was excused for the wrong reason", () => {
    // The exemption list is the only way this gate can be quietly weakened, so it is itself checked:
    // every entry says why, and no entry may be there because something was hard to preserve.
    for (const [path, why] of Object.entries(MAY_DIFFER)) {
      expect(why.length, `${path} needs a real reason`).toBeGreaterThan(15);
      // Aimed at the actual failure phrasing rather than at the WORD. A bare scan for "hard"
      // rejected "how hard those recalls were", which is a description of a signal and not an
      // excuse: the same wrong-instrument mistake this project has had to undo twice elsewhere.
      expect(why, `${path}: difficulty is not a reason`)
        .not.toMatch(/too hard|hard to (preserve|keep|restore|implement|do)|difficult to|not worth|would have to/i);
    }
  });

  it("the stamps the clock-derived ages are computed FROM do survive", () => {
    // The exemptions above are only honest if the underlying stamps are checked, or "it is an age"
    // would excuse losing the thing the age is measured from. That is exactly the `lastTickMs` bug:
    // it initialised to now, so `tick_stalled` could never fire on a daemon that restarted often.
    const before = assemble();
    const state = liveALife(before, 30);
    continuityStore().save(state);

    const restored = continuityStore().load()!;
    expect(restored.lastTickMs).toBe(state.lastTickMs);
    expect(restored.lastMomentMs).toBe(state.lastMomentMs);
    expect(restored.lastUserMs).toBe(state.lastUserMs);
  });

  it("her memory comes back whole, not merely present", () => {
    const before = assemble();
    liveALife(before, 30);
    const statsBefore = before.field.stats();
    const shape = (w: RealWorld): string[] => [...w.field.graph().nodes.values()]
      .map((n) => `${n.key}|${n.strength.toFixed(6)}|${n.reticence.toFixed(6)}|${n.tension.toFixed(6)}`).sort();
    const graphBefore = shape(before);

    const after = assemble();
    const statsAfter = after.field.stats();
    console.log(`  the field: ${statsBefore.nodes} nodes / ${statsBefore.edges} edges → ${statsAfter.nodes} / ${statsAfter.edges}`);
    expect(statsAfter.nodes).toBe(statsBefore.nodes);
    expect(statsAfter.edges).toBe(statsBefore.edges);
    expect(shape(after), "every node comes back with its own strength, cost and pressure").toEqual(graphBefore);
  });

  it("what she was told, and how far it has held up, comes back too", () => {
    const before = assemble();
    liveALife(before, 10);
    for (let i = 0; i < 6; i++) {
      before.field.encodeClaim({
        key: `told-${i}`, text: `he said the ${i} thing is settled`, nowMs: before.now(),
        origin: "told", source: "owner", valence: 0.2,
      });
    }
    before.field.persist();
    const trustBefore = before.field.trust().told;
    expect(assemble().field.trust().told, "a restart must not return her to trusting from scratch")
      .toBeCloseTo(trustBefore, 9);
  });

  it("her randomness resumes where it stopped, so the next moment is the one it would have been", () => {
    const a = createStream(987_654);
    for (let i = 0; i < 17; i++) a.next();
    const wouldHaveBeen = [a.next(), a.next(), a.next()];

    const b = createStream(987_654, 17);
    expect([b.next(), b.next(), b.next()], "a restart must not reroll her").toEqual(wouldHaveBeen);
  });

  it("a run of declines she has just made survives a reboot, as a COUNT she keeps", () => {
    // This used to assert that the run still forced her to say yes after a restart. That floor is
    // gone, because a real person can certainly decline three times running. What survives the
    // reboot is the count itself, which now goes to `/vitals` for him to see rather than to the
    // gate to override her: and carrying it across a restart still matters for exactly the old
    // reason, inverted: a reboot must not erase the record of what she has been doing.
    const log = createWillingnessLog(2);
    expect(log.state().recentDeclines, "a restart wiped the run she is actually on").toBe(2);
    const w = log.ask({
      request: "could you sort the notes",
      drives: { discomfort: 1, care: 0, social: 0, curiosity: 1, expression: 0, maintenance: 0 },
      emotion: { pleasure: -0.9, arousal: -0.9, dominance: -0.5 },
      phase: "dormant", warmth: 0,
    });
    expect(w.reason, "the count is deciding for her again").not.toMatch(/floor/u);
  });

  it("what she came to wonder about, and its ASKED MARK, both survive a restart", async () => {
    // The mark is a KEY REWRITE done during rest(). If the question survived a restart while the
    // mark did not, the same memory would open a second question the next night, the exact
    // once-only guarantee the mark exists for, silently voided by a reboot. And the two travel
    // in one persist now (added because rest is her field's largest single step and was not
    // followed by any persist at all).
    const w = assemble();
    w.field.encodeClaim({
      key: "told:海边", text: "他提过一句什么海边的事", nowMs: w.now(),
      origin: "told", source: "chat:1",
    });
    const node = [...w.field.graph().nodes.values()].find((n) => n.key === "told:海边")!;
    node.recalls = 30;                                   // she kept coming back to it
    await w.field.rest(w.now() + HOUR);
    w.field.persist();

    const again = assemble();
    const nodes = [...again.field.graph().nodes.values()];
    expect(nodes.find((n) => n.key?.startsWith("iwonder:")),
      "the question she came to have did not survive the reboot").toBeTruthy();
    expect(nodes.find((n) => n.key?.includes("·想问")),
      "the ASKED mark was lost — the same memory will open a second question tomorrow").toBeTruthy();
  });

  it("and a temperament she grew over months is not quietly reset to neutral", () => {
    // The loss that would be least visible and most total: she would still have every memory, every
    // mood and every habit, and still be a different person.
    const before = assemble();
    const state = liveALife(before, 5);
    continuityStore().save(state);
    const restored = continuityStore().load()!;
    expect(restored.temperament).toEqual(state.temperament);
    expect(restored.temperament).not.toEqual(neutralTemperament());
    expect(restored.temperamentDays).toBe(96);
  });
});

// ── A restart must not live the last day a second time ──────────────────────────────
//
// The harness above rebuilds her from the stores. The real daemon did one more thing at start: it
// replayed the last twenty-four hours of the ops-log into her mood, on top of the stored self that
// already held them. A three-minute restart an hour after the day-close took her from 平稳
// (0.03, -0.01) to 低落 (-0.37, -0.31). These drive the function the daemon now calls.

describe("a restart right after the day-close leaves her mood where it was", async () => {
  const { createInnerState } = await import("../../../src/life/inner-state.js");
  const { catchUpAtStart, CATCH_UP_WINDOW_MS } = await import("../../../src/life/day-summary.js");

  const NOW_MS = Date.parse("2026-09-28T05:01:53Z");
  // A day with things going wrong in it and no message from him, the shape of her 9/27.
  const opsLines = Array.from({ length: 40 }, (_, i) => JSON.stringify({
    event: i % 4 === 0 ? "tool_call" : "provider_call",
    ts: new Date(NOW_MS - (i + 1) * 30 * 60 * 1000).toISOString(),
    toolName: "read",
    success: i % 4 !== 0,
  }));
  const opts = { nowMs: NOW_MS, budgetLow: false, timezoneOffsetHours: -4 };
  const theDayClose: DaySummary = {
    successes: 3, failures: 2, stuck: 0, skills: 0, idle: 5, novelty: 0.4, observations: 4,
    anomalies: 1, maintenanceDue: 0, hoursSinceUser: 88, lateNight: false, budgetLow: false,
    restful: false,
  };

  it("with a stored self, nothing is replayed and she comes back as she was", () => {
    const store = createInnerStateStore(db);
    const before = createInnerState({ store });
    before.update(theDayClose); // the real day-close, saved
    const drives = before.drives();
    const emotion = before.emotion();

    // The restart, the way the daemon does it: read once, hand on, then the catch-up decides.
    const storedSelf = store.load();
    const after = createInnerState({ store: { load: () => storedSelf, save: (s) => store.save(s) } });
    const folded = catchUpAtStart(after, storedSelf, () => opsLines, opts);

    expect(folded, "a day she already lived was folded in again").toBe(false);
    expect(after.emotion()).toEqual(emotion);
    expect(after.drives()).toEqual(drives);
  });

  it("with no stored self, the log is still how she is rebuilt", () => {
    const fresh = createInnerState({ store: createInnerStateStore(db) });
    const baseline = fresh.drives();
    const folded = catchUpAtStart(fresh, null, () => opsLines, opts);
    expect(folded).toBe(true);
    expect(fresh.drives()).not.toEqual(baseline);
  });

  it("and a first start reads only the last day of the log, not all of it", () => {
    // Everything in this log is older than the window, so there is nothing to rebuild from.
    const old = opsLines.map((l) => {
      const e = JSON.parse(l) as { ts: string };
      return JSON.stringify({ ...e, ts: new Date(Date.parse(e.ts) - CATCH_UP_WINDOW_MS).toISOString() });
    });
    const fresh = createInnerState({ store: createInnerStateStore(db) });
    expect(catchUpAtStart(fresh, null, () => old, opts)).toBe(false);
  });

  it("and the daemon hands the catch-up the stored self it restored", () => {
    const src = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const at = src.indexOf("catchUpAtStart(innerState, storedSelf,");
    expect(at, "the start catch-up is no longer gated on the stored self").toBeGreaterThan(-1);
    const start = src.slice(src.indexOf("const innerStore = createInnerStateStore("), at);
    expect(start, "the restored self is not the one handed to the catch-up").toMatch(/const storedSelf = innerStore\.load\(\)/u);
  });
});

// ── What she has been doing is still there after a restart ──────────────────────────

describe("the window of what she has been doing survives a restart", async () => {
  const { createDoingLog, recentMomentsFrom, RECENT_MOMENTS } = await import("../../../src/life/doing.js");
  type Outcome = Parameters<ReturnType<typeof createDoingLog>["record"]>[0];

  // A day shaped like her 9/27: mostly held reach-outs, some thinking, a few looks.
  const day: Outcome[] = Array.from({ length: RECENT_MOMENTS + 10 }, (_, i): Outcome => ({
    chose: i % 5 === 0 ? "explore" : i % 3 === 0 ? "reflect" : "reach_out",
    intent: "",
    artifact: "…",
    ...(i % 3 !== 0 && i % 5 !== 0 ? { delivered: i % 7 === 0 ? "push" : "diary", heldBecause: "gate" } : {}),
  }) as Outcome);

  it("refilled from her agency record, it reads exactly as it did before the restart", () => {
    const live = createDoingLog();
    for (const o of day) live.record(o);
    // What agency.jsonl holds: each outcome with its beat, one per line, plus the odd bad line.
    const lines = [...day.map((o, i) => JSON.stringify({ ...o, beat: `moment:${i}` })), "{not json", ""];
    const restored = createDoingLog(recentMomentsFrom(lines));
    expect(restored.state()).toEqual(live.state());
    expect(restored.state().diaried, "a restart read as a day of sending nothing").toBeGreaterThan(0);
  });

  it("and the daemon refills it at start instead of opening it empty", () => {
    const src = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const at = src.indexOf("const doingLog = createDoingLog(");
    expect(at, "the doing log is no longer created where this guard looks").toBeGreaterThan(-1);
    expect(src.slice(at, at + 400), "the doing window opens empty on every start again").toMatch(/recentMomentsFrom\(/u);
  });
});

// ── A weekly look whose result was lost does not spend the week ─────────────────────

describe("a lost weekly look is tried again the next day, not seven days later", async () => {
  const { noticeStampAfter } = await import("../../../src/life/noticing.js");
  const WEEK = 7 * DAY;
  const LAST = Date.parse("2026-09-17T04:00:00Z");
  const NOW = LAST + WEEK;

  it("a look that came back unreadable leaves the stamp where it was", () => {
    expect(noticeStampAfter(LAST, NOW, true)).toBe(LAST);
    expect(noticeStampAfter(LAST, NOW, false)).toBe(NOW);
  });

  it("and the daemon un-stamps on a lost look rather than spending the week", () => {
    const src = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const at = src.indexOf("stamp(noticeStampAfter(previousNoticeMs, nowMs, lost));");
    expect(at, "the weekly stamp no longer depends on whether the look was lost").toBeGreaterThan(-1);
    const call = src.slice(src.indexOf("let lost = false;"), at);
    expect(call, "an unreadable reply no longer marks the look as lost").toMatch(/onFault: \(where, detail\) => \{ lost = true;/u);
    expect(call, "a thrown look no longer marks the look as lost").toMatch(/catch \(err\) \{\s*lost = true;/u);
  });
});
