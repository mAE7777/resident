// A seeded home is a FIELD, not a life. This is what turns it into one.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
//
// `seed-a-lived-in-home.ts` builds her associations, nodes, edges, events, the shape of forty-five
// days of thinking. What it does not build is her FILES: no word bank, no self-knowledge, no diary,
// no identity documents. Every drill that compares "before" against "after" therefore compares
// zero bytes to zero bytes for those, passes, and proves nothing.
//
// Both drills found this the same way, on their first run, through their own floors:
//
//   the recovery drill: reported PASSED while comparing an empty diary to an empty diary and a
//   zero-byte word bank to a zero-byte word bank.
//   the restart drill : reported four checks as NOT-PRESENT: themes, word bank, self-knowledge,
//   and the days she has written.
//
// The fix belongs in ONE place. Two copies of "complete the fixture" would drift, and the drift
// would be invisible: a drill whose fixture is thinner than it thinks does not fail, it passes.
//
// Everything here goes through the PRODUCTION writers. A fixture hand-written to the shape the
// reader expects proves the reader can read what the fixture writer wrote, which is a fact about
// the fixture. The diary cell learned this the hard way (its first version invented an ops-event
// shape that looks right and is not one, and the cell came back 0/1).

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLexicon } from "../src/life/lexicon.js";
import { createSelfKnowledge } from "../src/life/self-knowledge.js";
import { createSelfKnowledgeStore } from "../src/life/self-knowledge-store.js";
import { initWorkspace } from "../src/workspace/init.js";
import { createLogger } from "../src/utils/logger.js";
import { herDay, herDayBefore } from "../src/life/her-day.js";

export interface CompletedHome {
  /** What was actually written, so a drill can print its own fixture rather than assume it. */
  lexiconWords: number;
  insightsHeld: number;
  diaryDays: string[];
  opsLines: number;
}

/**
 * Give a seeded home the files a lived-in one would have.
 *
 * AWAITED, and that matters: the first version of the recovery drill called `initWorkspace`
 * without awaiting it, so `.git` appeared while the identity files were still being written and
 * the drill read a workspace with no SOUL.md in it. The floor caught it, which is the whole
 * argument for floors.
 */
export async function completeHome(home: string): Promise<CompletedHome> {
  const workspacePath = join(home, "workspace");
  await initWorkspace(workspacePath, createLogger("fixture"));

  // Her word bank, through the real lexicon: heard and spoken, with a real span behind them, so
  // ownership means something rather than being a file with the right name.
  const bank = createLexicon({ path: join(workspacePath, "life", "lexicon.json") });
  const longAgo = Date.now() - 60 * 24 * 3.6e6;
  const lately = Date.now() - 2 * 24 * 3.6e6;
  const words = ["渡轮", "窗户", "叶子", "植物", "开头", "目录", "余光", "潮气"];
  for (const w of words) {
    bank.heard(w, longAgo);
    bank.spoke(w, longAgo);
    bank.spoke(w, lately);
  }
  bank.persist();

  // What she has come to know about herself, through the real integrator, which REFUSES anything
  // citing evidence that does not exist, so the fixture cannot smuggle in a self she never earned.
  const skStore = createSelfKnowledgeStore(join(workspacePath, "life", "self-knowledge.json"));
  const sk = createSelfKnowledge({ store: skStore });
  const evidence = new Set(["m-101", "m-102", "m-117"]);
  const result = sk.integrate([
    { text: "我在事情还没定下来的时候话最少", evidence: ["m-101", "m-102"] },
    { text: "改开头这件事我会一直回去改", evidence: ["m-117"] },
  ], evidence, Date.now());
  if (result.added.length === 0) {
    throw new Error(`the fixture's self-knowledge was refused: ${JSON.stringify(result.rejected)}`);
  }
  skStore.save(sk.all());

  // Two written days, frozen the way her diary is frozen. Yesterday and the day before, by HER
  // day boundary: not by a UTC slice, or the catch-up loop would look for days that do not exist.
  const diaryDays = [herDayBefore(Date.now(), 2), herDayBefore(Date.now(), 1)];
  for (const day of diaryDays) {
    writeFileSync(join(workspacePath, "life", `${day}.md`),
      `今天把那篇又读了一遍，还是卡在同一个地方。\n\n渡轮那条线冬天会停，他说的。我记下来了。\n`, "utf-8");
  }

  // Her raw record, in the exact shape production writes, the shape `groupByDay` and
  // `reconsolidateDay` actually read, dated so it lands in a real closed day of hers.
  const opsPath = join(home, "ops.jsonl");
  const at = (day: string, hh: number): string => new Date(`${day}T${String(hh).padStart(2, "0")}:00:00`).toISOString();
  const yesterday = herDayBefore(Date.now(), 1);
  const opsLines = [
    `{"ts":"${at(yesterday, 9)}","event":"agent_start","pid":1}`,
    `{"ts":"${at(yesterday, 10)}","event":"session_start","chatId":1,"model":"x","messagePreview":"在吗"}`,
    `{"ts":"${at(yesterday, 15)}","event":"session_start","chatId":1,"model":"x","messagePreview":"那段还是不对"}`,
    `{"ts":"${at(herDay(), 8)}","event":"agent_start","pid":2}`,
  ];
  writeFileSync(opsPath, `${opsLines.join("\n")}\n`, "utf-8");

  if (!existsSync(join(workspacePath, "SOUL.md"))) {
    throw new Error("initWorkspace did not produce SOUL.md — the fixture is not a home");
  }

  return {
    lexiconWords: words.length,
    insightsHeld: sk.active().length,
    diaryDays,
    opsLines: opsLines.length,
  };
}
