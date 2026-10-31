// DOES A TASTE EXIST IN THE OCCUPIED SEED, AND DOES IT EVER DECIDE ANYTHING, the dark probe the
// register demanded before any taste cell may be built (an unmeasured p is defect class 19).
//
// Method, all real modules: seed the occupied home the harness uses, open its field, and run the
// REAL `chooseSubject` competition many times over independent streams. The taste term enters
// that competition through `likingFor`; the question is whether it ever CHANGES THE WINNER,
// measured by ablation impossibility, so instead we measure the observable: how often the chosen
// subject belongs to a theme at all, and what taste the field holds. If no theme with a real
// liking exists, the taste-steers-subject condition does not exist in this fixture, and the
// number here IS the register entry's evidence.
//
// Usage: pnpm exec tsx scripts/_probe-taste.ts

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createLivingField } from "../src/life/field-live.js";
import { createFieldStore } from "../src/life/field-store.js";
import { createDatabase } from "../src/db/sqlite.js";
import { createStream } from "../src/life/soft-choice.js";

const ROOT = new URL("..", import.meta.url).pathname;
// THE HOME THE SEEDER ACTUALLY MADE, read back from what it prints.
//
// The first version of this file passed a directory of its own as the seeder's first argument and
// then opened a database inside it. The seeder takes DAYS as that argument (`Number(argv[2])`) and
// mkdtemps its own home, so the path went in as `days = NaN`, nothing was ever written where this
// script was looking, and the field it measured was EMPTY. The probe then reported
// 「chooseSubject returns null 300/300」: a true statement about an empty field, published as
// evidence that taste has no condition to act in. Defect class 20 in a probe written to satisfy
// class 19. The number was wrong and the register entry built on it has been withdrawn.
const seeded = execFileSync("pnpm",
  ["exec", "tsx", "scripts/seed-a-lived-in-home.ts", "45", "--occupied", "--stranger"],
  { cwd: ROOT, encoding: "utf-8" });
const home = /(\/\S*resident-lived-in-\S+)/u.exec(seeded)?.[1];
if (home === undefined) throw new Error(`could not seed a home:\n${seeded}`);

const db = createDatabase(join(home, "data.db")).result;
const field = createLivingField({ store: createFieldStore(db) });
const now = Date.now();

const stats = field.stats();
console.log(`the field she is carrying: ${stats.nodes} things · themes ${stats.byKind.theme}`
  + ` · moments ${stats.byKind.moment} · questions ${stats.byKind.question}`);

const RUNS = 300;
const counts = new Map<string, number>();
let none = 0;
for (let i = 0; i < RUNS; i++) {
  const c = field.chooseSubject(now, createStream(9000 + i));
  if (c === null) { none += 1; continue; }
  const key = c.node.text.slice(0, 24);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`chooseSubject over ${RUNS} independent draws: null ${none}`);
for (const [text, n] of sorted.slice(0, 8)) console.log(`  ${(100 * n / RUNS).toFixed(1)}%  ${text}`);
console.log("\nreading: a taste can only steer a subject that belongs to a THEME with a liking");
console.log("attached. If the theme count above is 0, the condition for the taste cell does not");
console.log("exist in this fixture: that number goes into the register entry as the measured");
console.log("reason, and no cell is built until a home has lived long enough to grow one.");
