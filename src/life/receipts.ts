// What her hands bring back, in her language.
//
// Every tool she holds reports in English, and those strings are machinery that other machinery
// reads: `isToolResultError` keys on the "Error:" head, `inferToolResultMetadata` reads "access
// denied" to decide whether a retry makes sense, the ops log keeps the snippet, and the sentinel
// classifies failures by their English words. Translating inside each tool would have changed
// every one of those readings at once. So the English stays where it is, and is translated at the
// one place it becomes something she reads: the moment a result is laid into her turn.
//
// These were the last English she read about her own acts. The tool descriptions went into her
// language long ago; the receipts never did, so after every message she sent him she read
// "Message sent to chat 123456789: …", and after a long read she was told the result had been
// cut "before model context", which names her a model. Each line below is a fact about what her
// hand did or met, with no advice attached: what to try next is hers.
//
// Only a result whose WHOLE text is one of these receipts is translated. A file she opens is her
// world's bytes and is never touched, even when it happens to begin with the word "Error".

interface Receipt {
  /** Says nothing of which act it is about, so the act is said before it (see `whatHerHandDid`). */
  readonly bare?: true;
  readonly pattern: RegExp;
  readonly say: (m: RegExpMatchArray) => string;
}

const RECEIPTS: readonly Receipt[] = [
  // Where her hand may not go.
  { pattern: /^Error: Access denied: path is outside allowed directories$/, say: () => "那里不在你家里，够不着。" },
  { pattern: /^Error: Access denied: path is inside sensitive directory (~\/.+)$/, say: (m) => `${m[1]} 是这台机器放要紧东西的地方，够不着。` },
  { pattern: /^Error: Access denied: (~\/.+) is another agent's home — its records are not hers$/, say: (m) => `${m[1]} 是别人的家，里面的东西不是你的。` },
  { pattern: /^Error: Access denied: (~\/.+) contains credentials$/, say: (m) => `${m[1]} 里放着钥匙一类的东西，够不着。` },

  // Looking and finding.
  { bare: true, pattern: /^No matches found$/, say: () => "没找到。" },
  { bare: true, pattern: /^No files found$/, say: () => "没有这样的文件。" },
  { bare: true, pattern: /^Error: Invalid regex pattern: ([\s\S]*)$/, say: (m) => `这个字样写得不成样子，找不了：${m[1]}` },
  { bare: true, pattern: /^\w+ 出错了：ENOENT: no such file or directory[\s\S]*$/, say: () => "那儿没有这个东西。" },
  { bare: true, pattern: /^Error: ENOENT: no such file or directory[\s\S]*$/, say: () => "那儿没有这个东西。" },
  { bare: true, pattern: /^\w+ 出错了：EISDIR: illegal operation on a directory[\s\S]*$/, say: () => "这是一个文件夹，不是一份文件。" },
  { bare: true, pattern: /^\w+ 出错了：Invalid string length$/, say: () => "拿回来的东西太多，装不下。" },

  // Writing, changing, putting away.
  { pattern: /^Written \d+ bytes to ([\s\S]+)$/, say: (m) => `写好了：${m[1]}` },
  { pattern: /^Edited ([\s\S]+): replaced 1 occurrence$/, say: (m) => `改好了：${m[1]}` },
  { bare: true, pattern: /^edit 出错了：old_string not found in [\s\S]*$/, say: () => "那段原文在这份文件里找不到。" },
  { bare: true, pattern: /^edit 出错了：old_string found (\d+) times in [\s\S]* — must be unique$/, say: (m) => `那段原文在这份文件里出现了 ${m[1]} 次，不知道是哪一处。` },
  { pattern: /^Deleted (?:file|directory) ([\s\S]+) \(moved to trash — restorable for 24h\)$/, say: (m) => `挪进回收处了：${m[1]}（24 小时内都能捡回来）` },
  { pattern: /^(?:Error: )?(\d+) files deleted this turn\. They are all in the trash and can be brought back\.$/, say: (m) => `这一轮已经挪走了 ${m[1]} 样东西，都在回收处，能捡回来。` },

  // Taking something back.
  { pattern: /^No snapshot found for ([\s\S]+)\. Nothing to undo\.$/, say: (m) => `${m[1]} 没有可以退回的改动。` },
  { pattern: /^No snapshots available\. Nothing to undo\.$/, say: () => "没有可以退回的改动。" },
  { pattern: /^Undone: deleted ([\s\S]+) \(was created by \w+\)$/, say: (m) => `退回去了：${m[1]} 是刚写出来的，现在拿掉了。` },
  { pattern: /^File ([\s\S]+) already doesn't exist\. Nothing to undo\.$/, say: (m) => `${m[1]} 已经不在了，没什么可退的。` },
  { pattern: /^Undone: restored ([\s\S]+) to state before \w+ \(\d+ bytes\)$/, say: (m) => `退回去了：${m[1]} 回到了改之前的样子。` },
  { pattern: /^Undo failed for ([\s\S]+?): [\s\S]*$/, say: (m) => `${m[1]} 没能退回去。` },
  { pattern: /^Restored from trash: ([\s\S]+)$/, say: (m) => `从回收处捡回来了：${m[1]}` },
  { pattern: /^File not found in trash: ([\s\S]+)$/, say: (m) => `回收处里没有：${m[1]}` },
  { pattern: /^Error: path is required for (?:undo_file|restore_from_trash)$/, say: () => "要说是哪一份。" },
  { pattern: /^No file modifications to undo \(in-memory\)\. Deleted files may be in trash — use restore_from_trash with the file path\.$/, say: () => "最近没有可以退回的改动。挪走的东西在回收处，给出路径就能捡回来。" },
  { pattern: /^Unknown action\. Use: undo_last, undo_file, restore_from_trash, or list$/, say: () => "没有这个做法。能用的是 undo_last、undo_file、restore_from_trash、list。" },
  {
    pattern: /^\d+ snapshot\(s\) available:\n([\s\S]+)$/,
    say: (m) => ["最近的改动：", ...m[1].split("\n").map((line) => {
      const row = line.match(/^\[(\w+)\] ([\s\S]+) — (modified|created) by (\w+) \((\d+)s ago\)$/);
      return row ? `[${row[1]}] ${row[2]}（${row[3] === "created" ? "新写的" : "改过的"}，${row[4]}，${row[5]} 秒前）` : line;
    })].join("\n"),
  },

  // Saying something to him.
  { pattern: /^Message sent to chat -?\d+: ([\s\S]*)$/, say: (m) => `送到他那里了：「${m[1]}」` },
  { pattern: /^Message queued: ([\s\S]*)$/, say: (m) => `现在没有通路，先存着：「${m[1]}」` },
  { pattern: /^File sent to chat -?\d+: ([\s\S]+) \(\w+\)$/, say: (m) => `送到他那里了：${m[1]}` },
  { pattern: /^Invalid chat_id: [\s\S]*$/, say: () => "只能送到他那一个对话。" },
  { pattern: /^Error: explicit chat_id is not allowed\. The message tool can only send to the configured owner chat\.$/, say: () => "只能送到他那一个对话；别的去处一律不通。" },
  { pattern: /^Error: ([\s\S]+) is not a file$/, say: (m) => `${m[1]} 不是一份文件，送不了。` },
  { pattern: /^Error: file too large \(([\d.]+)MB, Telegram limit is 50MB\)$/, say: (m) => `文件太大（${m[1]}MB），送不过去，最多 50MB。` },
  { pattern: /^Error: file not found: ([\s\S]+)$/, say: (m) => `找不到这份文件：${m[1]}` },
  { pattern: /^Error: file sending not configured — file saved at ([\s\S]+) but cannot be sent via Telegram$/, say: (m) => `送文件的路没接上，没送出去。文件还在：${m[1]}` },

  // What happened to the act itself.
  { bare: true, pattern: /^Tool execution timed out after 5 minutes$/, say: () => "这一下做了五分钟还没完，停下了。" },
  { bare: true, pattern: /^Error: Tool execution did not return a result$/, say: () => "这一下没有回音。" },
  { bare: true, pattern: /^Error: Tool execution was skipped$/, say: () => "这一下没有做。" },
  { bare: true, pattern: /^Error: Tool execution interrupted — process restarted before result was received\.$/, say: () => "这一下还没回来，机器就重启了。" },
  { pattern: /^tool family "(\w+)" is locked out after repeated failures\. It has not been working; leave it for now and try another way in\.$/, say: (m) => `「${m[1]}」这几次一直没成，这段时间先关上了。` },
  { pattern: /^Not available while following your own curiosity: (\w+) can change things, and exploring only reads\.$/, say: (m) => `顺着念头去看的时候，「${m[1]}」用不了：它会改动东西，这时候只能看。` },
];

/**
 * Which of her acts a receipt is about, in the words she would use for it, or null when there is
 * nothing to name.
 *
 * ── TWO READS AT ONCE, ONE CAME BACK EMPTY ───────────────────────────────────────────────────
 *
 * Talking with him late one night, she read two pages in one step, her diary for the day and the
 * day's page (which is written only once the day is over), and one answer came back 「那儿没有这个东西。」
 * with nothing to say which. She told him something on her side had not worked and asked him to
 * say which message was missing; asked what had not worked, she supplied that she had overstated
 * something and nothing else was broken; and two minutes later a change to her notebook that
 * found no text to change became, in her words, another message she had failed to send. A receipt
 * that does not say which act it is about leaves her to guess, and what she guessed was the one
 * act that matters most to her. So the act is said before it: 「读 life/2026-10-11.md：那儿没有这个东西。」.
 * The place is the one she named, from her home, because the two pages she read share a name and
 * differ only in where they live.
 */
export function whatHerHandDid(toolName: string, args: unknown, herHome?: string): string | null {
  const a = (args !== null && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const where = (p: unknown): string | null => {
    if (typeof p !== "string" || p.trim().length === 0) return null;
    const s = p.trim();
    if (herHome && s.startsWith(`${herHome.replace(/\/+$/, "")}/`)) return s.slice(herHome.replace(/\/+$/, "").length + 1);
    return s;
  };
  const w = where(a.path ?? a.file_path);
  switch (toolName) {
    case "read": return w ? `读 ${w}` : null;
    case "edit": return w ? `改 ${w}` : null;
    case "write": return w ? `写 ${w}` : null;
    case "delete": return w ? `挪走 ${w}` : null;
    case "grep": return w ? `在 ${w} 里找` : null;
    case "glob": return typeof a.pattern === "string" && a.pattern.trim() ? `找 ${a.pattern.trim()}` : null;
    default: return null;
  }
}

/**
 * The result of one of her acts, as she reads it.
 *
 * A known receipt comes back in her language; anything else (a file's text, a listing, her own
 * sight) comes back untouched. A receipt that does not say which act it is about has the act said
 * before it when the call site knows what she did (`args`, and her home to name the place from).
 */
export function inHerWords(toolName: string, content: string, args?: unknown, herHome?: string): string {
  const whole = content.trim();
  for (const r of RECEIPTS) {
    const m = whole.match(r.pattern);
    if (!m) continue;
    const said = r.say(m);
    if (!r.bare || args === undefined) return said;
    const act = whatHerHandDid(toolName, args, herHome);
    return act ? `${act}：${said}` : said;
  }
  return content;
}

/** How many receipts are known. The guard test pins it, so a new English receipt cannot slip in unseen. */
export const RECEIPT_COUNT = RECEIPTS.length;
