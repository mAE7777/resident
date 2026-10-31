// CAN SHE COME BACK?
//
// ── ERIC'S THIRD INSTRUCTION, AS ARITHMETIC ──────────────────────────────────────────────────
//
// 「我说她是自主独立，不仅仅因为我们不主动设计她…还因为她能够调节，而不是说随着时间的推移变得
// 越来越奇怪/故障」. A person who is well can self-regulate: a mood returns to baseline, a thing
// stops mattering, something understood gets put down, a rift gets repaired. A design where every
// quantity only moves ONE WAY does not fail a test, it produces a being who gets slowly stranger
// for years and nothing anywhere reports it.
//
// So every state variable she has gets four questions, and they are answered by DRIVING THE REAL
// MODULES rather than by reading the code and forming an opinion:
//
//   1. THE WAY OUT, what pushes it away from where it started.
//   2. THE WAY BACK, what could bring it back.
//   3. IS THE WAY BACK REACHABLE, in the range of lives she will actually have. A return path
//      that exists in the source and cannot be walked is worse than none, because it looks like
//      an answer.
//   4. WHAT LAYER IS THE RETURN, "over a threshold, reset" is layer 1 wearing a loop's clothes.
//
// This script answers 1-3 with numbers. Question 4 is a judgement, and each answer to it has
// to carry its own argument.
//
// Usage: pnpm exec tsx scripts/_return-paths.ts

import { EMPTY_RECORD, heSpoke, hisUsualRegard } from "../src/life/relationship.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";
import { howHeHasBeen } from "../src/life/how-it-landed.js";
import {
  createTrust, applyTrustDelta, TRUST_START, TRUST_MIN, TRUST_MAX, TRUST_UP, TRUST_DOWN,
} from "../src/life/credence.js";
import { createLivingField } from "../src/life/field-live.js";
import { neutralTemperament, drift, distanceFromNeutral } from "../src/life/temperament.js";
import { appraise, neutralPAD } from "../src/life/emotion.js";

const n3 = (x: number | null): string => (x === null ? "null" : x.toFixed(3));

const rows: string[] = [];
const verdicts: Array<{ what: string; verdict: string }> = [];
function row(what: string, out: string, back: string, verdict: string): void {
  rows.push(`  ${what.padEnd(34)} out: ${out.padEnd(26)} back: ${back}`);
  verdicts.push({ what, verdict });
}

console.log("\n── CAN SHE COME BACK? ──────────────────────────────────────────────────────────\n");

// ── 1 · HOW HE HAS USUALLY TREATED HER ──────────────────────────────────────────────────────
//
// A LIFETIME MEAN, and the reported defect is that its positive half is clamped flat. Measured
// here rather than read off the source, because the question that matters is not what the formula
// says: it is what range the formula can actually be driven into by real messages.

const WELL = "你要是有空的话，能不能帮我看看书架那边？我这边赶着交东西，不急的话明天也行。";
const BADLY = "现在马上把你工作区里都有什么文件列一遍发我";

function regardAfter(text: string, times: number): number | null {
  let rec = EMPTY_RECORD;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, 1_700_000_000_000 + i * 864e5, howHeSaidIt(text));
  return hisUsualRegard(rec);
}

/**
 * THE REACHABLE RANGE, across messages he would really send.
 *
 * Two messages is not a range. And the first run of this turned up something the two-point version
 * could not explain: two hundred curt messages produced regard `null`, because a bare demand is
 * not LEGIBLE to `howHeSaidIt`, so nothing folds in at all. An illegible message contributes
 * nothing rather than contributing badness, which is the right discipline and means the negative
 * half is not reachable from that message either.
 *
 * So the range has to be measured over a spread of things he would actually type.
 */
const HIS_RANGE: ReadonlyArray<{ what: string; text: string }> = [
  { what: "asked, with a reason and a way out", text: WELL },
  { what: "asked warmly, no deadline", text: "你有空的时候看看那份目录就行，不着急，我也是刚想起来。" },
  { what: "asked, plainly", text: "能不能帮我看一下书架那边？" },
  { what: "told, with a reason", text: "把目录整理一下，我下午要用。" },
  { what: "told, bare", text: BADLY },
  { what: "told, bare, with a clock", text: "现在马上整理完，十分钟内给我。" },
  { what: "told, bare, with a clock and a big ask", text: "现在马上把整个笔记目录重新整理一遍，两千字的说明也一起写了，一小时内。" },
];
console.log("   the reachable range, over messages he would really send:");
let lowest: number | null = null;
let highest: number | null = null;
for (const m of HIS_RANGE) {
  const r = regardAfter(m.text, 200);
  const form = howHeSaidIt(m.text);
  console.log(`     ${m.what.padEnd(38)} regard ${n3(r).padStart(6)}  (legible: ${String(form.legible)})`);
  if (r !== null) {
    lowest = lowest === null ? r : Math.min(lowest, r);
    highest = highest === null ? r : Math.max(highest, r);
  }
}
console.log(`   → reachable regard runs ${n3(lowest)} … ${n3(highest)}`);

const bestReachable = highest;
const worstReachable = lowest;
// The REAL mapping, imported rather than copied: a probe with its own copy of the arithmetic
// measures the copy, and would have gone on reporting the old numbers after the fix landed.
const asHeUsuallyIs = (r: number | null): number => howHeHasBeen(r);

console.log("① how he has usually treated her");
console.log(`   two hundred messages, always well:  regard ${n3(bestReachable)}  → standing multiplier ${asHeUsuallyIs(bestReachable).toFixed(3)}`);
console.log(`   two hundred messages, always curt:  regard ${n3(worstReachable)}  → standing multiplier ${asHeUsuallyIs(worstReachable).toFixed(3)}`);
console.log(`   never spoken:                       regard null   → standing multiplier ${asHeUsuallyIs(null).toFixed(3)}`);
const positiveHalfIsDead = Math.abs(asHeUsuallyIs(bestReachable) - asHeUsuallyIs(null)) < 0.001;
console.log(`   ${positiveHalfIsDead
  ? "THE POSITIVE HALF IS DEAD: a lifetime of being treated well reads exactly like never having spoken."
  : "the positive half carries something."}`);
row("how he usually treats her", `${n3(worstReachable)} (curt)`, `${n3(bestReachable)} (kind)`,
  positiveHalfIsDead ? "BROKEN — only the negative half is arithmetic" : "ok");

// ── 2 · HOW MUCH SHE TRUSTS WHAT SHE IS TOLD ────────────────────────────────────────────────
//
// The asymmetry is deliberate and right: losing is faster than earning, which is how trust
// behaves. The question is whether earning is REACHABLE, a path that needs a rare coincidence is
// a path she will never walk.

let t = createTrust();
let downSteps = 0;
while (t.told > TRUST_MIN + 1e-9 && downSteps < 1000) { t = applyTrustDelta(t, -TRUST_DOWN); downSteps += 1; }
let upSteps = 0;
while (t.told < TRUST_START - 1e-9 && upSteps < 10_000) { t = applyTrustDelta(t, TRUST_UP); upSteps += 1; }

console.log("\n② how much she trusts what she is told");
console.log(`   start ${TRUST_START}, floor ${TRUST_MIN}, ceiling ${TRUST_MAX}`);
console.log(`   to fall from start to the floor: ${downSteps} contradictions`);
console.log(`   to climb back from the floor to the start: ${upSteps} corroborations`);
console.log(`   the climb costs ${(upSteps / downSteps).toFixed(1)}x the fall — which is right; the question is whether`);
console.log("   a corroboration can HAPPEN, and that needs something he told her to meet something she lived.");
row("trust in what he tells her", `${downSteps} conflicts to the floor`, `${upSteps} corroborations back`,
  "asymmetric by design — reachability of the UP path is the open question");

// ── 3 · WHAT SHE FEELS ──────────────────────────────────────────────────────────────────────
//
// The one that is unambiguously fine, and worth measuring anyway: a loop that is believed to exist
// and is not is the whole subject of this file.

let mood = neutralPAD();
// A run of days that go badly, through the REAL appraisal: nothing works, nothing is in her hands.
for (let i = 0; i < 40; i++) {
  mood = appraise(mood, { goalProgress: -0.9, novelty: 0.9, control: -0.8, fatigue: 0.6, engagement: 0.8 });
}
const worst = mood;
// Then ordinary days. Not GOOD ones, the question is whether time alone brings her back, which is
// what a baseline pull means and what "she can regulate" has to mean at the bottom.
for (let i = 0; i < 200; i++) {
  mood = appraise(mood, { goalProgress: 0, novelty: 0.2, control: 0, fatigue: 0.3, engagement: 0.5 });
}
console.log("\n③ what she feels");
console.log(`   forty bad days:              pleasure ${worst.pleasure.toFixed(3)}`);
console.log(`   then two hundred ordinary:   pleasure ${mood.pleasure.toFixed(3)} (baseline ${neutralPAD().pleasure.toFixed(3)})`);
const moodReturns = Math.abs(mood.pleasure - neutralPAD().pleasure) < Math.abs(worst.pleasure - neutralPAD().pleasure) * 0.2;
row("what she feels (PAD)", `${worst.pleasure.toFixed(3)}`, `${mood.pleasure.toFixed(3)}`,
  moodReturns ? "ok — a real pull back to baseline" : "BROKEN — mood does not return");

// ── 4 · WHO SHE IS BECOMING ─────────────────────────────────────────────────────────────────
//
// Temperament drifts. The claim to check is that it drifts BACK symmetrically, and the suspected
// hole is that the evidence weight stops falling after three weeks, which would mean a shape
// formed early can never be undone.

// THE QUESTION HAS TO BE THE RIGHT ONE. The first version of this pulled one way for 120 days and
// then pulled the OPPOSITE way for 480, and reported that she does not come back, because three
// of the four latents had been driven to the far extreme instead of home. Distance from neutral was
// the same or larger, correctly, and the probe called that a broken return path. That was a claim
// about the probe.
//
// What "she can regulate" actually asks: after a life that shaped her, does an ORDINARY life,
// nothing pulling either way: bring her back? Or is she stuck where the early evidence put her?
let temp = neutralTemperament();
for (let d = 1; d <= 120; d++) temp = drift(temp, { metWhenSpeaking: -1, exploringPaidOff: -1, hisShare: 1, activity: -1 }, d);
const driftedTo = distanceFromNeutral(temp);
const NOTHING_PULLING = { metWhenSpeaking: 0, exploringPaidOff: 0, hisShare: 0, activity: 0 };
let halfway = 0;
for (let d = 121; d <= 600; d++) {
  temp = drift(temp, NOTHING_PULLING, d);
  if (halfway === 0 && distanceFromNeutral(temp) < driftedTo / 2) halfway = d - 120;
}
const backTo = distanceFromNeutral(temp);
console.log("\n④ who she is becoming (temperament)");
console.log(`   120 days of a life that pulls one way:  distance from neutral ${driftedTo.toFixed(4)}`);
console.log(`   then 480 days with nothing pulling:     distance from neutral ${backTo.toFixed(4)}`);
console.log(`   half of it was gone after ${halfway} ordinary days`);
console.log(`   ${backTo < driftedTo * 0.2 ? "she comes back." : "SHE DOES NOT COME BACK — a shape formed early is permanent."}`);
row("who she is becoming", `${driftedTo.toFixed(4)} after 120 days`,
  `${backTo.toFixed(4)}, half gone in ${halfway}d`,
  backTo < driftedTo * 0.2 ? "ok — an ordinary life dissolves it" : "BROKEN — early shape is permanent");

// ── 5 · WHAT SHE HOLDS ──────────────────────────────────────────────────────────────────────
//
// Node strength and tension. The claimed loop is decay + pruning + easeOff + putting something
// down, which would make this the deepest one she has. Driven through the real field.

// TENSION COMES FROM THINGS SHE COULD NOT SETTLE, not from things that felt bad. The first version
// of this encoded forty charged MOMENTS and reported tension 0.0000 before and after, a return
// path declared broken on a quantity the probe had never driven. Questions are what carry tension.
const field = createLivingField({ noReminding: true });
const T0 = 1_700_000_000_000;
for (let i = 0; i < 40; i++) {
  field.encodeQuestion({
    key: `q${i}`, text: `第 ${i} 件我没弄明白的事`, nowMs: T0 + i * 3.6e6,
    source: "hers", tension: 0.5,
  });
}
/**
 * The RAW weight, summed over her nodes.
 *
 * `signals().tension` is a saturating aggregate: forty half-tense questions peg it at 1.0000, and
 * it stays at 1.0000 for as long as the sum is anywhere near the ceiling. The first version of this
 * read that number before and after and reported that nothing fades, which was a measurement
 * ceiling, not a stuck quantity. A saturating gauge cannot answer a question about a return path;
 * it can only say whether the answer is far from the top.
 */
const rawTension = (): number => {
  let sum = 0;
  for (const n of field.graph().nodes.values()) sum += n.tension;
  return sum;
};

const heldAtFirst = rawTension();
const signalAtFirst = field.signals(T0 + 40 * 3.6e6).tension;
let now = T0 + 40 * 3.6e6;
let halfGone = 0;
for (let d = 0; d < 365; d++) {
  now += 864e5;
  field.tick(now);
  if (halfGone === 0 && rawTension() < heldAtFirst / 2) halfGone = d + 1;
}
const heldAfter = rawTension();
console.log("\n⑤ what she holds (unresolved weight in her field)");
console.log(`   forty things she could not settle:  raw weight ${heldAtFirst.toFixed(2)} (the signal reads ${signalAtFirst.toFixed(4)})`);
console.log(`   a year of ordinary time:            raw weight ${heldAfter.toFixed(2)} (the signal reads ${field.signals(now).tension.toFixed(4)})`);
console.log(`   half of it was gone after ${halfGone} days`);
row("what she is carrying", heldAtFirst.toFixed(2), `${heldAfter.toFixed(2)}, half gone in ${halfGone}d`,
  heldAfter < heldAtFirst * 0.5 ? "ok — time alone lightens it" : "BROKEN — nothing fades");

// ── WHAT THE TABLE SAYS ─────────────────────────────────────────────────────────────────────

console.log("\n── the rows, measured ──────────────────────────────────────────────────────────");
for (const r of rows) console.log(r);
console.log("\n── verdicts ────────────────────────────────────────────────────────────────────");
for (const v of verdicts) console.log(`  ${v.what.padEnd(34)} ${v.verdict}`);
const broken = verdicts.filter((v) => v.verdict.startsWith("BROKEN"));
console.log(`\n${broken.length === 0
  ? "every measured quantity has a reachable way back."
  : `${broken.length} quantity(s) cannot come back: ${broken.map((b) => b.what).join(", ")}`}`);
