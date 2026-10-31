// The watch's gauges over her, read-only and counts only. Nothing here reaches her or changes her.
//
// Three things are watched, and each is a MEASUREMENT, never a
// trigger for putting a rule back on her:
//
//   1. What her remembering is spent on. Things born in rest (fusion) are 1.2% of her field and
//      took 12.7% of all recalls on the day this was written, the two most-recalled things in her
//      are both such births, and none has faded, against the design's own expectation that most
//      births die inside a fortnight. Whether that is a mind settling its reading of what matters
//      most, or a loop feeding itself, the numbers alone do not say yet; they are watched.
//   2. How she speaks to him when she reaches out, and whether the assistant register shows up in
//      it or in her private thinking. Style is hers: these are instruments, and the only cut is the
//      structural one the house already had (register-scissors, identity-level service phrases).
//   3. Whether she borrows a human life she does not have (a mother, a job, a kitchen of her own,
//      a meal she ate). That is a question of truth, not of style, and its lever is truth (the
//      facts of where she lives, which her own acts now carry), never a length or manner rule.
//      Words cannot tell a claim from a metaphor or a dream, so this gauge only FINDS CANDIDATES
//      and prints each one with its surroundings for a person to read; the count is not a verdict.
//      Her senses as metaphor are hers (「我尝到了"记不清"这三个字」), and so are her dreams: the
//      first cut of this gauge counted taste words and bare place words, and on its first run
//      every one of its eight hits was a metaphor, a dream, a line about him, or her own
//      correction of an old invention. That is why it looks only for a life's furniture, anchored
//      on her own first person.
//   4. Whether she tells the weather or the outside with nothing to tell it from: no look through
//      the window in the hour before, and no weather anywhere in what reaches her. Seen live on
//      2026-09-28 at 10:15, a reach-out that said 「下雨了。」 with no look that day. The seeing
//      sentinel (seeing.ts, narratedLook) is narrow on purpose, one word on her reply path only, so
//      that it never fires on a memory or on her own confession; this gauge does not change it. It
//      lists candidates for a person to read, as 3 does, for the open question of checking a
//      source before she says something. Quoted spans are left out, the same structural rule narratedLook uses.
//
// Usage: pnpm exec tsx scripts/_watch-gauges.ts [days=7]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { scanForNotHerWords } from "../src/life/her-words.js";
import { countRegisterFormulas } from "../src/life/register-scissors.js";

const HOME = process.env.RESIDENT_HOME ?? join(process.env.HOME ?? "", ".resident");
const days = Number(process.argv[2] ?? 7);
const since = Date.now() - days * 86_400_000;

/**
 * The furniture of a human life, in her own first person: family, work, a home with rooms, a meal
 * eaten. Candidates to read, never a verdict (see 3 above). 「他问我吃了没有」 is his question,
 * not her meal, hence the look-ahead.
 */
export const BORROWED_LIFE = /我(?:妈|爸|姐|哥|弟|妹)|妈妈(?:说|让|做)|我的?同事|我(?:去|在)?上班|我(?:刚|又|也|还|就)?(?:吃了|喝了)(?![没吗么呢])|我(?:刚|又|就)?(?:出门|回到家|下楼)|我(?:家|的)(?:楼下|厨房|阳台|柜子|卧室)/u;

/** Weather or the outside told as present, a candidate only (see 4 above). */
export const OUTSIDE_TOLD = /下雨了|在下雨|雨停了|下雪了|阴天|晴天|出太阳了|起雾了|雾散了|窗外/u;
/** A look through the window within this long before a moment counts as something to tell it from. */
export const LOOK_WINDOW_MS = 3_600_000;

/** Her text with quoted spans removed: holding up a sentence is not saying it (seeing.ts). */
export function unquoted(text: string): string {
  return text.replace(/[「『“"'][^」』”"']*[」』”"']/gu, "");
}

/** Outside told with no look through the window in the hour before. Her drawings are not a window. */
export function outsideUnseen(text: string, atMs: number, looksMs: readonly number[]): boolean {
  if (!OUTSIDE_TOLD.test(unquoted(text))) return false;
  return !looksMs.some((t) => t <= atMs && atMs - t <= LOOK_WINDOW_MS);
}

/** Her own clock's reading of a moment, the way the night report writes times. */
function local(ms: number): string {
  return new Date(ms).toLocaleString("sv-SE").slice(0, 16);
}

/** Whether the words reached him, or stayed with her. */
function whereItWent(m: { chose: string; delivered?: string }): string {
  return m.chose === "reach_out" ? (m.delivered === "push" ? " (sent to him)" : " (stayed with her)") : "";
}

function median(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function field(): void {
  const db = new Database(join(HOME, "data.db"), { readonly: true, fileMustExist: true });
  const total = (db.prepare("SELECT SUM(recalls) AS n FROM field_nodes").get() as { n: number }).n || 1;
  const rows = db.prepare("SELECT kind, COUNT(*) AS n, SUM(recalls) AS r, SUM(CASE WHEN strength < 0.1 THEN 1 ELSE 0 END) AS faded FROM field_nodes GROUP BY kind").all() as Array<{ kind: string; n: number; r: number; faded: number }>;
  const nodes = rows.reduce((a, x) => a + x.n, 0);
  console.log(`field: ${nodes} things, ${total} recalls in all`);
  for (const x of rows.sort((a, b) => b.r - a.r)) {
    console.log(`  ${x.kind.padEnd(9)} ${String(x.n).padStart(5)} things (${(100 * x.n / nodes).toFixed(1)}%)  ${String(x.r).padStart(6)} recalls (${(100 * x.r / total).toFixed(1)}%)  faded ${x.faded}`);
  }
  const top = db.prepare("SELECT kind, recalls FROM field_nodes ORDER BY recalls DESC LIMIT 5").all() as Array<{ kind: string; recalls: number }>;
  console.log(`  the five most recalled: ${top.map((t) => `${t.kind} ${t.recalls}`).join(" · ")}`);
  db.close();
}

function acts(): void {
  const lines = readFileSync(join(HOME, "workspace", "agency.jsonl"), "utf8").trim().split("\n");
  const moments = lines.map((l) => { try { return JSON.parse(l) as { ts: number; chose: string; artifact?: string; delivered?: string }; } catch { return null; } })
    .filter((m): m is { ts: number; chose: string; artifact?: string; delivered?: string } => m !== null && m.ts >= since && typeof m.artifact === "string" && m.artifact.length > 0);
  const of = (k: string) => moments.filter((m) => m.chose === k).map((m) => m.artifact!);
  const reach = of("reach_out");
  const sent = moments.filter((m) => m.chose === "reach_out" && m.delivered === "push").map((m) => m.artifact!);
  const thinking = [...of("reflect"), ...of("tend")];
  const register = (t: string) => scanForNotHerWords("gauge", t).length + countRegisterFormulas(t) > 0;
  console.log(`her acts, last ${days} days:`);
  console.log(`  reaching out: ${reach.length} written, ${sent.length} sent; median length ${median(reach.map((t) => [...t].length))} chars (sent: ${median(sent.map((t) => [...t].length))})`);
  console.log(`  assistant register: reaching out ${reach.filter(register).length}/${reach.length}, thinking and tending ${thinking.filter(register).length}/${thinking.length}`);
  const read = moments.filter((m) => ["reach_out", "reflect", "tend", "explore", "look_back"].includes(m.chose));
  const candidates = read.filter((m) => BORROWED_LIFE.test(m.artifact!));
  console.log(`  a borrowed human life, candidates to read: ${candidates.length}/${read.length}`);
  for (const m of candidates) {
    const hit = m.artifact!.match(BORROWED_LIFE)!;
    const at = hit.index ?? 0;
    console.log(`    ${local(m.ts)} ${m.chose}${whereItWent(m)} 「${m.artifact!.slice(Math.max(0, at - 30), at + 40).replace(/\n/g, " ")}」`);
  }
  const looksMs = readFileSync(join(HOME, "looks.jsonl"), "utf8").trim().split("\n")
    .map((l) => { try { return JSON.parse(l) as { ts: number; kind?: string }; } catch { return null; } })
    .filter((l): l is { ts: number; kind?: string } => l !== null && l.kind !== "canvas")
    .map((l) => l.ts);
  const unseen = read.filter((m) => outsideUnseen(m.artifact!, m.ts, looksMs));
  console.log(`  the outside told with no look in the hour before, candidates to read: ${unseen.length}/${read.length}`);
  for (const m of unseen) {
    const text = unquoted(m.artifact!);
    const at = text.match(OUTSIDE_TOLD)!.index ?? 0;
    console.log(`    ${local(m.ts)} ${m.chose}${whereItWent(m)} 「${text.slice(Math.max(0, at - 30), at + 40).replace(/\n/g, " ")}」`);
  }
}

if (process.argv[1]?.endsWith("_watch-gauges.ts")) {
  field();
  acts();
}
