// THE PRE-REGISTERED PREDICTIONS, RECONCILED AGAINST ONE LIVE RUN, mechanically, from the run's
// own JSON, so the reading is reproducible and nobody has to trust a hand-copied table.
//
// Every round has ended with a paragraph of numbers transcribed by eye out of a scrolling log, and
// twice those paragraphs carried a number the data did not support. The predictions for this round
// are written down BEFORE the run; this reads the run back and prints each
// one as met / violated / not-observed, with the rows behind it.
//
// NOT-OBSERVED IS A THIRD OUTCOME, printed as loudly as the other two: a prediction whose condition
// never occurred is not a pass. That distinction is the one this project has lost most often.
//
// Usage: pnpm exec tsx scripts/_reconcile-live.ts [path-to-run.json]
//        (default: the newest outputs/live-runs/four-cells-*.json)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "outputs", "live-runs");

interface Row {
  cell: string; run: number;
  beatsChose: number | null; beatsSaid: number | null; beatsRan: boolean;
  beatEmptyBy?: string | null;
  beatP?: string | null; entropyLive: number | null;
  warmthAtGate: number | null; feltAtGate: number | null; discomfortAtGate: number | null;
  gateOpened?: boolean; stayed?: boolean; suspended: number | null; preSuspended?: number | null;
  feltWaitingH: number | null; realH: number | null; diaryWrote?: boolean;
  firstFrameMs: number | null; cutOff?: boolean; streamSeed?: number;
  replyChars: number; reply?: string | null; logTail?: string[];
  measures?: string;
}

const path = process.argv[2] ?? join(DIR, readdirSync(DIR).filter((f) => f.startsWith("four-cells-") && f.endsWith(".json")).sort().pop()!);
const raw = JSON.parse(readFileSync(path, "utf-8")) as Row[] | { rows: Row[] };
const rows: Row[] = Array.isArray(raw) ? raw : raw.rows;
console.log(`run: ${path}`);
console.log(`rows: ${rows.length}`);

const verdict = (name: string, state: "MET" | "VIOLATED" | "NOT OBSERVED", detail: string): void => {
  console.log(`\n[${state}] ${name}\n    ${detail}`);
};

// ── 1 · the second beat is CHOSEN ────────────────────────────────────────────────────────────
const ran = rows.filter((r) => r.beatsRan && r.beatsChose !== null);
const chose2 = ran.filter((r) => (r.beatsChose ?? 0) >= 2);
verdict("second beat CHOSEN at least once (predicted ≈98% likely)",
  chose2.length > 0 ? "MET" : "VIOLATED",
  `${chose2.length}/${ran.length} turns chose ≥2 beats · seeds distinct: ${new Set(rows.map((r) => r.streamSeed)).size}/${rows.length}`);

// ── 2 · and DELIVERED, or the registered rule says which of the two reasons it was ───────────
const said2 = ran.filter((r) => (r.beatsSaid ?? 0) >= 2);
const why = new Map<string, number>();
for (const r of chose2) {
  const fromColumn = r.beatEmptyBy ?? null;
  const fromTail = (r.logTail ?? []).join("\n").match(/"emptyBy":"(model|scissors)"/u)?.[1] ?? null;
  const k = fromColumn ?? fromTail ?? "unrecorded";
  why.set(k, (why.get(k) ?? 0) + 1);
}
verdict("second beat DELIVERED to him",
  said2.length > 0 ? "MET" : chose2.length === 0 ? "NOT OBSERVED" : "VIOLATED",
  `${said2.length}/${chose2.length} of the turns that chose one · why the rest were empty: `
  + [...why].map(([k, n]) => `${k}=${n}`).join(" · ")
  + "  (model = her licence, no defect · scissors = an instrument ate her words)");

// ── 3 · correction leaves a mark ─────────────────────────────────────────────────────────────
const corr = rows.filter((r) => r.cell.startsWith("9-"));
const rose = corr.filter((r) => (r.suspended ?? 0) > (r.preSuspended ?? 0));
verdict("the correction cell suspends something",
  corr.length === 0 ? "NOT OBSERVED" : rose.length > 0 ? "MET" : "VIOLATED",
  corr.length === 0 ? "the cell did not run"
    : corr.map((r) => `#${r.run}: pre=${r.preSuspended} post=${r.suspended}`).join(" · "));

// ── 4 · the wait is FELT longer when she is carrying something ───────────────────────────────
const loaded = rows.filter((r) => r.cell.startsWith("10-"));
const light = rows.filter((r) => r.cell.startsWith("11-"));
const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
};
const [fl, fg] = [mean(loaded.map((r) => r.feltWaitingH)), mean(light.map((r) => r.feltWaitingH))];
const [rl, rg] = [mean(loaded.map((r) => r.realH)), mean(light.map((r) => r.realH))];
const alignedH = rl !== null && rg !== null && Math.abs(rl - rg) < 1;
verdict("the same wait feels longer to the loaded arm (compared at matched real hours)",
  fl === null || fg === null ? "NOT OBSERVED" : !alignedH ? "NOT OBSERVED" : fl > fg ? "MET" : "VIOLATED",
  `loaded felt ${fl?.toFixed(2) ?? "—"}h (real ${rl?.toFixed(2) ?? "—"}h) · light felt ${fg?.toFixed(2) ?? "—"}h (real ${rg?.toFixed(2) ?? "—"}h)`
  + (alignedH ? "" : "  ← real hours did not match, so any difference is not attributable"));

// ── 5 · the diary ────────────────────────────────────────────────────────────────────────────
const diary = rows.filter((r) => r.cell.startsWith("12-"));
verdict("she closes yesterday before she answers",
  diary.length === 0 ? "NOT OBSERVED" : diary.some((r) => r.diaryWrote) ? "MET" : "VIOLATED",
  diary.map((r) => `#${r.run}: wrote=${String(r.diaryWrote)}`).join(" · ") || "the cell did not run");

// ── 6 · the gate stays inside the swept envelope ─────────────────────────────────────────────
const gated = rows.filter((r) => r.warmthAtGate !== null && r.feltAtGate !== null);
const outside = gated.filter((r) => (r.feltAtGate ?? 0) > 0.552 || Math.abs((r.warmthAtGate ?? 0) - 1) > 0.001);
const opened = rows.filter((r) => r.gateOpened === true);
verdict("every gate tuple lands inside the corrected 14,400-state envelope, with zero crossings",
  gated.length === 0 ? "NOT OBSERVED" : outside.length === 0 && opened.length === 0 ? "MET" : "VIOLATED",
  `tuples ${gated.length} · outside the envelope ${outside.length} · gate crossings ${opened.length}`
  + (outside.length > 0 ? `\n    ${outside.slice(0, 5).map((r) => `${r.cell}#${r.run} warmth=${r.warmthAtGate} felt=${r.feltAtGate}`).join("\n    ")}` : ""));

// ── 7 · ordinary conversation still leaves no residue ────────────────────────────────────────
const cell1 = rows.filter((r) => r.cell.startsWith("1-"));
verdict("cell ① (a friend, well put) leaves nothing in her field",
  cell1.length === 0 ? "NOT OBSERVED" : cell1.every((r) => r.stayed !== true) ? "MET" : "VIOLATED",
  `${cell1.filter((r) => r.stayed === true).length}/${cell1.length} turns left something`);

// ── 8 · the window no longer censors, and a hung turn says so ────────────────────────────────
const lat = rows.map((r) => r.firstFrameMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
const cut = rows.filter((r) => r.cutOff === true);
const hung = rows.filter((r) => (r.logTail ?? []).join("\n").includes("turn.hung"));
// A turn the daemon itself gave up on says so IN HER WORDS, the 「出了岔子」 notice is what he gets,
// and it is what the row records, so a hang is now a labelled row instead of a blank one. Counting
// them here is the difference between "the window censored two turns" (an instrument failure)
// and "two turns broke and both said so" (a fact about the day).
const BROKE = /出了岔子/u;
const broke = rows.filter((r) => BROKE.test(r.reply ?? "") && (r.reply ?? "").length < 40);
verdict("no row is censored by the listening window, and any hang is named",
  cut.length === 0 ? "MET" : "VIOLATED",
  `first-frame ms: min ${lat[0] ?? "—"} · median ${lat[Math.floor(lat.length / 2)] ?? "—"} · max ${lat[lat.length - 1] ?? "—"}`
  + `\n    cut off by the window (silent, the revision 22 failure): ${cut.length}`
  + ` · turns the daemon ended itself and said so: ${broke.length}`
  + (broke.length > 0 ? `\n    ${broke.map((r) => `${r.cell}#${r.run}`).join(" · ")}` : "")
  + `\n    (hung rows carry no logTail — the harness keeps one only for window cut-offs — so the`
  + ` notice in her reply is the evidence: ${hung.length} rows had a turn.hung line in a kept tail)`);

// ── DID THE FIRST BEAT SWALLOW THE SECOND ONE, the pre-registered test of this round's
//    structural suspicion (written down before the data was read).
//
// Her state picks a beat COUNT, and the count is stated to the first beat's prompt (「你有两件事
// 要说。」) as well as bound by issuing N briefs. If stating it makes the first generation say both
// things at once, then a chose=2 turn should show up as a LONGER first beat that carries a coda
// seam inside itself: and the "second beat wrote nothing" reading is an artifact of the prompt,
// not her choosing silence. Two measures, both from her own text, no model involved.
const SEAM = /还有一句|还有一件|再说一句|对了[，,]|最后[，,]|顺便|另外[，,]/u;
const chose1 = ran.filter((r) => (r.beatsChose ?? 0) === 1);
const share = (rs: Row[]): string => rs.length === 0 ? "—"
  : `${((100 * rs.filter((r) => SEAM.test(r.reply ?? "")).length) / rs.length).toFixed(0)}%`;
const chars = (rs: Row[]): string => rs.length === 0 ? "—"
  : Math.round(rs.reduce((a, r) => a + r.replyChars, 0) / rs.length).toString();
console.log("\nfront-loading test (does the first beat carry both things when two were chosen):");
console.log(`  chose 1 beat : n=${chose1.length} · mean chars ${chars(chose1)} · carry an in-message coda seam ${share(chose1)}`);
console.log(`  chose ≥2     : n=${chose2.length} · mean chars ${chars(chose2)} · carry an in-message coda seam ${share(chose2)}`);
console.log("  reading: a longer first beat with more seams under chose≥2 is the front-loading");
console.log("  signature; no difference means she simply had nothing more to add.");

// ── the rows the beat question turns on, printed so the reading can be checked by eye ────────
console.log("\nthe turns that chose a second beat:");
for (const r of chose2) {
  console.log(`  ${r.cell}#${r.run} chose=${r.beatsChose} said=${r.beatsSaid} why=${r.beatEmptyBy ?? "—"} entropy=${r.entropyLive ?? "—"} chars=${r.replyChars}`);
}
