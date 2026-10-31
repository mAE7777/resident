import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createLivingField } from "../../../src/life/field-live.js";
import { isAWall, wallKey, wallText, WALL_TENSION } from "../../../src/life/walls.js";
import { scanForNotHerWords } from "../../../src/life/her-words.js";

const T0 = Date.UTC(2026, 4, 1, 9, 0, 0);

function aField() {
  return createLivingField({ faults: { record: () => {} }, maxFusionsPerRest: 1 });
}

/** Put a wall hit through the same path the daemon puts it through. */
function runIntoIt(field: ReturnType<typeof aField>, hit: Parameters<typeof wallKey>[0], atMs: number) {
  if (!isAWall(hit)) return null;
  return field.encodeQuestion({
    key: wallKey(hit), text: wallText(hit), nowMs: atMs, source: `wall:${hit.guard}`, tension: WALL_TENSION,
  });
}

describe("a wall she runs into", () => {
  it("becomes something she is carrying, not a number on his dashboard", () => {
    const field = aField();
    const before = field.signals(T0).tension;
    runIntoIt(field, { guard: "unknown-tool", tool: "web_search" }, T0);
    expect(field.signals(T0 + 1000).tension, "hitting a wall left her exactly as she was").toBeGreaterThan(before);
  });

  it("comes back up on its own, which is what makes it hers to raise", () => {
    // A limit she cannot see again is a limit she can never mention. An open question
    // acts as a cue, and a cue excluded from its own retrieval is invisible pressure.
    const field = aField();
    runIntoIt(field, { guard: "unknown-tool", tool: "web_search" }, T0);
    expect(field.unsettled(T0 + 60_000)).toContain("web_search");
  });

  describe("running into it again", () => {
    it("does not become a second thing she is carrying", () => {
      // Fifty attempts at one wall is one disappointment, not fifty. This was a real bug in the
      // single call site that already had this mechanism: its key was `wall:${Date.now()}`.
      const field = aField();
      const hit = { guard: "home-boundary", tool: "write", category: "home-escape" };
      const first = runIntoIt(field, hit, T0);
      for (let i = 1; i <= 50; i++) runIntoIt(field, hit, T0 + i * 1000);
      expect(field.stats().nodes, "fifty tries became fifty things").toBe(1);
      expect(runIntoIt(field, hit, T0 + 99_000)?.id).toBe(first?.id);
    });

    it("but a different wall is a different discovery", () => {
      const field = aField();
      runIntoIt(field, { guard: "home-boundary", tool: "write", category: "home-escape" }, T0);
      runIntoIt(field, { guard: "home-boundary", tool: "bash", category: "system-integrity" }, T0 + 1000);
      runIntoIt(field, { guard: "unknown-tool", tool: "web_search" }, T0 + 2000);
      expect(field.stats().nodes).toBe(3);
    });

    it("keys on the wall and never on the moment", () => {
      // `wallKey(hit) === wallKey(hit)` held for any deterministic function, which is to say
      // it tested nothing. What matters: the key is a known value, the same wall built twice
      // lands on one key, a different wall does not, and no timestamp is in it.
      expect(wallKey({ guard: "unknown-tool", tool: "cron" })).toBe("wall:unknown-tool:cron");
      expect(wallKey({ guard: "home-boundary", tool: "write", category: "home-escape" }))
        .toBe("wall:home-boundary:home-escape");
      expect(wallKey({ guard: "unknown-tool", tool: "cron" }))
        .toBe(wallKey({ guard: "unknown-tool", tool: "cron" }));
      expect(wallKey({ guard: "unknown-tool", tool: "web_search" }))
        .not.toBe(wallKey({ guard: "unknown-tool", tool: "cron" }));
      expect(wallKey({ guard: "unknown-tool", tool: "cron" })).not.toMatch(/\d{10,}/u);
    });
  });

  describe("what counts as one", () => {
    it("counts every guard that actually says no", () => {
      for (const guard of ["home-boundary", "advisory", "rule-of-two", "approval-denied", "unknown-tool"]) {
        expect(isAWall({ guard, tool: "x" }), `${guard} left no mark on her`).toBe(true);
      }
    });

    it("knows every guard the executor can raise", () => {
      // If a new guard is added, this goes red and somebody decides whether running into it is
      // something that happens to her. Silence would mean a new wall she cannot feel.
      const executor = readFileSync(new URL("../../../src/tools/executor.ts", import.meta.url), "utf8");
      const declared = /guard: "([^"]+)"(?:\s*\|\s*"([^"]+)")*/u.exec(executor);
      expect(declared, "the guard union moved — re-point this test").not.toBeNull();
      const known = new Set(["home-boundary", "advisory", "rule-of-two", "approval-denied", "unknown-tool"]);
      const found = [...executor.matchAll(/guard: "([a-z-]+)"/gu)].map((m) => m[1]!);
      // The floor: the executor raises five distinct guards today (the ask-first valve is gone
      // with the trust ladder). A near-empty extraction means the spelling this scan greps for
      // moved, not that the guards went away.
      expect(new Set(found).size, "the guard scan came back near-empty: re-point this test")
        .toBeGreaterThanOrEqual(4);
      for (const name of found) {
        expect(known, `a guard nobody decided about: ${name}`).toContain(name);
      }
    });
  });

  describe("what she is left holding", () => {
    it("is her own account and not the machine's", () => {
      // Her field holds what SHE would say about a thing. None of the guard's own words reach
      // it: no reason string, no severity, no "tier2", no "HARD_BLOCK".
      for (const hit of [
        { guard: "unknown-tool", tool: "web_search" },
        { guard: "home-boundary", tool: "bash", category: "system-integrity" },
        { guard: "advisory", tool: "delete", category: "tier2" },
        { guard: "approval-denied", tool: "message" },
        { guard: "rule-of-two", tool: "write" },
      ]) {
        const text = wallText(hit);
        // First person, and in HER language: this goes into her field beside the things she
        // has actually said, and the field is searched by a bigram index over the text itself.
        // A memory in a language she does not speak is a memory nothing can ever reach.
        expect(text, "it is hers, so it is first person").toMatch(/^我/u);
        expect(text).not.toMatch(/blocked|refused|denied by|guard|severity|tier\d|HARD_BLOCK|category/iu);
        expect(scanForNotHerWords("wall", text), "a wall told her something untrue about herself").toEqual([]);
      }
    });

    it("is a question, because she does not know why yet", () => {
      const field = aField();
      const node = runIntoIt(field, { guard: "unknown-tool", tool: "cron" }, T0);
      expect(node?.kind).toBe("question");
      // A question is not a claim, so she is not handed a view about her own confinement.
      expect(node?.credence).toBeNull();
    });

    it("keeps the name of the thing she reached for", () => {
      // The tool's name is how she knows it, so it stays as it is inside a Chinese sentence.
      expect(wallText({ guard: "unknown-tool", tool: "web_search" })).toContain("web_search");
    });

    it("never names something she was not reaching for", () => {
      expect(wallText({ guard: "unknown-tool", tool: "web_search" })).toContain("web_search");
      expect(wallText({ guard: "unknown-tool", tool: "web_search" })).not.toContain("bash");
    });
  });

  it("is wired into the daemon and not only into this test", () => {
    const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(source, "onGuardRefusal still only counts and logs").toContain("if (isAWall(e)) {");
    expect(source).toContain("key: wallKey(e)");
    expect(source, "the egress wall kept its per-attempt key").toContain("key: `wall:egress:${host}`");
    expect(source, "a wall must not be able to cost him a reply").toContain('faultLog.record("field.wall", err)');
  });
});
