// THE SPINE: every moment of her life has ONE id, and every instrument writes it down.
//
// ── THE PROBLEM THIS SOLVES, MEASURED FIRST ──────────────────────────────────────────────────
//
// Eight streams watch her: ops.jsonl, faults.jsonl, conversation-log.jsonl, vitals.jsonl,
// history.jsonl, agency.jsonl, her field's event log, the snapshots, and before this file none
// of them shared a key. Each record carried its own timestamp and nothing else. Reconstructing
// "what happened in that moment" meant joining eight files by time window, and the join is not
// merely tedious, it is WRONG: her turns, her own moments, and the watchtower cycle interleave
// on the event loop, so two beats overlap in wall time and a fault stamped 14:03:07 belongs to
// either. Scattered instruments read like coverage until the night something breaks and no one
// can say which beat it broke in.
//
// ── WHY AsyncLocalStorage AND NOT A "CURRENT BEAT" VARIABLE ──────────────────────────────────
//
// The obvious build is a module-level `currentBeat` set at the top of each entry point. That is
// the same wrong build as the fixed-length source window in the alert guard: it works until the
// first interleave. A turn awaits the model; the watchtower cycle runs in the gap; a variable
// would tag the watchtower's faults with the TURN's id, mis-attribution manufactured by the
// instrument itself, which is worse than no attribution because it reads as evidence.
// `AsyncLocalStorage` carries the beat across awaits within its own async context and nowhere
// else. The interleave case is pinned in `beat.test.ts` with two concurrent beats.
//
// ── WHAT A BEAT IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────────
//
// A beat is one occasion of her running: a turn (he spoke), a moment (hers), the hourly life
// tick, a watchtower cycle, a maintenance sweep, a dream. The journal line it leaves carries her
// state at entry and at exit, so the FIRST question of any investigation, what did this beat do
// to her: is answered by the line itself, and every other stream's records carry the beat id so
// the SECOND question: what exactly happened inside, is one grep. This is an instrument: it
// lives beside her home with the other readings ABOUT her, she never reads it, and nothing in
// her behaviour depends on it.

import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type BeatKind =
  | "turn"        // he spoke; one whole conversation turn
  | "moment"      // a moment of her own (past the gate, refusals are not beats)
  | "tick"        // the daily life tick: diary, rest, consolidation
  | "watch"       // one watchtower cycle: the instrument's own beat, not hers
  | "maintenance" // disk upkeep, snapshots
  | "dream"       // one dream run
  | "heartbeat"   // one memory-heartbeat tick
  | "cron";       // one scheduled job firing

export interface Beat {
  id: string;
  kind: BeatKind;
  t0: number;
  /** Free annotations the beat's own code adds as it learns them (chatId, chose, …). */
  note: Record<string, unknown>;
}

const als = new AsyncLocalStorage<Beat>();
let seq = 0;

/** The beat this code is running inside, or undefined outside any beat (boot, shutdown, tests). */
export function currentBeat(): Beat | undefined {
  return als.getStore();
}

/**
 * Add facts to the running beat's journal line as they become known. A no-op outside a beat, so
 * shared code paths never need to care whether they were reached from inside one.
 */
export function annotateBeat(patch: Record<string, unknown>): void {
  const b = als.getStore();
  if (b) Object.assign(b.note, patch);
}

export interface BeatKeeper {
  /**
   * Run `fn` as one beat. The journal line is written when `fn` settles, resolve or reject,
   * and a rejection is journalled `ok: false` and RETHROWN unchanged: the spine observes, it
   * never absorbs.
   */
  inBeat<T>(kind: BeatKind, fn: () => Promise<T>): Promise<T>;
}

export function createBeatKeeper(opts: {
  journalPath: string;
  /** A small reading of her state, taken at entry and exit. Best-effort; null when unreadable. */
  snapshot?: () => unknown;
  /** Where a journal-write failure is reported. It must never be nowhere. */
  onFault?: (where: string, detail: unknown) => void;
  now?: () => number;
}): BeatKeeper {
  const now = opts.now ?? Date.now;
  try {
    const dir = dirname(opts.journalPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    opts.onFault?.("beat.journal.dir", err);
  }

  const read = (): unknown => {
    try { return opts.snapshot?.() ?? null; } catch { return null; }
  };

  function journal(line: Record<string, unknown>): void {
    try {
      appendFileSync(opts.journalPath, JSON.stringify(line) + "\n", "utf8");
    } catch (err) {
      // A spine that dies silently is the exact scattered-ness it exists to end.
      opts.onFault?.("beat.journal.write", err);
    }
  }

  return {
    async inBeat<T>(kind: BeatKind, fn: () => Promise<T>): Promise<T> {
      seq += 1;
      const t0 = now();
      const beat: Beat = { id: `${kind}:${t0}:${seq}`, kind, t0, note: {} };
      const state0 = read();
      try {
        const out = await als.run(beat, fn);
        journal({ id: beat.id, kind, t0, t1: now(), ok: true, state0, state1: read(), ...beat.note });
        return out;
      } catch (err) {
        journal({
          id: beat.id, kind, t0, t1: now(), ok: false,
          err: err instanceof Error ? (err.message || err.name).slice(0, 300) : String(err).slice(0, 300),
          state0, state1: read(), ...beat.note,
        });
        throw err;
      }
    },
  };
}
