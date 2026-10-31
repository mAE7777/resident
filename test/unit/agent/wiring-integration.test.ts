import { describe, it, expect } from "vitest";
import { createSteeringQueue } from "../../../src/agent/steering.js";
import { createTaskManager } from "../../../src/agent/tasks.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Steering Queue (concurrency serialization) ─────────────────────────────

describe("steering queue — per-chat serialization", () => {
  it("enqueue + drain returns messages in order", () => {
    const q = createSteeringQueue();
    q.enqueue("chat1", { text: "hello" });
    q.enqueue("chat1", { text: "world" });
    const drained = q.drain("chat1");
    expect(drained).toHaveLength(2);
    expect((drained[0] as { text: string }).text).toBe("hello");
    expect((drained[1] as { text: string }).text).toBe("world");
  });

  it("drain clears the queue", () => {
    const q = createSteeringQueue();
    q.enqueue("chat1", "msg1");
    q.drain("chat1");
    expect(q.hasMessages("chat1")).toBe(false);
    expect(q.drain("chat1")).toHaveLength(0);
  });

  it("separate sessions are independent", () => {
    const q = createSteeringQueue();
    q.enqueue("chat1", "a");
    q.enqueue("chat2", "b");
    expect(q.drain("chat1")).toHaveLength(1);
    expect(q.hasMessages("chat2")).toBe(true);
  });

  it("hasMessages returns false for empty/unknown sessions", () => {
    const q = createSteeringQueue();
    expect(q.hasMessages("unknown")).toBe(false);
  });
});

// ── Steering wired in index.ts ──────────────────────────────────────────────

describe("steering wired in index.ts", () => {
  it("index.ts imports createSteeringQueue", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain("createSteeringQueue");
  });

  it("index.ts has activeTurns set for per-chat serialization", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain("activeTurns");
    expect(content).toContain("activeTurns.has(chatId)");
    expect(content).toContain("activeTurns.add(chatId)");
    expect(content).toContain("activeTurns.delete(chatId)");
  });

  it("all three handlers have finally blocks releasing activeTurns", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    // Text, photo, document handlers all have finally { ... activeTurns.delete(chatId); }
    const finallyBlocks = content.match(/finally\s*\{[\s\S]*?activeTurns\.delete/g);
    expect(finallyBlocks).not.toBeNull();
    expect(finallyBlocks!.length).toBeGreaterThanOrEqual(3);
  });

  it("text handler drains steering in finally (not try body)", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    // POSITIONAL: the old check asserted two disconnected substrings existed
    // somewhere in the file, so moving the drain into the try body stayed green. Every CALL to
    // the drain (skip the function's own definition line and its inner try) must sit inside a
    // finally: the nearest preceding block opener must be `finally {`, not an unrelated `try {`.
    // Comments are stripped first (the same rule as the TTL oracle below):
    // this file habitually quotes code shapes in comments, and a quoted `finally {` between a
    // drain call and its real `try {` would have vacuously greened the gate. Block comments are
    // blanked line-by-line (preserving line numbers), then line comments cut.
    const noBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.split("\n").map(() => "").join("\n"));
    const lines = noBlockComments.split("\n").map((raw) => {
      const l = /^\s*(?:\/\/|\*)/.test(raw) ? "" : raw;
      const at = l.indexOf("//");
      return at === -1 ? l : l.slice(0, at);
    });
    const callLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.includes("await drainSteering("));
    expect(callLines.length, "no drain calls found — re-point this gate").toBeGreaterThanOrEqual(3);
    for (const { i } of callLines) {
      // Walk upward to the nearest BLOCK opener, skipping self-contained one-line try/catch
      // guards (a line carrying both `try {` and `catch` opens nothing that survives it).
      let opener = "";
      for (let k = i - 1; k >= 0 && k > i - 200; k--) {
        const l = lines[k];
        if (l.includes("try {") && l.includes("catch")) continue;
        // Both finally syntaxes count: a block `finally {` and a promise `.finally(`.
        if (l.includes("finally {") || l.includes(".finally(")) { opener = "finally"; break; }
        if (/\btry\s*\{\s*$/.test(l)) { opener = "try"; break; }
      }
      expect(opener, `drain call at line ${i + 1} is not inside a finally`).toBe("finally");
    }
  });
});

describe("task posture wiring in index.ts", () => {
  it("photo handler classifies with an explicit media marker", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain('classifyTaskProfile(`[photo image] ${caption}`)');
    // Takes-mediated: the caption PROPOSES, what it did to her decides,
    // and the taskType the ops log carries is the post-competition one.
    expect(content).toContain("const photoTaskType = photoProfile.primary");
    expect(content).toContain("takesItOn(photoTaskProfile.primary");
  });

  it("text, photo, and document handlers write structured conversation logs", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain("userText: text");
    expect(content).toContain("userText: `[photo] ${caption}`");
    expect(content).toContain("userText: `[document: ${doc.filename}] ${caption}`");
  });

  it("session_start logging includes task type and tier upgrade fields", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain("taskType,");
    expect(content).toContain("tierUpgraded,");
    expect(content).toContain("taskType: photoTaskType");
    expect(content).toContain("taskType: docTaskType");
  });
});

describe("task manager — lifecycle tracking", () => {
  it("create returns a task with correct type and pending status", () => {
    const tm = createTaskManager();
    const task = tm.create("agent_turn", "chat:123");
    expect(task.type).toBe("agent_turn");
    expect(task.status).toBe("pending");
    expect(task.id).toMatch(/^agt_/);
    expect(task.message).toBe("chat:123");
  });

  it("update transitions status and sets completedAt", () => {
    const tm = createTaskManager();
    const task = tm.create("dream", "scheduled");
    tm.update(task.id, "running");
    expect(tm.get(task.id)?.status).toBe("running");
    tm.update(task.id, "completed", "done");
    const updated = tm.get(task.id);
    expect(updated?.status).toBe("completed");
    // `not.toBeNull()` passed on undefined; demand the recorded timestamp itself.
    expect(updated?.completedAt, "completedAt was never recorded").toBeTypeOf("number");
    expect(updated?.completedAt).toBeGreaterThan(0);
    expect(updated?.output).toBe("done");
  });

  it("list returns all tasks", () => {
    const tm = createTaskManager();
    tm.create("agent_turn", "a");
    tm.create("cron", "b");
    expect(tm.list()).toHaveLength(2);
  });

  it("ID prefixes match task type", () => {
    const tm = createTaskManager();
    expect(tm.create("agent_turn", "").id).toMatch(/^agt_/);
    expect(tm.create("dream", "").id).toMatch(/^drm_/);
    expect(tm.create("delegate", "").id).toMatch(/^del_/);
    expect(tm.create("cron", "").id).toMatch(/^crn_/);
  });
});

describe("task manager wired in index.ts", () => {
  it("index.ts creates taskManager and passes to registerCommands", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain("createTaskManager");
    expect(content).toContain("taskManager,");
    expect(content).toContain('taskManager.create("agent_turn"');
  });

  it("commands.ts accepts taskManager in CommandDeps", () => {
    const content = readFileSync(join(process.cwd(), "src", "telegram", "commands.ts"), "utf8");
    expect(content).toContain("taskManager");
  });
});

// ── The step wall (graceful max_iterations) ─────────────────────────────────

describe("the step wall speaks only her words", () => {
  it("the loop no longer carries the first-person progress report", () => {
    // Removed 2026-09-28 with its module: the machine may not write in her voice.
    // Code only: the comments keep the old sentences on the record as the reason for the change.
    const content = readFileSync(join(process.cwd(), "src", "agent", "loop.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
    expect(content).not.toContain("formatPartialDelivery");
    expect(content).not.toContain("下一轮从现在的进度接着做");
    expect(content).not.toContain("这件事我做到一半被停下了");
    expect(existsSync(join(process.cwd(), "src", "agent", "partial.ts"))).toBe(false);
  });

  it("the identity paragraph drops a heading-only IDENTITY.md (S-67)", () => {
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(index).toContain('const own = saysNothing(identity || "") ? "" : `${identity.trim()}\\n\\n`;');
  });

  it("the iteration-cap notice flows through the LOOP's delivered content, with no duplicate follow-up", () => {
    // One fix made the max_iterations exit yield its content (partial note riding on it); a later
    // one removed index's separate limit follow-up, which had become a second/third copy of the
    // same fact: and a sentence he received that her history never recorded. ONE string flows
    // to him, the mouth, history, and memory: the loop's.
    const loop = readFileSync(join(process.cwd(), "src", "agent", "loop.ts"), "utf8");
    const exitAt = loop.indexOf('finishReason: "max_iterations"');
    expect(exitAt).toBeGreaterThan(0);
    expect(loop.slice(exitAt - 900, exitAt)).toContain('yield { type: "text_chunk", content: finalContent }');
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(index, "the duplicate limit follow-up came back").not.toContain("我走了");
  });

  it("index.ts speaks a final answer that never arrived as a text_chunk — except a cut-off one", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    // The interrupted guard is load-bearing: without it, a barge-in/cross-
    // channel abort spoke the FULL unspoken reply through the still-unlatched voice stream,
    // words he cut off, which her history then rightly refused to record.
    expect(content).toContain('if (!spoke && result?.content && result.finishReason !== "interrupted")');
  });
});

// ── Verifier + Skill Outcome Recording (critic merge) ───────────────────────

