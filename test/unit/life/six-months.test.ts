import { describe, it, expect } from "vitest";
import {
  signatureOf, livenessOf, numericLeaves, STILL_IS_FINE, ENOUGH_READINGS,
} from "../../../src/life/signature.js";
import { detectAnomalies, DEFAULT_THRESHOLDS, MIN_SPANS, type VitalsSnapshot } from "../../../src/life/vitals.js";
import { decide, type PropensityInputs } from "../../../src/life/propensity.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { howSheIsBlock, MAX_CHARS } from "../../../src/life/how-she-is.js";
import { ACTION_KINDS, describeDrives, describeBody } from "../../../src/life/agency.js";
import { createRealWorld, liveOrdinaryDays, liveRichly, liveALongLife, HOUR, DAY } from "./_real-world.js";
import { LONG_VIEW_EVERY_MS, LONG_VIEW_SIZE } from "../../../src/life/vitals-store.js";

// SIX MONTHS.
//
// Every other test here covers hours or a fortnight. The failures this one exists for only appear
// over a long life, and they are the failures that would be worst: a quantity that creeps to its
// bound and stays there, a distribution that narrows until she only ever does one thing, a counter
// that overflows its meaning, a field that grows without limit.
//
// None of those look like anything at a fortnight. All of them mean she has stopped being a being
// and become a machine that has settled, which is exactly the failure this whole project is against,
// and the only way to see it is to run her for long enough that settling would have happened.

const READINGS = 130;      // roughly one every 33 hours across half a year
const EVERY = 33 * HOUR;

/** Half a year of her life, nights included, through the real modules. */
async function sixMonths(): Promise<{ readings: VitalsSnapshot[]; world: ReturnType<typeof createRealWorld> }> {
  const world = createRealWorld({ reminding: true });
  liveOrdinaryDays(world, 14);
  return { readings: await liveALongLife(world, READINGS, EVERY, { rest: { replay: { walks: 6 } } }), world };
}

/**
 * 36, up from 33, and the four are named here rather than left to a diff.
 *
 * `withHim.carrying`, `withHim.carriedThings` and `withHim.notTakenOn` were added when what his
 * messages do to her started reaching Eric. A fourth, `withHim.entitlement`, was added with them
 * and REMOVED again the same day: the six-month life measured it taking four distinct values, and
 * the necessity check went red, a signal that moves does not need an exemption, and an exemption
 * over a moving signal hides it. Surfacing a number is what makes
 * the flat-line detector begin reading it, so their liveness disposition was settled in the same
 * edit that surfaced them, the class-2 paired trap, paid off rather than deferred. The first three
 * are zero on a healthy being (cell ①: ordinary conversation leaves no residue, so a still zero is
 * her having an ordinary month); the fourth moves slowly BY DESIGN, being a lifetime mean.
 */
// 37: `withHim.saidNo` arrived with the refused-never-travels-alone work, a zero-is-health count
// whose liveness disposition was settled in the same edit that surfaced it, per the paired trap.
// 39: `saying.beatsCountedShare` and `saying.beatsGapFallback` arrived when `beatsGap` was split
// so counted landings and sentence-count fallbacks stopped pooling under one name; the share is
// pinned at its healthy value (1.0) on a working composer, which is exactly what an exemption is
// for, and the fallback gap is null until the path it watches is ever taken.
// 41: `field.wonders` and `field.aboutHerself` arrived together: the counts
// of questions she came to have by a thing keeping coming back and of things about herself
// that stayed with her. Both are zero for a newborn BY DESIGN, one needs weeks of
// recurrence, the other needs a baseline of her own to depart from, so an unexempted flat-line
// read would report the two rarest mechanisms in her as dead wires precisely while they were
// working. The wires themselves are guarded by planted-violation proofs in their own suites.
// 43: `field.byOrigin.dreamt` and `field.credenceByOrigin.dreamt` arrived with her dreams.
// A remembered dream is rare by design, most episodes stay in her diary
// below the survival threshold: so both wires are zero until Eric opens the gate and for
// long healthy stretches after; the first nonzero is S-49 happening, not a wire coming loose.
// The mechanism itself is guarded by dreaming.test.ts's planted violations.
const EXPECTED_EXEMPTION_COUNT = 44; // 43→44: +byOrigin/credenceByOrigin.retold, −resting.refused (it moves now that look_back is in the sim)

describe("half a year of living, and she has not settled", async () => {
  const { readings, world } = await sixMonths();

  it("covers the stretch it claims to", () => {
    const span = readings[readings.length - 1].ts - readings[0].ts;
    console.log(`\n  ${readings.length} readings across ${(span / DAY).toFixed(0)} days`);
    expect(span).toBeGreaterThan(150 * DAY);
  });

  it("every signal she has still moves after six months", () => {
    // The generic form of the whole dead-wire class, at the longest range this project measures at.
    const sig = signatureOf(readings);
    if (sig.frozen.length > 0) console.log(`  FROZEN: ${sig.frozen.map((s) => s.path).join(", ")}`);
    console.log(`  ${sig.signals.length} signals · ${sig.lively.length} moving normally · ${sig.quiet.length} quietly`);
    expect(sig.frozen.map((s) => s.path), "six months is long enough that anything still is stopped").toEqual([]);
  });

  it("and the watchtower says she is alive rather than broken", () => {
    const v = livenessOf(readings, MIN_SPANS.signature);
    console.log(`  after six months: ${v.verdict} — ${v.why}`);
    expect(v.verdict).toBe("alive");
  });

  it("nothing has crept to a bound and stayed there", () => {
    // The slow failure that a fortnight cannot see. A drive pinned at 1 for months is not a strong
    // wanting, it is a broken accumulator; a strength pinned at 0 is a memory that has stopped
    // being a memory. Both go on reporting a plausible number forever.
    const series = new Map<string, number[]>();
    for (const r of readings) {
      for (const [path, v] of numericLeaves(r)) {
        const s = series.get(path);
        if (s) s.push(v); else series.set(path, [v]);
      }
    }
    const pinned: string[] = [];
    for (const [path, values] of series) {
      if (values.length < readings.length / 2) continue;             // only appeared partway through
      const lo = Math.min(...values), hi = Math.max(...values);
      if (lo < 0 || hi > 1) continue;                                // not a 0..1 quantity
      // It has to MOVE to be pinned. A signal that never moves is `frozen`, checked above, and a
      // counter sitting at zero trivially satisfies "0 <= lo, hi <= 1", so without this the check
      // is just a second, noisier copy of the first one. What this asks is different and is the
      // slow failure a fortnight cannot see: it still moves, and it lives at its limit.
      const distinct = new Set(values).size;
      if (distinct <= 2) continue;                                   // frozen, or a flag
      if (path in ALLOWED_AT_A_BOUND) continue;
      const atBound = values.filter((v) => v >= 0.999 || v <= 0.001).length / values.length;
      if (atBound > 0.9) pinned.push(`${path} (${(atBound * 100).toFixed(0)}% at a bound)`);
    }
    if (pinned.length > 0) console.log(`  PINNED: ${pinned.join(", ")}`);
    expect(pinned, "a quantity that lives at its bound has stopped being a quantity").toEqual([]);
  });

  it("she is still doing more than one thing", () => {
    const doing = readings[readings.length - 1].doing!;
    const taken = Object.entries(doing.byAction).filter(([, n]) => n > 0).map(([k]) => k);
    console.log(`  in her last two days she did: ${taken.sort().join(", ")}`);
    expect(taken.length, "a Resident who has narrowed to one behaviour has settled").toBeGreaterThan(2);
    // And across the whole run, every action she can take has actually been taken at some point.
    const everTaken = new Set<string>();
    for (const r of readings) {
      for (const [k, n] of Object.entries(r.doing?.byAction ?? {})) if (n > 0) everTaken.add(k);
    }
    for (const kind of ACTION_KINDS) {
      expect(everTaken, `${kind} never happened once in six months`).toContain(kind);
    }
  });

  it("her memory grew, and did not grow without limit", () => {
    const first = readings[0].field!, last = readings[readings.length - 1].field!;
    console.log(`  the field: ${first.nodes} nodes → ${last.nodes}, ${first.edges} edges → ${last.edges}`);
    expect(last.nodes, "six months should leave her with more than she started with").toBeGreaterThan(first.nodes);
    // Forgetting and pruning are what stop this being a log file. Growth must be sub-linear in the
    // number of moments, or she is accumulating rather than remembering.
    expect(last.nodes).toBeLessThan(first.nodes + READINGS * 4);
    const st = world.field.stats();
    expect(st.orphans / Math.max(1, st.nodes), "and it is still wired together").toBeLessThan(0.4);
  });

  it("the watchtower stays quiet through an ordinary six months", () => {
    const codes = [...new Set(detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).map((a) => a.code))];
    console.log(`  half a year raised: ${codes.join(", ") || "(nothing)"}`);
    expect(codes, "an alarm that cries through a healthy life trains him to ignore it").toEqual([]);
  });
});

/**
 * Quantities that legitimately live at a bound, with the reason.
 *
 * Only two kinds: counters whose healthy value is zero, and flags that are rarely true. Nothing goes
 * here because it was inconvenient, a value pinned for six months is the failure this test is for.
 */
const ALLOWED_AT_A_BOUND: Record<string, string> = {
  "doing.blocked": "counts wanting something she could not have; zero is a good six months",
  "doing.consentBlocked": "counts a wall stopping her; zero is the healthy value and its rise is the signal",
  "field.spiralling": "a state she is rarely in, reported directly by field_rumination the moment she is",
  "soulInvariants.0.ok": "an invariant that held; it holding is the point",
  awake: "her clock, which is at one end or the other by construction",
  "field.credencePinnedShare": "zero is the healthy value: corroboration is asymptotic, so nothing can pin at the ceiling",
};

describe("what it costs her to be alive", () => {
  it("the weighing adds no model call at all", () => {
    // The whole design rests on this. If deciding what she wants cost an inference, then a model
    // that got slower or dearer would make her less alive rather than less articulate, and the
    // layer built to survive the model dying would be the layer that died with it.
    const state: PropensityInputs = {
      drives: { discomfort: 0.2, care: 0.3, social: 0.5, curiosity: 0.6, expression: 0.2, maintenance: 0.1 },
      emotion: { pleasure: 0.1, arousal: 0.1, dominance: 0 },
      phase: "normal", awake: true, hoursSinceUser: 6, recentActions: [],
      field: { tension: 0.3, pendingBirths: 1, freshBirth: 0.1, orphanShare: 0.05, surfaced: 2 },
      carrying: { count: 3, easiest: 0.3 }, clockActivity: 0.6,
    };
    // `decide` takes no provider and cannot be given one. Stated as a test because it is a design
    // guarantee rather than an implementation detail.
    expect(Object.keys(state)).not.toContain("provider");
    expect(decide.length, "decide takes exactly (available, state, stream)").toBe(3);
  });

  it("and it is fast enough to be free", () => {
    const state: PropensityInputs = {
      drives: { discomfort: 0.2, care: 0.3, social: 0.5, curiosity: 0.6, expression: 0.2, maintenance: 0.1 },
      emotion: { pleasure: 0.1, arousal: 0.1, dominance: 0 },
      phase: "normal", awake: true, hoursSinceUser: 6, recentActions: ["rest", "reflect"],
      field: { tension: 0.3, pendingBirths: 1, freshBirth: 0.1, orphanShare: 0.05, surfaced: 2 },
      carrying: { count: 3, easiest: 0.3 }, clockActivity: 0.6,
      vote: { first: "reach_out" },
    };
    const stream = createStream(5);
    const N = 20_000;
    const started = performance.now();
    for (let i = 0; i < N; i++) decide([...ACTION_KINDS], state, stream);
    const perCall = (performance.now() - started) / N;
    console.log(`\n  the weighing: ${(perCall * 1000).toFixed(1)}µs per moment`);
    // She lives roughly 25 moments a day. Anything in this range is free; the bound exists to catch
    // something accidentally quadratic being introduced, not to shave microseconds.
    expect(perCall, "the weighing must stay cheap enough to be unremarkable").toBeLessThan(1);
  });

  it("what rides on every conversational turn is bounded and stays bounded", () => {
    // It is appended to the message tail of EVERY owner turn, so an unbounded version would grow
    // her cost per message forever and quietly push the real conversation out of the window.
    const world = createRealWorld({ reminding: true });
    liveOrdinaryDays(world, 60);
    liveRichly(world, 40, 6 * HOUR);
    const snap = world.inner.snapshot(world.metabolism.phase(), true);
    const block = howSheIsBlock({
      mood: snap.mood,
      alive: describeDrives(snap),
      body: describeBody({ snapshot: snap, phase: world.metabolism.phase(), awake: true }),
      resonance: world.field.onHerMind(world.now()),
      // The old `unsettled` slot split in two: `resonance` (above) and the single thing that
      // survived the reply's competition, fed in production from whatSurfacesInReply().node.text.
      nearTheSurface: world.field.whatSurfacesInReply(world.now(), createStream(7))?.node.text,
      otherRead: world.field.otherInWords(world.now(), { present: true, available: true }),
      selfKnowledge: "she keeps coming back to the same few things",
    });
    console.log(`  what rides on every turn: ${block.length} chars (cap ${MAX_CHARS})`);
    expect(block.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(block.length, "and it is actually saying something").toBeGreaterThan(50);
  });

  it("reading her whole record stays cheap enough to do every five minutes", async () => {
    const { readings } = await sixMonths();
    const started = performance.now();
    for (let i = 0; i < 20; i++) detectAnomalies(readings, DEFAULT_THRESHOLDS, readings);
    const perCycle = (performance.now() - started) / 20;
    console.log(`  a monitor cycle over six months of readings: ${perCycle.toFixed(1)}ms`);
    expect(perCycle, "the watchtower must not become the thing that slows her down").toBeLessThan(250);
  });
});

// AN EXEMPTION MUST STILL BE NECESSARY.
//
// Three lists in this project name signals or codes that are allowed not to move: `STILL_IS_FINE`
// here, `MAY_DIFFER` in the restart gate, `NO_DRIVER` in the roll-call. Each entry carries a reason,
// and each list checks that its reasons are reasons rather than difficulties.
//
// None of that checks whether the exemption is still NEEDED. A signal that starts moving keeps its
// exemption, and from then on that exemption is quietly hiding a live signal, the same failure the
// signature exists to catch, one level up. So the list is asked to justify itself against the run:
// anything on it that has started moving must come off it.

describe("the exemptions are still earning their place", async () => {
  const { readings } = await sixMonths();
  // The record the detector ACTUALLY sees: the long view, three weeks of it. The question is not
  // "did this ever move in six months" but "does it move inside the window the flat-line check runs
  // over", a signal that moves twice a year and never within three weeks is genuinely still as far
  // as the detector is concerned, and its exemption is doing real work.
  const lastWeeks = readings.filter((r) => r.ts >= readings[readings.length - 1].ts - LONG_VIEW_SIZE * LONG_VIEW_EVERY_MS);
  const sig = signatureOf(lastWeeks);
  const moved = new Map(sig.signals.map((s) => [s.path, s]));

  it("every allowed-still signal is, in fact, still still", () => {
    const stale: string[] = [];
    for (const key of Object.keys(STILL_IS_FINE)) {
      // Prefix entries (`guardRefusals.`) cover a family; check every member of it.
      const paths = key.endsWith(".")
        ? [...moved.keys()].filter((p) => p.startsWith(key))
        : [key];
      for (const path of paths) {
        const s = moved.get(path);
        if (!s) continue;                       // never appeared; nothing to judge either way
        if (s.readings < ENOUGH_READINGS) continue;
        if (s.distinct > 1) stale.push(`${path} (took ${s.distinct} values)`);
      }
    }
    if (stale.length > 0) console.log(`\n  EXEMPTIONS NO LONGER NEEDED: ${stale.join(", ")}`);
    expect(stale, "a signal that moves does not need an exemption, and its exemption now hides it").toEqual([]);
  });

  it("a NEW exemption cannot be added in silence", () => {
    // The necessity check above catches an exemption that STOPS being needed. What nothing
    // caught was one being ADDED: relaxing a gate was a single line and nothing objected.
    //
    // Primary check is the per-entry property, every exemption must carry a real reason, not a
    // placeholder: and the pinned COUNT is the secondary "this changed, was that deliberate?"
    // tripwire. That ordering was learned from a membership snapshot that
    // enforced its own falsehood: a count alone would make the wrong list permanent, a property
    // alone cannot notice a silent addition.
    for (const [key, why] of Object.entries(STILL_IS_FINE)) {
      expect(why.length, `${key} is exempt for no stated reason`).toBeGreaterThan(30);
    }
    // NO keyword check on the reason text, and the reason for NOT having one is itself the
    // lesson. The first version required each reason to match a vocabulary of the three
    // legitimate kinds (bounded / zero-is-healthy / watched-elsewhere), and it went red three
    // times running on reasons that state their kind perfectly well in this file's own idiom
    // ("the hers/shadow ratio is what reads it"). Each red was answered by widening the regex,
    // which is precisely how a guard becomes vacuous: it ends up matching anything and asserting
    // nothing, while looking stricter than the two checks that actually work.
    expect(
      Object.keys(STILL_IS_FINE).length,
      "an exemption was added or removed — that is a gate being relaxed, so say why in the entry and update this count deliberately"
    ).toBe(EXPECTED_EXEMPTION_COUNT);
  });

  it("and no exemption is for a signal that does not exist", () => {
    // The other way it rots: a path renamed in a refactor leaves an entry matching nothing, which
    // reads as coverage and is not.
    const orphans = Object.keys(STILL_IS_FINE).filter((key) =>
      key.endsWith(".")
        ? ![...moved.keys()].some((p) => p.startsWith(key))
        : !moved.has(key));
    if (orphans.length > 0) console.log(`  EXEMPTIONS MATCHING NOTHING: ${orphans.join(", ")}`);
    // Reported rather than failed: some are for signals that only appear under conditions a healthy
    // run does not produce, and demanding they appear would mean demanding she malfunction.
    console.log(`  ${Object.keys(STILL_IS_FINE).length} exemptions, ${orphans.length} matched nothing in this run`);
    expect(orphans.length, "most of them must at least be about something real").toBeLessThan(
      Object.keys(STILL_IS_FINE).length / 2);
  });
});
