// Can this be taken back?
//
// The answer feeds Rule-of-Two, which is what decides whether an action needs confirmation. So a
// wrong answer here is a wall being opened or closed by a word count.
//
// The bash branch used to be `!IRREVERSIBLE_KEYWORDS.some(kw => JSON.stringify(args).includes(kw))`,
// every keyword, matched anywhere in the whole serialised argument blob. That is wrong in both
// directions, and badly wrong in the dangerous one:
//
//   `grep -r 'delete' .`          contains "delete"  → irreversible. Harmless, just noise.
//   `cat /var/log/deployment.log` contains "deploy"  → irreversible. Same.
//   `rm -rf ~/work`               contains NOTHING   → **reversible**
//   `git reset --hard`            contains NOTHING   → **reversible**
//   `> notes.md`                  contains NOTHING   → **reversible**
//
// So the three commands anyone would name first as unrecoverable all read as safe to do without
// asking, while reading a log file needed confirmation. It is not a threshold that wants softening;
// it is the wrong instrument. What matters is the COMMAND, not whether a word appears somewhere in
// the string.
//
// Both directions still fail safe by construction: this only ever decides whether to ASK, and the
// home boundary: which is a real wall and unconditional, runs before any of it.

/** Words that mean "this leaves" when they appear in a TOOL NAME. Never scanned against arguments. */
export const IRREVERSIBLE_KEYWORDS = [
  "delete",
  "send",
  "post",
  "publish",
  "push",
  "deploy",
  "remove",
  "drop",
  "terminate",
  "cancel",
];

const ALWAYS_REVERSIBLE_BUILTINS = new Set([
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
  "weather",
  "currency_convert",
  "places_lookup",
  "memory_search",
  "memory_read",
  "search_tools",
]);

/**
 * Commands that do not come back, matched as the command rather than as a substring.
 *
 * Deliberately generous about what counts as gone: a `mv` can be undone by hand and a `rm` cannot,
 * but both are worth a question, and the cost of asking is one confirmation while the cost of not
 * asking is somebody's afternoon.
 */
const DESTRUCTIVE_COMMANDS = new Set([
  "rm", "rmdir", "shred", "unlink", "truncate", "dd", "mkfs", "fdisk", "diskutil",
  "mv", "chown", "chmod", "kill", "killall", "pkill", "shutdown", "reboot", "halt",
  "curl", "wget", "scp", "rsync", "ssh", "nc", "ncat",
]);

/** Sub-commands that make an otherwise ordinary tool unrecoverable. */
const DESTRUCTIVE_SUBCOMMANDS: Record<string, RegExp> = {
  git: /\b(push|reset\s+--hard|clean|rebase|filter-branch|gc\s+--prune|branch\s+-D)\b/,
  npm: /\b(publish|unpublish|deprecate)\b/,
  pnpm: /\b(publish|unpublish)\b/,
  yarn: /\b(publish|unpublish)\b/,
  docker: /\b(rm|rmi|prune|kill|stop)\b/,
  kubectl: /\b(delete|drain|cordon|apply)\b/,
  brew: /\b(uninstall|remove|cleanup)\b/,
  systemctl: /\b(stop|disable|mask)\b/,
  launchctl: /\b(unload|remove|bootout)\b/,
  defaults: /\bdelete\b/,
  gh: /\b(pr\s+merge|release\s+create|repo\s+delete)\b/,
};

/** The command string out of whatever shape the tool was called with. */
function commandOf(args: unknown): string {
  if (typeof args === "string") return args;
  if (args && typeof args === "object") {
    const c = (args as { command?: unknown }).command;
    if (typeof c === "string") return c;
  }
  // `classifyReversibility` has already refused anything unreadable, so this can only be reached
  // with arguments that ARE readable and simply carry no `command`.
  return argsText(args) ?? "";
}

/**
 * Whether a shell command can be taken back.
 *
 * Splits on the separators that start a new command, so only the VERB position of each segment is
 * examined, `grep -r 'delete' .` is a grep, whatever it is searching for.
 */
export function bashIsReversible(command: string): boolean {
  if (!command.trim()) return true;
  // Redirection truncates, and does it without any command being obviously to blame.
  if (/(^|[^>])>(?!>)\s*\S/.test(command)) return false;

  for (const segment of command.split(/\||&&|\|\||;|\n/)) {
    const trimmed = segment.trim().replace(/^(sudo|command|env|nohup|time|xargs)\s+/i, "");
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const verb = (parts[0] ?? "").toLowerCase().replace(/^.*\//, ""); // /bin/rm → rm
    if (DESTRUCTIVE_COMMANDS.has(verb)) return false;
    const sub = DESTRUCTIVE_SUBCOMMANDS[verb];
    if (sub && sub.test(trimmed.toLowerCase())) return false;
  }
  return true;
}

/**
 * The arguments as text, or `null` when they cannot be read at all.
 *
 * `null` and `""` are different answers and this used to conflate them. Returning `""` on a
 * stringify failure means "there is nothing alarming in these arguments", which is the opposite of
 * what is known, and three branches below read it exactly that way: `artifact_fetch` concluded it
 * was not delivering, `web_fetch` defaulted to GET, and `bash` saw an empty command. All three
 * answered REVERSIBLE and skipped the confirmation.
 *
 * No known reachable path, because tool arguments come from parsed model JSON and so carry no cycles
 * and no BigInt. A safety check that fails in the wrong direction is worth fixing regardless: the
 * next caller is not obliged to come from there, and "unreachable today" is not a property anyone
 * re-checks.
 */
function argsText(args: unknown): string | null {
  if (args === undefined || args === null) return "";   // no arguments is not the same as unreadable
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return null;
  }
}

export function classifyReversibility(toolName: string, args?: unknown, _toolDescription?: string): boolean {
  const name = toolName.toLowerCase();
  const raw = argsText(args);
  // If it cannot be seen what she is about to do, it is not reversible. One rule, before any branch,
  // rather than three branches each having to remember it.
  if (raw === null) return false;
  const text = raw.toLowerCase();
  if (name === "artifact_fetch") {
    // The schema key was renamed deliver → send (not-her-words); a fetch that
    // sends the artifact out via Telegram is the irreversible shape.
    return !/"send"\s*:\s*true/.test(text);
  }
  if (name === "web_fetch") {
    const method = /"method"\s*:\s*"([^"]+)"/.exec(text)?.[1]?.toUpperCase() ?? "GET";
    return method === "GET" || method === "HEAD";
  }
  if (name === "self") return /"operation"\s*:\s*"read"/.test(text);
  if (name === "undo") return true;
  if (name === "video_extract" || name === "document_extract" || name === "image_edit" || name === "browser_capture") {
    return true;
  }
  if (name === "connect_mcp") {
    return true;
  }
  if (ALWAYS_REVERSIBLE_BUILTINS.has(name)) return true;
  if (name === "message") return false;
  if (name === "cron") {
    return /"action"\s*:\s*"list"/.test(text);
  }
  if (name === "delete") return true; // builtin delete moves to trash and is undoable.
  if (name === "bash") return bashIsReversible(commandOf(args));
  // MCP tools: scan tool name for irreversible keywords
  return !IRREVERSIBLE_KEYWORDS.some((kw) => name.includes(kw));
}
