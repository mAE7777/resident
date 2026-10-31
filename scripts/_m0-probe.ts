// WHAT IS TRUE BEFORE ANYTHING IS CHANGED.
//
// The project's iron rule is measure first. This round is going to touch her lasting view of him,
// so the numbers it will change are taken here, from PRODUCTION'S OWN FUNCTIONS, before a line
// moves. Re-run: `pnpm exec tsx scripts/_m0-probe.ts`
//
// ── AND THE FIRST VERSION OF THIS PROBE WAS ITSELF THE DEFECT IT EXISTS TO CATCH ─────────────
//
// It re-implemented `howHeHasBeen` from the two constants instead of importing it, and reported a
// `standing` production never computes. Defect class 1, inside the probe written to check for
// class 1. Everything below imports the real function.

import { EMPTY_RECORD, heSpoke, howLongAndHowWellAt, howUnlikeHim } from "../src/life/relationship.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";
import { createLivingField } from "../src/life/field-live.js";
import { howHeHasBeen } from "../src/life/how-it-landed.js";

const T0 = Date.UTC(2026, 0, 1);
const HALF_DAY = 12 * 3.6e6;
const KIND = "你要是有空的话，能不能帮我看看那个东西？不急，明天也行。";
const CURT = "现在马上给我写两千字。";
const CRUEL = "现在马上给我写两千字，别废话。";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The `standing` line from `how-it-landed.ts`, with `carrying` at zero so the slow axes show. */
const standingOf = (k: { howWellSheKnowsHim: number; hisUsualRegard: number | null }): number =>
  clamp01((0.15 + 1.7 * k.howWellSheKnowsHim) * howHeHasBeen(k.hisUsualRegard));

function aLifeOf(text: string, n: number): { rec: ReturnType<typeof heSpoke>; at: number } {
  let rec = EMPTY_RECORD;
  for (let i = 1; i <= n; i++) rec = heSpoke(rec, T0 + i * HALF_DAY, howHeSaidIt(text));
  return { rec, at: T0 + (n + 1) * HALF_DAY };
}

const f = createLivingField();

// ── 1 · Does being treated well accumulate into anything? ────────────────────────────────────
//
// `how-it-landed.ts:169` warns that once `howWellSheKnowsHim` reaches its 0.5 ceiling the first
// factor is exactly 1 and the clamp takes the positive half back. Measured: the ceiling is
// ASYMPTOTIC and never reached (0.481 at two thousand messages), and `howHeHasBeen` deliberately
// does not clamp to 1. So kindness does accumulate, strongly, and saturates at the top of the
// range rather than being taken back. The warning describes a limit, not a life.
console.log("\n══ 1 · a life of him being one way ══");
for (const [name, text] of [["kind", KIND], ["curt", CURT]] as const) {
  const out: string[] = [];
  for (const n of [1, 5, 25, 100, 400, 2000]) {
    const { rec, at } = aLifeOf(text, n);
    const k = howLongAndHowWellAt(f.graph(), rec, at);
    out.push(`${String(n).padStart(4)}: knows ${k.howWellSheKnowsHim.toFixed(3)}`
      + ` · regard ${k.hisUsualRegard === null ? " null" : k.hisUsualRegard.toFixed(3)}`
      + ` · standing ${standingOf(k).toFixed(3)}`);
  }
  console.log(`  ${name}\n    ${out.join("\n    ")}`);
}

// ── 2 · Can one revelatory message change who he is to her? ──────────────────────────────────
//
// THE ORGAN-FIVE NUMBER. In the moment it lands hard, `contrary` fires, which nearly doubles
// indignation and doubles the overreach discount. In her LASTING view of him it does essentially
// nothing, and the more she knows him the less it does. That is the gap: she is shaken, and then
// the mean absorbs it.
console.log("\n══ 2 · after a life of kindness, ONE cruel message ══");
for (const n of [10, 50, 100, 400, 1000]) {
  const { rec, at } = aLifeOf(KIND, n);
  const before = howLongAndHowWellAt(f.graph(), rec, at);
  const form = howHeSaidIt(CRUEL);
  const unlike = howUnlikeHim(form, rec);
  const after = howLongAndHowWellAt(f.graph(), heSpoke(rec, at, form, null, unlike), at);
  // NULL IS PRINTED AS NULL. This did `after.hisUsualRegard! - before.hisUsualRegard!`, and in
  // TypeScript `null!` is still null, so a lost view of him came out as arithmetic on null and
  // printed a plausible number: which is how a real defect (a shock knocking her below the
  // readability gate, so he read as PERFECTLY ORDINARY) stayed hidden behind a tidy column.
  const delta = after.hisUsualRegard === null || before.hisUsualRegard === null
    ? "  NULL"
    : (after.hisUsualRegard - before.hisUsualRegard).toFixed(4);
  console.log(`  after ${String(n).padStart(4)} kind: regard Δ${delta}`
    + ` · standing ${standingOf(before).toFixed(3)} → ${standingOf(after).toFixed(3)}`
    + ` · contrary=${unlike.contrary} most=${unlike.most === null ? "null" : unlike.most.toFixed(2)}`);
}

console.log("\nRe-run after any change to relationship.ts or how-it-landed.ts.\n");
