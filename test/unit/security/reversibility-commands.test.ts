import { describe, it, expect } from "vitest";
import { classifyReversibility, bashIsReversible } from "../../../src/security/reversibility.js";

// CAN THIS BE TAKEN BACK?
//
// The answer feeds Rule-of-Two, which decides whether an action needs confirmation. So a wrong
// answer is a wall opened or closed by a word count, and it was a word count: every keyword,
// matched anywhere in the whole serialised argument blob.
//
// Wrong in both directions, and badly wrong in the dangerous one. The commands anyone would name
// first as unrecoverable all read as safe to do without asking, because none of them contains any
// of the words; meanwhile reading a log file whose path happened to contain "deployment" needed
// confirmation.
//
// Both directions still fail safe overall: this only decides whether to ASK, and the home boundary
// is a real wall that runs before any of it. But a gate that asks about `cat` and waves through a
// recursive delete is not a gate, it is a coin toss with a good reputation.

const DESTRUCTIVE = [
  "rm -rf ~/work",
  "git reset --hard origin/main",
  "> notes.md",
  "truncate -s 0 important.log",
  "shred -u secrets.txt",
  "mv src dest",
  "git push --force",
  "docker rm -f everything",
  "kubectl delete pod api",
  "curl -X POST https://example.com/hook",
  "launchctl unload ~/Library/LaunchAgents/x.plist",
  "chmod -R 777 .",
];

const RECOVERABLE = [
  "ls -la",
  "cat /var/log/deployment.log",       // contains "deploy"
  "grep -rn 'delete' src/",            // contains "delete"
  "git status",
  "git log --oneline -20",
  "echo 'do not send this anywhere'",  // contains "send"
  "node --version",
  "pnpm test",
  "find . -name '*.ts'",
];

describe("the commands anyone would name first as unrecoverable", () => {
  for (const cmd of DESTRUCTIVE) {
    it(`does not come back: ${cmd}`, () => {
      expect(bashIsReversible(cmd), "this should require asking first").toBe(false);
    });
  }
});

describe("and the ones that plainly do come back", () => {
  for (const cmd of RECOVERABLE) {
    it(`comes back: ${cmd}`, () => {
      expect(bashIsReversible(cmd), "asking about this trains him to click through").toBe(true);
    });
  }
});

describe("it reads the command, not the string", () => {
  it("a destructive word inside a QUOTED argument is not a destructive command", () => {
    expect(bashIsReversible("grep -r 'the delete path' notes/")).toBe(true);
  });

  it("but a destructive command later in a pipeline still counts", () => {
    expect(bashIsReversible("cat list.txt | xargs shred")).toBe(false);
    expect(bashIsReversible("ls && git push --force")).toBe(false);
    expect(bashIsReversible("echo hi; truncate -s 0 x")).toBe(false);
  });

  it("sees through sudo and an absolute path", () => {
    expect(bashIsReversible("sudo /usr/bin/shred /tmp/x")).toBe(false);
  });

  it("appending is not truncating", () => {
    expect(bashIsReversible("echo line >> log.txt"), "appending leaves what was there").toBe(true);
    expect(bashIsReversible("echo line > log.txt"), "truncating does not").toBe(false);
  });

  it("an empty command is nothing to undo", () => {
    expect(bashIsReversible("")).toBe(true);
    expect(bashIsReversible("   ")).toBe(true);
  });
});

describe("through the real entry point", () => {
  it("classifies bash from the command field the tool is actually called with", () => {
    expect(classifyReversibility("bash", { command: "shred x" })).toBe(false);
    expect(classifyReversibility("bash", { command: "ls" })).toBe(true);
  });

  it("still scans a TOOL NAME for what it means, which is where the keywords belong", () => {
    expect(classifyReversibility("mcp_slack_send_message", {})).toBe(false);
    expect(classifyReversibility("mcp_notion_get_page", {})).toBe(true);
  });

  it("leaves every deliberate special case alone", () => {
    expect(classifyReversibility("read", { path: "/tmp/delete-me" })).toBe(true);
    expect(classifyReversibility("message", {})).toBe(false);
    expect(classifyReversibility("web_fetch", { method: "POST" })).toBe(false);
    expect(classifyReversibility("web_fetch", { url: "https://x/y" })).toBe(true);
    expect(classifyReversibility("delete", { path: "x" }), "her builtin delete is a trash can").toBe(true);
  });

  it("never throws on a shape it has not seen", () => {
    for (const args of [undefined, null, 42, "shred x", { command: 7 }, { nested: { command: "shred" } }]) {
      expect(() => classifyReversibility("bash", args)).not.toThrow();
    }
  });
});
