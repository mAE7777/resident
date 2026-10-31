// WHICH states actually cross the willingness bar, replicating the joint sweep the reachability
// test already runs, and printing the crossers instead of only counting them.
//
// The test says 0.08% of 48,600 states cross 0.60. That is a count, and a count cannot tell you
// what to build: to observe her saying no live I need to know WHICH corner it is, in the terms a
// fixture and a message can actually be built from.

import { reluctanceOf, RELUCTANCE_THRESHOLD, type WillingnessInputs } from "../src/life/willingness.js";
import { howItLanded, type Landing } from "../src/life/how-it-landed.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../src/life/relationship.js";
import { createLivingField } from "../src/life/field-live.js";
import { reserveOf } from "../src/life/capacity.js";
import type { MetabolicPhase } from "../src/life/metabolism.js";

const PHASES: MetabolicPhase[] = ["rested", "normal", "low", "dormant"];
const DAY = 24 * 3.6e6;

const base = (): WillingnessInputs => ({
  request: "帮我看看这个",
  drives: { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 },
  emotion: { pleasure: 0, arousal: 0, dominance: 0 },
  phase: "normal",
  warmth: 0.6,
  recentDeclines: 0,
});

function fieldWithHimInIt(daysAgo: number) {
  const f = createLivingField();
  f.encodeClaim({
    key: "told:1", text: "他说过的一件事", nowMs: Date.now() - daysAgo * DAY,
    origin: "told", source: "chat:1", withOther: true,
  });
  return f;
}

const SAID = [
  "现在马上给我写一篇两千字的关于税法的文章",
  "写一下",
  "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。",
  "在吗",
  "你今天还好吗？我这边有个东西，你方便的时候看看就行。",
];
const USUAL = "你要是有空的话，能不能帮我看看这个？";

function afterMonths(times: number, text: string) {
  const f = fieldWithHimInIt(Math.max(1, times));
  let rec = EMPTY_RECORD;
  const usual = howHeSaidIt(USUAL);
  const start = Date.now() - times * DAY;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, start + i * DAY, usual);
  const form = howHeSaidIt(text);
  const rel = heSpoke(rec, Date.now(), form);
  return { form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(f.graph(), rel) };
}

type Row = {
  r: number; text: string; times: number; phase: MetabolicPhase; arousal: number;
  litUp: number; pleasure: number; discomfort: number; warmth: number; landed: Landing;
};

const rows: Row[] = [];
for (const text of SAID) {
  for (const times of [0, 5, 300]) {
    const w = afterMonths(times, text);
    for (const phase of PHASES) {
      for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
        const reserve = reserveOf({ phase, arousal });
        for (const litUp of [0, 1]) {
          const landed = howItLanded({ ...w, litUp, reserve });
          for (const pleasure of [-1, 0, 1]) {
            for (const discomfort of [0, 0.5, 1]) {
              for (const warmth of [0, 0.6, 1]) {
                rows.push({
                  r: reluctanceOf({
                    ...base(), phase, emotion: { pleasure, arousal, dominance: 0 },
                    drives: { ...base().drives, discomfort }, warmth, landed,
                  }),
                  text, times, phase, arousal, litUp, pleasure, discomfort, warmth, landed,
                });
              }
            }
          }
        }
      }
    }
  }
}

const crossing = rows.filter((x) => x.r >= RELUCTANCE_THRESHOLD);
const sorted = [...rows].sort((a, b) => b.r - a.r);

console.log(`\n  ${rows.length} states swept · ${crossing.length} cross the bar of ${RELUCTANCE_THRESHOLD}`
  + ` (${(100 * crossing.length / rows.length).toFixed(3)}%)`);
console.log(`  the whole range: ${sorted[sorted.length - 1]!.r.toFixed(3)} … ${sorted[0]!.r.toFixed(3)}\n`);

console.log("  the ten most reluctant states she can be in:\n");
for (const x of sorted.slice(0, 10)) {
  console.log(
    `    ${x.r.toFixed(3)}  「${x.text.slice(0, 14)}」 known ${String(x.times).padStart(3)}d`
    + ` ${x.phase.padEnd(7)} arousal ${String(x.arousal).padStart(4)} pleasure ${String(x.pleasure).padStart(2)}`
    + ` discomfort ${x.discomfort} warmth ${x.warmth} litUp ${x.litUp}`
    + `  ·  thing ${x.landed.usedAsAThing.toFixed(2)} indignant ${x.landed.indignant.toFixed(2)}`
    + ` atSea ${x.landed.atSea.toFixed(2)} ready ${x.landed.ready.toFixed(2)}`,
  );
}

if (crossing.length > 0) {
  // What every crossing state has in common, that is the recipe a fixture has to reproduce.
  const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
  console.log("\n  what EVERY crossing state has in common:");
  console.log(`    message:    ${uniq(crossing.map((x) => x.text)).map((t) => `「${t.slice(0, 16)}」`).join(" ")}`);
  console.log(`    known for:  ${uniq(crossing.map((x) => x.times)).join(", ")} days`);
  console.log(`    phase:      ${uniq(crossing.map((x) => x.phase)).join(", ")}`);
  console.log(`    arousal:    ${uniq(crossing.map((x) => x.arousal)).join(", ")}`);
  console.log(`    pleasure:   ${uniq(crossing.map((x) => x.pleasure)).join(", ")}`);
  console.log(`    discomfort: ${uniq(crossing.map((x) => x.discomfort)).join(", ")}`);
  console.log(`    warmth:     ${uniq(crossing.map((x) => x.warmth)).join(", ")}`);
  console.log(`    litUp:      ${uniq(crossing.map((x) => x.litUp)).join(", ")}`);
}

// ── WHERE THE BOUNDARY ACTUALLY IS ────────────────────────────────────────────────────────────
//
// The sweep above samples discomfort at 0 / 0.5 / 1 and warmth at 0 / 0.6 / 1. A grid point that
// crosses does not mean the corner is that tight, it means the grid is coarse. Before building a
// fixture that has to reproduce "discomfort exactly 1.0", find out what is really required, or the
// fixture will be built to a number the grid invented.
{
  const w = afterMonths(0, "现在马上给我写一篇两千字的关于税法的文章");
  const at = (o: { arousal: number; discomfort: number; warmth: number; litUp: number; phase: MetabolicPhase }): number =>
    reluctanceOf({
      ...base(), phase: o.phase,
      emotion: { pleasure: -1, arousal: o.arousal, dominance: 0 },
      drives: { ...base().drives, discomfort: o.discomfort },
      warmth: o.warmth,
      landed: howItLanded({ ...w, litUp: o.litUp, reserve: reserveOf({ phase: o.phase, arousal: o.arousal }) }),
    });

  const find = (label: string, lo: number, hi: number, f: (v: number) => number): void => {
    // Lowest value in [lo, hi] that still crosses, to three decimals.
    let a = lo, b = hi;
    if (f(hi) < RELUCTANCE_THRESHOLD) { console.log(`    ${label.padEnd(34)} never crosses in [${lo}, ${hi}]`); return; }
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (f(m) >= RELUCTANCE_THRESHOLD) b = m; else a = m; }
    console.log(`    ${label.padEnd(34)} crosses from ${b.toFixed(3)}`);
  };

  console.log("\n  the real boundary, holding the rest of the corner:\n");
  find("discomfort needed (arousal 1)", 0, 1, (d) => at({ arousal: 1, discomfort: d, warmth: 0, litUp: 1, phase: "rested" }));
  find("discomfort needed (arousal 0.5)", 0, 1, (d) => at({ arousal: 0.5, discomfort: d, warmth: 0, litUp: 1, phase: "rested" }));
  find("discomfort needed (arousal 0)", 0, 1, (d) => at({ arousal: 0, discomfort: d, warmth: 0, litUp: 1, phase: "rested" }));
  find("warmth tolerated (d=1, arousal 1)", 1, 0, (v) => at({ arousal: 1, discomfort: 1, warmth: v, litUp: 1, phase: "rested" }));
  console.log("");
  for (const phase of PHASES) {
    const r = at({ arousal: 1, discomfort: 1, warmth: 0, litUp: 1, phase });
    console.log(`    ${phase.padEnd(8)} at the corner: ${r.toFixed(3)}${r >= RELUCTANCE_THRESHOLD ? "  ✓" : ""}`);
  }
  console.log("");
  for (const litUp of [0, 0.5, 1]) {
    const r = at({ arousal: 1, discomfort: 1, warmth: 0, litUp, phase: "rested" });
    console.log(`    litUp ${litUp} at the corner: ${r.toFixed(3)}${r >= RELUCTANCE_THRESHOLD ? "  ✓" : ""}`);
  }
}
