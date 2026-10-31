// Dangerous command detection: normalization + PicoClaw blocklist + 44 regex patterns
// Ported from Hermes approval.py (lines 76-139, 169-184) and PicoClaw shell blocklist

import { checkBashOutbound, checkBashPrivateNetwork } from "./outbound-guard.js";

export type CommandSeverity = "block" | "confirm";

export interface CommandScanResult {
  severity: CommandSeverity;
  description: string;
}

// _SENSITIVE_WRITE_TARGET expansion:
// ~/.ssh/, ~/.config/, ~/.gnupg/, /etc/, ~/.bashrc, ~/.bash_profile, ~/.zshrc, ~/.profile, .env
const _SENSITIVE_WRITE_TARGET =
  String.raw`(~/\.ssh/|~/\.config/|~/\.gnupg/|/etc/|~/\.bashrc|~/\.bash_profile|~/\.zshrc|~/\.profile|\.env)`;

// 44 dangerous command patterns (Hermes approval.py lines 76-139)
// Items 28-33 were adapted from "hermes"/"gateway", and now name BOTH daemons on this
// machine: hers, because these are the rules that stop her ending herself, and the
// neighbour's, because his daemon is not hers to stop either.
//
// Every pattern is matched against the LOWERCASED command, so every pattern must be written in
// lowercase. A capital letter here can never match: `git branch -D` and `chown -R root` were
// dead for that reason. Exported so the test can drive every entry with a sample command.
export const DANGEROUS_PATTERNS: ReadonlyArray<readonly [RegExp, string, CommandSeverity]> = [
  [/\brm\s+(-[^\s]*\s+)*\//, "delete in root path", "block"],
  [/\brm\s+-[^\s]*r/, "recursive delete", "block"],
  [/\brm\s+--recursive\b/, "recursive delete (long flag)", "block"],
  [/\bchmod\s+(-[^\s]*\s+)*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b/, "world/other-writable permissions", "confirm"],
  [/\bchmod\s+--recursive\b.*(777|666|o\+[rwx]*w|a\+[rwx]*w)/, "recursive world/other-writable (long flag)", "confirm"],
  [/\bchown\s+(-[^\s]*)?r\s+root/, "recursive chown to root", "confirm"],
  [/\bchown\s+--recursive\b.*root/, "recursive chown to root (long flag)", "confirm"],
  [/\bmkfs\b/, "format filesystem", "block"],
  [/\bdd\s+.*if=/, "disk copy", "block"],
  [/>\s*\/dev\/sd/, "write to block device", "block"],
  [/\bdrop\s+(table|database)\b/, "SQL DROP", "confirm"],
  [/\bdelete\s+from\b(?!.*\bwhere\b)/, "SQL DELETE without WHERE", "confirm"],
  [/\btruncate\s+(table)?\s*\w/, "SQL TRUNCATE", "confirm"],
  [/>\s*\/etc\//, "overwrite system config", "confirm"],
  [/\bsystemctl\s+(-[^\s]+\s+)*(stop|restart|disable|mask)\b/, "stop/restart system service", "confirm"],
  [/\bkill\s+-9\s+-1\b/, "kill all processes", "block"],
  [/\bpkill\s+-9\b/, "force kill processes", "block"],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb", "block"],
  [/\b(bash|sh|zsh|ksh)\s+-[^\s]*c(\s+|$)/, "shell command via -c/-lc flag", "block"],
  [/\b(python[23]?|perl|ruby|node)\s+-[ec]\s+/, "script execution via -e/-c flag", "confirm"],
  [/\b(?:command\s+)?(?:cd|pushd)\s+(?:~(?:\/\S*)?|\/\S*|\.\.(?:\/\S*)?)(?:\s|$)/, "change directory outside workspace", "block"],
  [/\b(curl|wget)\b.*\|\s*(ba)?sh\b/, "pipe remote content to shell", "block"],
  [/\b(bash|sh|zsh|ksh)\s+<\s*<?\s*\(\s*(curl|wget)\b/, "execute remote script via process substitution", "block"],
  [new RegExp(String.raw`\btee\b.*["']?` + _SENSITIVE_WRITE_TARGET), "overwrite system file via tee", "confirm"],
  [new RegExp(String.raw`>>?\s*["']?` + _SENSITIVE_WRITE_TARGET), "overwrite system file via redirection", "confirm"],
  [/\bxargs\s+.*\brm\b/, "xargs with rm", "block"],
  [/\bfind\b.*-exec\s+(\/\S*\/)?rm\b/, "find -exec rm", "block"],
  [/\bfind\b.*-delete\b/, "find -delete", "block"],
  // Both daemons. Hers, because these rules are what stop her from ending herself and
  // they used to name a process she is not. His, because his daemon is not hers to stop.
  [/\b(resident|god-agent)\s+(stop|restart)\b/, "stop/restart a daemon", "block"],
  [/\b(resident|god-agent)\s+update\b/, "daemon update", "block"],
  [/(resident|god-agent)\s+run\b.*(&\s*$|&\s*;|\bdisown\b|\bsetsid\b)/, "start daemon outside process manager", "block"],
  // A detacher sits BEFORE the command as readily as after it, and the rule above only looks
  // to the right of `run`, so `resident run & disown` was blocked while `setsid resident run`
  // walked straight through. `nohup` had its own line for exactly this reason; the others
  // never got one. Found by probing the rule rather than reading it.
  [/\b(nohup|setsid|systemd-run|daemonize|start-stop-daemon)\b.*(resident|god-agent)\s+run\b/, "start daemon outside process manager", "block"],
  [/\b(pkill|killall)\b.*\b(resident|god-agent|god)\b/, "kill daemon process", "block"],
  [/\bkill\b.*\$\(\s*pgrep\b/, "kill process via pgrep expansion", "block"],
  [/\bkill\b.*`\s*pgrep\b/, "kill process via backtick pgrep expansion", "block"],
  [/\b(cp|mv|install)\b.*\s\/etc\//, "copy/move file into /etc/", "confirm"],
  [/\bsed\s+-[^\s]*i.*\s\/etc\//, "in-place edit of system config", "confirm"],
  [/\bsed\s+--in-place\b.*\s\/etc\//, "in-place edit of system config (long flag)", "confirm"],
  [/\b(python[23]?|perl|ruby|node)\s+<</, "script execution via heredoc", "confirm"],
  [/\bgit\s+reset\s+--hard\b/, "git reset --hard", "confirm"],
  [/\bgit\s+push\b/, "git push (sends commits to remote — irreversible)", "confirm"],
  [/\bgit\s+clean\s+-[^\s]*f/, "git clean with force", "confirm"],
  // Lowercasing makes the safe `-d` and the forced `-D` the same text, so both ask first.
  [/\bgit\s+branch\s+-d\b/, "git branch delete (-d or the forced -D)", "confirm"],
  // GitHub CLI irreversible operations
  [/\bgh\s+pr\s+create\b/, "create GitHub PR (visible to others)", "confirm"],
  [/\bgh\s+pr\s+merge\b/, "merge GitHub PR (irreversible)", "confirm"],
  [/\bgh\s+release\s+create\b/, "create GitHub release (public)", "confirm"],
  // Package registry irreversible operations
  [/\bnpm\s+publish\b/, "npm publish (publishes package to registry)", "confirm"],
  [/\bdocker\s+push\b/, "docker push (pushes image to registry)", "confirm"],
  [/\bchmod\s+\+x\b.*[;&|]+\s*\.\//, "chmod +x followed by immediate execution", "block"],
  // Package install safety: npm must use --ignore-scripts, pip must use --user
  [/\bnpm\s+install\b(?!.*--ignore-scripts)/, "npm install without --ignore-scripts (postinstall scripts can execute arbitrary code)", "confirm"],
  [/\bpip3?\s+install\b(?!.*--user)(?!.*--target)(?!.*-t\s)/, "pip install without --user (may modify system Python)", "confirm"],
  [/\bpython3?\s+-m\s+pip\s+install\b(?!.*--user)(?!.*--target)/, "python -m pip install without --user", "confirm"],
];

// PicoClaw exact-match blocklist: checked first as fast-path before regex scan
// 6 canonical blocklist strings + agent-internal file protection
const PICOCLAW_BLOCKLIST: Array<[string, string]> = [
  ["rm -rf /", "delete in root path"],
  ["mkfs", "format filesystem"],
  ["dd if=/dev/zero", "disk overwrite"],
  ["/dev/sd", "raw device access"],
  ["shutdown -h now", "system shutdown"],
  ["crontab", "system crontab modification — use the cron tool instead"],
  ["launchctl", "system service management"],
  [" at ", "system at scheduler — use the cron tool instead"],
  ["reboot", "system reboot"],
  // Agent-internal file protection
  ["history.jsonl", "agent-internal state file"],
  [".dream_cursor", "agent-internal state file"],
  ["data.db", "agent-internal state file"],
];

// Normalize a command before pattern matching
// Strip ANSI (ECMA-48 CSI sequences + OSC), strip null bytes, NFKC normalize
export function normalizeCommand(command: string): string {
  // Strip ANSI CSI sequences: ESC [ ... letter
  // eslint-disable-next-line no-control-regex
  let result = command.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  // Strip ANSI OSC sequences: ESC ] ... ST (BEL or ESC \)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // Strip null bytes
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x00/g, "");
  // NFKC normalize (fullwidth Latin, halfwidth Katakana, etc.)
  result = result.normalize("NFKC");
  return result;
}

export interface CommandScanner {
  scanCommand(command: string): CommandScanResult | null;
}

export function createCommandScanner(): CommandScanner {
  function scanCommand(command: string): CommandScanResult | null {
    const normalized = normalizeCommand(command);
    const lower = normalized.toLowerCase();

    // PicoClaw exact-match pre-filter (fast path)
    for (const [substring, description] of PICOCLAW_BLOCKLIST) {
      if (lower.includes(substring)) {
        return { severity: "block", description };
      }
    }

    // 44-pattern regex scan on lowercased, normalized command
    for (const [pattern, description, severity] of DANGEROUS_PATTERNS) {
      if (pattern.test(lower)) {
        return { severity, description };
      }
    }

    // Outbound guard: block curl/wget POST to sensitive domains
    const outboundBlock = checkBashOutbound(lower);
    if (outboundBlock) {
      return { severity: "block", description: outboundBlock };
    }

    // Host-bash SSRF guard: curl/wget GETs must not bypass web_fetch private-network checks.
    const privateNetworkBlock = checkBashPrivateNetwork(normalized);
    if (privateNetworkBlock) {
      return { severity: "block", description: privateNetworkBlock };
    }

    return null;
  }

  return { scanCommand };
}
