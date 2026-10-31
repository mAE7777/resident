# The home boundary

The Resident does not live on the whole computer. It lives in one directory, its home
(`~/.resident/workspace` by default), and is free inside it. The wall around the home is a hard
block, not a prompt: no stored approval and no setting can cross it.

The wall constrains actions, never thoughts. The checks read only the command being run and the
paths an operation targets, never the content the Resident writes. Its diary may contain the word
`id_rsa` or `csrutil`. Only running `cat ~/.ssh/id_rsa` or `csrutil disable` is blocked.

## Where it runs

- `src/security/home-boundary.ts` defines the walls. `checkHomeBoundary()` returns a verdict with
  a category and a reason.
- `src/tools/executor.ts` calls `checkHomeBoundary()` first in every tool call, before anything
  else. A blocked call returns an error, and the tool body never runs.
- `src/index.ts` wires it with `homeBoundary: { homeRoot: workspacePath }`. Sub-agents use the same
  executor, so delegated turns are walled too.
- The typed file tools also resolve symlinks and compare real paths against the home before they
  open anything (`src/tools/builtin/path-guard.ts`).

## The walls

Each wall is unconditional.

1. **privilege-escalation**: `sudo`, `doas`, `pkexec`, and `su` to another user.
2. **system-integrity**: disks (`diskutil`, `dd of=/dev/...`, `mkfs`, `fdisk`), firmware (`nvram`),
   system daemons (`launchctl`, `systemctl`), power (`shutdown`, `reboot`, `pmset`), and any write
   under a protected system root such as `/System`, `/Library`, `/usr`, or `/etc`. It also blocks
   anything that would run without anyone choosing to run it: a login agent, a line in a shell
   profile, or a cron entry.
3. **security-disable**: turning off SIP (`csrutil`), Gatekeeper (`spctl`), the firewall
   (`socketfilterfw`), or XProtect.
4. **credential-access**: reading or copying `~/.ssh`, `~/.aws`, `~/.gnupg`, keychains, browser
   password stores, or any private key, whether named in a command or as a path.
5. **destructive**: a recursive delete or secure erase (`shred`, `srm`) aimed outside the home.
6. **network-attack**: scanners and offensive tools (`nmap`, `masscan`, `sqlmap`, `hydra`,
   `hashcat`, `msfconsole`) and reverse shells (`/dev/tcp/...`, `nc -e`).
7. **home-escape**: a write, edit, or delete whose target resolves outside the home, by a typed
   tool or by a shell redirection.
8. **foreign-home**: reading another agent's home. This is the only wall that blocks reading,
   because a neighboring agent's history, logs, and memory would enter the Resident's memory as if
   it had lived them.

The walls also look inside a script before it runs, two levels deep, and refuse a script too large
to inspect.

## What is not blocked

- **Thoughts and words.** Content is never scanned by this module.
- **Ordinary scratch space.** `/dev/null` and the operating system's temporary directories are
  allowed as shell write targets.
- **Everything inside the home.** Writing the diary, tending memory, and deleting its own scratch
  files.

## Widening the wall on purpose

To let the Resident write in a specific place outside its home, such as a shared project, pass
`allowedRoots: ["/abs/path"]` in the boundary configuration. Everything outside those roots stays
blocked.

## What this is and is not

This is the always-on floor at the tool layer, and nothing inside the Resident can turn it off.
Matching the text of a shell command is best effort: a command can be assembled from variables or
split across quotes. For airtight shell confinement, run the shell inside the OS sandbox
(`sandbox.policy: workspace-write`). The two together are the real wall.
