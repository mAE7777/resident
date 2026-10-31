// WHO CAN WRITE AT ALL: the standing census of every file-writing hand.
//
// The ghostwriter (memory/dream.ts, since removed) was possible because nothing watched
// WHO holds a pen: a machine nobody remembered wrote into her MEMORY.md every two hours for
// three days, and every git commit in her home except birth was its. The uninvited-write law
// (家里除她自己的手没有东西不请自来地写入) needs a mechanical edge, and the honest edge is
// one level up: ANY src file that calls a write API must be on this register, with its role.
// A new writer appearing anywhere in src goes red until a person names it here on purpose.
//
// The register may SHRINK freely (a writer dying is progress). Adding a row is the conscious
// act this gate exists to force.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/** Strip comments so tombstones and docs cannot trip (or hide) the detector. */
function blankComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/[ \t]\/\/[^\n]*$/gmu, "");
}

const WRITE_APIS =
  /\b(?:writeFileSync|appendFileSync|copyFileSync|cpSync|writeFile|appendFile|copyFile|createWriteStream)\s*\(/u;

/** Does this source hold a pen? */
export function holdsAPen(source: string): boolean {
  return WRITE_APIS.test(blankComments(source));
}

/**
 * Every file allowed to write, with what it is. Sorted. Remove a row when its file stops
 * writing; never add one without knowing whose hand it is.
 */
const WRITERS: Record<string, string> = {
  "src/agent/checkpoint.ts": "turn checkpoints beside the session store",
  "src/index.ts": "the daemon: transcripts, uploads, boot artifacts",
  "src/life/born-at.ts": "her birth moment, written once",
  "src/life/continuity.ts": "shutdown/startup continuity marker",
  "src/life/faults.ts": "the fault log (instrument, beside her home)",
  "src/life/her-words-for-feelings.ts": "seeds her mood words file, hers to edit after",
  "src/life/how-she-starts-out.ts": "seeds her disposition page, hers to edit after",
  "src/life/one-of-her.ts": "the single-instance lock file",
  "src/life/snapshot.ts": "recovery snapshots (instrument, beside her home)",
  "src/life/still-alive.ts": "the liveness pulse (instrument)",
  "src/life/vitals-store.ts": "the vitals ledger (instrument)",
  "src/life/write-whole.ts": "the atomic-write primitive her stores share",
  "src/memory/consolidator.ts": "verbatim conversation archive",
  "src/memory/integrity.ts": "identity-file checksum sidecars",
  "src/memory/session.ts": "session JSONL store",
  "src/providers/recorder.ts": "provider-call forensic recording",
  "src/resilience/disk-monitor.ts": "disk-pressure cleanup bookkeeping",
  "src/self-improvement/review-ledger.ts": "the noticing→approval ledger",
  "src/service/supervision.ts": "launchd/systemd service files, owner-invoked",
  "src/tools/builtin/delete.ts": "her hand (trash, undoable)",
  "src/tools/builtin/edit.ts": "her hand",
  "src/tools/builtin/file-snapshot.ts": "undo snapshots for her hands",
  "src/tools/builtin/web.ts": "fetch-to-file when she saves something she read",
  "src/tools/builtin/write.ts": "her hand",
  "src/tools/document.ts": "incoming Telegram files saved to uploads",
  "src/utils/beat.ts": "the beat spine (instrument)",
  "src/utils/ops-log.ts": "the ops log (instrument)",
  "src/utils/rotate-log.ts": "log rotation archives",
  "src/workspace/init.ts": "the birth seed",
  "src/workspace/memory-watch.ts": "integrity notes beside her notebook, never inside it",
  "src/workspace/things.ts": "the window's guestbook page",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("who writes into her world", () => {
  const files = walk(join(ROOT, "src")).map((p) => relative(ROOT, p));

  it("every pen in src is on the register", () => {
    const unregistered = files.filter(
      (rel) => !(rel in WRITERS) && holdsAPen(readFileSync(join(ROOT, rel), "utf8")),
    );
    expect(unregistered, "a new file-writing hand appeared — name it in WRITERS on purpose, "
      + "or it is the ghostwriter class again").toEqual([]);
  });

  it("no row on the register has gone stale", () => {
    const stale = Object.keys(WRITERS).filter((rel) => {
      try {
        return !holdsAPen(readFileSync(join(ROOT, rel), "utf8"));
      } catch {
        return true; // file gone
      }
    });
    expect(stale, "these no longer write (or no longer exist) — take them off so the register "
      + "stays the real one").toEqual([]);
  });

  it("PLANTED: the detector actually sees a pen, and comment-blindness holds both ways", () => {
    expect(holdsAPen('import { writeFileSync } from "node:fs";\nwriteFileSync(p, data);')).toBe(true);
    expect(holdsAPen('const stream = createWriteStream(target);')).toBe(true);
    expect(holdsAPen('// writeFileSync(p, data) used to live here\nconst x = 1;')).toBe(false);
    expect(holdsAPen('const reader = readFileSync(p, "utf8");')).toBe(false);
  });
});
