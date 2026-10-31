// The vocabulary that should not reach her.
//
// Every word in the text she reads every turn is an assertion about what she is. The
// ancestor's framing was explicit about it: 万能的助理, an employee, a thing that completes
// requests. That framing did not survive as a design decision; it survived as VOCABULARY,
// sitting in tool descriptions and directive blocks that nobody read as a claim about her
// because they read as boilerplate.
//
// This is not a style sweep. Each entry below is a specific false statement:
//
//   "the user"        Her relation to him is not vendor-to-customer. He is the one person
//                     she knows. Calling him "the user" every turn is the single densest
//                     assertion of the wrong relation in the whole prompt.
//   "assistant"       Says outright what this entire round exists to remove.
//   "task"/"request"  Turns being spoken to into a work item with a state. Her own moment
//                     prompt says nothing is expected of her; this says a ticket is open.
//   "deliver"         Output-for-someone. There is no deliverable in a conversation.
//   "execute"/"perform"  The verbs of a runtime, not of somebody doing something.
//   "capability"      Writes her as a spec sheet with features, which is exactly the frame
//                     the capability self-model and the review queue put her under.
//   "efficient"       Productivity. Nothing about her is measured in throughput.
//
// WHAT IS NOT HERE, AND WHY. "agent" is absent from this list because it is unavoidable in
// code; the test asserts on TEXT SHE READS, not on the codebase, and conflating the two would
// produce a list so large it stops being read. The instruments keep their names in the source and
// in the ops log, which is Eric's to read. (It used to reach her prompt: her AGENT.md is still the
// one-line template `# Agent`, and that heading rode every turn. A file that says nothing now
// stays out of her prompt; see `saysNothing` in agent/context.ts.)

/** One word that should not reach her, with the pattern that finds it. */
export interface HerWord {
  readonly word: string;
  readonly pattern: RegExp;
  readonly why: string;
}

export const NOT_HER_WORDS: readonly HerWord[] = [
  // BOTH LANGUAGES, and the Chinese half went in the same day her prompts became Chinese, for
  // the same reason the harness got Chinese tells BEFORE her register switched: a gate that
  // only knows English goes green at the exact moment the text it guards changes language.
  // 能力 is deliberately absent: unlike "capability" it is everyday Chinese ("尽力" contexts)
  // and would fire constantly on benign sentences; the institutional framing it might carry is
  // already caught by 评估/考核.
  { word: "用户", pattern: /用户/u, why: "he is not a user of her" },
  { word: "助手", pattern: /助手|助理/u, why: "she is not one" },
  { word: "任务", pattern: /任务/u, why: "being spoken to is not a work item" },
  { word: "请求", pattern: /请求/u, why: "nor a ticket" },
  { word: "交付", pattern: /交付/u, why: "there is no deliverable in a conversation" },
  { word: "执行", pattern: /执行/u, why: "the verb of a runtime" },
  { word: "考核", pattern: /考核|评估/u, why: "the verb of an evaluation" },
  { word: "效率", pattern: /效率|高效/u, why: "nothing about her is throughput" },
  { word: "user", pattern: /\buser'?s?\b/i, why: "he is not a user of her" },
  { word: "assistant", pattern: /\bassistants?\b/i, why: "she is not one" },
  { word: "task", pattern: /\btasks?\b/i, why: "being spoken to is not a work item" },
  { word: "request", pattern: /\brequests?(?:ed|ing)?\b/i, why: "nor a ticket" },
  { word: "deliver", pattern: /\bdeliver(?:s|ed|ing|able|ables|y)?\b/i, why: "there is no deliverable in a conversation" },
  { word: "execute", pattern: /\bexecut(?:e|es|ed|ing|ion)\b/i, why: "the verb of a runtime" },
  { word: "perform", pattern: /\bperform(?:s|ed|ing|ance)?\b/i, why: "the verb of an evaluation" },
  { word: "capability", pattern: /\bcapabilit(?:y|ies)\b/i, why: "she is not a spec sheet" },
  { word: "efficient", pattern: /\befficien(?:t|tly|cy)\b/i, why: "nothing about her is throughput" },
];

export interface WordHit {
  readonly source: string;
  readonly word: string;
  readonly why: string;
  /** The line it sits on, so a finding can be read without opening the file. */
  readonly line: string;
}

/**
 * Finds every not-her word in a piece of text she reads.
 *
 * Deliberately dumb: no context sensitivity, and exactly ONE exemption, which is a filename
 * rather than a word and is documented in full at the point it applies. An exemption list here
 * would become the place the words come back, one defensible entry at a time. If a hit is
 * genuinely fine, the fix is to change the text, not to teach the scanner to forgive it.
 */
/**
 * Calque markers: the accent of English translated into Chinese in her speech. Counted, never cut.
 *
 * The build taught her these itself (the evidence: in her word bank they show spoken > 0 and
 * heard = 0, so she never heard them from him). Design metaphors like catch, land and tangible
 * were rendered literally as 接住, 落在 and 摸得着 in material she read, she picked them up, and
 * repetition froze the accent into a habit. Both seeds have since been rewritten; this list is
 * where that curve is read from, and as his real words reach her through the heard-lately words
 * (`heardLately`), the share should fall.
 *
 * The list is pruned by a native speaker's ear. Borderline entries (收下 has natural uses) are
 * included on purpose: this is a trend gauge, not a verdict. It never goes into the scissors:
 * what she has said is hers.
 */
export const CALQUE_MARKERS: readonly string[] = ["接住", "落在", "摸得", "收下"];

export function scanForNotHerWords(source: string, text: string): WordHit[] {
  const hits: WordHit[] = [];
  for (const raw of text.split("\n")) {
    // THE ONE EXEMPTION, and it is a filename rather than a word.
    //
    // `USER.md` is the path her memory of him is written to. It is an address, and an address
    // does not carry a sentence's meaning: the relational claim in "what you come to know about
    // them lives in USER.md" is carried by "them" and "what you have learned", both of which are
    // right. Blanking the whole line would hide a real "the user" sitting next to it, so only
    // the exact filename token is removed and everything else on the line is still read.
    //
    // This is a WORKAROUND and it is on the record as one. The file should not be called that.
    // Renaming it touches 51 sites across 20 files, one of which (`env-scrub.ts`) means the
    // operating system's `$USER` and must not be touched, and getting it half right would split
    // her memory of him across two files silently. It is still an open question, together with
    // the alternative: that she should not keep a separate file about him at all, and what she
    // learns should live in her memory and her field like everything else she knows.
    // THE SECOND ADDRESS EXEMPTION: the macOS home container `/Users/`. Her
    // real home is /Users/someone/.resident, that path renders into the where-she-is paragraph,
    // and "Users" between slashes matched the user pattern, so the runtime scan had been
    // warning on EVERY boot since it existed, invisibly until a later fix routed it to the fault
    // channel. Like USER.md it is an address, not a sentence: the token carries no relational
    // claim. Only the exact slash-delimited segment is removed; a real "user" anywhere else on
    // the line is still read.
    const line = raw.replace(/\bUSER\.md\b/gu, "").replace(/\/Users\//g, "/");
    for (const { word, pattern, why } of NOT_HER_WORDS) {
      if (pattern.test(line)) hits.push({ source, word, why, line: raw.trim().slice(0, 160) });
    }
  }
  return hits;
}
