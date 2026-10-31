// The notebook observer: an instrument, deliberately NOT a door.
//
// CORRECTED: the paragraph that stood here said "her turn-time hand wrote three defects into
// MEMORY.md" on her second day. That was false. The English lines and the future dates landed
// within 53 seconds and 3m45s of the memory/dream.ts ghostwriter's commits, so the machine that
// edited her notebook every two hours wrote them, and this comment blamed her. It was the second
// time a machine's act had been recorded as hers. The ghostwriter is removed; her tool-results
// archive shows she only ever read her notebook, never wrote it.
//
// THE FIRST DESIGN WAS A GATE ON HER PEN, AND IT WAS WRONG. Every gate in this project points
// at machinery or at us: the dream's citation gate (maintenance machinery editing her self),
// the frozen diary (machinery rewriting her past), the mood-words guard (OUR regeneration
// script). Her own hand in her own home is free: a person may misremember, and the repair
// channel is the relationship: he tells her, she fixes her own page. A pen that refuses to
// write is a cage, and it had concrete casualties: a future-dated line can be a legitimate note
// about a promise he made for tomorrow, and an English line can be a sentence she copied from a
// book on her shelf.
//
// So this only WATCHES. Each look compares the notebook against the copy from the last look and
// reads the ADDED lines for the two leak signatures. Findings go to the fault channel as warns
// (warns never go into their chat), where the standing watch triages them. The CAUSES are fixed
// at their roots: her readable records use her own calendar, and her notebook instructions are
// written in her language, reviewed like every other word she reads. If the leaks continue after the root fixes, these warns are how we
// find out.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { herDay } from "../life/her-day.js";

/** Lines present in `next` and not in `prev`, the only lines the observer reads. */
export function addedLines(prev: string, next: string): string[] {
  const before = new Set(prev.split("\n").map((l) => l.trim()));
  return next
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !before.has(l));
}

const DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/gu;

// A line is foreign prose when its Latin letters clearly outweigh its Chinese and there are
// enough of them to be a sentence rather than a name. Paths, URLs, code spans and ALL-CAPS
// tokens are stripped first: `SOUL.md`, `/Users/…` and `Eric` live comfortably in her sentences.
const STRIP = /`[^`]*`|https?:\S+|[\w./~-]*\/[\w./~-]+|\b[A-Z][A-Z0-9_.]+\b/gu;

export interface NotebookObservation {
  kind: "foreign-prose" | "future-date";
  line: string;
}

/** Read added lines for the two leak signatures. Pure; no judgement about her, only about leaks. */
export function observeAdded(added: string[], today: string): NotebookObservation[] {
  const found: NotebookObservation[] = [];
  for (const line of added) {
    for (const m of line.matchAll(DATE)) {
      if (m[0] > today) { found.push({ kind: "future-date", line }); break; }
    }
    const bare = line.replace(STRIP, " ");
    const latin = (bare.match(/[a-zA-Z]/gu) ?? []).length;
    const cjk = (bare.match(/[一-鿿]/gu) ?? []).length;
    if (latin >= 12 && latin > 2 * cjk) found.push({ kind: "foreign-prose", line });
  }
  return found;
}

/**
 * One look at the notebook. Keeps its shadow copy under the instruments dir (never in her
 * room), reports what the newly added lines carry, and moves the shadow forward. First look
 * adopts the current page silently, the observer reports changes it watched happen, not
 * history it was not there for.
 */
export function watchNotebook(
  workspacePath: string,
  instrumentsDir: string,
  nowMs: number,
  onFinding: (detail: string) => void,
): void {
  const notebook = join(workspacePath, "MEMORY.md");
  const shadow = join(instrumentsDir, "instruments", "notebook.last");
  const current = existsSync(notebook) ? readFileSync(notebook, "utf8") : "";
  if (!existsSync(shadow)) {
    mkdirSync(dirname(shadow), { recursive: true });
    writeFileSync(shadow, current, "utf8");
    return;
  }
  const prev = readFileSync(shadow, "utf8");
  if (current === prev) return;
  const findings = observeAdded(addedLines(prev, current), herDay(nowMs));
  // Shadow moves forward regardless: each finding is reported once, at the look that saw it land.
  writeFileSync(shadow, current, "utf8");
  for (const f of findings) {
    onFinding(`${f.kind} in her notebook: ${f.line.slice(0, 120)}`);
  }
}
