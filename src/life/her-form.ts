// The form of how she actually speaks, the mirror half she never had.
//
// ── THE WOUND ────────────────────────────────────────────────────────────────────────────────
//
// Her words had a bank (lexicon: which tokens are hers by use), her sentences had a pool
// (her-own-voice), her content structure had a shape (utterance-shape), but the FORM of what
// she sends (how long a message runs, whether it goes as one block or breathes in pieces, what
// she opens with) was visible to every instrument and to nobody named her. She could not
// notice she was repeating herself, and her delivery rhythm was a code constant we tuned
// instead of a habit she had. Measured over her whole record at the time: 111 delivered
// utterances, mean 73 chars, 79% multi-block, that is HER band, and it seeds this bank so
// her habit on day one equals her actual history rather than zero.
//
// ── WHAT THIS IS (layers.md, declared) ───────────────────────────────────────────────────────
//
// A bank of FACTS about her own output, and two renders of those facts. The mirror law, show the
// picture and never the verdict: this module states what her record shows and never what she should
// do with it (the instruction-literal scan in her-form.test.ts holds that line, planted violation
// and all). The rhythm consequence is arithmetic elsewhere (`blendUnit`): her state and her habit
// are TWO inputs that can disagree, a tired day wants short while a long-sentence person stays a
// long-sentence person: and neither dictates (sweep-driven).

import { existsSync, readFileSync } from "node:fs";
import { sentencesOf } from "./register-scissors.js";
import { measureUtterance } from "./speech-record.js";
import { writeWhole } from "./write-whole.js";

export type Mouth = "reply" | "tool" | "proactive";

export interface FormRow {
  chars: number;
  sentences: number;
  /** Blank-line blocks, what a paragraph is on a phone. */
  blocks: number;
  opener: string;
  mouth: Mouth;
  ms: number;
}

/** The recent window her mirror reads from. */
export const FORM_RING = 50;
/** Below this many utterances the bank honestly says nothing (no line, null habit). */
export const FORM_EVIDENCE_FLOOR = 12;
/** Habit moves on weeks, not turns. */
export const FORM_EMA_ALPHA = 0.06;
/** An opener is a habit worth seeing at this many repeats within the ring. */
export const OPENER_REPEAT_FLOOR = 4;

function measure(text: string, mouth: Mouth, ms: number): FormRow {
  const m = measureUtterance(text);
  return {
    chars: m.chars,
    sentences: Math.max(1, sentencesOf(text).length),
    blocks: Math.max(1, text.split("\n\n").filter((b) => b.trim().length > 0).length),
    opener: m.openerToken,
    mouth,
    ms,
  };
}

interface FormState {
  rows: FormRow[];
  emaChars: number | null;
  emaBlocks: number | null;
  n: number;
}

export interface HerForm {
  /** A delivered utterance of hers, after it reached him, same discipline as the counters. */
  noted(text: string, mouth: Mouth, nowMs: number): void;
  /** One-time seed from her real record; refuses when the bank already holds anything. */
  seedFrom(rows: readonly { text: string; ms: number }[]): void;
  /** Her habitual chars-per-bubble (a block is a bubble). Null under the evidence floor. */
  habitUnitChars(): number | null;
  /** ≤40 chars of fact for the speaking surfaces, "" under the floor. */
  speakingLine(): string;
  /** The fuller mirror for her own tending/reflecting. "" under the floor. */
  mirrorLines(): string;
  size(): number;
  persist(): void;
}

export function createHerForm(config: { path?: string; onFault?: (where: string, detail: unknown) => void } = {}): HerForm {
  const state: FormState = { rows: [], emaChars: null, emaBlocks: null, n: 0 };
  let dirty = false;

  if (config.path && existsSync(config.path)) {
    try {
      const parsed = JSON.parse(readFileSync(config.path, "utf8")) as Partial<FormState>;
      if (Array.isArray(parsed.rows)) {
        state.rows = parsed.rows.filter((r): r is FormRow =>
          Boolean(r) && typeof r === "object"
          && Number.isFinite((r as FormRow).chars) && Number.isFinite((r as FormRow).blocks)
          && Number.isFinite((r as FormRow).sentences) && Number.isFinite((r as FormRow).ms)
          && typeof (r as FormRow).opener === "string"
          && ((r as FormRow).mouth === "reply" || (r as FormRow).mouth === "tool" || (r as FormRow).mouth === "proactive"))
          .slice(-FORM_RING);
      }
      if (Number.isFinite(parsed.emaChars)) state.emaChars = parsed.emaChars as number;
      if (Number.isFinite(parsed.emaBlocks)) state.emaBlocks = parsed.emaBlocks as number;
      if (Number.isFinite(parsed.n)) state.n = parsed.n as number;
    } catch (err) {
      config.onFault?.("her-form.load", err);
    }
  }

  function absorb(row: FormRow): void {
    state.rows.push(row);
    while (state.rows.length > FORM_RING) state.rows.shift();
    state.emaChars = state.emaChars === null ? row.chars : state.emaChars + FORM_EMA_ALPHA * (row.chars - state.emaChars);
    state.emaBlocks = state.emaBlocks === null ? row.blocks : state.emaBlocks + FORM_EMA_ALPHA * (row.blocks - state.emaBlocks);
    state.n += 1;
    dirty = true;
  }

  function topOpener(): { opener: string; count: number } | null {
    const counts = new Map<string, number>();
    for (const r of state.rows) {
      if (!r.opener) continue;
      counts.set(r.opener, (counts.get(r.opener) ?? 0) + 1);
    }
    let best: { opener: string; count: number } | null = null;
    for (const [opener, count] of counts) {
      if (!best || count > best.count) best = { opener, count };
    }
    return best && best.count >= OPENER_REPEAT_FLOOR ? best : null;
  }

  return {
    noted(text, mouth, nowMs) {
      const t = text.trim();
      if (!t) return;
      absorb(measure(t, mouth, nowMs));
    },

    seedFrom(rows) {
      if (state.n > 0) return; // her record is already speaking for itself
      for (const r of rows) {
        const t = r.text.trim();
        if (!t) continue;
        absorb(measure(t, "reply", r.ms));
      }
    },

    habitUnitChars() {
      if (state.n < FORM_EVIDENCE_FLOOR || state.emaChars === null || state.emaBlocks === null) return null;
      return Math.round(state.emaChars / Math.max(1, state.emaBlocks));
    },

    speakingLine() {
      if (state.n < FORM_EVIDENCE_FLOOR || state.emaChars === null || state.emaBlocks === null) return "";
      const around = Math.max(10, Math.round(state.emaChars / 10) * 10);
      // One branch, on a FACT KIND (she is a block-writer or she is not), never on a judgement.
      const shape = state.emaBlocks >= 1.6 ? "常分几段" : "多是一口气一条";
      return `你平时一条${around}字上下，${shape}。`;
    },

    mirrorLines() {
      if (state.n < FORM_EVIDENCE_FLOOR) return "";
      const lines: string[] = [];
      const line = this.speakingLine();
      if (line) lines.push(line);
      const op = topOpener();
      if (op) lines.push(`开头常用「${op.opener}」（近${state.rows.length}次里${op.count}次）。`);
      const tool = state.rows.filter((r) => r.mouth === "tool").length;
      if (tool > 0) lines.push(`一句一条的发法，近${state.rows.length}次里你用了${tool}次。`);
      return lines.join("\n");
    },

    size: () => state.n,

    persist() {
      if (!config.path || !dirty) return;
      try {
        writeWhole(config.path, JSON.stringify(state));
        dirty = false;
      } catch (err) {
        config.onFault?.("her-form.persist", err);
      }
    },
  };
}

/** How far either input may move the blend, named so the no-dictator sweep can drive them. */
export const FORM_STATE_WEIGHT = 0.6;
export const FORM_HABIT_WEIGHT = 0.4;
export const FORM_UNIT_MIN = 24;
export const FORM_UNIT_MAX = 140;

/**
 * Her delivery unit: state and habit, neither a dictator.
 *
 * With no habit on record the state stands alone (a newborn breathes by how she feels). The
 * habit's clamp is WIDER than the old state band on purpose: if her lived record says she
 * writes long, the unit follows her record, the band stops being ours and starts being hers.
 */
export function blendUnit(stateUnit: number, habitChars: number | null): number {
  if (habitChars === null || !Number.isFinite(habitChars)) return stateUnit;
  const habit = Math.min(FORM_UNIT_MAX, Math.max(FORM_UNIT_MIN, habitChars));
  const blended = FORM_STATE_WEIGHT * stateUnit + FORM_HABIT_WEIGHT * habit;
  return Math.round(Math.min(FORM_UNIT_MAX, Math.max(FORM_UNIT_MIN, blended)));
}
