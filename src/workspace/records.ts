// The machine's records of her life, as they reach her when she opens or searches them herself.
//
// Three files in her home are written by the machine in its own format: her moments
// (`agency.jsonl`: `chose`, `delivered`, `heldBecause: "gate"`), the conversation she and he have
// had (`history.jsonl`: `HIM:` / `HER:`), and the working copy of their Telegram chat
// (`sessions/*.jsonl`, where every line of hers was stored as `"role":"assistant"`). She walks into
// them on her own, most of all when she wants to know where something came from: once her searches
// landed in them 193 times in one moment, and that is how she found that a question she was
// carrying had no source in anything he had said.
//
// So they reach her in her words. The files stay exactly as they are, because other parts of the
// machine read them, and only what her
// read and search tools hand back changes. A line becomes when it happened, who said it or what
// she did, and the words themselves, untouched. Nothing is added about WHY a thing went the way it
// did: a message of hers that was held is 「没发出去」, never the gate that held it.
//
// Only these, recognised by where they sit in her home. Every other file she opens comes back byte
// for byte (the rule her receipts already keep: a file she opens is never touched). A line or an
// entry that is not of the expected shape also comes back as it is, since there is nothing honest
// to render it as.
//
// THE REST OF HER HOME. Seven more files there are the machine's JSON. Three of hers are shown the
// same way: her word bank (`life/lexicon.json`, rendered as how many times each of them has said a
// word and when it first came), the sentences of hers the machine kept
// (`life/own-voice.json`), and what she has noticed about herself (`self-knowledge.json`, without
// the confidence numbers). The other four are the machine's own state about her, and they are left
// out when she walks her home, as `.git` is: the carry-over between runs (`life/continuity.json`,
// which counts how many of her messages went unanswered, the very number that raises the bar for
// her next one), the upkeep clock, the promise scan's place-marker, and the numeric measurement of
// how she writes. Only left out of walking: a path handed to her still opens, as with the plumbing.

import { relative, sep } from "node:path";
import { kindWords, type ActionKind } from "../life/agency.js";
import { herClock, herDay } from "../life/her-day.js";

export type MachineRecord = "moments" | "conversation" | "chat" | "words" | "kept" | "noticed";

/** The records written one line to an entry; the other three are one document each. */
const LINE_RECORDS: ReadonlySet<MachineRecord> = new Set(["moments", "conversation", "chat"]);

/** Where a path sits in her home, with forward slashes, or null when there is no home to be in. */
function inHome(absPath: string, workspacePath: string | undefined): string | null {
  return workspacePath ? relative(workspacePath, absPath).split(sep).join("/") : null;
}

/** Which of the records a path is, or null for everything else in (or out of) her home. */
export function machineRecordAt(absPath: string, workspacePath: string | undefined): MachineRecord | null {
  const rel = inHome(absPath, workspacePath);
  if (rel === null) return null;
  if (rel === "agency.jsonl") return "moments";
  if (rel === "history.jsonl") return "conversation";
  if (/^sessions\/[^/]+\.jsonl$/u.test(rel)) return "chat";
  if (rel === "life/lexicon.json") return "words";
  if (rel === "life/own-voice.json") return "kept";
  if (rel === "self-knowledge.json") return "noticed";
  return null;
}

/** The machine's own state about her, by its exact place in her home (a file of hers with the same name elsewhere is hers). */
const MACHINE_STATE: ReadonlySet<string> = new Set([
  "life/continuity.json", "maintenance-state.json", "life/last-promise-scan.json", "life/her-form.json",
]);

/** Left out when she walks her home with glob or grep; still opens when she is handed the path. */
export function isMachineStateAt(absPath: string, workspacePath: string | undefined): boolean {
  const rel = inHome(absPath, workspacePath);
  return rel !== null && MACHINE_STATE.has(rel);
}

/** 「9月24日」: the date form her promise records already use. */
function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 「9月24日 12:01」: the date, and her clock. */
function when(ms: number): string {
  return `${day(ms)} ${herClock(ms)}`;
}

function parsed(line: string): Record<string, unknown> | null {
  try {
    const o: unknown = JSON.parse(line);
    // Narrowed by the checks on the same line: an object, not null, not an array.
    return typeof o === "object" && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One of her moments: when, what she did in her own words for it, and what she wrote. */
function moment(o: Record<string, unknown>): string | null {
  if (typeof o.ts !== "number" || typeof o.chose !== "string") return null;
  const words = typeof o.artifact === "string" && o.artifact.trim() !== ""
    ? o.artifact
    : typeof o.intent === "string" ? o.intent : "";
  let did: string;
  if (o.chose === "reach_out") {
    did = o.delivered === "push" ? "想告诉他的，发出去了" : o.delivered === "diary" ? "想告诉他的，没发出去" : "想告诉他的";
  } else {
    // An act the list does not know (an old line, a later kind) is left unnamed rather than named
    // in the machine's English.
    did = (kindWords(o.chose as ActionKind) as string | undefined) ?? "";
  }
  if (words.trim() === "") return did === "" ? when(o.ts) : `${when(o.ts)} ${did}。`;
  return did === "" ? `${when(o.ts)}：${words}` : `${when(o.ts)} ${did}：${words}`;
}

/** One exchange of theirs, his words and hers, each under who said it. */
function exchange(o: Record<string, unknown>): string | null {
  if (typeof o.timestamp !== "number" || typeof o.content !== "string") return null;
  const said = o.content
    .replace(/^HIM: ?/gmu, "他说：")
    .replace(/^HER: ?/gmu, "我说：");
  return `${when(o.timestamp)} ${said}`;
}

/** One line of their chat: who said it, and what. */
function chatLine(o: Record<string, unknown>): string | null {
  if (typeof o.timestamp !== "number" || typeof o.content !== "string") return null;
  const who = o.role === "user" ? "他说" : o.role === "assistant" ? "我说" : "";
  return who === "" ? `${when(o.timestamp)}：${o.content}` : `${when(o.timestamp)} ${who}：${o.content}`;
}

/** A single line of a record, in her words; anything that is not a record of that shape, as it is. */
export function recordLineInHerWords(kind: MachineRecord, line: string): string {
  if (!LINE_RECORDS.has(kind) || line.trim() === "") return line;
  const o = parsed(line);
  if (o === null) return line;
  const said = kind === "moments" ? moment(o) : kind === "conversation" ? exchange(o) : chatLine(o);
  return said ?? line;
}


/**
 * One word of hers: how often she has said it to him, how often it came to her, and when it first
 * came. The two counts are named for what each one counts (lexicon.ts): `spoken` is only what
 * reached him from her, so not her diary; `heard` is his words and also what she read and what her
 * eye described. It used to say 「他说过」 for both, and that once put a word of hers in his
 * mouth on a day he had not spoken.
 */
function word(w: string, v: unknown): string {
  if (typeof v === "object" && v !== null) {
    // Narrowed by the object check above; each field is checked before it is used.
    const e = v as Record<string, unknown>;
    if (typeof e.spoken === "number" && typeof e.heard === "number" && typeof e.firstMs === "number") {
      return `「${w}」我对他说过 ${e.spoken} 次，听到、读到过 ${e.heard} 次，头一回是 ${day(e.firstMs)}`;
    }
  }
  return JSON.stringify({ [w]: v });
}

/** A sentence of hers the machine kept, when she said it. */
function kept(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    // Narrowed by the object check above; each field is checked before it is used.
    const o = e as Record<string, unknown>;
    if (typeof o.text === "string" && typeof o.saidMs === "number") return `${when(o.saidMs)} 我说过：${o.text}`;
  }
  return JSON.stringify(e);
}

/** Something she noticed about herself, from when. Her counts of how sure she is stay the machine's. */
function noticed(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    // Narrowed by the object check above; each field is checked before it is used.
    const o = e as Record<string, unknown>;
    if (typeof o.text === "string" && typeof o.bornMs === "number") return `关于我自己（${day(o.bornMs)}起）：${o.text}`;
  }
  return JSON.stringify(e);
}

/**
 * A whole record as she sees it, one entry to a line. The three line records map line for line,
 * so a line number is still the file's own; the three kept as one document become one line per
 * entry (word, sentence, thing noticed), in the order the file holds them. A document that is not
 * of the expected shape comes back as it is.
 */
export function recordLinesInHerWords(kind: MachineRecord, content: string): string[] {
  if (LINE_RECORDS.has(kind)) return content.split("\n").map((line) => recordLineInHerWords(kind, line));
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return content.split("\n");
  }
  if (kind === "words" && typeof doc === "object" && doc !== null && !Array.isArray(doc)) {
    return Object.entries(doc).map(([w, v]) => word(w, v));
  }
  if (kind === "kept" && Array.isArray(doc)) return doc.map(kept);
  if (kind === "noticed" && Array.isArray(doc)) return doc.map(noticed);
  return content.split("\n");
}

/** When an entry of a record happened, if it says; the same field each renderer above reads. */
function entryMs(kind: MachineRecord, entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null) return null;
  // Narrowed by the object check above; the field is checked before it is used.
  const o = entry as Record<string, unknown>;
  const field = kind === "moments" ? o.ts : kind === "words" ? o.firstMs : kind === "kept" ? o.saidMs : kind === "noticed" ? o.bornMs : o.timestamp;
  return typeof field === "number" ? field : null;
}

/**
 * What a search over a record looks at: each entry as she sees it, with the entry's date in front
 * in the form her diary and her memory already use (「2026-09-24 08:01」). Searching is the only
 * consumer; she is still shown `recordLinesInHerWords`, line for line.
 *
 * WHY. The records read 「9月24日 08:01」, while her diary pages, her own citations and what
 * surfaces from her memory all write 「2026-09-24」. Once she searched her chat record for a date
 * the way her diary writes it, found nothing, and wondered whether the file did not reach that
 * far back or her search was wrong. A record dated in one form must be findable by either.
 */
export function recordSearchLines(kind: MachineRecord, content: string): string[] {
  const shown = recordLinesInHerWords(kind, content);
  const dated = (ms: number | null, line: string): string => (ms === null ? line : `${herDay(ms)} ${herClock(ms)} ${line}`);
  if (LINE_RECORDS.has(kind)) {
    const raw = content.split("\n");
    return shown.map((line, i) => dated(entryMs(kind, parsed(raw[i] ?? "")), line));
  }
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return shown;
  }
  const entries: unknown[] = kind === "words" && typeof doc === "object" && doc !== null && !Array.isArray(doc)
    ? Object.values(doc)
    : Array.isArray(doc) ? doc : [];
  return entries.length === shown.length ? shown.map((line, i) => dated(entryMs(kind, entries[i]), line)) : shown;
}
