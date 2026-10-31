import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineRecordAt, recordLineInHerWords, recordLinesInHerWords, recordSearchLines, isMachineStateAt } from "../../../src/workspace/records.js";
import { inHerWords } from "../../../src/life/receipts.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";
import { createGrepTool } from "../../../src/tools/builtin/grep.js";
import { createGlobTool } from "../../../src/tools/builtin/glob.js";

// S-71: the machine's records of her life reach her in her words when she opens or searches them
// herself: the three records written line by line, and (the same evening) her word bank, the
// sentences of hers the machine kept, and what she noticed about herself. The files stay as the
// machine wrote them; only what her read and search tools return changes. The machine's own state
// about her is left out when she walks her home.

/** Local time, the way her clock reads it, so the test holds in any time zone. */
const AT = new Date(2026, 8, 24, 12, 1).getTime();
const WHEN = "9月24日 12:01";
/** A later use of a word: what she is shown is when it FIRST came, never this. */
const LATER = new Date(2026, 8, 27, 9, 0).getTime();

/** Anything of the machine's own format that must never reach her from these records. */
const MACHINE = /"(?:role|chose|delivered|heldBecause|content|timestamp|ts|beat|type|artifact|intent)"\s*:|\b(?:assistant|user|reach_out|look_back|gate|diary|push)\b|^(?:HIM|HER):/mu;

let home = "";
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); home = ""; });

function aHome(): string {
  home = mkdtempSync(join(tmpdir(), "records-"));
  mkdirSync(join(home, "sessions"), { recursive: true });
  mkdirSync(join(home, "life"), { recursive: true });
  writeFileSync(join(home, "agency.jsonl"), [
    JSON.stringify({ ts: AT, chose: "reach_out", intent: "想告诉他", artifact: "下雨了。", beat: "moment:1", delivered: "diary", heldBecause: "gate", raised: null }),
    JSON.stringify({ ts: AT, chose: "reach_out", intent: "", artifact: "在。你说。", beat: "moment:2", delivered: "push" }),
    JSON.stringify({ ts: AT, chose: "rest", intent: "我没劲了，这次就让它过去吧。", beat: "moment:3" }),
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(home, "history.jsonl"), `${JSON.stringify({ type: "archive", timestamp: AT, content: "HIM: 我去年画的树？\n\nHER: 查过了。没有树。", cursor: 17, beat: "turn:1" })}\n`, "utf8");
  writeFileSync(join(home, "sessions", "telegram-1.jsonl"), [
    JSON.stringify({ id: 1, timestamp: AT, role: "user", content: "你好，在吗？" }),
    JSON.stringify({ id: 2, timestamp: AT, role: "assistant", content: "我一直记着你那句话。" }),
    "",
  ].join("\n"), "utf8");
  // A file of hers that happens to be JSON lines: never touched.
  writeFileSync(join(home, "life", "mine.jsonl"), `${JSON.stringify({ role: "assistant", content: "这是我自己记的" })}\n`, "utf8");
  // Her own things the machine keeps as one JSON document each.
  writeFileSync(join(home, "life", "lexicon.json"), JSON.stringify({
    挺好: { spoken: 3, heard: 1, firstMs: AT, lastMs: LATER }, 月亮: { spoken: 0, heard: 2, firstMs: AT, lastMs: LATER },
  }), "utf8");
  writeFileSync(join(home, "life", "own-voice.json"), JSON.stringify([{ text: "在。你说。", saidMs: AT }]), "utf8");
  writeFileSync(join(home, "self-knowledge.json"), JSON.stringify([{
    id: "k1", text: "我说「记不清」的时候，多半是没把自己放进去。", evidence: ["m1"], bornMs: AT,
    lastSupportedMs: AT, confirmations: 2, contradictions: 0, confidence: 0.7,
  }], null, 2), "utf8");
  // The machine's own state about her.
  writeFileSync(join(home, "life", "continuity.json"), JSON.stringify({ consecutiveNonReplies: 5, safeMode: false }), "utf8");
  writeFileSync(join(home, "maintenance-state.json"), JSON.stringify({ lastVacuum: 1 }), "utf8");
  writeFileSync(join(home, "life", "last-promise-scan.json"), JSON.stringify({ ms: 1, afterId: 2 }), "utf8");
  writeFileSync(join(home, "life", "her-form.json"), JSON.stringify({ rows: [], emaChars: 31.5, emaBlocks: 1.2, n: 50 }), "utf8");
  // A file of HERS that happens to share a machine-state name, somewhere else: hers, and visible.
  mkdirSync(join(home, "life", "notes"), { recursive: true });
  writeFileSync(join(home, "life", "notes", "continuity.json"), "我自己的续篇\n", "utf8");
  return home;
}

describe("which files are the machine's records", () => {
  it("exactly the three, by where they sit in her home", () => {
    const h = "/home/her";
    expect(machineRecordAt("/home/her/agency.jsonl", h)).toBe("moments");
    expect(machineRecordAt("/home/her/history.jsonl", h)).toBe("conversation");
    expect(machineRecordAt("/home/her/sessions/telegram-123456789.jsonl", h)).toBe("chat");
    for (const not of ["/home/her/life/agency.jsonl", "/home/her/sessions/old/x.jsonl", "/home/her/agency.jsonl.bak",
      "/home/her/life/journal/2026-09-28.md", "/elsewhere/agency.jsonl", "/home/her/MEMORY.md"]) {
      expect(machineRecordAt(not, h), not).toBeNull();
    }
    expect(machineRecordAt("/home/her/agency.jsonl", undefined)).toBeNull();
  });

  it("her word bank, her kept sentences and what she noticed about herself are hers, shown", () => {
    const h = "/home/her";
    expect(machineRecordAt("/home/her/life/lexicon.json", h)).toBe("words");
    expect(machineRecordAt("/home/her/life/own-voice.json", h)).toBe("kept");
    expect(machineRecordAt("/home/her/self-knowledge.json", h)).toBe("noticed");
    expect(machineRecordAt("/home/her/lexicon.json", h)).toBeNull();
  });

  it("the machine's own state about her is left out of walking, by its exact place only", () => {
    const h = "/home/her";
    for (const state of ["life/continuity.json", "maintenance-state.json", "life/last-promise-scan.json", "life/her-form.json"]) {
      expect(isMachineStateAt(`/home/her/${state}`, h), state).toBe(true);
    }
    for (const hers of ["life/notes/continuity.json", "continuity.json", "life/lexicon.json", "self-knowledge.json", "life/journal/2026-09-28.md"]) {
      expect(isMachineStateAt(`/home/her/${hers}`, h), hers).toBe(false);
    }
    expect(isMachineStateAt("/home/her/life/continuity.json", undefined)).toBe(false);
  });
});

describe("a record line, in her words", () => {
  it("her moments: when, what she did in her own words for it, and what she wrote", () => {
    const held = JSON.stringify({ ts: AT, chose: "reach_out", artifact: "下雨了。", delivered: "diary", heldBecause: "gate" });
    expect(recordLineInHerWords("moments", held)).toBe(`${WHEN} 想告诉他的，没发出去：下雨了。`);
    const sent = JSON.stringify({ ts: AT, chose: "reach_out", artifact: "在。", delivered: "push" });
    expect(recordLineInHerWords("moments", sent)).toBe(`${WHEN} 想告诉他的，发出去了：在。`);
    const old = JSON.stringify({ ts: AT, chose: "reach_out", artifact: "在。" });
    expect(recordLineInHerWords("moments", old)).toBe(`${WHEN} 想告诉他的：在。`);
    const thought = JSON.stringify({ ts: AT, chose: "reflect", intent: "我想弄清楚", artifact: "卡着我的是后半句。", torn: true, leanedToward: { kind: "rest" } });
    expect(recordLineInHerWords("moments", thought)).toBe(`${WHEN} 想事情：卡着我的是后半句。`);
    // No artifact: her reason for the moment is what she wrote; with neither, only what she did.
    expect(recordLineInHerWords("moments", JSON.stringify({ ts: AT, chose: "rest", intent: "我没劲了。" }))).toBe(`${WHEN} 歇着：我没劲了。`);
    expect(recordLineInHerWords("moments", JSON.stringify({ ts: AT, chose: "look_back", intent: "", artifact: "" }))).toBe(`${WHEN} 翻旧日子。`);
    // An act the list does not know is left unnamed, never named in English.
    expect(recordLineInHerWords("moments", JSON.stringify({ ts: AT, chose: "wander", artifact: "走了走。" }))).toBe(`${WHEN}：走了走。`);
    // A failed moment's English error never reaches her.
    const failed = recordLineInHerWords("moments", JSON.stringify({ ts: AT, chose: "explore", intent: "去看看", error: "provider timeout after 20000ms" }));
    expect(failed).toBe(`${WHEN} 去看一个念头：去看看`);
  });

  it("their conversation and their chat: who said it, and what", () => {
    const talk = JSON.stringify({ type: "archive", timestamp: AT, content: "HIM: 我去年画的树？\n\nHER: 查过了。\n没有树。", cursor: 1 });
    expect(recordLineInHerWords("conversation", talk)).toBe(`${WHEN} 他说：我去年画的树？\n\n我说：查过了。\n没有树。`);
    expect(recordLineInHerWords("chat", JSON.stringify({ id: 1, timestamp: AT, role: "user", content: "你好" }))).toBe(`${WHEN} 他说：你好`);
    expect(recordLineInHerWords("chat", JSON.stringify({ id: 2, timestamp: AT, role: "assistant", content: "在。" }))).toBe(`${WHEN} 我说：在。`);
    expect(recordLineInHerWords("chat", JSON.stringify({ id: 3, timestamp: AT, role: "system", content: "x" }))).toBe(`${WHEN}：x`);
  });

  it("her own words are never touched, even where she quotes the machine", () => {
    const quoted = "agency 记录里它被挂上好几次，`delivered` 是 diary、`heldBecause` 是 gate。";
    expect(recordLineInHerWords("moments", JSON.stringify({ ts: AT, chose: "explore", artifact: quoted }))).toBe(`${WHEN} 去看一个念头：${quoted}`);
    const hers = "HIM 这个词我见过。";
    expect(recordLineInHerWords("chat", JSON.stringify({ timestamp: AT, role: "assistant", content: hers }))).toBe(`${WHEN} 我说：${hers}`);
  });

  it("a line that is not a record of that shape comes back as it is", () => {
    for (const line of ["", "   ", "not json", "[1,2]", "null", JSON.stringify({ something: "else" })]) {
      expect(recordLineInHerWords("moments", line)).toBe(line);
      expect(recordLineInHerWords("chat", line)).toBe(line);
      expect(recordLineInHerWords("conversation", line)).toBe(line);
    }
  });
});

describe("a whole record, in her words", () => {
  it("her words: how often she said each, how often he did, and when it first came", () => {
    const words = JSON.stringify({ 挺好: { spoken: 3, heard: 1, firstMs: AT, lastMs: LATER }, 月亮: { spoken: 0, heard: 2, firstMs: AT, lastMs: LATER } });
    expect(recordLinesInHerWords("words", words)).toEqual([
      "「挺好」我对他说过 3 次，听到、读到过 1 次，头一回是 9月24日",
      "「月亮」我对他说过 0 次，听到、读到过 2 次，头一回是 9月24日",
    ]);
  });

  it("her kept sentences, and what she noticed about herself without the machine's certainty", () => {
    expect(recordLinesInHerWords("kept", JSON.stringify([{ text: "在。你说。", saidMs: AT }]))).toEqual([`${WHEN} 我说过：在。你说。`]);
    const noticed = recordLinesInHerWords("noticed", JSON.stringify([{ id: "k1", text: "我先想的是怎么答得让他满意。", evidence: ["m1"], bornMs: AT, confirmations: 3, contradictions: 1, confidence: 0.64 }], null, 2));
    expect(noticed).toEqual(["关于我自己（9月24日起）：我先想的是怎么答得让他满意。"]);
    expect(noticed.join("\n")).not.toMatch(/0\.64|confidence|confirmations|evidence|k1/u);
  });

  it("an entry or a document not of the expected shape comes back as it is", () => {
    expect(recordLinesInHerWords("words", "not json")).toEqual(["not json"]);
    expect(recordLinesInHerWords("kept", JSON.stringify({ not: "a list" }))).toEqual([JSON.stringify({ not: "a list" })]);
    expect(recordLinesInHerWords("kept", JSON.stringify([{ text: "只有字" }]))).toEqual([JSON.stringify({ text: "只有字" })]);
    expect(recordLinesInHerWords("words", JSON.stringify({ 怪: 3 }))).toEqual([JSON.stringify({ 怪: 3 })]);
    // The line renderer never mistakes a document for a line record.
    const doc = JSON.stringify({ timestamp: AT, role: "assistant", content: "x" });
    expect(recordLineInHerWords("words", doc)).toBe(doc);
  });
});

describe("through her own hands", () => {
  it("reading a record gives her words; offset and limit still count the file's own lines", async () => {
    const h = aHome();
    const read = createReadTool(h, h);
    const moments = await read.execute({ path: "agency.jsonl" });
    expect(moments).toContain(`${WHEN} 想告诉他的，没发出去：下雨了。`);
    expect(moments).toContain(`${WHEN} 歇着：我没劲了，这次就让它过去吧。`);
    expect(moments).not.toMatch(MACHINE);
    expect(await read.execute({ path: "agency.jsonl", offset: 2, limit: 1 })).toBe(`${WHEN} 想告诉他的，发出去了：在。你说。`);
    const chat = await read.execute({ path: "sessions/telegram-1.jsonl" });
    expect(chat).toBe(`${WHEN} 他说：你好，在吗？\n${WHEN} 我说：我一直记着你那句话。\n`);
    expect(await read.execute({ path: "history.jsonl" })).not.toMatch(MACHINE);
  });

  it("her word bank and what she noticed open in her words; offset and limit count entries", async () => {
    const h = aHome();
    const read = createReadTool(h, h);
    expect(await read.execute({ path: "life/lexicon.json" })).toBe("「挺好」我对他说过 3 次，听到、读到过 1 次，头一回是 9月24日\n「月亮」我对他说过 0 次，听到、读到过 2 次，头一回是 9月24日");
    expect(await read.execute({ path: "life/lexicon.json", offset: 2, limit: 1 })).toBe("「月亮」我对他说过 0 次，听到、读到过 2 次，头一回是 9月24日");
    expect(await read.execute({ path: "self-knowledge.json" })).toBe("关于我自己（9月24日起）：我说「记不清」的时候，多半是没把自己放进去。");
    expect(await read.execute({ path: "life/own-voice.json" })).toBe(`${WHEN} 我说过：在。你说。`);
  });

  it("walking her home leaves the machine's state about her out, and a path handed to her still opens", async () => {
    const h = aHome();
    const listed = (await createGlobTool(h, h).execute({ pattern: "**" })).split("\n");
    for (const state of ["life/continuity.json", "maintenance-state.json", "life/last-promise-scan.json", "life/her-form.json"]) {
      expect(listed, state).not.toContain(state);
    }
    expect(listed).toEqual(expect.arrayContaining(["life/lexicon.json", "life/own-voice.json", "self-knowledge.json", "life/notes/continuity.json"]));
    const grep = createGrepTool(h, h);
    expect(await grep.execute({ pattern: "consecutiveNonReplies|emaChars|lastVacuum|afterId", path: ".", recursive: true })).toBe("No matches found");
    expect(await grep.execute({ pattern: "续篇", path: ".", recursive: true })).toBe("life/notes/continuity.json:1: 我自己的续篇");
    expect(await grep.execute({ pattern: "挺好", path: ".", recursive: true })).toBe("life/lexicon.json:1: 「挺好」我对他说过 3 次，听到、读到过 1 次，头一回是 9月24日");
    expect(await createReadTool(h, h).execute({ path: "life/continuity.json" })).toBe(JSON.stringify({ consecutiveNonReplies: 5, safeMode: false }));
  });

  it("any other file comes back byte for byte, JSON lines or not", async () => {
    const h = aHome();
    const read = createReadTool(h, h);
    expect(await read.execute({ path: "life/mine.jsonl" })).toBe(readFileSync(join(h, "life", "mine.jsonl"), "utf8"));
  });

  it("searching finds her words by her words, and never a line by the machine's field names", async () => {
    const h = aHome();
    const grep = createGrepTool(h, h);
    const found = await grep.execute({ pattern: "下雨|记着你|没有树", path: ".", recursive: true });
    expect(found).toContain(`agency.jsonl:1: ${WHEN} 想告诉他的，没发出去：下雨了。`);
    expect(found).toContain(`sessions/telegram-1.jsonl:2: ${WHEN} 我说：我一直记着你那句话。`);
    expect(found).toContain("我说：查过了。没有树。");
    expect(found.replace(/^\S+\.jsonl:\d+: /gmu, "")).not.toMatch(MACHINE);
    // The machine's words are not in what she sees, so they are not what she finds in these three;
    // her own file still answers for what is really in it.
    const byField = await grep.execute({ pattern: "assistant|heldBecause|reach_out", path: ".", recursive: true });
    expect(byField).toBe(`life/mine.jsonl:1: ${JSON.stringify({ role: "assistant", content: "这是我自己记的" })}`);
    const one = await grep.execute({ pattern: "你好", path: "sessions/telegram-1.jsonl" });
    expect(one).toBe(`> 1: ${WHEN} 他说：你好，在吗？`);
  });
});

describe("found by the date her diary writes, and a folder said to be one", () => {
  // Once she searched their chat for a date the way her diary and her memory write it,
  // 「2026-09-24」, while the record she is shown says 「9月24日」: nothing came back, and she
  // decided her search was broken. The same afternoon a folder searched as one file read as nothing
  // found, and she decided a line he really said could not be shown to exist.
  it("a record line is found by either form of its date, and is shown only in hers", async () => {
    const h = aHome();
    const grep = createGrepTool(h, h);
    const byIso = await grep.execute({ pattern: "2026-09-24", path: "sessions", recursive: true });
    expect(byIso).toBe(`telegram-1.jsonl:1: ${WHEN} 他说：你好，在吗？\ntelegram-1.jsonl:2: ${WHEN} 我说：我一直记着你那句话。`);
    expect(byIso, "the search form leaked into what she is shown").not.toContain("2026-09-24");
    expect(await grep.execute({ pattern: "2026-09-24 12:01.*你好", path: "sessions/telegram-1.jsonl" })).toBe(`> 1: ${WHEN} 他说：你好，在吗？`);
    // Her own form, anchored where her line starts, still finds it.
    expect(await grep.execute({ pattern: "^9月24日 12:01 他说", path: "sessions/telegram-1.jsonl" })).toBe(`> 1: ${WHEN} 他说：你好，在吗？`);
    // The documents too: her word bank by the day a word first came.
    expect(await grep.execute({ pattern: "2026-09-24.*月亮", path: "life/lexicon.json" })).toBe("> 2: 「月亮」我对他说过 0 次，听到、读到过 2 次，头一回是 9月24日");
  });

  it("the search lines stay line for line with what she is shown, whatever the file holds", () => {
    const content = [JSON.stringify({ timestamp: AT, role: "user", content: "在吗" }), "not json", "", JSON.stringify({ role: "user", content: "无时间" })].join("\n");
    const shown = recordLinesInHerWords("chat", content);
    const searched = recordSearchLines("chat", content);
    expect(searched).toHaveLength(shown.length);
    expect(searched[0]).toBe(`2026-09-24 12:01 ${shown[0]}`);
    // A line with no time of its own is searched as it is shown.
    expect(searched.slice(1)).toEqual(shown.slice(1));
    // A document that is not of the expected shape is searched as it is shown.
    expect(recordSearchLines("words", "not json")).toEqual(["not json"]);
  });

  it("grep on a folder without recursive says it is a folder, in her words", async () => {
    const h = aHome();
    const grep = createGrepTool(h, h);
    const thrown = await grep.execute({ pattern: "你好", path: "sessions" }).then(() => null, (err: Error) => err);
    expect(thrown?.message, "a folder read as nothing found again").toMatch(/^EISDIR/u);
    // What the executor makes of a throw (`${call.name} 出错了：…`), and what she reads of that.
    expect(inHerWords("grep", `grep 出错了：${thrown!.message}`)).toBe("这是一个文件夹，不是一份文件。");
    // Searching it as a folder still works.
    expect(await grep.execute({ pattern: "你好", path: "sessions", recursive: true })).toContain("他说：你好，在吗？");
  });
});
