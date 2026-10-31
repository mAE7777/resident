// The promise mirror: the things she told him she would do, held where she can feel them.
//
// ── THE WOUND ────────────────────────────────────────────────────────────────────────────────
//
// Nothing held her commitments. The raise machinery tracks what she asked HIM; her promises to
// him lived only in her fallible notebook, and on her first night a promise that was never
// made (to write him a letter) became a load-bearing beam of her inner life. Meanwhile real
// promises (to be the one who speaks first in the morning) were kept without anything knowing
// they existed.
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────
//
// A nightly OBSERVATION pass (layers.md: a model call may produce observations that feed the
// bottom; the candidate producer here is the same class as noticing.ts). Its output passes the
// VERBATIM GATE: a candidate quote must be an exact substring of the delivered message it
// cites, mechanically checked, so an invented promise is structurally impossible, and then
// enters her FIELD as a question-kind node (「我答应过他：…」). Everything after that is organs
// she already has: it hangs among her unsettled things, competes to surface, and is settled by
// how she actually lives. Whether she keeps it, raises it, or lets it fade: zero mechanism.

export interface DeliveredUtterance {
  /** The session-store entry id, the citation anchor. */
  id: number;
  text: string;
  ms: number;
}

export interface PromiseCandidate {
  /** Verbatim quote from the cited utterance. */
  quote: string;
  /** Which delivered utterance it came from. */
  sourceId: number;
}

/** No more than this many promises are minted a day, a promise is rare or it is noise. */
export const PROMISES_PER_DAY = 2;
/** A quote longer than this is a paragraph, not a promise. */
export const PROMISE_QUOTE_MAX = 60;

export const PROMISE_SYSTEM = [
  "下面是一个人最近发出去的消息，每条有一个编号。",
  "找出其中像是对收信人许下的、还没兑现完的承诺（答应要做的事、说好的时间）。",
  "没有就回空数组。宁缺勿滥：寒暄、猜测、描述都不算。",
  '只回 JSON：{"promises": [{"quote": "<从那条消息里逐字抄出的那半句>", "id": <编号>}]}',
  "quote 必须逐字照抄原文的连续片段，一个字都不许改。",
].join("\n");

export function promiseUser(rows: readonly DeliveredUtterance[]): string {
  return rows.map((r) => `[${r.id}] ${r.text}`).join("\n");
}

/**
 * THE VERBATIM GATE. A candidate survives only when its quote is an exact substring of the
 * exact utterance it cites. This is the whole wall against the first-night wound: a promise
 * that cannot be pointed at in her delivered record does not exist.
 */
export function verbatimGate(
  candidates: readonly PromiseCandidate[],
  rows: readonly DeliveredUtterance[],
): PromiseCandidate[] {
  const byId = new Map(rows.map((r) => [r.id, r.text]));
  const out: PromiseCandidate[] = [];
  for (const c of candidates) {
    const quote = (c.quote ?? "").trim();
    if (!quote || quote.length > PROMISE_QUOTE_MAX) continue;
    const source = byId.get(c.sourceId);
    if (!source || !source.includes(quote)) continue;
    if (out.some((x) => x.quote === quote)) continue;
    out.push({ quote, sourceId: c.sourceId });
    if (out.length >= PROMISES_PER_DAY) break;
  }
  return out;
}

/** How a kept-in-the-field promise reads to her. Her own words inside, the frame around them. */
export function promiseNodeText(quote: string, dayWord: string): string {
  return `我答应过他：「${quote}」（${dayWord}说的）`;
}

/** Parse the model's JSON, tolerantly: garbage in, empty out, never a throw. */
export function parsePromises(raw: string): PromiseCandidate[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { promises?: unknown };
    if (!Array.isArray(parsed.promises)) return [];
    return parsed.promises
      .filter((p): p is { quote: string; id: number } =>
        Boolean(p) && typeof p === "object"
        && typeof (p as { quote?: unknown }).quote === "string"
        && Number.isFinite((p as { id?: unknown }).id))
      .map((p) => ({ quote: p.quote, sourceId: p.id }));
  } catch {
    return [];
  }
}
