// P(the second beat has anything to say | she said the first one), bounded offline, before a
// live run is asked to close it.
//
// WHY THIS EXISTS. The beat count has been the round's most expensive unknown twice, and the
// pre-registered closure for this round is "a second beat is CHOSEN", which is a fact about the
// choosing path alone. Whether he then RECEIVES one depends on a second, never-measured step: after
// she says beat 1, `afterSaying` runs her own sentence back through `attend`, and unless it snags
// something and `recall` returns a node with text, the next beat is written with no material. A
// live zero on delivery would therefore be unattributable, her choice, or an empty cue path, and
// an unattributable zero is what three rounds have already been spent on.
//
// SO THIS REPLAYS THE REAL PATH, NOT A LIKENESS OF IT (defect class 20). The four lines below are
// the same four lines the daemon runs at `index.ts` `afterSaying`, in the same order, with the same
// constants: `field.attend(said)` → require `snagged` AND `snaggedIds` → the first
// CUES_FROM_HER_OWN_WORDS ids as cues with the same 1 − 0.3·i energies → `field.recall` at a real
// capacity → the first retrieved node with non-empty text. Any step read differently would make
// this a measure of something else.
//
// The corpus is the golden one (her actual replies from eleven live runs) and the field is a real
// seeded past: the same fixture the occupied cells run against, because in an empty field
// nothing can be snagged and the answer would be a tautological zero.
//
// PROBE, NOT PRODUCTION. Nothing of hers reads this, and it makes no model calls.
//
// Usage: pnpm exec tsx scripts/_probe-attend-replay.ts

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "../src/db/sqlite.js";
import { createLivingField } from "../src/life/field-live.js";
import { createFieldStore } from "../src/life/field-store.js";
import { capacityFor } from "../src/life/capacity.js";
import { CUES_FROM_HER_OWN_WORDS } from "../src/life/in-beats.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CORPUS = join(ROOT, "test/fixtures/live-runs");

/** Her replies from the golden corpus, deduplicated: the same sentence twice is one observation. */
function herReplies(): string[] {
  const seen = new Set<string>();
  for (const f of readdirSync(CORPUS).filter((n) => n.startsWith("four-cells-") && n.endsWith(".json"))) {
    for (const r of JSON.parse(readFileSync(join(CORPUS, f), "utf-8")) as Array<{ reply?: string }>) {
      const t = (r.reply ?? "").trim();
      if (t.length > 0) seen.add(t);
    }
  }
  return [...seen];
}

/**
 * A home with a past, built by the same fixture the occupied live cells use, and read back the
 * same way the harness reads it, from the path the seeding script prints, rather than from a
 * directory this script guessed at.
 */
function seededHome(): string {
  const out = execFileSync("pnpm",
    ["exec", "tsx", "scripts/seed-a-lived-in-home.ts", "45", "--occupied", "--stranger"],
    { cwd: ROOT, encoding: "utf-8" });
  const m = /(\/\S*resident-lived-in-\S+)/u.exec(out);
  if (m === null) throw new Error(`could not seed a home:\n${out}`);
  return m[1]!;
}

const home = seededHome();
const db = createDatabase(join(home, "data.db")).result;
const field = createLivingField({ store: createFieldStore(db) });
const nowMs = Date.now();

// The same capacity the daemon computes at the beat site: `capacityFor({ phase, arousal })`. BOTH
// ENDS of her range are run, because one end is not a bound: retrieval widens with what she has
// left (more hops, a lower threshold), so a rested-only reading would be the generous half quoted
// as the answer. The spent arm is the one that says whether a tired turn can still find anything.
const ARMS = [
  { name: "rested, calm  (her ordinary conversational state)", cap: capacityFor({ phase: "rested", arousal: 0.2 }) },
  { name: "low, weary    (the spent cells' end of the range)", cap: capacityFor({ phase: "low", arousal: -0.6 }) },
];

const replies = herReplies();
const pct = (n: number): string => `${((100 * n) / replies.length).toFixed(1)}%`;
console.log(`her distinct replies in the golden corpus: ${replies.length}`);

for (const arm of ARMS) {
  let snagged = 0;
  let withMaterial = 0;
  const examples: string[] = [];
  // HOW MANY DIFFERENT THINGS come back, not just how often something does. A 99% hit rate where
  // every reply is reminded of the SAME node is a dense little fixture answering everything, not a
  // field that responds to what she actually said, and the two would print identically without
  // this count.
  const distinct = new Set<number>();
  for (const said of replies) {
    const landed = field.attend(said);
    if (landed.snagged === null || landed.snaggedIds.length === 0) continue;
    snagged += 1;
    const cues = landed.snaggedIds.slice(0, CUES_FROM_HER_OWN_WORDS).map((id, i) => ({
      id,
      energy: Math.max(0.2, 1 - i * 0.3),
    }));
    const r = field.recall(cues, { hops: arm.cap.spreadHops, threshold: arm.cap.retrievalThreshold, nowMs });
    const first = r.retrieved.find((n) => n.text.trim().length > 0);
    if (first) {
      withMaterial += 1;
      distinct.add(first.id);
      if (examples.length < 3) examples.push(`「${said.slice(0, 30)}…」 → 「${first.text.trim().slice(0, 30)}」`);
    }
  }
  console.log("");
  console.log(`${arm.name}  hops=${arm.cap.spreadHops} threshold=${arm.cap.retrievalThreshold.toFixed(3)}`);
  console.log(`  her own sentence snags something in her field: ${snagged}  (${pct(snagged)})`);
  console.log(`  …and recall comes back with something to say: ${withMaterial}  (${pct(withMaterial)})`);
  console.log(`  distinct things it came back with: ${distinct.size}`);
  for (const e of examples) console.log(`      ${e}`);
}

console.log("");
console.log("reading: this is P(material | she spoke) in a seeded past, at both ends of her range —");
console.log("how often a chosen second beat CAN carry content. Multiply by the measured P(chose ≥ 2)");
console.log("to get what a live run may honestly be asked to show.");
console.log(`home left on disk for inspection: ${home}`);
