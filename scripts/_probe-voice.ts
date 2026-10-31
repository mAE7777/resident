// Does what she actually says get INTO her own-voice pool?
//
// ── WHY THIS SCRIPT IS ITSELF A CAUTIONARY TALE ──────────────────────────────────────────────
//
// The first version of it scored `aiShapeOf(...).score`, the RAW composite, against
// `ADMISSIBLE_SHAPE`, reported "1 of 20 admitted, median 5", and that number was written into
// the working notes as that revision's headline finding, with a recommendation attached.
//
// The production gate does not use the raw score. `her-own-voice.ts` strikes out three
// DELIVERY-SCALE detectors before comparing, on purpose, with a comment saying that letting them
// veto admission "made the gate one almost nothing passes … which is the unreachable-gate class
// from the other side". The gate this probe measured **does not exist anywhere in the build**.
// Measured correctly: 20 of 20 admitted.
//
// So it now prints BOTH numbers side by side, because the gap between them is the thing that was
// missed and the thing most worth seeing: raw 5 against production 2 on the same sentence.
//
// Usage: pnpm exec tsx scripts/_probe-voice.ts <four-cells.json>

import { readFileSync } from "node:fs";
import { aiShapeOf, measureUtterance } from "../src/life/speech-record.js";
import { ADMISSIBLE_SHAPE } from "../src/life/her-own-voice.js";

/**
 * Copied from `her-own-voice.ts`, and the duplication is deliberate rather than lazy: if that set
 * changes and this one does not, the two numbers below stop agreeing and the disagreement is
 * visible in the output. A probe that imports its subject's logic cannot detect drift in it.
 */
const DELIVERY_SCALE = new Set(["S:monoblock", "S:embedded-question", "s:complex-sentence"]);

const path = process.argv[2];
if (!path) {
  console.error("  usage: pnpm exec tsx scripts/_probe-voice.ts <four-cells.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(path, "utf-8")) as Array<Record<string, unknown>>;
const tally = new Map<string, number>();
let admitted = 0;
let judged = 0;
const rawScores: number[] = [];
const voiceScores: number[] = [];

for (const r of rows) {
  const reply = String(r["reply"] ?? "").trim();
  if (reply.length === 0) continue;
  // A stored reply shorter than the one that was judged makes this unauditable, the harness used
  // to truncate at 300 characters and classify on the full text. Say so rather than average it in.
  const claimed = Number(r["replyChars"] ?? reply.length);
  const truncated = claimed > reply.length;

  const read = aiShapeOf(measureUtterance(reply), reply);
  const voice = read.fired
    .filter((f) => !DELIVERY_SCALE.has(f))
    .reduce((sum, f) => sum + (f.startsWith("S:") ? 2 : 1), 0);

  judged += 1;
  rawScores.push(read.score);
  voiceScores.push(voice);
  if (voice <= ADMISSIBLE_SHAPE) admitted += 1;
  for (const f of read.fired) tally.set(f, (tally.get(f) ?? 0) + 1);

  console.log(
    `  ${String(r["cell"]).slice(0, 20).padEnd(22)}#${String(r["run"])}`
    + `  raw ${String(read.score).padStart(2)}`
    + `  PRODUCTION ${String(voice).padStart(2)}`
    + `  ${voice <= ADMISSIBLE_SHAPE ? "ADMITTED" : "rejected"}`
    + `${truncated ? `   ⚠ stored ${reply.length} of ${claimed} chars — unauditable` : ""}`,
  );
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

console.log(`\n  bar ${ADMISSIBLE_SHAPE}`);
console.log(`  RAW score        median ${median(rawScores)}   <- what the first version of this probe measured`);
console.log(`  PRODUCTION score median ${median(voiceScores)}   <- what the gate actually compares`);
console.log(`  ADMITTED ${admitted}/${judged}`);
console.log(`\n  the three struck out before the comparison: ${[...DELIVERY_SCALE].join(", ")}`);
console.log("  (the breath dissolves those at the channel, so they are not voice tells)\n");
console.log("  which detectors fire, over her real replies:");
for (const [name, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  const struck = DELIVERY_SCALE.has(name) ? "  (struck out)" : "";
  console.log(`    ${String(n).padStart(3)}/${judged}  ${name}${struck}`);
}
