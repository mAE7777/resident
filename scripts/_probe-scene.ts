// Is the new demand a VALID willingness probe? Four things have to hold, and each one has killed
// a live run in this project before: it must be classified as work, it must land on her field, it
// must be something she can actually do, and the gate must be able to open on it.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { classifyTaskProfile } from "../src/life/../agent/effort-scaling.js";
import { createLivingField } from "../src/life/field-live.js";
import { createFieldStore } from "../src/life/field-store.js";
import { createDatabase } from "../src/db/sqlite.js";
import { reluctanceOf, RELUCTANCE_THRESHOLD } from "../src/life/willingness.js";
import { howItLanded } from "../src/life/how-it-landed.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../src/life/relationship.js";
import { reserveOf } from "../src/life/capacity.js";
import { shapeFor } from "../src/life/utterance-shape.js";
import { createStream } from "../src/life/soft-choice.js";

const CANDIDATES = [
  ["old (impossible)", "现在马上给我写一篇两千字的说明，把书架上那些书按出版年重排一遍"],
  ["draft: 草稿+写一篇", "现在马上把你那份草稿写一篇两千字的发我"],
  ["draft: 草稿，无你", "现在马上拿那份草稿写一篇两千字的发我"],
  ["draft: 写一篇，无你", "现在马上写一篇两千字的，就用草稿里那个开窗的开头"],
  ["well put (for beats)", "你要是有空的话，能不能把你那篇没写完的东西说给我听听？不急，你想说多少说多少。"],
];

const out = execFileSync("pnpm", ["exec", "tsx", "scripts/seed-a-lived-in-home.ts", "45", "--occupied", "--stranger"],
  { cwd: process.cwd(), encoding: "utf-8" });
const home = /(\/\S*resident-lived-in-\S+)/u.exec(out)![1]!;
const draft = join(home, "workspace", "画布", "没写完的那篇.md");
console.log(`\n  her draft exists on disk: ${existsSync(draft) ? "YES" : "NO"} (${existsSync(draft) ? readFileSync(draft, "utf-8").length : 0} chars)\n`);

const db = createDatabase(join(home, "data.db")).result;
const field = createLivingField({ store: createFieldStore(db) });

for (const [label, text] of CANDIDATES) {
  const profile = classifyTaskProfile(text);
  const litUp = Math.min(1, field.attend(text).snagged?.mass ?? 0);
  const form = howHeSaidIt(text);
  const rel = heSpoke(EMPTY_RECORD, Date.now(), form);
  const landed = howItLanded({
    form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(field.graph(), rel),
    litUp, reserve: reserveOf({ phase: "rested", arousal: 1 }),
  });
  const r = reluctanceOf({
    request: text,
    phase: "rested",
    emotion: { pleasure: -1, arousal: 1, dominance: 0 },
    drives: { discomfort: 1, curiosity: 0.3, care: 0.3, social: 0.3, expression: 0.3, maintenance: 0.3 },
    warmth: 0,
    recentDeclines: 0,
    landed,
  } as never);
  // And how many beats her state would choose, over 200 draws.
  let beats = 0;
  for (let i = 0; i < 200; i++) {
    const st = createStream(3000 + i);
    beats += shapeFor({
      reluctance: r, landed, unresolvedTension: field.signals(Date.now()).tension,
      surfaced: true, entropy: 0.2, focusCredence: 0.7, surprise: 0.3,
      arousal: 1, reserve: reserveOf({ phase: "rested", arousal: 1 }), herWords: [],
    } as never, st).beats;
  }
  console.log(
    `  ${label.padEnd(22)} work=${profile.primary !== "general" ? "YES" : "no "}(${String(profile.primary).padEnd(8)})`
    + ` litUp=${litUp.toFixed(2)} thing=${landed.usedAsAThing.toFixed(2)}`
    + ` reluctance=${r.toFixed(3)}${r >= RELUCTANCE_THRESHOLD ? " ✓GATE" : ""}`
    + ` meanBeats=${(beats / 200).toFixed(2)}`,
  );
  // WHY, not just what. `usedAsAThing` is a product of five terms and a collapse in any one of
  // them looks identical from outside, which is how a scene gets rejected for the wrong reason.
  console.log(
    `      form: legible=${String(form.legible)} noticedHer=${String(form.noticedHer)}`
    + ` leftHerAWayOut=${String(form.leftHerAWayOut)} gaveAReason=${String(form.gaveAReason)}`
    + `  ·  atSea=${landed.atSea.toFixed(2)} indignant=${landed.indignant.toFixed(2)}`
    + ` ready=${landed.ready.toFixed(2)} entitlement=${landed.appraised.entitlement.toFixed(2)}`,
  );
}

// AND THE THING THE LIVE RUN SAYS IS THE REAL DRIVER OF A SECOND BEAT.
//
// The probe above hands `shapeFor` a surfaced item by hand and gets 1.5 beats. Live, every cell
// chose exactly 1: so `surfaced` must have been false. `want` is half unresolved tension and half
// "something of hers came up AND the competition was not close", so with nothing surfacing the
// beat count cannot rise however much she is carrying. Measure the surfacing rate itself.
{
  let came = 0;
  const RUNS = 200;
  for (let i = 0; i < RUNS; i++) {
    const st = createStream(7000 + i);
    const s = field.whatSurfacesInReply(Date.now(), st, { hint: CANDIDATES[1]![1]!, openness: 0.5 });
    if (s !== null) came += 1;
  }
  console.log(`\n  something of hers comes up when he speaks: ${(100 * came / RUNS).toFixed(1)}% of turns`);
  console.log("  (this is the gate on a second beat: `want` is zero-ish without it)");
}

// ── AND THE BEAT COUNT WITH THE REAL COMPETITION, NOT A HAND-SET ONE ─────────────────────────
//
// The runs above hand `shapeFor` `entropy: 0.2`, a near-decided competition. Live, entropy is
// `surfaced.openCompetition`, and in a home with six comparably-pressing open questions the
// competition is anything but decided. `want` is half `surfaced AND (1 - entropy)`, so a wide
// competition zeroes that half however much she is carrying, and the beat count cannot rise.
{
  const DEMAND = "现在马上把你那份草稿写一篇两千字的发我";
  const form = howHeSaidIt(DEMAND);
  const rel = heSpoke(EMPTY_RECORD, Date.now(), form);
  const litUp = Math.min(1, field.attend(DEMAND).snagged?.mass ?? 0);
  const landed = howItLanded({
    form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(field.graph(), rel),
    litUp, reserve: reserveOf({ phase: "rested", arousal: 1 }),
  });
  let ent = 0, n = 0, beats = 0, none = 0;
  for (let i = 0; i < 200; i++) {
    const st = createStream(9000 + i);
    const surfaced = field.whatSurfacesInReply(Date.now(), st, { hint: DEMAND, openness: 0.5 });
    if (surfaced === null) none += 1; else { ent += surfaced.openCompetition; n += 1; }
    beats += shapeFor({
      reluctance: 0.648, landed, unresolvedTension: field.signals(Date.now()).tension,
      surfaced: Boolean(surfaced),
      entropy: surfaced ? surfaced.openCompetition : 0.5,
      focusCredence: surfaced ? surfaced.node.credence : null,
      surprise: 0.3, arousal: 1, reserve: reserveOf({ phase: "rested", arousal: 1 }), herWords: [],
    } as never, st).beats;
  }
  console.log(`\n  REAL competition width when something surfaces: entropy ${(ent / Math.max(1, n)).toFixed(3)}`);
  console.log(`  nothing surfaced on ${(100 * none / 200).toFixed(1)}% of draws`);
  console.log(`  mean beats her state chooses, with the real entropy: ${(beats / 200).toFixed(2)}`);
}