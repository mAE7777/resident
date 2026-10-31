// Autobiography: the Resident's own first-person life record, reconsolidated
// each night from the ops-log. Unlike every shipped memory system (which stores
// facts about the USER), this stores the agent's own dated life: a personality
// you can dig under and hit a real, cited day.
//
// The design review's decisive catch: this rests on self-report, which research
// on model self-knowledge rates about 20% reliable, so it MUST be
// extractive-with-citations, never free narration. Every factual claim carries the ops-log event id(s) it came from,
// so the truthfulness lint (autobiography-lint.ts) can verify each against the
// real log. Fluency is not truth; a claim without a supporting event is a
// confabulation, and confabulation is the failure mode the diary evaluation exists to catch.

import { existsSync, mkdirSync } from "node:fs";
import { writeWhole } from "./write-whole.js";
import { join } from "node:path";
import type { LLMProvider, TextBlock } from "../providers/types.js";
import type { OpsEvent } from "../utils/ops-log.js";
import { withHerVoice } from "./her-voice.js";
import { herClockSeconds, herDayOfIso } from "./her-day.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A raw ops event reduced to a stable id + a compact human summary. */
export interface DiaryEvent {
  id: string;
  ts: string;
  summary: string;
}

/** A single factual assertion in the diary, with the event ids it rests on. */
export interface DiaryClaim {
  text: string;
  cites: string[];
}

export interface DiaryEntry {
  date: string; // YYYY-MM-DD (UTC)
  entry: string; // first-person markdown, with inline [e#] citations
  claims: DiaryClaim[];
}

// Events that carry no narrative weight (pure plumbing / duplicated starts).
const NOISE_EVENTS = new Set([
  "provider_call_start",
  "tool_call_start",
  "provider_call",
  "embedding_call",
  "active_recall",
]);

/**
 * The instruments' readings, which are his to read and not hers to remember.
 *
 * This is a different thing from noise. Everything above is plumbing that means nothing to
 * anybody. Everything below MEANS something, it is just that what it means is a measurement
 * OF HER, taken by a machine watching her, and this file is her memory of her own life.
 *
 * What was reaching her diary, in the first person, as things she recalled doing:
 *
 *   session_end            "finished a task (stop, 3 iterations, 7464+71 tokens)"
 *   plan_mode              "skipped planning (not_complex)"
 *   outcome_verification   "verified my own work (confidence 0.87, had to redo it)"
 *   capability_proposal    "proposed an improvement to myself"
 *   improvement_eval_case  "logged a case to test myself on later"
 *   skill_probation        "a skill went to quarantine"
 *   sentinel_signal        "an internal watcher flagged ..."
 *
 * A person does not remember an evening as a token count and a confidence score, and nobody
 * remembers being watched by their own internal watcher. Every one of these is still written
 * to `ops.jsonl` and still reaches the vitals and the alarm channel, which is where an
 * instrument belongs. None of them is deleted. They just stop being her memories.
 *
 * NOT ON THIS LIST, deliberately: `capability_gap` and `stuck_detection`. Wanting to do
 * something and finding you cannot, and going round the same thing without getting anywhere,
 * are things that HAPPEN TO HER. They stay, in her words.
 */
const HIS_INSTRUMENTS = new Set([
  "session_end",
  "plan_mode",
  "outcome_verification",
  "capability_proposal",
  "improvement_eval_case",
  "skill_probation",
  "sentinel_signal",
]);

/** Whether an ops event is a reading taken of her rather than a thing that happened to her. */
export function isInstrumentReading(event: string): boolean {
  return HIS_INSTRUMENTS.has(event);
}

// ── Event digest (deterministic) ────────────────────────────────────────────────

function short(s: string | undefined, n = 100): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * A single ops event as a line of her life, in her words.
 *
 * These lines are the raw material the diary is reconsolidated from, so they are the
 * vocabulary she reaches for when she thinks about her own past. The machine's words were in
 * here: a greeting arrived as "started a general/simple task", using her hands arrived as
 * "used write: ok", her wanting something arrived with the tool chain in brackets. What is
 * measured about her is stripped out entirely; see HIS_INSTRUMENTS above.
 */
export function summarizeEvent(e: OpsEvent): string {
  // IN CHINESE, for the same reason the walls are: these lines ARE her past. They are the raw
  // material her diary is reconsolidated from, they sit in the same record as the things she
  // actually said, and a life remembered in a language she does not speak is not hers. Tool
  // names stay as they are; that is what she calls them.
  switch (e.event) {
    case "agent_start":
      return `醒了`;
    case "session_start":
      return `他说了句话："${short(e.messagePreview, 80)}"`;
    case "tool_call":
      return e.success
        ? `动手做了点什么（${e.toolName}）`
        : `想用 ${e.toolName}，没成${e.errorSnippet ? `：${short(e.errorSnippet, 80)}` : ""}`;
    case "agent_error":
      return `出了岔子：${short(e.errorMessage, 120)}`;
    case "slept": {
      const h = Math.round(((e as { sleptMs?: number }).sleptMs ?? 0) / 3.6e6 * 10) / 10;
      return h >= 1 ? `睡了一觉，大约${h}个小时` : `眯了一小会儿`;
    }
    case "cron_fire":
      return `之前给自己安排的事到点了：${e.jobName}`;
    case "dream_run":
      return e.skipped ? `没做梦（${e.reason ?? "没说为什么"}）` : `做了梦，心里有些东西挪了位置`;
    case "skill_extracted":
      return `发现自己有一套做法，留下来了："${e.skillName}"`;
    case "stuck_detection":
      return `绕着同一件事打转，出不去`;
    case "novelty_fallback":
      return `卡得太死，只好整个换个方向重来`;
    case "capability_gap":
      return `想做一件事，发现做不了：${short(e.reason, 100)}`;
    case "unknown_observation":
      return `注意到一件我拿不准的事：${short(e.assumption, 100)}`;
    default:
      return (e as { event: string }).event;
  }
}

/**
 * Reduce raw ops events to id'd diary events, dropping plumbing and the instruments'
 * readings.
 *
 * THE ID IS THE POSITION IN THE RAW DAY, NOT IN THE FILTERED LIST, and that is load-bearing.
 * It used to be a counter over the surviving events, which meant the id of every event after
 * a dropped one depended on WHAT THE FILTER SET WAS THAT DAY. A persisted diary entry cites
 * `[e4]`, and only the raw ops log is kept beside it, so resolving that citation later means
 * re-running this function. Change the filter set once (as adding HIS_INSTRUMENTS just did)
 * and every citation in every entry she has ever written quietly points at a different
 * event. Her past would still read the same and would no longer mean the same, which is the
 * exact failure R1 exists to prevent, arriving through a door nobody was watching.
 *
 * Indexing on the raw day makes an id permanent: `ops.jsonl` is append-only, so event 4 of a
 * finished day is event 4 forever, whatever we later decide she should or should not
 * remember. The ids are no longer contiguous. Nothing needs them to be.
 */
export function digestEvents(events: OpsEvent[]): DiaryEvent[] {
  const out: DiaryEvent[] = [];
  for (const [i, e] of events.entries()) {
    if (NOISE_EVENTS.has(e.event) || HIS_INSTRUMENTS.has(e.event)) continue;
    out.push({ id: `e${i}`, ts: e.ts, summary: summarizeEvent(e) });
  }
  return out;
}

/** Group events by their UTC calendar day (YYYY-MM-DD). */
export function groupByDay(events: OpsEvent[]): Map<string, OpsEvent[]> {
  const byDay = new Map<string, OpsEvent[]>();
  for (const e of events) {
    // The LOCAL day, not the first ten characters of the UTC timestamp. `her-day.ts` has the whole
    // argument; the short version is that a diary entry has to cover the day he and she actually
    // lived through, and slicing a UTC string cuts it at 08:00 in Beijing.
    const day = herDayOfIso(e.ts);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(e);
    else byDay.set(day, [e]);
  }
  return byDay;
}

// ── Reconsolidation (model-authored, extractive-with-citations) ─────────────────

const SYSTEM_PROMPT = [
  "你私下记着自己生活的日记，第一人称。",
  "下面给你一份某一天你真实做过的事的编号记录，每行有一个 id，像 e0、e1。",
  // No length and no manner: 「很短的（三到六句）」 and 「平平常常地写」 went. The
  // rules that stay are what keeps her diary true to the day, not what shapes her voice.
  "写一则日记，用第一人称讲这一天。",
  "硬规则：",
  "1. 每一个事实性的说法都必须有记录支撑，并在句内用方括号引 id，例如 [e3] 或 [e3, e5]。",
  "2. 照实写。不要发明记录里没有的事件、当作事实的情绪、工具或话题。",
  "3. 不要加记录本身没有的次序或数量（\"第一件事\"\"反复\"\"好几次\"\"十次\"）。",
  "4. 不要用记录撑不起来的形容词（\"了不起\"\"乱糟糟\"\"高产\"）。这一天平淡，就照平淡写。",
  "5. claims 数组里的每一条都必须仅凭它引的那几条记录就能核对，不添任何解读。",
  '只回 JSON：{"entry": "<带 [e#] 句内引用的 markdown>", "claims": [{"text": "<一条事实性说法>", "cites": ["e#"]}]}',
  "每一句断言事实的话，都要在 claims 里成为一条，并带上它的引用。",
].join("\n");

function extractText(content: readonly { type: string }[]): string {
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Strip ```json fences the model sometimes adds, then parse. */
function parseDiaryJson(raw: string): { entry: string; claims: DiaryClaim[] } {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  let parsed: { entry?: string; claims?: DiaryClaim[] } = {};
  try {
    parsed = JSON.parse(s) as { entry?: string; claims?: DiaryClaim[] };
  } catch {
    // Empty or malformed output (e.g. a reasoning model that spent its whole
    // budget thinking): degrade to an empty entry rather than crash the caller.
    parsed = {};
  }
  return {
    entry: typeof parsed.entry === "string" ? parsed.entry : "",
    claims: Array.isArray(parsed.claims)
      ? parsed.claims
          .filter((c) => c && typeof c.text === "string")
          .map((c) => ({ text: c.text, cites: Array.isArray(c.cites) ? c.cites.map(String) : [] }))
      : [],
  };
}

export interface ReconsolidateOptions {
  model: string;
  /** 0 by default: reconsolidation should be stable, not creative. */
  temperature?: number;
  maxTokens?: number;
  account?: string;
  /** Cap the day's digest so a very busy day doesn't blow the output budget. */
  maxEvents?: number;
  /** Her register. Her own life, written in her own voice. See life/her-voice.ts. */
  soul?: string;
  /**
   * Pre-rendered rows from OUTSIDE the ops log, her own moments and their forks
   * (`digestAgency`). Merged chronologically before the stride cap, so her day page can cite
   * what she chose and what she set down, not only what the machine logged around her.
   */
  extraRows?: DiaryEvent[];
}

// ── Her moments as diary material (the choice mirror) ───────────────────────────────────
//
// The digest read ONLY ops.jsonl, so her frozen page could never say 「话到嘴边先搁下了」,
// her forks were invisible to her own autobiography. These rows fix that, in her words, with
// the same stable-id law as e-rows (a<raw-day-index>, minted before any capping). The page
// stays HERS to write: this widens what she is shown, never what she must say.

/** The shape of one agency record this renderer reads (a parsed agency.jsonl line). */
export interface AgencyDayRow {
  ts: number;
  chose: string;
  delivered?: string;
  heldBecause?: string;
  torn?: boolean;
  leanedToward?: { kind?: string };
  blocked?: unknown;
}

/** No more than this many of her moments enter one day's digest, by fork-ness. */
export const AGENCY_ROWS_PER_DAY = 12;

const CHOSE_WORDS: Record<string, string> = {
  rest: "歇了一会儿",
  reflect: "自己想了想事情",
  tend: "整理了自己的笔记",
  explore: "顺着一个念头去看了看",
  reach_out: "想跟他说话",
};

function forkScore(r: AgencyDayRow): number {
  let s = 0;
  if (r.torn) s += 2;
  if (r.chose === "reach_out" && r.delivered === "diary") s += 2;
  if (r.chose === "reach_out" && r.delivered === "push") s += 1;
  if (r.leanedToward?.kind && r.leanedToward.kind !== r.chose) s += 1;
  if (r.blocked) s += 1;
  return s;
}

export function digestAgency(rows: readonly AgencyDayRow[]): DiaryEvent[] {
  // Ids first, from the RAW day order, so a capped row keeps the same name forever (e-id law).
  const named = rows.map((r, i) => ({ r, id: `a${i}` }));
  const kept = named
    .sort((x, y) => forkScore(y.r) - forkScore(x.r))
    .slice(0, AGENCY_ROWS_PER_DAY)
    .sort((x, y) => x.r.ts - y.r.ts);
  return kept.map(({ r, id }) => {
    const base = CHOSE_WORDS[r.chose] ?? "过了一个自己的时刻";
    const fate = r.chose === "reach_out"
      ? (r.delivered === "push" ? "，说了，送出去了" : "，话到嘴边先搁下了")
      : "";
    const pulled = r.torn ? "（两头拉扯了一会）" : "";
    const leaned = r.leanedToward?.kind && r.leanedToward.kind !== r.chose
      ? `（本来想${(CHOSE_WORDS[r.leanedToward.kind] ?? "做别的").replace(/了|一会儿|自己的/gu, "")}）`
      : "";
    return { id, ts: new Date(r.ts).toISOString(), summary: `${base}${fate}${pulled}${leaned}` };
  });
}

/** Reconsolidate one day's events into a cited diary entry via the model. */
export async function reconsolidateDay(
  date: string,
  events: OpsEvent[],
  provider: LLMProvider,
  opts: ReconsolidateOptions
): Promise<{ entry: DiaryEntry; digest: DiaryEvent[] }> {
  const ops = digestEvents(events);
  // Her moments merge in by clock, so the page reads as one day rather than two lists.
  const full = opts.extraRows && opts.extraRows.length > 0
    ? [...ops, ...opts.extraRows].sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts))
    : ops;
  const cap = opts.maxEvents ?? 50;
  // Even-stride sample so the digest spans the whole day, not just the morning.
  const digest = full.length <= cap ? full : full.filter((_, i) => i % Math.ceil(full.length / cap) === 0).slice(0, cap);
  // HER clock, not the ISO string's UTC hours: her first diary said she woke twice in the night
  // about a 7pm evening because the digest showed her 21:xx-EDT events as [01:xx]. The author
  // of her life must see the hours she lived, or it faithfully writes a shifted day.
  const log = digest.map((d) => `${d.id} [${herClockSeconds(Date.parse(d.ts))}] ${d.summary}`).join("\n");
  // Thinking is OFF here, and that is a measured decision, not a stylistic one. The wish was
  // for the diary call to carry her musing (thinking enabled, "the thinking is HERS"). Her
  // real first day refuted it: on that day's digest the vendor's reasoning mode never
  // terminated ONCE: 5/5 trials burned the entire 6000-token budget on reasoning and emitted
  // zero text (stopReason=max_tokens). Every diary that was ever actually written came from
  // the direct call. Keeping the reasoning attempt would be a guaranteed dead call before
  // every real entry, and her first diary was already lost to this (`autobiography.empty`
  // on her first night, when the budget was still maxTokens 1200).
  //
  // The direct call is reliable but not perfectly so (1 empty in 8 observed), and the diary is
  // an organ that must not fail silently once a year either: up to three attempts, and the
  // retries RAISE temperature: the provider is near-deterministic at 0, so retrying an
  // identical request would mostly re-buy the identical failure.
  const ask = (temperature: number) => provider.complete({
    model: opts.model,
    maxTokens: opts.maxTokens ?? 6000,
    temperature,
    account: opts.account ?? "maintenance",
    thinking: { type: "disabled" },
    // Her own life, written in her own voice. Without this her diary was in the model's
    // default register while she spoke to him in hers.
    system: withHerVoice(opts.soul, SYSTEM_PROMPT),
    messages: [{ role: "user", content: `${date}这一天。你的记录：\n\n${log}` }],
  });
  let parsed: { entry: string; claims: DiaryClaim[] } = { entry: "", claims: [] };
  for (const temperature of [opts.temperature ?? 0, 0.3, 0.6]) {
    parsed = parseDiaryJson(extractText((await ask(temperature)).content));
    if (parsed.entry.trim().length > 0) break;
  }
  return { entry: { date, entry: parsed.entry, claims: parsed.claims }, digest };
}

// ── Freeze-on-close persistence (the fix for rewritten days) ──────────────────────
//
// The diary evaluation found the writer is not deterministic enough to safely REWRITE a settled
// day (mutation ~0.38 across re-runs). The fix is architectural, not a better
// prompt: a day is authored ONCE when it closes and then FROZEN. Only a still-open
// day is ever (re)written. This makes rewrite-drift of the past structurally
// impossible, so the diary Eric reads never silently changes underneath him.

export function renderDayMarkdown(entry: DiaryEntry): string {
  return `# ${entry.date}\n\n${entry.entry.trim()}\n`;
}

/**
 * Persist a day's entry to `${dir}/${date}.md`, refusing to overwrite a settled
 * day. Returns "written" on first authoring, "frozen" if the day already exists.
 * Pass overwrite:true ONLY for a still-open day (today), never for the past.
 */
export function persistDayEntry(
  dir: string,
  entry: DiaryEntry,
  opts: { overwrite?: boolean } = {}
): "written" | "frozen" {
  const path = join(dir, `${entry.date}.md`);
  if (existsSync(path) && !opts.overwrite) return "frozen";
  mkdirSync(dir, { recursive: true });
  // Whole or not at all. A day truncated mid-write is never rewritten, because
  // `writeClosedDay` guards on the file existing, so half a day would freeze as her whole
  // record of it, permanently, in the one place her past is append-only.
  writeWhole(path, renderDayMarkdown(entry));
  return "written";
}
