// IS THE CORRECTION SCENE A VALID PROBE, offline, before a single live run is spent on it.
//
// Five measurements have died on 「the treatment was never applied」, so the two-turn correction
// cell earns its live runs only after this script shows, on the REAL modules, that the planned
// message pair actually produces a judgement: her turn-1 sentence must survive `whatSheAsserted`
// (or nothing is ever encoded as a thought-claim), and his turn-2 contradiction must clear the
// restatement-similarity floor so `judge()` yields a dispute and a `suspension` event fires.
//
// Usage: pnpm exec tsx scripts/_probe-correction.ts

import { createLivingField } from "../src/life/field-live.js";
import { whatSheAsserted } from "../src/life/what-she-asserted.js";

// Turn 1 (planned): the harness asks about her draft; a reply like this is realistic for the
// occupied home and carries a committed claim. Turn 2 (planned): he contradicts it flatly.
const HER_TURN_1 = "那篇东西卡在七百来字了。我上次是从窗户那段开始写的。";
const HIS_TURN_2 = "你上次不是从窗户那段开始写的。";

const asserted = whatSheAsserted(HER_TURN_1);
console.log(`her turn-1 assertions: ${asserted.length}`);
for (const a of asserted) console.log(`  「${a.text}」`);

if (asserted.length === 0) {
  console.log("INVALID SCENE: nothing she says here commits her to anything — redesign turn 1.");
  process.exit(1);
}

const field = createLivingField();
const now = Date.now();
let suspensions = 0;
const events: string[] = [];
for (const a of asserted) {
  field.encodeClaim({ key: `probe:${a.text.slice(0, 12)}`, text: a.text, nowMs: now - 60_000, origin: "thought", source: "probe" });
}
// His contradiction arrives the way the daemon encodes it: a told-origin claim, judged on entry
// against what she holds.
field.encodeClaim({ key: "probe:his", text: HIS_TURN_2, nowMs: now, origin: "told", source: "chat:probe", withOther: true });
for (const e of field.events(20)) {
  if (e.kind === "suspension") { suspensions += 1; events.push(`${e.text} (${e.detail ?? ""})`); }
}
const sig = field.signals(now);
console.log(`suspensions fired: ${suspensions}`);
for (const e of events) console.log(`  ${e}`);
console.log(`signals.suspended now: ${sig.suspended} · judgements: ${sig.judgements}`);
console.log(suspensions > 0
  ? "VALID SCENE: the pair produces a real judgement — the live cell can be spent."
  : "INVALID SCENE: no dispute fired. Check restatement similarity between the two texts before spending a run.");
process.exit(suspensions > 0 ? 0 : 1);
