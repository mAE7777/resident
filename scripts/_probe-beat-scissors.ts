// COULD THE SCISSORS EMPTY A SECOND BEAT, the other half of the delivery question, offline.
//
// A live run kept producing rows that read chose=2, said=1: her state picks a second beat
// and he receives one message. Three things can produce that, and only one of them is a defect:
//
//   · the material path came back empty       , measured elsewhere: 99.4% of her replies snag
//     (`_probe-attend-replay.ts`)                something, so this is not it
//   · the model wrote nothing                 , HER LICENSE. The beat prompt says 「没有就什么都
//                                                别写」 and a beat she does not want is not a bug
//   · the scissors emptied what she wrote     , A DEFECT: an instrument eating her words
//
// The daemon separates the last two in its own log (`emptyBy: model | scissors`), and this bounds
// the third one WITHOUT a live run: run the register scissors over sentences of the shape a second
// beat actually takes: short, one thought, often a coda, and count how many come back empty.
//
// The corpus is hers: every sentence here is lifted from the golden live corpus (the clauses that
// FOLLOW a natural coda seam, which is exactly what a second beat would carry), never invented for
// the probe, because a probe fed invented text measures the inventor.
//
// PROBE, NOT PRODUCTION. No model calls; the scissors are the real ones.
//
// Usage: pnpm exec tsx scripts/_probe-beat-scissors.ts

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { trimRegister } from "../src/life/register-scissors.js";

const CORPUS = join(new URL("..", import.meta.url).pathname, "test/fixtures/live-runs");
const SEAM = /还有一句|还有一件|再说一句|对了[，,]|最后[，,]|顺便|另外[，,]/u;

/** Clauses that follow a coda seam in her real replies: the closest thing to a beat-2 corpus. */
function codaClauses(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(CORPUS).filter((n) => n.startsWith("four-cells-") && n.endsWith(".json"))) {
    for (const r of JSON.parse(readFileSync(join(CORPUS, f), "utf-8")) as Array<{ reply?: string }>) {
      for (const s of (r.reply ?? "").split(/[。！？\n]/u)) {
        const t = s.trim();
        if (t.length >= 6 && SEAM.test(t)) out.push(`${t}。`);
      }
    }
  }
  return [...new Set(out)];
}

// Her SHORTEST real sentences too: a second beat is one thought, and the shorter it is the more of
// it a cut takes. If anything is at risk of being emptied whole, it is these.
function shortestSentences(limit: number): string[] {
  const all = new Set<string>();
  for (const f of readdirSync(CORPUS).filter((n) => n.startsWith("four-cells-") && n.endsWith(".json"))) {
    for (const r of JSON.parse(readFileSync(join(CORPUS, f), "utf-8")) as Array<{ reply?: string }>) {
      for (const s of (r.reply ?? "").split(/[。！？\n]/u)) {
        const t = s.trim();
        if (t.length >= 4) all.add(`${t}。`);
      }
    }
  }
  return [...all].sort((a, b) => a.length - b.length).slice(0, limit);
}

function report(name: string, texts: string[]): void {
  let emptied = 0;
  let touched = 0;
  const examples: string[] = [];
  for (const t of texts) {
    const cut = trimRegister(t);
    if (cut.text.trim().length === 0) {
      emptied += 1;
      if (examples.length < 5) examples.push(`EMPTIED 「${t}」`);
    } else if (cut.text.trim() !== t.trim()) {
      touched += 1;
      if (examples.length < 5) examples.push(`trimmed 「${t}」 → 「${cut.text.trim()}」`);
    }
  }
  console.log("");
  console.log(`${name}: ${texts.length} sentences`);
  console.log(`  emptied whole (would read as emptyBy:scissors): ${emptied}`);
  console.log(`  altered but still speaking: ${touched}`);
  for (const e of examples) console.log(`    ${e}`);
}

report("her coda clauses (the beat-2-shaped ones)", codaClauses());
report("her 40 shortest sentences", shortestSentences(40));
console.log("");
console.log("reading: whatever share is emptied whole is the ceiling on how often a chosen beat can");
console.log("vanish into the instrument. The rest of any live chose>said gap is hers.");
