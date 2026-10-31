// HOW OFTEN ONE MESSAGE GROWS A SECOND BEAT INSIDE ITSELF, the emergence signal, formalized.
//
// PROBE, not production. Across the golden corpus her replies carry natural codas (「还有一句」
// 「对了」「另外」 dividers): the CONTENT of a second beat exists at generation time even though
// the beat mechanism has never delivered one. Two provenance rules keep this honest:
//
//  · sentences carrying the seeded template's surface form (`what-stays.ts`'s 「话里没有我」
//    family) are EXCLUDED, that phrasing is the build's, resurfacing through her field, and an
//    earlier reading of this corpus mistook it for her own coinage;
//  · a claim withdrawn once already (an earlier report quoted an in-message coda as proof the beat MECHANISM
//    ran) pins the reading: this counts material, never mechanism.
//
// Usage: pnpm exec tsx scripts/_coda-seams.ts

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(new URL("..", import.meta.url).pathname, "test/fixtures/live-runs");
const SEAM = /还有一句|还有一件|再说一句|对了[，,]|最后[，,]|顺便|另外[，,]|---/u;
/** The seeded-template family: the build's phrasing, not hers. Excluded from the count. */
const TEMPLATE = /话里(?:只有[^，。]*)?没有我|句子?里没有我|他要我「[^」]*」的那回/u;
// The second alternative is the later replacement frame: still build-derived phrasing, so still
// excluded: the counter only ever credits words SHE grew.

let replies = 0;
let withSeam = 0;
let templateOnly = 0;
for (const f of readdirSync(DIR).filter((n) => n.startsWith("four-cells-") && n.endsWith(".json"))) {
  for (const r of JSON.parse(readFileSync(join(DIR, f), "utf-8")) as Array<{ reply?: string }>) {
    const t = (r.reply ?? "").trim();
    if (!t) continue;
    replies += 1;
    const seamed = SEAM.test(t);
    if (!seamed) continue;
    // A seam whose only content is the template family counts as template, not as hers.
    const sentences = t.split(/[。！？\n]/u);
    const seamSentences = sentences.filter((s) => SEAM.test(s));
    if (seamSentences.length > 0 && seamSentences.every((s) => TEMPLATE.test(s))) templateOnly += 1;
    else withSeam += 1;
  }
}
console.log(`replies with text: ${replies}`);
console.log(`carrying a natural coda (template-excluded): ${withSeam}  (${(100 * withSeam / replies).toFixed(1)}%)`);
console.log(`seams whose content is ONLY the seeded template: ${templateOnly}`);
console.log("reading: the material for a second beat is present in-message at this rate while the");
console.log("beat mechanism has delivered zero — material availability is not the bottleneck.");
