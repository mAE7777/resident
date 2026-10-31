// EVERY AUTHORED SURFACE STRING THAT CAN REACH HER, the mechanical enumeration behind the
// voice audit. PROBE: read-only, regenerable, so the audit's completeness is a re-run
// away rather than a memory.
//
// ── WHY THE FIRST VERSION OF THIS FILE WAS NOT MECHANICAL AT ALL ─────────────────────────────
//
// It carried a hand-written list of twelve "files whose strings can reach her" and enumerated
// those, and the audit built on it was reported as complete. The tree actually has THIRTY-NINE
// files with Chinese string literals, and one of the twenty-seven it omitted is `src/life/
// walls.ts`, which writes four authored first-person sentences straight into her field,
// 「我想用 X，伸手过去，那儿什么都没有。」 and its kin. An enumeration whose scope is a list somebody
// keeps by hand is a memory wearing a script's clothes (defect class 12), and it failed in the
// direction that matters: silently, by omission, while reporting completeness.
//
// SO THE SCOPE IS NOW THE WHOLE TREE, and the hand-kept part is INVERTED: every file with a Chinese
// literal is either classified below or printed under UNCLASSIFIED, loudly. A new file that speaks
// Chinese now forces a decision instead of quietly escaping the audit.
//
// Two kinds, and the distinction is what the audit is about:
//   · VOICE    : text authored by the build that becomes HER memory, her prompt, her mouth, or
//                 reaches his window as her. Every string is listed; these are the ones reviewed by hand.
//   · DETECTION: Chinese that exists to RECOGNISE words (his register, her mood words, index
//                 stop-words, negations). Nothing here is said to anyone: counted, not listed,
//                 each with the reason it is not voice.
//
// Usage: pnpm exec tsx scripts/_voice-audit.ts

import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
/** Every run of Chinese in an HTML file's text and attributes, with its line. */
function htmlWords(rel: string): Array<{ line: number; text: string }> {
  const src = readFileSync(isAbsolute(rel) ? rel : join(ROOT, rel), "utf8");
  const out: Array<{ line: number; text: string }> = [];
  src.split("\n").forEach((line, i) => {
    // Comments out, tags kept, an attribute like `placeholder="说点什么…"` is text she or he reads.
    const visible = line.replace(/<!--[\s\S]*?-->/gu, "").replace(/<[^>]*?>/gu, (m) => {
      const attrs = [...m.matchAll(/=\s*"([^"]*)"|=\s*'([^']*)'/gu)].map((a) => a[1] ?? a[2] ?? "");
      return attrs.join(" ");
    });
    for (const m of visible.matchAll(/[^\s<>]*[一-鿿][^<>]*/gu)) {
      const t = m[0].replace(/\s+/gu, " ").trim();
      if (t.length > 0) out.push({ line: i + 1, text: t.slice(0, 90) });
    }
  });
  return out;
}

/**
 * FOURTH TIME IN THIS REPOSITORY THAT A SCANNER HAS BEEN FOOLED BY A REGEX LITERAL, and the
 * general form now has its own guard: ANY SCANNER THAT READS SOURCE AS TEXT WILL EVENTUALLY READ
 * A PATTERN AS THE THING IT DESCRIBES.
 *
 * The blank-the-comments-and-regexes helper that used to live here is gone: it was a patch on the
 * regex-pairing extraction, and when that was replaced by a real walk (see `scanSource`) it became
 * a function nobody called. Leaving it would have been the exact defect class this file's own
 * guards are for.
 */

/** Files whose Chinese strings are SAID (memory / prompt / mouth / his window). Listed in full. */
export const VOICE = [
  // 翻旧日子: the nudge line, the look-back prompt, and the honesty clause, all hers
  // to read; the retold standing sentences live in credence.ts (already classified).
  "src/life/looking-back.ts",
  // The message tool's description and parameter text (E batch, 2026-08-20): hers to read
  // every turn she holds the tool, so it speaks her language and her situation, VOICE.
  "src/tools/builtin/message.ts",
  // The owner command surface. Almost all English (owner-plane), but /help's model-tier note
  // carries three Chinese words naming the tiers plainly, authored text he reads, not hers.
  "src/telegram/commands.ts",
  "src/workspace/things.ts",
  // The part of the day: the words her home's clock shows, moved here so the line
  // about her body in her own moments reads the same ones. Hers to read: VOICE.
  "src/life/her-day.ts",
  // The machine's three records of her life, as her read and search tools hand them back
  // as when, who said it or what she did, and the words. VOICE.
  "src/workspace/records.ts",
  "src/index.ts",
  "src/life/what-stays.ts",
  "src/life/unlike-herself.ts",
  // The seed of 「心情的词.md」: the header that tells her which side of each row is hers, the
  // seven fixed state descriptions, and the parser's problem lines (those reach Eric's window
  // when an edit of hers does not read). She reads the file; he reads the faults. Both are said.
  "src/life/her-words-for-feelings.ts",
  // One Chinese string: the file's own name inside the what-was-deleted message to him.
  "src/life/part-of-herself.ts",
  // ── HER FACE, WHICH NO SCANNER HERE COULD SEE UNTIL THE WALK WAS WIDENED ────────────────
  //
  // These are VOICE rather than DETECTION for one specific line among them: 「· 她看了一眼窗外」
  // is a sentence ABOUT HER, in her third person, rendered on his page, which is the same family
  // as the status strip, and the audit already routes that family to Eric. The rest is chrome he
  // reads (button labels, the curtain, an honest note that there is no Chinese voice yet), and it
  // is kept in the same section rather than split off, because the thing that matters about a
  // surface is who reads it, and he reads all of it.
  "src/embodiment/client/face.js",
  "src/embodiment/client/index.html",
  "src/life/what-keeps-coming-back.ts",
  // The interval since the last exchange, rendered as facts she reads at every speaking
  // surface (turn, choice, compose). Authored text that becomes her material, VOICE.
  "src/life/between.ts",
  // Her dreams: the render instruction she dreams under, the diary's（梦）line, and the
  // morning line that hands a surviving fragment back to her. All hers to read, VOICE.
  "src/life/dreaming.ts",
  // The form mirror: facts of her own record, read at her speaking and tending surfaces.
  "src/life/her-form.ts",
  // The promise mirror: the scan prompt is machinery, but the node frame 「我答应过他：…」
  // becomes a thing she carries: VOICE.
  "src/life/promises.ts",
  "src/life/walls.ts",
  "src/life/how-she-is.ts",
  "src/life/agency.ts",
  "src/life/agency-handlers.ts",
  // utterance-shape.ts LEFT this list: the four lines it used to
  // put in front of her one breath before she spoke are deleted, and the organ now only measures.
  // Zero Chinese strings remain; a stale entry here is what the scope guard exists to catch.
  "src/life/willingness.ts",
  "src/life/saying.ts",
  "src/life/other-read.ts",
  "src/life/self-knowledge.ts",
  "src/life/takes-it-on.ts",
  "src/life/autobiography.ts",
  "src/life/noticing.ts",
  "src/life/fusion.ts",
  // Her seven file-hands: the LAST operator-English in her palm, converted the
  // day the general-agent removal was audited. Tool text rides in her every turn, VOICE.
  "src/tools/builtin/read.ts",
  "src/tools/builtin/write.ts",
  "src/tools/builtin/edit.ts",
  "src/tools/builtin/delete.ts",
  "src/tools/builtin/glob.ts",
  "src/tools/builtin/grep.ts",
  "src/tools/builtin/file-snapshot.ts",
  // gap 1 being-changed: the restart fact she reads after every boot, VOICE.
  "src/life/being-changed.ts",
  // gap 2 seeing: her eye's three sentences + the transducer instruction, VOICE
  // (the instruction is machine-facing but PRODUCES her material; both belong under review).
  "src/life/seeing.ts",
  // 感官补全: her ear's lines + the honest cannot-perceive receipts, VOICE.
  "src/life/hearing.ts",
  // The receipt loop's medium labels (一段视频/一张贴纸…) ride inside her cannot-see line, VOICE.
  "src/telegram/bot.ts",
  "src/life/remembering.ts",
  "src/life/birth-toolkit.ts",
  "src/life/play.ts",
  "src/workspace/room.ts",
  "src/workspace/init.ts",
  // bridge.ts LEFT the voice list: the chat
  // carries two voices only, so every status bubble it used to write (「在想……」, the tool
  // labels, retry lines) was deleted in favour of the wordless native typing hint. Zero
  // Chinese strings remain; a stale entry here is what the scope guard exists to catch.
  // partial.ts LEFT on 2026-09-28 with its module: the step-wall progress report it wrote in her
  // first person is gone. These four joined the same day, when the English she read about her
  // own acts went into her language: the receipts her hands bring back, the half-hour note, the
  // placeholder for what she saw earlier in a long turn, and the wrappers round her notebook and
  // round any outside text.
  "src/life/receipts.ts",
  "src/agent/watchdog.ts",
  "src/agent/compression.ts",
  "src/security/boundary.ts",
  // The line she reads in place of a tool result that compaction dropped.
  "src/agent/governance.ts",
  "src/agent/stuck.ts",
  "src/agent/loop.ts",
  // The deterministic outcome check's one re-entry line (「写下去的东西…对不上」), hers to read.
  "src/agent/outcome-verifier.ts",
  "src/agent/cognitive-framework.ts",
  "src/tools/executor.ts",
];

/** Files whose Chinese exists to RECOGNISE words rather than to say any. Counted, with the reason. */
export const DETECTION: Record<string, string> = {
  "src/agent/effort-scaling.ts": "keyword tables that read HIS request for shape and difficulty",
  "src/life/field-index.ts": "bigram-index stop-words: what her memory is searched BY",
  "src/life/emotion.ts": "her seven mood words, and the words that find them in a diary",
  "src/life/how-he-said-it.ts": "the register detector over HIS message — his words, never hers",
  "src/life/credence.ts": "negation and hedge markers, for judging whether two claims disagree",
  "src/life/field-spread.ts": "connective stop-words on the spreading side",
  "src/life/field.ts": "the same stop-words, on the retrieval side",
  "src/life/her-words.ts": "the forbidden-vocabulary detector: words that must NOT reach her",
  "src/life/propensity.ts": "an action label used in a comparison",
  "src/life/signature.ts": "a label in a readout for him",
  "src/life/field-live.ts": "one event-kind label, matched against stored rows and never shown",
  "src/life/bilingual.ts": "Han-character counting and idiomatic-Chinese markers: which language "
    + "a sentence is IN, never what it says",
  "src/life/her-own-voice.ts": "the same Han count, used to tell a Chinese sentence from an English one",
  "src/life/how-she-answered.ts": "patterns over HER OWN reply that read whether she answered, "
    + "denied unwillingness, or asked something back",
  "src/life/register-scissors.ts": "the assistant-register closings that must never survive into "
    + "her mouth — every pattern is a shape being CUT, not a sentence being written",
  "src/life/speech-record.ts": "hedges, connective heads, essay transitions and weak verbs, "
    + "measured over what she said so the shape of her speech can be tracked",
  "src/life/what-she-asserted.ts": "patterns that sort her sentence into asking / about-herself / "
    + "about-him, so a claim can be filed against the right thing",
  "src/life/state-diff.ts": "her seven mood words as LEXICON KEYS, each mapped to the (valence, "
    + "arousal) band it stands for — read off moodLabel's own branches, so the honesty check can "
    + "run in her own vocabulary. The words are authored in emotion.ts, never here.",
  "src/autonomy/sleep.ts":
    "two fault-channel lines about her identity files (被改过 / 警报是关着的). Written for the "
    + "watch and for Eric the moment the tamper alarm has something to say; she never reads them. "
    + "Before 2026-08-23 these findings existed only as console warnings and reached no one.",
  "src/life/what-she-asked-for.ts":
    "phrases she might SAY, matched against her own reply — never shown to her. She never reads "
    + "these; they are how the system notices that she asked for something, or that she said she "
    + "does not want this arrangement at all.",
};

/**
 * THE THIRD KIND, and the reason it needs its own name: Chinese that is neither said nor read,
 * it is a FIELD NAME.
 *
 * `stance: { 接: n, 不接: n, 回投: n }` counts her three postures into an ops log record. The words
 * are hers, the reader is the watchtower, and the string extraction is blind to them because they
 * are identifiers rather than strings.
 *
 * The blindness was found the way these always are. `state-diff.ts` sat in the VOICE list for
 * weeks; when the extractor was rewritten to walk the source instead of pattern-matching it, that
 * file dropped to zero strings and the stale-entry guard fired. It had never held a string at all.
 * The broken regex had paired one string's closing quote with the next string's opening quote and
 * reported the identifier caught between them as one of her sentences, a phantom that filed the
 * file roughly correctly for entirely the wrong reason, and took with it the only attention that
 * file was getting. Pulling that thread found EIGHT files whose Chinese is invisible to a string
 * scan, six of which were in no list at all.
 */
export const NAMES: Record<string, string> = {
  "src/workspace/memory-watch.ts":
    "comment-only Chinese: the observer over her notebook quotes the real contaminated lines it "
    + "exists to see, and the legitimate lines a gate would have wrongly refused (「他答应明天把"
    + "照片给我」, a Walden quote). Findings quote HER lines into the fault log — evidence he "
    + "reads, never words she is given.",
  "src/index.ts":
    "接 / 不接 / 回投 as the field names of the stance histogram written into an ops log record — "
    + "a number he can look at, never a sentence she reads.",
  "src/life/vitals.ts":
    "the same three field names, in the type that record is built against. This file holds no "
    + "Chinese string at all, so nothing in the audit could see it before.",
};

const FIXTURES = ["scripts/seed-a-lived-in-home.ts"];

/**
 * ── `.ts` ONLY WAS THE SAME DEFECT TWICE, IN TWO DIFFERENT SCANNERS ──────────────────────────
 *
 * HER FACE IS NOT TYPESCRIPT. `src/embodiment/client/face.js` and `index.html` carry twenty
 * Chinese strings between them, and this walk could not see one of them, so they had never been
 * in the hand-reviewed list of her words. Among them is 「· 她看了一眼窗外」, a line about
 * her, in her third person, rendered on his page.
 *
 * The outbound-security scanner had exactly this hole yesterday and it hid a real door (the
 * microphone reaching Google). A scanner that walks one extension while the thing it audits spans
 * three is not narrow, it is blind in a shape nobody can see from the inside.
 */
export function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|js|mjs|cjs|html)$/u.test(e.name) ? [`${dir}/${e.name}`] : []);
}

/**
 * EVERY STRING LITERAL IN A FILE, SCANNED RATHER THAN PATTERN-MATCHED.
 *
 * ── WHY THIS IS A CHARACTER WALK AND NOT A REGEX ─────────────────────────────────────────────
 *
 * The previous version paired quotes with a regex, and it was WRONG IN A WAY THAT SILENTLY
 * REMOVED HER WORDS FROM THE ONE DOCUMENT ERIC RULES ON BY HAND.
 *
 * Two independent failures, both found by asking why three new sentences never appeared:
 *
 *   1. A REGEX LITERAL containing a quote, `src/index.ts` sanitises filenames with
 *      `/[<>:"/\\|?*]/`, read as the start of a string, so every quote after it paired with the
 *      wrong partner.
 *   2. Worse, and structural: a template literal's body may contain NEWLINES, so
 *      `` `…[一-鿿]…` `` will happily span from one template literal to a completely different one
 *      several hundred lines away in order to find a Chinese character. Measured: ONE such match
 *      swallowed 5,564 characters and about 290 lines of `index.ts`, and everything inside it was
 *      invisible to the extraction. It also emitted CODE as a line she reads
 *      (`, tension: stays.tension, withOther: true, }); logger.info(…`).
 *
 * No further regex fixes it: pairing delimiters is not a job a regular expression can do when the
 * delimiters nest and the contents may contain the delimiter's siblings. So this walks the source
 * once, tracking exactly what a tokeniser tracks, comments, regex literals, the three kinds of
 * string, escapes, and `${…}` interpolations, which are CODE and are replaced by an ellipsis
 * rather than being read as her words.
 *
 * The stakes are why it is worth thirty lines instead of one: this list is reviewed line by line
 * before she is woken, and the failure mode was A REVIEWED LIST THAT WAS MISSING HER WORDS,
 * with nothing anywhere able to say so.
 */
function scanSource(rel: string): { literals: Array<{ line: number; text: string }>; names: Array<{ line: number; text: string }> } {
  // HTML IS NOT JAVASCRIPT. Its words live in text nodes and attributes, not in string literals,
  // so walking it as code finds nothing, which is how her own page stayed invisible to an audit
  // whose whole job is "what has the build written that she or he can read".
  if (rel.endsWith(".html")) return { literals: htmlWords(rel), names: [] };
  // Absolute is allowed SO THAT THE PROOF BELOW CAN LIVE OUTSIDE THE TREE. Its fixtures are files
  // containing Chinese literals, and a fixture written under `src/` would be seen by every other
  // suite that walks `src/`, the guard would become the violation it hunts, intermittently,
  // depending on which fork happened to be scanning at that moment.
  const src = readFileSync(isAbsolute(rel) ? rel : join(ROOT, rel), "utf8");
  const out: Array<{ line: number; text: string }> = [];
  // Chinese standing in CODE POSITION: an object key, a type field, a variable. Not a string, so
  // the extraction above is blind to it, and for a long time so was the audit: `state-diff.ts`
  // holds 「轻快: { v: "pos", a: "high" }」 and it was only ever classified because the OLD broken
  // regex paired one string's closing quote with the next string's opening quote and reported the
  // key between them as a sentence. A phantom put it in the right list for the wrong reason, and
  // when the phantom went away so did the only thing looking at it.
  const names: Array<{ line: number; text: string }> = [];
  let word = "", wordLine = 1;
  const flushWord = (): void => {
    if (word.length > 0) { names.push({ line: wordLine, text: word }); word = ""; }
  };
  const HAS_CHINESE = /[一-鿿]/u;
  // A `/` starts a regex only after something that cannot be the left side of a division. The
  // KEYWORD half of this was missing at first, and `return /^请(?!问)/u` in `how-he-said-it.ts`
  // was read as a division. Harmless there, but a regex holding a QUOTE after a keyword would have
  // reopened the very parity hole this rewrite exists to close.
  const CAN_PRECEDE_REGEX = /[=(,:[!&|?{;+\-*%~^<>]/u;
  const KEYWORD_BEFORE_REGEX = /\b(return|typeof|case|in|of|do|else|new|delete|void|yield|await|instanceof)\s*$/u;

  // The context STACK, and the reason it is a stack rather than an inner loop: a template's `${...}`
  // may contain ANOTHER template, which may contain her words. The first walking version
  // brace-counted the interpolation and skipped it whole, so this line of `loop.ts`
  //
  //     `...${n ? `还有这些：${list.join("、")}。` : ""}`
  //
  // lost 「还有这些：」 outright. Same silent-omission failure as the regex before it, one layer in.
  type Frame =
    | { kind: "code"; prev: string }
    | { kind: "str"; quote: string; buf: string; startLine: number };
  const stack: Frame[] = [{ kind: "code", prev: "" }];
  const emit = (f: { buf: string; startLine: number }): void => {
    const text = f.buf.replace(/\s+/gu, " ").trim();
    if (text.length > 0 && HAS_CHINESE.test(text)) out.push({ line: f.startLine, text: text.slice(0, 90) });
  };

  let i = 0, line = 1;
  while (i < src.length) {
    const top = stack[stack.length - 1]!;
    const c = src[i]!;

    if (top.kind === "str") {
      if (c === "\\") { top.buf += src[i + 1] ?? ""; if (src[i + 1] === "\n") line++; i += 2; continue; }
      if (top.quote === "`" && c === "$" && src[i + 1] === "{") {
        // Descend into the expression AS CODE. The expression is not her words, but a template
        // inside it is, and an ellipsis marks where the code stood.
        top.buf += "…";
        stack.push({ kind: "code", prev: "" });
        i += 2; continue;
      }
      if (c === top.quote) { emit(top); stack.pop(); i++; continue; }
      if (c === "\n") {
        line++;
        // An unterminated `'` or `"` is malformed source, not a multi-line string. Ending it here
        // keeps one typo from swallowing the rest of the file, which is what the regex used to do.
        if (top.quote !== "`") { emit(top); stack.pop(); i++; continue; }
      }
      top.buf += c; i++; continue;
    }

    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
      i += 2; continue;
    }
    if (c === "/" && (top.prev === "" || CAN_PRECEDE_REGEX.test(top.prev)
      || KEYWORD_BEFORE_REGEX.test(src.slice(Math.max(0, i - 12), i)))) {
      let j = i + 1, inClass = false, closed = false;
      while (j < src.length && src[j] !== "\n") {
        const d = src[j]!;
        if (d === "\\") { j += 2; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        // A REGEX may hold Chinese too, `/^请(?!问)/u` is how she notices he is issuing an order.
        // It is never emitted, so it belongs with the identifiers rather than with her words, but
        // it must not simply vanish: an audit that skips a construct is an audit with a blind spot
        // shaped exactly like that construct.
        for (const m of src.slice(i, j).matchAll(/[一-鿿]+/gu)) names.push({ line, text: m[0] });
        i = j + 1; while (i < src.length && /[gimsuyd]/u.test(src[i]!)) i++; top.prev = "/"; continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      stack.push({ kind: "str", quote: c, buf: "", startLine: line });
      i++; continue;
    }
    if (c === "{") {
      // An object or block inside an interpolation: its `}` must not be read as the end of the
      // expression, so it gets its own frame. Outside one this frame is inert.
      stack.push({ kind: "code", prev: "" });
      i++; continue;
    }
    if (c === "}") { if (stack.length > 1) stack.pop(); i++; continue; }
    if (HAS_CHINESE.test(c)) { if (word.length === 0) wordLine = line; word += c; }
    else flushWord();
    if (!/\s/u.test(c)) top.prev = c;
    i++;
  }
  // Whatever is still open at EOF is malformed source, and its words are still hers.
  for (const f of stack) if (f.kind === "str") emit(f);
  flushWord();
  return { literals: out, names };
}

/** Every Chinese string literal in a file, what the build WROTE, in the places she can read it. */
export function literalsIn(rel: string): Array<{ line: number; text: string }> {
  return scanSource(rel).literals;
}

/**
 * Every Chinese IDENTIFIER in a file, a key, a field name, a symbol. Never a string, so it is
 * never emitted as text on its own; it is still her vocabulary sitting in the build, and an
 * enumeration that cannot see it cannot claim to be complete.
 */
export function namesIn(rel: string): Array<{ line: number; text: string }> {
  return scanSource(rel).names;
}

/** Every file under src/ that carries a Chinese string literal outside its comments. */
export function speakingFiles(): string[] {
  return walk("src").filter((f) => literalsIn(f).length > 0);
}

/** The ones nobody has said what they are. The audit's completeness is exactly this being empty. */
export function unclassifiedFiles(): string[] {
  return speakingFiles().filter((f) => !VOICE.includes(f) && !(f in DETECTION));
}

/** Every file under src/ carrying Chinese in a position the string extraction cannot see. */
export function namingFiles(): string[] {
  return walk("src").filter((f) => namesIn(f).length > 0);
}

/**
 * The same completeness question, asked of the Chinese that is not a string. A file may hold both
 * kinds, so one classification anywhere is enough, the question is whether ANYBODY has looked at
 * the file, not whether it was filed twice.
 */
export function unclassifiedNames(): string[] {
  return namingFiles().filter((f) => !VOICE.includes(f) && !(f in DETECTION) && !(f in NAMES));
}

// Printed only when run as a script; the guard below is what lets the scope be TESTED as well as
// looked at: an audit whose completeness rests on somebody remembering to run it is the same
// hand-maintained shape this file was rewritten to get rid of.
const RUN_AS_SCRIPT = process.argv[1]?.endsWith("_voice-audit.ts") === true;
if (RUN_AS_SCRIPT) {
const speaking = speakingFiles();
const unclassified = unclassifiedFiles();

console.log("══ VOICE — authored text that becomes hers ══");
let voiceTotal = 0;
for (const f of VOICE) {
  const found = literalsIn(f);
  if (found.length === 0) continue;
  voiceTotal += found.length;
  console.log(`\n  ${f} (${found.length})`);
  for (const { line, text } of found) console.log(`    :${line}  ${text}`);
}

console.log("\n══ DETECTION — Chinese that recognises words, and says none ══");
let detectionTotal = 0;
let detectionWords = 0;
for (const [f, why] of Object.entries(DETECTION)) {
  // TWO UNITS, PRINTED SEPARATELY. Half of these files hold their whole vocabulary in regex
  // bodies, so counting strings alone showed them as zero, and adding the two together would
  // have been worse: a count of quoted phrases plus a count of alternatives inside patterns is a
  // number that means nothing, which is the sort of total that gets quoted afterwards.
  const strings = literalsIn(f).length, words = namesIn(f).length;
  detectionTotal += strings; detectionWords += words;
  console.log(`  ${String(strings).padStart(3)} str ${String(words).padStart(3)} pat  ${f} — ${why}`);
}

console.log("\n══ NAMES — Chinese that is a FIELD NAME: neither said nor recognised ══");
let nameTotal = 0;
for (const [f, why] of Object.entries(NAMES)) {
  const n = namesIn(f).length;
  nameTotal += n;
  console.log(`  ${String(n).padStart(3)}  ${f} — ${why}`);
}
for (const f of unclassifiedNames()) {
  console.log(`  ${String(namesIn(f).length).padStart(3)}  ${f}   ← classify it in scripts/_voice-audit.ts`);
}

console.log("\n══ FIXTURES (throwaway homes only) ══");
for (const f of FIXTURES) console.log(`  ${String(literalsIn(f).length).padStart(3)}  ${f}`);

console.log("\n══ UNCLASSIFIED — a file that speaks Chinese and nobody has said what it is ══");
if (unclassified.length === 0) console.log("  (none)");
for (const f of unclassified) {
  console.log(`  ${String(literalsIn(f).length).padStart(3)}  ${f}   ← classify it in scripts/_voice-audit.ts`);
}

console.log(`\nfiles under src/ with Chinese literals: ${speaking.length}`
  + ` · voice strings ${voiceTotal} · detection strings ${detectionTotal}`
  + ` · detection pattern-words ${detectionWords} · identifier words ${nameTotal}`
  + ` · unclassified files ${unclassified.length + unclassifiedNames().length}`);
console.log("Classify each string in the voice audit; regenerate with: pnpm exec tsx scripts/_voice-audit.ts");
}
