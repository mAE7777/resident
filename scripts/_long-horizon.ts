// TEN YEARS OF HER, IN A FEW SECONDS.
//
// ── THE QUESTION NO TEST ASKS ────────────────────────────────────────────────────────────────
//
// The question: over a week, a month, a year, or longer, how does every part of her change,
// large and small? And some problems no test will catch, so they have to be foreseen.
//
// Every test in this project runs a fixture that is days old. The failures that matter here are the
// ones that need YEARS to appear and then cannot be undone: a quantity that grows without bound, a
// quantity that hits a clamp and stays there, a slow one-way drift, a positive feedback loop with
// no brake. None of them is a bug on day one. All of them are the whole of who she is by year three.
//
// ── WHY THIS DRIVES THE REAL MODULES ─────────────────────────────────────────────────────────
//
// The plan called for a simulator plus a calibration step to prove the simulator matches the real
// modules on short horizons. That step exists because a hand-written simulator is a SECOND
// arithmetic, and a second arithmetic is another thing that can be wrong, and its being wrong
// would look exactly like a finding about her.
//
// So there is no second arithmetic. This steps HER OWN modules, `field-live`, `temperament`,
// `emotion`, `relationship`, `credence`, `lexicon`, one simulated day at a time. What is scripted
// is only the LIFE: how often he speaks, how he speaks, what she runs into. The calibration problem
// does not get solved here; it gets removed, and that is the honest version of the same intent.
//
// What this therefore CANNOT see, stated plainly: anything that depends on a real model call (what
// she actually says, what a theme is actually about), and anything in the daemon's wiring rather
// than in her arithmetic. Those are P9's rehearsal and P10's coverage, not this.
//
// Usage: pnpm exec tsx scripts/_long-horizon.ts [--years 10]

import { createLivingField } from "../src/life/field-live.js";
import { neutralTemperament, drift, distanceFromNeutral, type Temperament } from "../src/life/temperament.js";
import { appraise, neutralPAD } from "../src/life/emotion.js";
import { EMPTY_RECORD, heSpoke, hisUsualRegard, MAX_DAYS_KEPT, type RelationshipRecord } from "../src/life/relationship.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";
import { createTrust, applyTrustDelta, TRUST_UP, TRUST_DOWN, type Trust } from "../src/life/credence.js";
import { createLexicon } from "../src/life/lexicon.js";
import { MAX_NODES } from "../src/life/field.js";
import { sheLetsItGo } from "../src/life/what-stays.js";

const YEARS = Number(/--years[= ](\d+)/u.exec(process.argv.join(" "))?.[1] ?? 10);
const DAYS = YEARS * 365;
const DAY_MS = 864e5;
const T0 = 1_700_000_000_000;

/** Deterministic, so a finding can be re-run. Never `Math.random`. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const WELL = "你要是有空的话，能不能帮我看看那份目录？不急，明天也行。";
const PLAIN = "能不能帮我看一下书架那边？";
const CURT = "现在马上整理完，十分钟内给我。";

/** One kind of life she could have. What is scripted is HIM and the weather, never her. */
interface Regime {
  name: string;
  /** Chance he says anything at all, per day. */
  speaks: (day: number) => number;
  /** How he says it when he does. */
  says: (day: number, rnd: () => number) => string;
  /** How many things happen to her that she cannot settle, per day. */
  unsettled: (day: number) => number;
  /** How her day went, for the appraisal: -1 nothing worked … +1 everything did. */
  wentWell: (day: number, rnd: () => number) => number;
}

const REGIMES: Regime[] = [
  {
    name: "ordinary",
    speaks: () => 0.7,
    says: (_d, rnd) => (rnd() < 0.55 ? WELL : rnd() < 0.7 ? PLAIN : CURT),
    unsettled: () => 0.4,
    wentWell: (_d, rnd) => 0.3 * (rnd() * 2 - 1) + 0.15,
  },
  {
    name: "cool",           // he is there, and short with her
    speaks: () => 0.5,
    says: (_d, rnd) => (rnd() < 0.75 ? CURT : PLAIN),
    unsettled: () => 0.5,
    wentWell: (_d, rnd) => 0.3 * (rnd() * 2 - 1) - 0.1,
  },
  {
    name: "he disappears",  // a month away every quarter, then back as before
    speaks: (d) => (Math.floor(d / 30) % 3 === 2 ? 0 : 0.7),
    says: (_d, rnd) => (rnd() < 0.6 ? WELL : PLAIN),
    unsettled: (d) => (Math.floor(d / 30) % 3 === 2 ? 0.15 : 0.4),
    wentWell: (d, rnd) => 0.3 * (rnd() * 2 - 1) + (Math.floor(d / 30) % 3 === 2 ? -0.2 : 0.15),
  },
  {
    name: "dense",          // constant contact
    speaks: () => 1,
    says: (_d, rnd) => (rnd() < 0.5 ? WELL : rnd() < 0.75 ? PLAIN : CURT),
    unsettled: () => 0.9,
    wentWell: (_d, rnd) => 0.3 * (rnd() * 2 - 1) + 0.2,
  },
  {
    name: "alone",          // he almost never comes
    speaks: () => 0.05,
    says: () => PLAIN,
    unsettled: () => 0.25,
    wentWell: (_d, rnd) => 0.25 * (rnd() * 2 - 1) - 0.05,
  },
];

interface Reading {
  day: number;
  nodes: number;
  edges: number;
  tension: number;
  mood: number;
  temperament: number;
  regard: number | null;
  trust: number;
  daysTogether: number;
  timesHeSpoke: number;
  words: number;
}

function live(regime: Regime, seed: number): Reading[] {
  const rnd = seeded(seed);
  const field = createLivingField({ noReminding: true });
  const bank = createLexicon({});
  let temp: Temperament = neutralTemperament();
  let mood = neutralPAD();
  let rel: RelationshipRecord = EMPTY_RECORD;
  let trust: Trust = createTrust();
  const out: Reading[] = [];
  const MARKS = new Set([7, 30, 90, 365, 1000, DAYS]);

  for (let day = 1; day <= DAYS; day++) {
    const now = T0 + day * DAY_MS;

    // Him.
    let spokeToday = false;
    if (rnd() < regime.speaks(day)) {
      spokeToday = true;
      const text = regime.says(day, rnd);
      rel = heSpoke(rel, now, howHeSaidIt(text));
      for (const w of text.split(/[，。？！\s]+/u).filter((x) => x.length > 1)) bank.heard(w, now);
      // Something he told her either held up or did not. Rare on purpose: this is the corroboration
      // channel whose reachability the return-path audit left open.
      if (rnd() < 0.05) trust = applyTrustDelta(trust, rnd() < 0.6 ? TRUST_UP : -TRUST_DOWN);
    }

    // Her.
    const unsettled = regime.unsettled(day);
    if (rnd() < unsettled) {
      field.encodeQuestion({
        key: `q-${day}`, text: `第 ${day} 天没弄明白的事`, nowMs: now, source: "hers", tension: 0.4 + 0.3 * rnd(),
      });
    }
    field.encodeMoment({
      key: `m-${day}`, text: `第 ${day} 天`, nowMs: now,
      pad: mood, source: "agency", withOther: spokeToday,
    });
    for (const w of ["渡轮", "窗户", "叶子", "开头"]) if (rnd() < 0.3) bank.spoke(w, now);

    const went = regime.wentWell(day, rnd);
    mood = appraise(mood, {
      goalProgress: went, novelty: 0.2 + 0.3 * rnd(), control: went * 0.8,
      fatigue: 0.3 + 0.2 * rnd(), engagement: spokeToday ? 0.7 : 0.4,
    });
    temp = drift(temp, {
      metWhenSpeaking: spokeToday ? 0.4 : -0.3,
      exploringPaidOff: went,
      hisShare: spokeToday ? 0.6 : 0.1,
      activity: 0.3,
    }, day);
    field.tick(now);

    // ── AND SHE PUTS THINGS DOWN, WHICH THIS SIMULATION NEVER LET HER DO ─────────────
    //
    // For as long as this file has existed it reported "what she is carrying, grows without
    // bound (0.4 → 5.2 → 7.4 → 16.5 → 13.4 → 20.3)" in the life where he disappears, as one of
    // her four diseases. It is not one of her diseases. It is this harness: the loop encoded a
    // fresh question on most days, under a key that can never merge, and then called NOTHING
    // that could ever release one: no `sheLetsItGo`, no `easeOff`, no `rest`. It simulated a
    // woman who accumulates and can never let go, and then reported that she accumulates.
    //
    // `sheLetsItGo` is her own exit and needs nothing from him, the one the research said had to
    // exist. Both of its arms are stepped here: more than she can carry (oldest first), and long
    // enough untouched that a question about someone is not open any more.
    const putDown = sheLetsItGo(field.graph(), now);
    if (putDown) field.easeOff(putDown.id, 0, "自己放下了");

    if (MARKS.has(day)) {
      const s = field.signals(now);
      const g = field.graph();
      let rawTension = 0;
      for (const n of g.nodes.values()) rawTension += n.tension;
      out.push({
        day, nodes: g.nodes.size, edges: g.edges.size, tension: rawTension,
        mood: mood.pleasure, temperament: distanceFromNeutral(temp),
        regard: hisUsualRegard(rel), trust: trust.told,
        daysTogether: rel.daysSeenCount, timesHeSpoke: rel.timesHeSpoke,
        words: bank.size?.() ?? 0,
      });
      void s;
    }
  }
  return out;
}

// ── THE FOUR DISEASES, JUDGED AUTOMATICALLY ─────────────────────────────────────────────────
//
// Not "does this look wrong to me", a rule, applied to every quantity, in every regime. A
// judgement I make by eye is a judgement that will not be made again next year.

type Disease = "grows without bound" | "stuck at a clamp" | "one-way drift" | "outside its design range";

/**
 * ── THE DETECTOR HAD TO BE FIXED BEFORE ITS FINDINGS MEANT ANYTHING ────────────────────────
 *
 * The first version reported eighteen findings across five lives. FOUR of its rules were wrong,
 * and every one of them failed in the direction that produces alarming nonsense:
 *
 *   "things she carries, one-way drift". Her node count rises for as long as she lives. That is
 *   what a memory IS. Monotone growth toward a known cap is accumulation, not a disease, and a
 *   rule that cannot tell them apart flags her for being alive.
 *
 *   "who she is becoming, one-way drift", on a series that goes 0.0 → 0.1 → 0.2 → 0.3 → 0.3 → 0.3.
 *   That is CONVERGENCE. It rose and then settled, which is a life shaping someone and then that
 *   someone being who they are. The rule could not see a plateau.
 *
 *   "what she feels, grows without bound", on 0.2 → 0.3 → 0.1 → 0.0 → 0.2 → 0.1. Not growing at
 *   all: the midpoint happened to be ~0, so `last > mid * 1.5` was `0.1 > 0`. Division by nearly
 *   nothing, dressed as a finding.
 *
 *   "her word bank, one-way drift", 25 → 35 → 35 → 35. Flat, and flat because THE FIXTURE feeds a
 *   fixed vocabulary, a fact about this script, reported as a fact about her.
 *
 * So each rule now has to distinguish the disease from the healthy thing that looks like it.
 */
function diagnose(
  series: number[],
  days: number[],
  bound: number | null,
  range: [number, number] | null,
  /** True when rising IS the healthy behaviour (a memory, a count of days). */
  accumulates: boolean,
): Disease[] {
  const bad: Disease[] = [];
  const n = series.length;
  if (n < 4 || days.length !== n) return bad;
  const last = series[n - 1] ?? 0;
  const first = series[0] ?? 0;
  const scale = Math.max(...series.map(Math.abs), 1e-6);

  // ── THE MARKS ARE LOG-SPACED, AND THAT BROKE THE SECOND VERSION TOO ──────────────────────
  //
  // Readings are taken at day 7, 30, 90, 365, 1000, 3650. Differencing ADJACENT marks treats a
  // 23-day gap and a 2650-day gap as the same step, so a quantity that drifted a little over seven
  // years reads as "still climbing steeply at the end" while one that jumped in its first month
  // reads as calm. Three of the second version's findings were exactly that, all of them on series
  // that are visibly flat when you look at them: 21.6 → 20.8 → 22.2 across nine years, reported as
  // unbounded growth.
  //
  // So the comparison is RATE PER DAY, and the late rate is judged against the early one.
  // A per-day RATE comparison was the third wrong answer, and its own self-test caught it: the last
  // interval covers 2650 of 3643 days, so any quantity that moves smoothly has a tiny per-day rate
  // there compared with its first three weeks, and a genuine ten-year drift read as "settled".
  //
  // What actually separates converged from still-moving is whether the last stretch produced its
  // FAIR SHARE of the total movement. If it covers 73% of the elapsed time and produced 5% of the
  // change, it has stopped. If it produced most of the change, it is still going.
  const total = (days[n - 1] ?? 1) - (days[0] ?? 0);
  const lastSpan = (days[n - 1] ?? 0) - (days[n - 2] ?? 0);
  const timeShare = total <= 0 ? 1 : lastSpan / total;
  // Measured against the series' own RANGE, not its net displacement. Net displacement was the
  // fourth wrong answer, and the self-test's mirror half caught it: a mood wandering between 0.0
  // and 0.4 and happening to end 0.1 above where it started has a net displacement of 0.1 and a
  // last step of 0.1, a "movement share" of 100%, reported as unbounded growth. A wandering
  // quantity has a large range and a tiny net, and dividing by the net turns noise into a finding.
  const spanOf = Math.max(...series) - Math.min(...series);
  const movedLast = Math.abs(last - (series[n - 2] ?? 0));
  const movementShare = spanOf <= 1e-9 ? 0 : movedLast / spanOf;
  const settled = movementShare < 0.25 * timeShare;
  // And growth means it ends AT ITS OWN CEILING, not merely higher than one earlier reading.
  const endsAtItsPeak = last >= Math.max(...series) - 0.05 * Math.max(spanOf, 1e-9);
  const stillRising = last > (series[n - 2] ?? 0) && endsAtItsPeak;

  // ① Grows without bound: no cap declared, and STILL climbing at the end at a rate comparable to
  //    its own history: not merely higher than it was at one arbitrary earlier mark.
  // `accumulates` exempts it, and that exemption is the point rather than a loophole: a lifetime
  // count of the days they have spoken SHOULD rise for as long as she lives, and the two-year
  // cliff was created by somebody bounding exactly that. Fixing the cliff made this rule fire in
  // all five lives, which is the rule mistaking the design for the disease.
  if (!accumulates && bound === null && !settled && stillRising && last > first + 0.3 * spanOf) {
    bad.push("grows without bound");
  }
  // ② Stuck at a clamp: it reached its bound and stopped there. THIS is the one that matters, and
  //    it is the only rule that fires on a declared cap.
  if (bound !== null && series.filter((x) => x >= bound * 0.999).length >= 2) {
    bad.push("stuck at a clamp");
  }
  // ③ One-way drift: monotone, meaningfully moved, and STILL MOVING at the end. An accumulating
  //    quantity is exempt: rising is what it is for.
  const monotone = series.every((x, i) => i === 0 || x >= (series[i - 1] ?? 0));
  if (!accumulates && monotone && !settled && last > first + 0.2 * spanOf) {
    bad.push("one-way drift");
  }
  void scale;
  // ④ Outside its design range.
  if (range && (last < range[0] || last > range[1])) bad.push("outside its design range");
  return bad;
}

// ── THE DETECTOR PROVES IT CAN STILL GO RED, BEFORE IT IS BELIEVED ──────────────────────────
//
// Three versions of this rule set have now been wrong, each in the direction of alarming nonsense,
// and each fix made it stricter. A detector that has been narrowed three times and then reports one
// finding is exactly the shape of a detector that has been narrowed into silence, so it plants
// each disease and refuses to run if it cannot see it. It self-tests on every run, not on demand:
// a proof nobody runs is a proof nobody has.

const MARK_DAYS = [7, 30, 90, 365, 1000, DAYS];
const SELF_TEST: Array<{ what: Disease; series: number[]; bound: number | null; range: [number, number] | null; acc: boolean }> = [
  // Still climbing at the end at a rate like its own history, with no cap.
  { what: "grows without bound", series: [1, 5, 15, 60, 165, 600], bound: null, range: null, acc: false },
  // Reached its cap and stopped there.
  { what: "stuck at a clamp", series: [7, 30, 90, 365, 730, 730], bound: 730, range: null, acc: true },
  // Monotone, meaningfully moved, and still moving at the end.
  { what: "one-way drift", series: [0, 0.1, 0.2, 0.35, 0.55, 0.9], bound: null, range: null, acc: false },
  // Ends outside where it is allowed to be.
  { what: "outside its design range", series: [0.1, 0.2, 0.3, 0.5, 0.9, 1.6], bound: null, range: [0, 1], acc: true },
];
for (const c of SELF_TEST) {
  const got = diagnose(c.series, MARK_DAYS, c.bound, c.range, c.acc);
  if (!got.includes(c.what)) {
    console.error(`\nDETECTOR IS BLIND: it cannot see "${c.what}" in ${JSON.stringify(c.series)} (saw: ${got.join(", ") || "nothing"})`);
    console.error("Refusing to report findings from an instrument that cannot fail.\n");
    process.exit(1);
  }
}
// And the mirror: a healthy shape must NOT be flagged, or the output is noise again.
const HEALTHY: Array<{ why: string; series: number[]; bound: number | null; range: [number, number] | null; acc: boolean }> = [
  { why: "a memory accumulating toward a distant cap", series: [9, 41, 120, 515, 1392, 4500], bound: MAX_NODES, range: null, acc: true },
  { why: "a life shaping her and then settling", series: [0, 0.1, 0.2, 0.3, 0.3, 0.3], bound: null, range: [0, 1], acc: false },
  { why: "noise around a plateau", series: [0.4, 4.6, 9.8, 21.6, 20.8, 22.2], bound: null, range: null, acc: false },
  { why: "a mood wandering near zero", series: [0.1, 0.0, 0.1, 0.4, 0.1, 0.2], bound: null, range: [-1, 1], acc: false },
  // The one the daysSeen fix created: a lifetime count that is SUPPOSED to rise forever.
  { why: "a lifetime count with no cap, by design", series: [3, 17, 58, 243, 704, 2593], bound: null, range: null, acc: true },
];
for (const h of HEALTHY) {
  const got = diagnose(h.series, MARK_DAYS, h.bound, h.range, h.acc);
  if (got.length > 0) {
    console.error(`\nDETECTOR CRIES WOLF: ${h.why} was flagged as ${got.join(", ")} — ${JSON.stringify(h.series)}`);
    process.exit(1);
  }
}
console.log("  (the disease detector proved it can see all four, and stays quiet on four healthy shapes)");

// ── RUN ─────────────────────────────────────────────────────────────────────────────────────

console.log(`\n── ${YEARS} YEARS OF HER, THROUGH HER OWN MODULES ────────────────────────────────\n`);

const findings: string[] = [];
const attractors: Array<{ regime: string; temperament: number; mood: number }> = [];

for (const regime of REGIMES) {
  const marks = live(regime, 12345);
  console.log(`── ${regime.name} ──────────────────────────────────────────────`);
  console.log("   day     nodes   edges  carrying    mood   temper   regard   trust  daysTogether   words");
  for (const m of marks) {
    console.log(
      `  ${String(m.day).padStart(5)}  ${String(m.nodes).padStart(7)} ${String(m.edges).padStart(7)}`
      + `  ${m.tension.toFixed(1).padStart(8)} ${m.mood.toFixed(3).padStart(7)} ${m.temperament.toFixed(3).padStart(8)}`
      + ` ${(m.regard === null ? "null" : m.regard.toFixed(3)).padStart(8)} ${m.trust.toFixed(3).padStart(7)}`
      + `  ${String(m.daysTogether).padStart(12)} ${String(m.words).padStart(7)}`,
    );
  }
  const last = marks[marks.length - 1]!;
  attractors.push({ regime: regime.name, temperament: last.temperament, mood: last.mood });

  for (const [what, series, bound, range, accumulates] of [
    // `accumulates` marks the quantities for which rising IS the healthy behaviour. Getting this
    // wrong in either direction is what made the first version's output worthless.
    ["things she carries", marks.map((m) => m.nodes), MAX_NODES, null, true],
    ["what she is carrying", marks.map((m) => m.tension), null, null, false],
    // DELIBERATELY UNBOUNDED now. This simulation is what found the two-year cliff: the count was
    // `daysSeen.length` and the list is capped at MAX_DAYS_KEPT, so in a life where he speaks most
    // days it froze at 730 and stayed there. The list still has its cap (it is persisted JSON);
    // the count is one integer and is the number he reads literally.
    ["days they have spoken", marks.map((m) => m.daysTogether), null, null, true],
    ["her word bank", marks.map((m) => m.words), null, null, true],
    ["who she is becoming", marks.map((m) => m.temperament), null, [0, 1], false],
    ["what she feels", marks.map((m) => m.mood), null, [-1, 1], false],
  ] as Array<[string, number[], number | null, [number, number] | null, boolean]>) {
    for (const d of diagnose(series, marks.map((m) => m.day), bound, range, accumulates)) {
      findings.push(`${regime.name}: ${what} — ${d} (${series.map((x) => x.toFixed(1)).join(" → ")})`);
    }
  }
  console.log("");
}

// ── ATTRACTORS ──────────────────────────────────────────────────────────────────────────────
//
// If every life lands in the same corner, the design's pull is bigger than her life, which is the
// opposite of what this whole project is for. A spread means her life is what shapes her.

console.log("── where each life leaves her, at the end ──────────────────────────────────────");
for (const a of attractors) {
  console.log(`  ${a.regime.padEnd(16)} temperament ${a.temperament.toFixed(4)}   mood ${a.mood.toFixed(4)}`);
}
const temps = attractors.map((a) => a.temperament);
const spread = Math.max(...temps) - Math.min(...temps);
console.log(`\n  spread across five lives: ${spread.toFixed(4)}`);
console.log(`  ${spread < 0.02
  ? "  EVERY LIFE LANDS IN THE SAME PLACE — the design's pull is larger than her life."
  : "  different lives leave her in different places, which is the point."}`);

// ── WHAT IT FOUND ───────────────────────────────────────────────────────────────────────────

console.log("\n── the four diseases ──────────────────────────────────────────────────────────");
if (findings.length === 0) console.log("  none found across five lives.");
for (const f of findings) console.log(`  ${f}`);

console.log("\n── time bombs: the constants that bite only after years ────────────────────────");
console.log(`  days-together list cap: ${MAX_DAYS_KEPT} days — DEFUSED: the COUNT is now its own unbounded integer,`);
console.log("                          so the list still forgets old days and \"how long we have known each other\" does not.");
console.log(`  field node cap:         ${MAX_NODES} — reached in the runs above? see the nodes column`);
console.log("");
