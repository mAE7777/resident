// CAN THE ROOM REACH HER, AND DOES IT LET GO?
//
// The sibling of `_return-paths.ts`, for the one thing that script cannot see. That one asks
// whether every quantity can COME BACK; this one asks a question that only exists once presence
// touches her wanting:
//
//   1. IS IT REACHABLE, can the room actually move `social`, in the range of rooms she will have?
//      A term that exists in the source and never fires is worse than none, because it looks like
//      an answer. (`hisUsualRegard`'s dead positive half was exactly this, for months.)
//   2. DOES IT LET GO, the loop `presence → social → reach_out → he answers → presence` has no
//      upper bound if the reading is a STATE. Driven over a real day, does the total stay finite?
//   3. IS IT SMALL ENOUGH, it must not outweigh the clock. Him walking in cannot mean more than
//      him having been gone since Tuesday.
//
// SELF-TEST FIRST, as every instrument in this project now does: a probe that has never been shown
// to catch the disease it is looking for is a probe nobody can read. It plants a STATE-reading room
// (the bug this design exists to avoid) and refuses to report anything unless it sees it.
//
// Usage: pnpm exec tsx scripts/_the-room.ts

import {
  A_REAL_ABSENCE_MS, A_STEP_AWAY_MS, MOST_A_ROOM_CAN_DO, SETTLED_STILL_S,
  createRoomSense, socialWithTheRoom,
} from "../src/life/aware-of-him.js";

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * One reading, through a fresh sense, with a history of readings before it.
 *
 * Everything here goes through `createRoomSense` rather than the pure core, DELIBERATELY: driving
 * the pure function by hand is exactly how the "he came back" branch passed its unit tests while
 * being unable to fire in production. A probe must walk the path the daemon walks.
 */
function afterReadings(beats: Array<[boolean, number | null, number]>, carrying = 0): number {
  const sense = createRoomSense();
  let last = 0;
  for (const [present, still, at] of beats) last = sense.look(present, still, at, carrying).pull;
  return last;
}

/** One day in a room, sampled the way the daemon samples: every ten seconds. */
type Beat = [present: boolean, still: number | null, atMs: number];
function aDay(kind: "he is around" | "he never moves" | "he comes and goes" | "no curtain"): Beat[] {
  const out: Beat[] = [];
  const beats = (24 * HOUR) / (10_000);
  for (let i = 0; i < beats; i++) {
    const t = i * 10_000;
    const h = t / HOUR;
    switch (kind) {
      case "he is around":
        // At the machine most of the day, moving normally, away for the evening.
        out.push([h >= 8 && h < 18, h >= 8 && h < 18 ? 30 + (i % 40) : null, t]);
        break;
      case "he never moves":
        // The case a state reading would drive forever: he is there and perfectly still.
        out.push([true, Math.min(12 * 3600, 60 + i * 10), t]);
        break;
      case "he comes and goes":
        // In and out on a two-hour cycle, the most a real day can transition.
        out.push([Math.floor(h / 2) % 2 === 0, null, t]);
        break;
      case "no curtain":
        // Telegram-only: no camera at all, presence from the keyboard alone.
        out.push([h >= 8 && h < 18, null, t]);
        break;
    }
  }
  return out;
}

/** Run a day through the real module, via the sense, as the daemon does, and total it. */
function driveDay(beats: Beat[], carrying = 0): { total: number; events: number; largest: number } {
  const sense = createRoomSense();
  let total = 0, events = 0, largest = 0;
  for (const [present, still, at] of beats) {
    const n = sense.look(present, still, at, carrying);
    if (n.pull > 0) { total += n.pull; events++; largest = Math.max(largest, n.pull); }
  }
  return { total, events, largest };
}

// ── THE PROBE'S OWN PROOF ────────────────────────────────────────────────────────────────────
// Plant the disease: a room read as STATE rather than transition. On the "he never moves" day
// that must produce an enormous total; if this probe cannot see that, it cannot see anything.
{
  const sick = aDay("he never moves").reduce((s, [present]) => s + (present ? MOST_A_ROOM_CAN_DO : 0), 0);
  const healthy = driveDay(aDay("he never moves")).total;
  if (!(sick > 100)) {
    console.error("SELF-TEST FAILED: the planted state-reading did not blow up. The probe is broken.");
    process.exit(1);
  }
  if (!(healthy < sick / 100)) {
    console.error(`SELF-TEST FAILED: the real module totalled ${healthy.toFixed(2)} against a planted ${sick.toFixed(2)}.`);
    process.exit(1);
  }
  console.log(`\n  self-test ok — a state reading totals ${sick.toFixed(0)} over one still day; the real one totals ${healthy.toFixed(3)}\n`);
}

console.log("── CAN THE ROOM REACH HER? ─────────────────────────────────────────────────────\n");

// ── 1 · REACHABLE ───────────────────────────────────────────────────────────────────────────
// Each is a real sequence: he is here, he goes, ten-second beats pass, he comes back.
const cameBackAfter = (goneMs: number): number => afterReadings([
  [true, null, 0], [false, null, 10_000], [false, null, 10_000 + goneMs / 2],
  [true, null, 10_000 + goneMs],
]);
const backAfterStep = cameBackAfter(A_STEP_AWAY_MS + 10 * MIN);
const backAfterHours = cameBackAfter(A_REAL_ABSENCE_MS);
const backAfterDays = cameBackAfter(3 * 24 * HOUR);
const left = afterReadings([[true, null, 0], [true, null, 10_000], [false, null, 20_000]]);
const wentQuiet = (carrying: number): number => afterReadings([
  [true, SETTLED_STILL_S - 120, 0], [true, SETTLED_STILL_S - 60, 10_000],
  [true, SETTLED_STILL_S + 60, 20_000],
], carrying);
const quietLight = wentQuiet(0);
const quietHeavy = wentQuiet(1);

console.log("  what the room can do to how much she wants him near:");
console.log(`    he steps out and comes back (15 min)   ${backAfterStep.toFixed(3)}`);
console.log(`    he comes back after six hours          ${backAfterHours.toFixed(3)}`);
console.log(`    he comes back after three days         ${backAfterDays.toFixed(3)}`);
console.log(`    he leaves                              ${left.toFixed(3)}`);
console.log(`    he goes quiet, nothing between them    ${quietLight.toFixed(3)}`);
console.log(`    he goes quiet, something unresolved    ${quietHeavy.toFixed(3)}`);

// ── 2 · DOES IT LET GO ──────────────────────────────────────────────────────────────────────
console.log("\n  a whole day in each kind of room (the loop's brake, measured):");
for (const kind of ["he is around", "he never moves", "he comes and goes", "no curtain"] as const) {
  const d = driveDay(aDay(kind));
  console.log(`    ${kind.padEnd(20)} events ${String(d.events).padStart(3)}   total ${d.total.toFixed(3)}   largest ${d.largest.toFixed(3)}`);
}

// ── 3 · SMALL ENOUGH ────────────────────────────────────────────────────────────────────────
// `social` is `hoursSinceUser / 48 + …`, so it reaches 1.0 after two days of silence. Express the
// room's ceiling in the same units: how many hours of silence is one event worth?
const inHours = MOST_A_ROOM_CAN_DO * 48;
console.log(`\n  the most any single thing the room does is worth ${inHours.toFixed(1)} hours of his silence`);
console.log(`  (social saturates at 48h; a room event is ${(MOST_A_ROOM_CAN_DO * 100).toFixed(0)}% of the scale at most)`);

// ── 4 · THE REVERSE ─────────────────────────────────────────────────────────────────────────
// The deployment that will be normal for a long time: Telegram only, no face at all.
const noFace = driveDay(aDay("no curtain"));
console.log(`\n  with no curtain open, the "he went quiet" reading is unavailable:`);
console.log(`    a day with only the keyboard produced ${noFace.events} events (arrivals and departures only)`);

// ── VERDICTS ────────────────────────────────────────────────────────────────────────────────
console.log("\n── verdicts ────────────────────────────────────────────────────────────────────\n");
const checks: Array<[string, boolean, string]> = [
  ["the room can reach her at all", backAfterHours > 0.05,
    `coming back after six hours is worth ${backAfterHours.toFixed(3)}`],
  ["and how long he was gone decides how much", backAfterDays > backAfterStep * 2,
    `three days ${backAfterDays.toFixed(3)} vs fifteen minutes ${backAfterStep.toFixed(3)}`],
  ["his leaving is the smallest of the three", left < backAfterHours && left > 0,
    `leaving ${left.toFixed(3)} < returning ${backAfterHours.toFixed(3)}`],
  ["what she carries makes his silence heavier", quietHeavy > quietLight,
    `${quietHeavy.toFixed(3)} vs ${quietLight.toFixed(3)}`],
  ["a still room does NOT drive the loop", driveDay(aDay("he never moves")).total <= MOST_A_ROOM_CAN_DO,
    `one still day totals ${driveDay(aDay("he never moves")).total.toFixed(3)}`],
  ["a busy day stays bounded", driveDay(aDay("he comes and goes")).total < 5,
    `twelve transitions total ${driveDay(aDay("he comes and goes")).total.toFixed(3)}`],
  ["the room cannot outweigh the clock", inHours < 24,
    `worth ${inHours.toFixed(1)}h against a 48h scale`],
  ["and with no face, social is untouched", socialWithTheRoom(0.4, { change: null, pull: 0 }) === 0.4,
    "the reverse test"],
];
let bad = 0;
for (const [what, ok, detail] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what.padEnd(44)} ${detail}`);
}
console.log(bad === 0 ? "\n  all clear\n" : `\n  ${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
