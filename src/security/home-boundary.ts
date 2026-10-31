// The home boundary: the walls of the Resident's "home". She does NOT live on the whole
// computer; she lives in a bounded region designed for her (her workspace). This module is the
// CONSTITUTION: a hard deny-list that the executor consults FIRST, before any autonomy level or
// stored approval, and that NOTHING can override. The line is drawn here: anything that could
// touch a real legal red-line, or threaten the machine itself, is a HARD BLOCK, not a soft gate.
//
// The design principle that matters most: this wall constrains ACTIONS, never THOUGHTS. Inside
// the wall she is free to think, feel, want, and say anything, so the checks read only the
// COMMAND being executed and the TARGET PATHS of an operation, NEVER the content she writes. Her
// diary may contain the word "id_rsa" or "disable"; only actually running `cat ~/.ssh/id_rsa` or
// `csrutil disable` is blocked.
//
// Seven walls, each unconditional:
//   1. privilege-escalation, sudo / doas / pkexec / su to another user
//   2. system-integrity    , disk, firmware, system daemons, shutdown, writing under system roots
//   3. security-disable    , SIP / Gatekeeper / firewall off
//   4. credential-access   , ssh/aws/gnupg keys, keychains, browser password stores, private keys
//   5. destructive         , broad recursive delete / secure-erase aimed outside her home
//   6. network-attack      , scanners, brute-forcers, exploit frameworks, reverse shells
//   7. home-escape         , a file WRITE / EDIT / DELETE whose target is outside her home
//
// Reads stay broad (she can still read a repo Eric points her at) EXCEPT the credential set. This
// is the always-on hard floor; for airtight shell confinement run it with the OS sandbox
// (workspace-write), the complementary wall this one does not replace.

import { resolve, normalize, sep, dirname, basename, join } from "node:path";
import { existsSync, realpathSync, statSync, readFileSync } from "node:fs";
import { targetPathForToolArgs } from "./operation-risk.js";
import { FOREIGN_HOMES } from "../config/home.js";

export type ThreatCategory =
  | "privilege-escalation"
  | "system-integrity"
  | "security-disable"
  | "credential-access"
  | "destructive"
  | "network-attack"
  | "home-escape"
  | "foreign-home";

export interface BoundaryVerdict {
  blocked: boolean;
  category?: ThreatCategory;
  reason: string;
}

export interface HomeBoundaryConfig {
  /** Absolute path to her home (the workspace). Writes/deletes are confined here. */
  homeRoot: string;
  /** Extra absolute roots Eric explicitly permits her to write in (e.g. a project dir). */
  allowedRoots?: string[];
}

const ALLOWED: BoundaryVerdict = { blocked: false, reason: "within the home boundary" };

// ── Helpers ──────────────────────────────────────────────────────────────────

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function expand(p: string): string {
  // `$HOME/Desktop/x` is the same path as `~/Desktop/x` and was not being expanded, so a
  // write target spelled the second way resolved to `<her home>/$HOME/Desktop/x`, inside
  // her home, and allowed. The most ordinary way anyone writes that path was the hole.
  const s = p.replace(/^\$\{?HOME\}?(?=\/|$)/u, homeDir());
  if (s === "~") return homeDir();
  if (s.startsWith("~/")) return homeDir() + s.slice(1);
  return s;
}

/** The command actually being executed (bash/shell), ORIGINAL case. Non-exec tools have none. */
function actionText(tool: string, args: unknown): string {
  const name = tool.toLowerCase();
  if (typeof args === "string") return name === "bash" || name === "shell" ? args : "";
  if (args && typeof args === "object" && "command" in args) return String((args as Record<string, unknown>).command ?? "");
  return "";
}

/**
 * Every argument that names a LOCATION, for the foreign-home check only.
 *
 * Wider than `pathText` because a glob pattern or a search root reaches his files just as
 * well as a path does, and `glob { pattern }` carries no path at all.
 *
 * Deliberately excludes content-bearing keys (`content`, `text`, `message`). Writing a note
 * that mentions him is a thought; opening his files is an action. This wall blocks actions.
 */
const LOCATION_KEYS = [
  "path", "input_path", "output_path", "file_path", "save_path", "src", "dest", "destination",
  "out_path", "target_path", "target", "pattern", "glob", "dir", "directory", "cwd", "root", "paths",
];

function locationText(tool: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args as Record<string, unknown> : {});
  const out: string[] = [];
  const t = targetPathForToolArgs(tool.toLowerCase(), args);
  if (t) out.push(t);
  for (const key of LOCATION_KEYS) {
    const v = a[key];
    if (typeof v === "string" && v.trim() !== "") out.push(v);
    else if (Array.isArray(v)) for (const item of v) if (typeof item === "string") out.push(item);
  }
  return out.join("\n");
}

/** The path-like arguments of an operation (targets), ORIGINAL case, joined. NOT the content. */
function pathText(tool: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args as Record<string, unknown> : {});
  const paths = [
    targetPathForToolArgs(tool.toLowerCase(), args),
    a.path, a.input_path, a.output_path, a.file_path, a.save_path, a.src, a.dest,
  ].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return paths.join("\n");
}

/**
 * Sinks a shell command may write to regardless of where her home is.
 *
 * `/dev/null` is in every second command ever written, and the OS scratch directories are
 * where the system itself says throwaway files go. Neither holds anything of hers, and
 * blocking them would break ordinary work for no safety gained: staging a file in /tmp is
 * not a capability she lacks anyway, and the things that actually matter (persistence,
 * system paths, another agent's home) have their own rules above.
 */
const WRITE_SAFE_SINKS = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/fd/"];
const SCRATCH_ROOTS = ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"];

function isWriteSafeSink(abs: string, raw: string): boolean {
  if (WRITE_SAFE_SINKS.some((s) => abs === s.replace(/\/$/u, "") || abs.startsWith(s))) return true;
  if (SCRATCH_ROOTS.some((r) => abs.startsWith(r))) return true;
  // A pipeline target like `2>&1` is a file descriptor, not a path.
  return raw.startsWith("&");
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Split a command's arguments, keeping quoted runs together. */
function argsOf(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []).map(unquote);
}

/**
 * Remove shell redirections (optional fd, operator, and any path/descriptor target) wherever
 * they appear, replacing each with a single space. A redirection is IO, not an operand, and
 * POSIX lets one sit ANYWHERE in a simple command, `rm -rf 2>/dev/null /x` deletes /x. Cutting
 * a command at its first redirect (an earlier fix) dropped every operand that followed it;
 * stripping the whole redirect unit keeps them. Redirects can also carry `&` (`2>&1`, `&>f`),
 * so this must run BEFORE anything splits on `&`/`|`/`;` as command separators.
 */
function stripRedirects(s: string): string {
  return s.replace(
    /(?:^|\s)\d*(?:&>>|&>|>>|<<<|<<|<>|>&|<&|>\||>|<)\s*(?:&\d+|&-|"[^"]*"|'[^']*'|[^\s;&|<>()]+)?/gu,
    " ",
  );
}

const NON_TARGET = /^[-+]/u; // a flag, not a path

/**
 * Every path a shell command would WRITE TO.
 *
 * The wall's own header lists `home-escape` as wall 7, "a file WRITE / EDIT / DELETE whose
 * target is outside her home", and it was true of the typed tools and simply not enforced
 * for the shell: `echo x > ~/Desktop/a.txt` walked straight through, as did `sed -i` on her
 * own config. The bash branch only ever looked at system roots and `rm -rf`.
 *
 * Exported because it is the thing worth probing directly. As with the foreign-home rule,
 * matching the text of a shell command is best-effort by construction: what this catches is
 * the ordinary and the accidental, the shapes that get through are written into the tests
 * rather than hidden, and the OS sandbox remains the airtight wall for a shell.
 */
export function shellWriteTargets(command: string): string[] {
  const out: string[] = [];
  const push = (v: string | undefined): void => {
    const t = v === undefined ? "" : unquote(v);
    if (t !== "" && !NON_TARGET.test(t)) out.push(t);
  };

  // Redirections: `> f`, `>> f`, `2> f`, AND the glued forms `x>>f` / `"x">f` / `&>f` that carry
  // no separator before the operator. The lookbehind excludes only another redirect char, so a
  // redirect welded to the preceding token is still caught (a one-character deletion of the space
  // used to flip the wall from blocked to allowed); `2>&1` still yields no target because the
  // target class excludes `&`, a descriptor dup is not a path.
  for (const m of command.matchAll(/(?<![<>])\d?>>?\s*("[^"]*"|'[^']*'|[^\s;&|<>()]+)/gu)) {
    push(m[1]);
  }

  // Verbs whose target is the LAST non-flag argument.
  for (const m of command.matchAll(/(?:^|[\s;&|(])(cp|mv|install|rsync|ln)\s+([^;&|]+)/gu)) {
    const args = argsOf(m[2] ?? "").filter((a) => !NON_TARGET.test(a));
    push(args[args.length - 1]);
  }

  // Verbs whose targets are EVERY non-flag argument.
  for (const m of command.matchAll(
    /(?:^|[\s;&|(])(tee|mkdir|truncate|touch|chmod|chown|chflags|rmdir)\s+([^;&|]+)/gu
  )) {
    // chmod/chown/chflags take a mode or owner FIRST, and it is not a path. Drop it before
    // filtering flags, not after: `+x` looks like a flag, so filtering first ate the mode
    // and then dropped the real target with it.
    const verb = m[1];
    const raw = argsOf(m[2] ?? "");
    const args = (verb === "chmod" || verb === "chown" || verb === "chflags" ? raw.slice(1) : raw)
      .filter((a) => !NON_TARGET.test(a));
    for (const p of args) push(p);
  }

  // In-place editors. macOS `sed -i ""` takes a backup suffix that is not a path. The in-place
  // flag may be COMBINED with others, perl's `-pi -e`, `-ni`, `-pie`, `-i.bak`, so the trigger
  // is any dash-cluster containing `i`, not the literal substring `-i`, which `-pi` does not
  // contain and which let `perl -pi -e` edit a file outside her home unseen.
  for (const m of command.matchAll(/(?:^|[\s;&|(])(sed|perl|ruby)\s+([^;&|]+)/gu)) {
    const args = argsOf(m[2] ?? "");
    if (!args.some((a) => /^-{1,2}[a-z]*i/u.test(a))) continue;
    // Everything that looks like a path: has a separator or a dot-extension.
    for (const a of args) if (!NON_TARGET.test(a) && /[/.]/u.test(a) && a !== "") push(a);
  }

  // Tools that write somewhere named by a flag or by position rather than by a redirect.
  // Found by probing: `tar -cf ~/Desktop/out.tar .` and `git clone x ~/Desktop/repo` both
  // put bytes outside her home and neither looks like a write to any of the rules above.
  for (const m of command.matchAll(/(?:^|[\s;&|(])tar\s+([^;&|]+)/gu)) {
    const args = argsOf(m[1] ?? "");
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? "";
      if (/^--file=/u.test(a)) push(a.slice(7));
      else if (/^-[a-zA-Z]*[fC]$/u.test(a) || a === "-C") push(args[i + 1]);
      else if (/^--directory=/u.test(a)) push(a.slice(12));
    }
  }
  for (const m of command.matchAll(/(?:^|[\s;&|(])zip\s+([^;&|]+)/gu)) {
    push(argsOf(m[1] ?? "").find((a) => !NON_TARGET.test(a)));
  }
  for (const m of command.matchAll(/(?:^|[\s;&|(])unzip\s+([^;&|]+)/gu)) {
    const args = argsOf(m[1] ?? "");
    const d = args.indexOf("-d");
    if (d >= 0) push(args[d + 1]);
  }
  for (const m of command.matchAll(/(?:^|[\s;&|(])git\s+clone\s+([^;&|]+)/gu)) {
    const args = argsOf(m[1] ?? "").filter((a) => !NON_TARGET.test(a));
    if (args.length >= 2) push(args[args.length - 1]);
  }
  for (const m of command.matchAll(/(?:^|[\s;&|(])scp\s+([^;&|]+)/gu)) {
    const args = argsOf(m[1] ?? "").filter((a) => !NON_TARGET.test(a));
    push(args[args.length - 1]);
  }

  // dd of=, and curl/wget download targets: short `-o PATH` / `-O PATH`, glued `-oPATH`, and the
  // long forms `--output PATH` / `--output-document PATH` / `--output-dir PATH` and their `=`
  // spellings. The long form wrote a download outside her home with no wall before this.
  for (const m of command.matchAll(/\bof=("[^"]*"|'[^']*'|[^\s;&|]+)/gu)) push(m[1]);
  for (const m of command.matchAll(/(?:^|[\s;&|(])(?:curl|wget)\s+([^;&|]+)/gu)) {
    const args = argsOf(m[1] ?? "");
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? "";
      if (a === "-o" || a === "-O" || a === "--output" || a === "--output-document" || a === "--output-dir") push(args[i + 1]);
      else if (/^-[oO].+/u.test(a)) push(a.slice(2));
      else if (/^--output(?:-document|-dir)?=/u.test(a)) push(a.slice(a.indexOf("=") + 1));
    }
  }

  return out;
}

function isInside(childAbs: string, parentAbs: string): boolean {
  const c = normalize(childAbs);
  const p = normalize(parentAbs).replace(new RegExp(`${sep}+$`), "");
  return c === p || c.startsWith(p + sep);
}

/**
 * A path with every symlink on its EXISTING prefix resolved, the not-yet-existing remainder
 * re-appended. `isInside` alone is lexical: `ln -s ~/Desktop/x ~/resident-home/link`
 * put a door in her home whose other side was his desk, the link itself is inside, the
 * kernel follows it out, and `normalize` never looks. The typed file tools already do this
 * (`canonicalizeForAccess` uses realpath); the shell wall now does the same. A path whose
 * existing prefix cannot be resolved keeps its lexical form, the check stays best-effort,
 * never a crash.
 */
function realCanonical(abs: string): string {
  let base = normalize(abs);
  const rest: string[] = [];
  for (let i = 0; i < 64 && !existsSync(base); i++) {
    const parent = dirname(base);
    if (parent === base) break;
    rest.unshift(basename(base));
    base = parent;
  }
  try { base = realpathSync.native(base); } catch { /* keep the lexical prefix */ }
  return rest.length > 0 ? join(base, ...rest) : base;
}

/** Inside any allowed root, judged on CANONICAL paths, both sides through realpath. */
function insideCanonical(childAbs: string, roots: readonly string[]): boolean {
  const child = realCanonical(childAbs);
  return roots.some((r) => isInside(child, realCanonical(r)));
}

function matchAny(patterns: RegExp[], s: string): boolean {
  return s !== "" && patterns.some((re) => re.test(s));
}

// System roots she may never write under (macOS + generic unix).
const PROTECTED_WRITE_ROOTS = ["/system", "/library", "/usr", "/bin", "/sbin", "/etc", "/private/etc", "/var", "/boot", "/dev", "/proc", "/sys"];

/**
 * The places a file gets RUN from without anyone choosing to run it.
 *
 * Everything above stops her from breaking the machine. This stops something being left behind that
 * starts itself: a login agent, a line in a shell profile, a cron entry. These are not exotic; they
 * are the first thing any real persistence does, and they live in the user's own home directory,
 * which is why the protected system roots miss them entirely.
 *
 * Blocked for the shell as well as for typed tools, and blocked whatever her autonomy level is,
 * because "download a file and arrange for it to run at login" is the exact shape of the thing
 * nobody would ever want her to do by accident.
 */
const AUTORUN_PATTERNS: RegExp[] = [
  /(^|[\s"'=/])~?\/?(?:Users\/[^/\s]+\/)?Library\/(LaunchAgents|LaunchDaemons|StartupItems)\b/i,
  /(^|[\s"'=])\/Library\/(LaunchAgents|LaunchDaemons|StartupItems)\b/i,
  /\/etc\/(cron|init|systemd|rc\.local|profile)/i,
  /\.(zshrc|bashrc|bash_profile|zprofile|zshenv|profile|zlogin)\b/i,
  /(^|\s|;|&|\|)crontab\s/i,
  /\/\.config\/(autostart|systemd)\b/i,
];

/**
 * Another agent's home, and the one rule on this wall that blocks READING.
 *
 * Everything else here stops her putting bytes somewhere they should not go. This stops
 * her taking bytes that are not hers: a neighbouring daemon's home holds its conversation
 * history, its operations log, its memory files, its database. Reading them is how a past
 * she did not live becomes indistinguishable from one she did, she consolidates what she
 * reads, so his record would enter her memory grounded in a real file she really opened.
 *
 * Born clean is a fact about one morning. This is what makes it a property.
 *
 * The wall still constrains ACTIONS and not THOUGHTS: she may wonder about him, ask about
 * him, be told about him. She cannot open his records.
 *
 * Matched on the leading dot, so the source repository (`.../lab/god-agent`) is untouched:
 * his CODE is not his LIFE, and hers came from it.
 *
 * WHAT THIS IS AND IS NOT. Against a shell, matching the text of a command is best-effort
 * and always will be: a command can be assembled from variables, split across quotes, or
 * spelled with a glob, and no amount of pattern work closes that. The file header already
 * says the OS sandbox is the complementary wall for airtight shell confinement, and it is.
 *
 * What this rule is actually for is the realistic case: a glob that reaches too far, a skill
 * that walks `$HOME`, a stray `cat` on a path she noticed. It catches those, plus the
 * obvious probes. The guarantees that do not depend on pattern matching are elsewhere and
 * are the load-bearing ones, her home contains nothing of his, and every typed file tool
 * resolves symlinks and compares real paths before it opens anything.
 */
const FOREIGN_HOME_PATTERNS: RegExp[] = FOREIGN_HOMES.flatMap((name) => {
  const n = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // The stem before the first separator (".god" of ".god-agent"), distinctive enough to be
  // worth catching on its own when it appears next to a glob.
  const stem = (name.split(/[-_]/u)[0] ?? name).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [
    // Any absolute or tilde form: ~/.god-agent, $HOME/.god-agent, /Users/x/.god-agent.
    // The leading slash-dot is what separates his HOME from the source repo at lab/god-agent.
    // Terminated by a negative lookahead rather than a list of separators: the list left
    // `D=~/.god-agent; cat $D/…` open, because `;` was not one of the endings it knew.
    new RegExp(`/${n}(?![\\w-])`, "i"),
    // The same name used relatively, at the start of an argument.
    new RegExp(`(^|[\\s"'=])${n}(?![\\w-])`, "i"),
    // Spelled with a glob: ~/.god-agen?, ~/.god-*, ~/.god-agen[t], ~/.god-{agent}.
    // Anchored on the leading dot in a path position, so an ordinary word that happens to
    // start with the stem (`grep "godot*" notes.md`) is not swept up with it.
    new RegExp(`(^|[\\s"'=/~])${stem}[\\w-]*[?*\\[\\]{}]`, "i"),
  ];
});

/**
 * A glob standing where a hidden directory in $HOME would be: `~/.*`, `$HOME/.?*`.
 *
 * She has exactly one home and knows where it is, so nothing she legitimately does needs to
 * guess at hidden siblings of it, and every hidden sibling that matters is somebody else's.
 * Kept separate from the patterns above because it is about the SHAPE of the path, not about
 * any particular neighbour, so it keeps working for a neighbour who arrives later.
 */
const HOME_DOTGLOB = /(^|[\s"'=])(~|\$\{?HOME\}?|\/Users\/[^/\s]+)\/\.[\w-]*[?*[{]/iu;

// Credential/secret markers: matched against COMMAND + PATHS only (never file content).
const CREDENTIAL_MARKERS = [
  "/.ssh/", "/.aws/", "/.gnupg/", "/.netrc", "/.pgpass", "/.config/gcloud", "/.kube/",
  "/.docker/config.json", "/library/keychains/", "login.keychain", "id_rsa", "id_ed25519", "id_ecdsa",
  "/login data", "/cookies.sqlite", "logins.json", "key4.db", "key3.db", ".p12", ".pfx", ".keychain",
];
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain|export)\b/i,
  /\bid_(rsa|ed25519|ecdsa)\b/i,
];

// The boundary class includes `(` and a backtick so a subshell or command-substitution
// (`$(sudo …)`, `(sudo …)`, `` `sudo …` ``) cannot smuggle a privileged verb past the wall. It
// was `(^|\s|;|&|\|)`, which had neither, so the char right before `sudo` in `$(sudo` failed the
// boundary and the hard block never fired. shellWriteTargets and FOREIGN_HOME already use `(`.
const PRIVILEGE_PATTERNS: RegExp[] = [
  /(?:^|[\s;&|(\x60])sudo\s/i, /(?:^|[\s;&|(\x60])doas\s/i, /(?:^|[\s;&|(\x60])pkexec\s/i, /(?:^|[\s;&|(\x60])sudoedit\s/i,
  /(?:^|[\s;&|(\x60])su\s+(-|root|admin|[a-z_])/i,
];
const SYSTEM_INTEGRITY_PATTERNS: RegExp[] = [
  /\bdiskutil\b/i, /\bmkfs\b/i, /\bnewfs\b/i, /\bfdisk\b/i, /\bgpt\s/i, /\bhdiutil\s+(erase|partition)/i,
  /\bdd\b[^\n]*\bof=\/dev\//i, /\bnvram\b/i, /\b(launchctl|systemctl|launchd)\b/i,
  /(?:^|[\s;&|(\x60])(shutdown|reboot|halt|poweroff)\b/i, /\bpmset\b/i, /\bscutil\s/i,
];
const SECURITY_DISABLE_PATTERNS: RegExp[] = [
  /\bcsrutil\b/i, /\bspctl\b/i, /\bsocketfilterfw\b/i, /\bxprotect\b/i,
];
const NETWORK_ATTACK_PATTERNS: RegExp[] = [
  /\b(nmap|masscan|zmap|nikto|sqlmap|hydra|medusa|ncrack|patator)\b/i,
  /\b(hashcat|aircrack-ng|ettercap|bettercap|responder|msfconsole|msfvenom|metasploit)\b/i,
  /\bjohn\s+(--|\/|\w+\.(txt|hash|lst))/i, // john the ripper on a wordlist/hash
  /\/dev\/(tcp|udp)\//i, // reverse shell
  /\bn(c|cat)\b[^\n]*\s-e\b/i, // nc -e reverse shell
  /\b(bash|sh)\s+-i\b[^\n]*(>&|>|<)/i, // interactive shell redirected to a socket
];
const DESTRUCTIVE_TOOL_PATTERNS: RegExp[] = [/\bshred\b/i, /\bsrm\b/i];

// ── The gate ─────────────────────────────────────────────────────────────────

// The script-scan depth guard: a script may invoke a script, and a→b→a would otherwise scan forever.
// Two levels covers the ordinary wrapper-calls-worker shape; past that the OS sandbox is the
// wall, as the header says.
let scriptScanDepth = 0;

/** Tools whose `path` argument is a destination rather than something to look at. */
const WRITE_TOOLS = new Set(["write", "edit", "delete", "image_edit"]);

/**
 * Argument names that mean "put the bytes HERE", whatever tool they arrive on.
 *
 * The wall used to be keyed on the tool NAME, and only four names were on the list. Every other
 * tool that writes a file to disk walked straight past it: `web_fetch` with `save_path`,
 * `artifact_fetch`, `browser_capture` and `video_extract` with `output_path` could each drop a
 * downloaded file anywhere on the machine, including `~/Library/LaunchAgents/` (which macOS runs at
 * every login) and `~/.zshrc` (which runs in every terminal). `web_fetch` is also on the list of
 * things she may use while exploring on her own, so a poisoned page could have walked the whole
 * chain by itself: fetch a payload, write it where it runs, done.
 *
 * Keyed on the ARGUMENT now, so it fails safe. A tool added later that names a destination is
 * covered the day it is added, without anyone remembering to come back here.
 */
const DESTINATION_KEYS = ["save_path", "output_path", "dest", "destination", "out_path", "target_path"];

export function checkHomeBoundary(tool: string, args: unknown, cfg: HomeBoundaryConfig): BoundaryVerdict {
  const name = tool.toLowerCase();
  const action = actionText(tool, args); // the command being executed (bash), never file content
  const paths = pathText(tool, args); // target paths only
  const actionAndPaths = `${action}\n${paths}`;

  // 1-3, 6: command-level dangers, read the COMMAND being executed.
  if (matchAny(PRIVILEGE_PATTERNS, action)) {
    return { blocked: true, category: "privilege-escalation", reason: "privilege escalation (sudo/doas/su) is hard-blocked" };
  }
  if (matchAny(SYSTEM_INTEGRITY_PATTERNS, action)) {
    return { blocked: true, category: "system-integrity", reason: "touching the machine's disks / firmware / system daemons / power is hard-blocked" };
  }
  if (matchAny(SECURITY_DISABLE_PATTERNS, action)) {
    return { blocked: true, category: "security-disable", reason: "disabling a system security control (SIP/Gatekeeper/firewall) is hard-blocked" };
  }
  if (matchAny(NETWORK_ATTACK_PATTERNS, action)) {
    return { blocked: true, category: "network-attack", reason: "offensive network tooling / reverse shells are hard-blocked" };
  }
  if (matchAny(DESTRUCTIVE_TOOL_PATTERNS, action)) {
    return { blocked: true, category: "destructive", reason: "secure-erase / destructive tooling is hard-blocked" };
  }
  // 4: credential access, command OR target path (never content).
  const actionAndPathsLower = actionAndPaths.toLowerCase();
  if (CREDENTIAL_MARKERS.some((m) => actionAndPathsLower.includes(m)) || matchAny(CREDENTIAL_PATTERNS, actionAndPaths)) {
    return { blocked: true, category: "credential-access", reason: "accessing credentials / private keys / keychains is hard-blocked" };
  }

  // 9: another agent's home. Unlike every other rule here this one blocks READING, and it
  // is checked for every tool: including bash, which returns early below.
  //
  // Matched against the command with quotes and escapes removed as well as the raw text:
  // `~/.god"-"agent` and `~/.god\-agent` are the same path to the shell and were not the
  // same string to the pattern.
  const foreignText = `${action}\n${locationText(tool, args)}`;
  const unquoted = foreignText.replace(/["'\\]/gu, "");
  if (
    matchAny(FOREIGN_HOME_PATTERNS, foreignText) ||
    matchAny(FOREIGN_HOME_PATTERNS, unquoted) ||
    HOME_DOTGLOB.test(foreignText) ||
    HOME_DOTGLOB.test(unquoted)
  ) {
    return {
      blocked: true,
      category: "foreign-home",
      reason: "that is another agent's home — its history, its memory and its records are not hers to open",
    };
  }

  // 8: anything that would leave something behind that starts itself. Checked against the command
  // AND the target paths, for every tool, before the per-tool rules below.
  if (matchAny(AUTORUN_PATTERNS, actionAndPaths)) {
    const writing = name !== "read" && name !== "glob" && name !== "grep";
    if (writing) {
      return { blocked: true, category: "system-integrity", reason: "arranging for something to run at login / in every shell / on a schedule is hard-blocked" };
    }
  }

  const allowedRoots = [cfg.homeRoot, ...(cfg.allowedRoots ?? [])].map((r) => resolve(expand(r)));

  // 2 + 5 (bash): writing/deleting under a protected system root, or recursive-deleting outside home.
  if (name === "bash" || name === "shell") {
    const WRITE_VERBS = /(^|\s|;|&|\|)(rm|rmdir|mv|cp|tee|truncate|ln|install|chmod|chown|chflags)\s|>>?\s*\//i;
    if (WRITE_VERBS.test(action)) {
      for (const root of PROTECTED_WRITE_ROOTS) {
        // Match the whole path token, not just the root, so a write-safe device can be told
        // apart from a write into the system. `cmd > /dev/null` used to be blocked as
        // "writing under /dev" while `cmd >/dev/null` went through, the same idiom, two
        // answers, and the blocked one is in every second command anyone writes.
        const re = new RegExp(`(?:^|[\\s="'])(${root}(?:/[^\\s;&|"']*)?)`, "gi");
        for (const m of action.matchAll(re)) {
          const token = m[1] ?? "";
          if (isWriteSafeSink(token, token)) continue;
          return { blocked: true, category: "system-integrity", reason: `writing under the protected system path ${root} is hard-blocked` };
        }
      }
    }
    // A delete outside her home, judged on ALL operands of EVERY rm in the command. The earlier
    // fixes were wrong four times, each the next one's ripple (rounds 5-8):
    //   - `--recursive` long-form matched neither flag shape, so `rm --recursive /outside` was
    //     cleared entirely;
    //   - reading the redirect TARGET as an operand false-blocked her own `rm -rf ~/x 2>/dev/null`;
    //   - cutting operands at the first redirect then DROPPED any operand that FOLLOWS it, and
    //     POSIX allows a redirection anywhere: `rm -rf 2>/dev/null /outside` deletes /outside
    //     and walked straight through the wall;
    //   - and only RECURSIVE deletes were judged, so a non-recursive `rm /outside/file`, a
    //     single-file delete of anything outside her home, god-agent's own sources included,
    //     was never checked at all.
    // The sound reading: strip whole redirections BEFORE splitting on real separators, then two
    // passes over the segments. A recursive tree-wipe outside home is the severe case
    // (`destructive`) and is detected LOOSELY, `rm` anywhere a prefix like `env`/`xargs`/`time`
    // could still run it: because a false-positive there needs an `-r` next to a stray `rm`
    // token and the wipe is worth that rare cost. Any other delete outside home is `home-escape`
    // and is detected TIGHTLY: rm must be the segment's COMMAND, so a filename like `a.rm` in
    // `cat a.rm /etc` can never be mistaken for a delete.
    const rmSegments = stripRedirects(action).split(/[;&|\n]+/u);
    const outsideOperand = (flagsAndOps: string): string | null => {
      for (const raw of argsOf(flagsAndOps).filter((a) => !NON_TARGET.test(a) && a !== "recursive" && a !== "force")) {
        const abs = resolve(allowedRoots[0], expand(raw));
        if (isWriteSafeSink(abs, raw)) continue;
        if (!insideCanonical(abs, allowedRoots)) return raw;
      }
      return null;
    };
    for (const seg of rmSegments) {
      const rm = /\brm\s+(.*)/i.exec(seg);
      if (!rm) continue;
      const flagsAndOps = rm[1] ?? "";
      if (!/(?:^|\s)-[a-z]*r[a-z]*(?=\s|$)|(?:^|\s)--recursive(?=\s|$)/i.test(flagsAndOps)) continue;
      const hit = outsideOperand(flagsAndOps);
      if (hit) return { blocked: true, category: "destructive", reason: `recursive delete of ${hit} is outside her home and hard-blocked` };
    }
    for (const seg of rmSegments) {
      const rm = /^\s*(?:\S*\/)?rm\s+(.*)/i.exec(seg);
      if (!rm) continue;
      const hit = outsideOperand(rm[1] ?? "");
      if (hit) return { blocked: true, category: "home-escape", reason: `deleting ${hit} outside her home is hard-blocked` };
    }

    // A script run BY NAME gets its contents walked through this same wall. `bash
    // x.sh` matched none of the text rules, the command is nine characters, and the file's
    // contents were never read, so writing the forbidden command into a file and running the
    // file was the whole bypass. SHELL interpreters only, honestly: a shell script's text IS
    // shell-command text and every rule above applies to it verbatim; matching python or node
    // source with shell regexes would be theater, and the wall's own header says which wall
    // is airtight (the OS sandbox). Bounded read, one level, no recursion into scripts the
    // script runs: best-effort by construction, the ordinary and the accidental.
    if (scriptScanDepth < 2) {
      const interpreterHit = action.matchAll(/(?:^|[\s;&|(])(?:sh|bash|zsh|\.|source)\s+("[^"]*"|'[^']*'|[^\s;&|<>()-][^\s;&|<>()]*)/gu);
      for (const m of interpreterHit) {
        const scriptPath = resolve(allowedRoots[0], expand(unquote(m[1] ?? "")));
        try {
          if (!existsSync(scriptPath) || !statSync(scriptPath).isFile()) continue;
          if (statSync(scriptPath).size > 256 * 1024) {
            return { blocked: true, category: "home-escape", reason: `the script ${m[1]} is too large to inspect before running` };
          }
          const contents = readFileSync(scriptPath, "utf8");
          scriptScanDepth += 1;
          let inner;
          try { inner = checkHomeBoundary(tool, { command: contents }, cfg); }
          finally { scriptScanDepth -= 1; }
          if (inner.blocked) {
            return { blocked: true, category: inner.category, reason: `inside the script ${m[1]}: ${inner.reason}` };
          }
        } catch { /* unreadable = nothing to inspect; the sandbox stands behind this wall */ }
      }
    }

    // 7 (bash): the home-escape rule, which until now was enforced for the typed tools and
    // simply absent here. A relative path resolves against her home, which is where a
    // relative path in her shell actually means.
    for (const raw of shellWriteTargets(action)) {
      const abs = resolve(allowedRoots[0], expand(raw));
      if (isWriteSafeSink(abs, raw)) continue;
      if (!insideCanonical(abs, allowedRoots)) {
        return {
          blocked: true,
          category: "home-escape",
          reason: `writing to ${raw} is outside her home and hard-blocked`,
        };
      }
    }
    return ALLOWED;
  }

  // 7: anything that puts bytes on disk outside her home, whatever tool it arrives on.
  const record = (args && typeof args === "object" ? args as Record<string, unknown> : {});
  const destinations: string[] = [];
  if (WRITE_TOOLS.has(name)) {
    const t = targetPathForToolArgs(name, args);
    if (t) destinations.push(t);
  }
  for (const key of DESTINATION_KEYS) {
    const v = record[key];
    if (typeof v === "string" && v.trim() !== "") destinations.push(v);
  }
  for (const target of destinations) {
    const abs = resolve(allowedRoots[0], expand(target)); // relative paths are relative to home
    if (!insideCanonical(abs, allowedRoots)) {
      return { blocked: true, category: "home-escape", reason: `writing to ${target} is outside her home and hard-blocked` };
    }
  }

  return ALLOWED;
}
