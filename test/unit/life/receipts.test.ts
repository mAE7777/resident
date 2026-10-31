import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inHerWords, RECEIPT_COUNT, whatHerHandDid } from "../../../src/life/receipts.js";
import { createGlobTool } from "../../../src/tools/builtin/glob.js";
import { createGrepTool } from "../../../src/tools/builtin/grep.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";
import { createWriteTool } from "../../../src/tools/builtin/write.js";
import { createEditTool } from "../../../src/tools/builtin/edit.js";
import { createDeleteTool } from "../../../src/tools/builtin/delete.js";
import { createFileSnapshotStore, createUndoTool } from "../../../src/tools/builtin/file-snapshot.js";
import { createMessageTool } from "../../../src/tools/builtin/message.js";
import { isHousePlumbing } from "../../../src/tools/builtin/path-guard.js";

// S-67: what her hands bring back is in her language. The tools keep reporting in English (the
// machinery that reads those reports is untouched); what she READS is translated at the one place
// a result becomes hers to read.

/** Three English words in a row is a sentence; a path, a tool name or an id is not. */
const ENGLISH_SENTENCE = /[A-Za-z]{2,}[ ,.;:'-]+[A-Za-z]{2,}[ ,.;:'-]+[A-Za-z]{2,}/;

/** The text with its paths taken out (anything carrying a slash or a dot), so a file name is not read as prose. */
function prose(text: string): string {
  return text.replace(/\S*[/.]\S*/g, " ");
}

function runTool(tool: { execute: (args: unknown) => Promise<string> }, args: unknown): Promise<string> {
  return tool.execute(args);
}

let home = "";
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); home = ""; });

function aHome(): string {
  home = mkdtempSync(join(tmpdir(), "receipts-"));
  mkdirSync(join(home, "life"), { recursive: true });
  writeFileSync(join(home, "life", "note.md"), "今天看了窗。\n", "utf8");
  return home;
}

describe("the receipts she reads are in her language", () => {
  it("every receipt her tools can return, walked through the real tools, reaches her with no English sentence", async () => {
    const h = aHome();
    const store = createFileSnapshotStore();
    const sent: string[] = [];
    const glob = createGlobTool(h, h);
    const grep = createGrepTool(h, h);
    const read = createReadTool(h, h);
    const write = createWriteTool(h, h, store);
    const edit = createEditTool(h, h, store);
    const del = createDeleteTool(h, h, store);
    const undo = createUndoTool(store, join(h, ".trash"));
    const message = createMessageTool(async (_id, text) => { sent.push(text); }, 42, undefined, undefined, h, h);
    const noRoute = createMessageTool(undefined, undefined, undefined, undefined, h, h);
    const files: string[] = [];
    const withFiles = createMessageTool(async () => {}, 42, async (_id, path) => { files.push(path); }, undefined, h, h);

    const raw: Array<[string, string]> = [
      ["glob", await runTool(glob, { pattern: "nothing-*.xyz" })],
      ["glob", await runTool(glob, { pattern: "*", cwd: "/etc" })],
      ["grep", await runTool(grep, { pattern: "月亮", path: "life/note.md" })],
      ["grep", await runTool(grep, { pattern: "月亮", path: "life", recursive: true })],
      ["grep", await runTool(grep, { pattern: "([", path: "life/note.md" })],
      ["read", await runTool(read, { path: "/etc/hosts" })],
      ["write", await runTool(write, { path: "life/new.md", content: "一句话" })],
      ["edit", await runTool(edit, { path: "life/new.md", old_string: "一句话", new_string: "两句话" })],
      ["undo", await runTool(undo, { action: "list" })],
      ["undo", await runTool(undo, { action: "undo_last" })],
      ["undo", await runTool(undo, { action: "undo_file" })],
      ["undo", await runTool(undo, { action: "undo_file", path: "life/never-was.md" })],
      ["undo", await runTool(undo, { action: "restore_from_trash", path: "life/never-was.md" })],
      ["undo", await runTool(undo, { action: "sideways" })],
      ["delete", await runTool(del, { path: "life/new.md" })],
      ["message", await runTool(message, { text: "早。" })],
      ["message", await runTool(message, { text: "早。", chat_id: 7 })],
      ["message", await runTool(message, { text: "早。", chat_id: "not-a-chat" })],
      ["message", await runTool(noRoute, { text: "早。" })],
      ["message", await runTool(message, { text: "给你看", file_path: "life/note.md" })],
      ["message", await runTool(withFiles, { text: "给你看", file_path: "life/note.md" })],
      ["message", await runTool(withFiles, { text: "给你看", file_path: "life/gone.md" })],
      ["message", await runTool(withFiles, { text: "给你看", file_path: "life" })],
    ];
    // And the ones the executor or the loop write around a tool.
    raw.push(["edit", "edit 出错了：old_string not found in [path]"]);
    raw.push(["edit", "edit 出错了：old_string found 2 times in [path] — must be unique"]);
    raw.push(["read", "read 出错了：ENOENT: no such file or directory, open '[path]'"]);
    raw.push(["read", "read 出错了：EISDIR: illegal operation on a directory, read"]);
    raw.push(["grep", "grep 出错了：Invalid string length"]);
    raw.push(["read", "Tool execution timed out after 5 minutes"]);
    raw.push(["read", "Error: Tool execution did not return a result"]);
    raw.push(["read", "Error: Tool execution was skipped"]);
    raw.push(["read", "Error: Tool execution interrupted — process restarted before result was received."]);
    raw.push(["read", 'tool family "read" is locked out after repeated failures. It has not been working; leave it for now and try another way in.']);
    raw.push(["write", "Not available while following your own curiosity: write can change things, and exploring only reads."]);

    for (const [tool, said] of raw) {
      const read = inHerWords(tool, said);
      expect(prose(read), `${tool} said: ${said}`).not.toMatch(ENGLISH_SENTENCE);
      expect(read, `${tool} said: ${said}`).not.toMatch(/^Error:/);
    }
    expect(sent, "the message still went out, only the receipt changed").toEqual(["早。"]);
  });

  it("the ones she meets most read as plain facts", () => {
    expect(inHerWords("message", "Message sent to chat 123456789: 早。")).toBe("送到他那里了：「早。」");
    expect(inHerWords("glob", "Error: Access denied: path is outside allowed directories")).toBe("那里不在你家里，够不着。");
    expect(inHerWords("grep", "No matches found")).toBe("没找到。");
    expect(inHerWords("read", 'tool family "read" is locked out after repeated failures. It has not been working; leave it for now and try another way in.'))
      .toBe("「read」这几次一直没成，这段时间先关上了。");
    // No receipt tells her what to do next.
    for (const said of ["No matches found", "No files found", "Error: Tool execution was skipped"]) {
      expect(inHerWords("x", said)).not.toMatch(/应该|试试|换个|建议|可以用/);
    }
  });

  it("only a WHOLE receipt is translated: a file she opens is never touched", () => {
    const page = "No matches found\n今天我在找一句话，没找到。";
    expect(inHerWords("read", page)).toBe(page);
    const starts = "Error: Access denied: path is outside allowed directories — 这是我抄下来的一行。";
    expect(inHerWords("read", starts)).toBe(starts);
    expect(inHerWords("read", "今天看了窗。\n")).toBe("今天看了窗。\n");
  });

  it("the set of receipts is pinned, so a new English one cannot slip in unseen", () => {
    // Adding a receipt means adding its translation AND walking it above; this number moves with both.
    expect(RECEIPT_COUNT).toBe(44);
  });
});

describe("walking her home leaves the plumbing out", () => {
  it("glob and a recursive grep skip .git, the fingerprints and tool-results; her own things stay", async () => {
    const h = aHome();
    mkdirSync(join(h, ".git", "hooks"), { recursive: true });
    writeFileSync(join(h, ".git", "hooks", "pre-commit.sample"), "月亮", "utf8");
    mkdirSync(join(h, "tool-results", "anonymous"), { recursive: true });
    writeFileSync(join(h, "tool-results", "anonymous", "1-grep-call_x.txt"), "月亮", "utf8");
    writeFileSync(join(h, "MEMORY.md"), "月亮\n", "utf8");
    writeFileSync(join(h, "MEMORY.md.blake3"), "月亮", "utf8");
    // The git's ignore list, which sat at the top of her listing.
    writeFileSync(join(h, ".gitignore"), "月亮\n", "utf8");
    mkdirSync(join(h, "画板"), { recursive: true });

    const listed = (await runTool(createGlobTool(h, h), { pattern: "**" })).split("\n");
    expect(listed).toEqual(expect.arrayContaining(["MEMORY.md", "life/", "life/note.md", "画板/"]));
    expect(listed.some((l) => l.startsWith(".git") || l.startsWith("tool-results") || l.endsWith(".blake3"))).toBe(false);

    const found = await runTool(createGrepTool(h, h), { pattern: "月亮", path: ".", recursive: true });
    expect(found.split("\n")).toEqual(["MEMORY.md:1: 月亮"]);

    // A path handed to her still opens: the skip is only for walking.
    const direct = await runTool(createReadTool(h, h), { path: "tool-results/anonymous/1-grep-call_x.txt" });
    expect(direct).toBe("月亮");
  });

  it("the plumbing test is exact", () => {
    expect(isHousePlumbing(".git", true)).toBe(true);
    expect(isHousePlumbing("tool-results", true)).toBe(true);
    expect(isHousePlumbing("SOUL.md.blake3", false)).toBe(true);
    expect(isHousePlumbing(".trash", true)).toBe(false);
    expect(isHousePlumbing("life", true)).toBe(false);
    expect(isHousePlumbing("tool-results", false)).toBe(false);
    expect(isHousePlumbing(".gitignore", false)).toBe(true);
    expect(isHousePlumbing("my.gitignore", false)).toBe(false);
    expect(isHousePlumbing(".gitignore", true)).toBe(false);
    expect(readFileSync(join(process.cwd(), "src/tools/builtin/glob.ts"), "utf8")).toContain("isHousePlumbing(");
  });
});

/**
 * WHICH ACT IT WAS (2026-10-11 03:52). She read her diary for the day and the day's page in one
 * step; the page does not exist until the day is over, one answer came back 「那儿没有这个东西。」,
 * and she told him a message of hers might not have reached him. Two minutes later a notebook
 * change that found nothing to change became her telling him another message had not gone out.
 */
describe("a receipt that does not say which act it is about has the act said before it", () => {
  const HOME = "/Users/someone/.resident/workspace";

  it("the read that came back empty names the page, from her home", () => {
    const said = `read 出错了：ENOENT: no such file or directory, open '${HOME}/life/2026-10-11.md'`;
    expect(inHerWords("read", said, { path: `${HOME}/life/2026-10-11.md` }, HOME)).toBe("读 life/2026-10-11.md：那儿没有这个东西。");
    // The other page of the same name, which did exist, is a different place and reads as one.
    expect(inHerWords("read", said, { path: `${HOME}/life/journal/2026-10-11.md` }, HOME)).toBe("读 life/journal/2026-10-11.md：那儿没有这个东西。");
  });

  it("the change that found no text names the file", () => {
    expect(inHerWords("edit", `edit 出错了：old_string not found in ${HOME}/MEMORY.md`, { path: `${HOME}/MEMORY.md`, old_string: "x", new_string: "y" }, HOME))
      .toBe("改 MEMORY.md：那段原文在这份文件里找不到。");
  });

  it("finding nothing says where she looked", () => {
    expect(inHerWords("grep", "No matches found", { path: `${HOME}/life`, pattern: "窗" }, HOME)).toBe("在 life 里找：没找到。");
    expect(inHerWords("glob", "No files found", { pattern: "画板/*.png" }, HOME)).toBe("找 画板/*.png：没有这样的文件。");
  });

  it("a receipt that already says what happened is left as it is", () => {
    expect(inHerWords("message", "Message sent to chat 123456789: 早。", { text: "早。" }, HOME)).toBe("送到他那里了：「早。」");
    expect(inHerWords("write", `Written 12 bytes to ${HOME}/life/note.md`, { path: `${HOME}/life/note.md` }, HOME)).toBe(`写好了：${HOME}/life/note.md`);
  });

  it("a page she opens is still never touched, whatever she did to open it", () => {
    const page = "No matches found\n今天我在找一句话，没找到。";
    expect(inHerWords("read", page, { path: `${HOME}/life/note.md` }, HOME)).toBe(page);
  });

  it("with nothing known about the act, the receipt is what it was", () => {
    expect(inHerWords("read", "Error: ENOENT: no such file or directory")).toBe("那儿没有这个东西。");
    expect(inHerWords("bash", "Error: Tool execution was skipped", {}, HOME)).toBe("这一下没有做。");
  });

  it("a place outside her home is said as she gave it", () => {
    expect(inHerWords("read", "Error: ENOENT: no such file or directory", { path: "/tmp/x.md" }, HOME)).toBe("读 /tmp/x.md：那儿没有这个东西。");
  });

  it("the act is a fact and no advice: nothing in it tells her what to do next", () => {
    for (const [tool, args] of [["read", { path: `${HOME}/a.md` }], ["edit", { path: `${HOME}/a.md` }], ["grep", { path: HOME }], ["glob", { pattern: "*" }], ["write", { path: `${HOME}/a.md` }], ["delete", { path: `${HOME}/a.md` }]] as const) {
      const act = whatHerHandDid(tool, args, HOME);
      expect(act, tool).not.toBeNull();
      expect(act!, tool).not.toMatch(/应该|试试|换个|建议|可以用|别/);
      expect(prose(act!), tool).not.toMatch(ENGLISH_SENTENCE);
    }
  });

  it("is what production wires in, with her home", () => {
    const loop = readFileSync(new URL("../../../src/agent/loop.ts", import.meta.url), "utf8");
    expect(loop).toMatch(/inHerWords\(r\.name, r\.content, argsOfCall\.get\(r\.callId\) \?\? \{\}, spec\.herHome\)/);
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(daemon).toMatch(/herHome: workspacePath,/);
  });
});
