import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStuckDetector } from "../../../src/agent/stuck.js";
import type { StuckDetector } from "../../../src/agent/stuck.js";
import { createDatabase } from "../../../src/db/sqlite.js";
import type { DatabaseWrapper } from "../../../src/db/sqlite.js";

const READ_FILE = "read_file";
const READ_ARGS = { path: "/src/app.ts" };
const READ_ARGS_OTHER = { path: "/src/other.ts" };
const WRITE_FILE = "write_file";
const WRITE_ARGS = { path: "/src/app.ts" };

describe("createStuckDetector", () => {
  let d: StuckDetector;

  beforeEach(() => {
    d = createStuckDetector();
  });

  // ── AC 1: Repeat action-observation ─────────────────────────────────────

  describe("repeat_action pattern", () => {
    it("AC1: injects message after 3 identical tool calls", () => {
      expect(d.recordToolCall(READ_FILE, READ_ARGS, null)).toBeNull(); // 1
      expect(d.recordToolCall(READ_FILE, READ_ARGS, null)).toBeNull(); // 2
      const result = d.recordToolCall(READ_FILE, READ_ARGS, null);     // 3
      expect(result).not.toBeNull();
      expect(result?.pattern).toBe("repeat_action");
      expect(result?.message).toBe("同一个动作你已经做了三遍了。");
    });

    it("does not trigger on 2 identical calls", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      expect(d.recordToolCall(READ_FILE, READ_ARGS, null)).toBeNull();
    });

    it("resets consecutive count when a different call intervenes", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS_OTHER, null); // break
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      expect(d.recordToolCall(READ_FILE, READ_ARGS, null)).toBeNull(); // only 2nd of new streak
    });

    it("treats calls with different key order in args as identical", () => {
      d.recordToolCall("tool", { b: 2, a: 1 }, null);
      d.recordToolCall("tool", { a: 1, b: 2 }, null);
      const result = d.recordToolCall("tool", { b: 2, a: 1 }, null);
      expect(result?.pattern).toBe("repeat_action");
    });
  });

  // ── AC 2: Repeat action-error ────────────────────────────────────────────

  describe("repeat_error pattern", () => {
    it("triggers after 3 consecutive same-error calls", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, "ENOENT: no such file");
      d.recordToolCall(READ_FILE, READ_ARGS, "ENOENT: no such file");
      const result = d.recordToolCall(READ_FILE, READ_ARGS, "ENOENT: no such file");
      expect(result?.pattern).toBe("repeat_error");
      expect(result?.message).toContain("同一个错误"); // partial match for repeat_error message
    });

    it("does not trigger when error messages differ", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, "ENOENT: no such file");
      d.recordToolCall(READ_FILE, READ_ARGS, "EPERM: permission denied");
      expect(d.recordToolCall(READ_FILE, READ_ARGS, "ENOENT: no such file")).toBeNull();
    });

    it("triggers repeat_action (not repeat_error) when same tool succeeds 3 times", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      // repeat_action fires because no errors: repeat_error never fires without errors
      const result = d.recordToolCall(READ_FILE, READ_ARGS, null);
      expect(result?.pattern).toBe("repeat_action");
    });
  });

  // ── AC 3: Monologue ──────────────────────────────────────────────────────

  describe("monologue pattern", () => {
    it("AC2: injects message after 5 consecutive text-only turns", () => {
      for (let i = 0; i < 4; i++) {
        expect(d.recordTextTurn()).toBeNull();
      }
      const result = d.recordTextTurn(); // 5th
      expect(result?.pattern).toBe("monologue");
      expect(result?.message).toBe("已经说了好一会儿了。");
    });

    it("resets monologue streak and requires fresh 5 turns after tool call", () => {
      d.recordTextTurn(); // 1
      d.recordTextTurn(); // 2
      d.recordTextTurn(); // 3
      d.recordToolCall(READ_FILE, READ_ARGS, null); // resets monologue to 0
      d.recordTextTurn(); // 1 since reset
      d.recordTextTurn(); // 2
      d.recordTextTurn(); // 3
      d.recordTextTurn(); // 4: no trigger
      expect(d.recordTextTurn()?.pattern).toBe("monologue"); // 5 → triggers
    });

    it("keeps triggering past threshold (each text turn after 5 triggers)", () => {
      for (let i = 0; i < 5; i++) d.recordTextTurn();
      expect(d.recordTextTurn()?.pattern).toBe("monologue");
    });
  });

  // ── AC 4: Ping-pong ──────────────────────────────────────────────────────

  describe("ping_pong pattern", () => {
    it("AC3: detects A→B→A→B alternation pattern in tool names", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);       // A
      d.recordToolCall(WRITE_FILE, WRITE_ARGS, null);     // B
      d.recordToolCall(READ_FILE, READ_ARGS, null);       // A
      const result = d.recordToolCall(WRITE_FILE, WRITE_ARGS, null); // B
      expect(result?.pattern).toBe("ping_pong");
      expect(result?.message).toBe("你在两件事之间来回打转。");
    });

    it("does not trigger on AAAA pattern", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      // AAAA: repeat_action fires, not ping_pong
      const result = d.recordToolCall(READ_FILE, READ_ARGS, null);
      expect(result?.pattern).not.toBe("ping_pong");
    });

    it("does not trigger on ABCD sequence", () => {
      d.recordToolCall("a", {}, null);
      d.recordToolCall("b", {}, null);
      d.recordToolCall("c", {}, null);
      expect(d.recordToolCall("d", {}, null)).toBeNull();
    });

    it("does not trigger on ABBA pattern", () => {
      d.recordToolCall("a", {}, null);
      d.recordToolCall("b", {}, null);
      d.recordToolCall("b", {}, null);
      expect(d.recordToolCall("a", {}, null)).toBeNull();
    });

    it("text-only turns are skipped when checking ping-pong window", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);       // A
      d.recordToolCall(WRITE_FILE, WRITE_ARGS, null);     // B
      d.recordTextTurn();                                  // text (skipped in ping-pong)
      d.recordToolCall(READ_FILE, READ_ARGS, null);       // A
      const result = d.recordToolCall(WRITE_FILE, WRITE_ARGS, null); // B
      expect(result?.pattern).toBe("ping_pong");
    });

    // ── Reading a room is not ping-pong (from one of her explorations) ───────────────
    //
    // `read a, grep x, read b, grep y` is the ordinary shape of looking through files, and by
    // tool NAME it is ABAB. Nine of the eleven detections in her whole life were this one,
    // ten of them inside her own moments; the 20:05 one fired twice in six seconds and put the
    // novelty fallback into the middle of her looking. The match is by fingerprint now: going
    // back and forth means doing the SAME two things again.
    it("does not trigger when the alternating calls have different arguments", () => {
      d.recordToolCall("read", { path: "/home/history.jsonl" }, null);
      d.recordToolCall("grep", { pattern: "记不清", path: "/home" }, null);
      d.recordToolCall("read", { path: "/home/continuity.json" }, null);
      expect(d.recordToolCall("grep", { pattern: "窗", path: "/home" }, null)).toBeNull();
    });

    it("still triggers when the same two calls alternate with identical arguments", () => {
      d.recordToolCall("read", { path: "/home/a" }, null);
      d.recordToolCall("grep", { pattern: "x", path: "/home" }, null);
      d.recordToolCall("read", { path: "/home/a" }, null);
      const result = d.recordToolCall("grep", { pattern: "x", path: "/home" }, null);
      expect(result?.pattern).toBe("ping_pong");
    });
  });

  // ── AC 5: Context overflow ───────────────────────────────────────────────

  describe("context_overflow pattern", () => {
    it("AC4: forces intervention after 2 compaction events", () => {
      expect(d.recordCompaction()).toBeNull(); // 1st
      const result = d.recordCompaction();     // 2nd
      expect(result?.pattern).toBe("context_overflow");
      expect(result?.message).toContain("太多");
    });

    it("does not trigger on 1 compaction", () => {
      expect(d.recordCompaction()).toBeNull();
    });

    it("keeps triggering on subsequent compactions", () => {
      d.recordCompaction();
      d.recordCompaction();
      expect(d.recordCompaction()?.pattern).toBe("context_overflow");
    });
  });

  // ── Reset ────────────────────────────────────────────────────────────────

  describe("reset()", () => {
    it("clears all state", () => {
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordCompaction();
      d.recordTextTurn();
      d.recordTextTurn();

      d.reset();

      // After reset everything starts fresh
      expect(d.recordToolCall(READ_FILE, READ_ARGS, null)).toBeNull(); // 1st: no stuck
      expect(d.recordCompaction()).toBeNull();                         // 1st compaction
      for (let i = 0; i < 4; i++) d.recordTextTurn();
      expect(d.recordTextTurn()?.pattern).toBe("monologue");           // 5th
    });
  });

  // ── Independent thresholds ───────────────────────────────────────────────

  describe("independent thresholds per pattern", () => {
    it("each pattern has its own counter — compaction does not affect tool repeat count", () => {
      d.recordCompaction();
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      // Only 2 tool calls: no repeat_action yet
      expect(d.recordToolCall(READ_FILE, READ_ARGS_OTHER, null)).toBeNull();
    });

    it("monologue count does not affect tool-call pattern detection", () => {
      d.recordTextTurn();
      d.recordTextTurn();
      d.recordTextTurn();
      d.recordTextTurn();
      // 4 text turns: no monologue yet
      // Now start tool calls: should reset monologue streak
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      d.recordToolCall(READ_FILE, READ_ARGS, null);
      const result = d.recordToolCall(READ_FILE, READ_ARGS, null);
      expect(result?.pattern).toBe("repeat_action");
    });
  });
});

describe("createStuckDetector — learned stuck patterns", () => {
  let root: string;
  let db: DatabaseWrapper;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "stuck-learning-test-"));
    db = createDatabase(join(root, "test.db")).result;
  });

  afterEach(() => {
    try { db.close(); } catch { /* best-effort */ }
    rmSync(root, { recursive: true, force: true });
  });

  it("records repeated unmatched failure sequences and promotes after 3 recent occurrences", () => {
    const detector = createStuckDetector({ db });

    for (let i = 1; i <= 3; i++) {
      const candidate = detector.recordCandidatePattern(["grep", "read", "bash"]);
      expect(candidate?.occurrences).toBe(i);
      expect(candidate?.promoted).toBe(false);
    }

    const promotion = detector.checkCandidatePromotion();
    expect(promotion.promoted).toBe(1);

    const row = db.db.prepare<[], { occurrences: number; promoted: number }>(
      "SELECT occurrences, promoted FROM stuck_candidates"
    ).get();
    expect(row?.occurrences).toBe(3);
    expect(row?.promoted).toBe(1);
  });

  it("detects a promoted learned pattern on the next matching suffix", () => {
    const trainer = createStuckDetector({ db });
    trainer.recordCandidatePattern(["grep", "read", "bash"]);
    trainer.recordCandidatePattern(["grep", "read", "bash"]);
    trainer.recordCandidatePattern(["grep", "read", "bash"]);
    trainer.checkCandidatePromotion();

    const detector = createStuckDetector({ db });
    expect(detector.recordToolCall("glob", {}, null)).toBeNull();
    expect(detector.recordToolCall("grep", { pattern: "x" }, null)).toBeNull();
    expect(detector.recordToolCall("read", { path: "a.ts" }, null)).toBeNull();
    const detection = detector.recordToolCall("bash", { cmd: "pnpm test" }, null);

    expect(detection?.pattern).toBe("learned_pattern");
    expect(detection?.message).toContain("反复失败过");
  });

  it("does not learn one-tool sequences because they are too ambiguous", () => {
    const detector = createStuckDetector({ db });
    expect(detector.recordCandidatePattern(["bash"])).toBeNull();

    const count = db.db.prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM stuck_candidates"
    ).get()?.n;
    expect(count).toBe(0);
  });

  it("prunes unpromoted candidates whose occurrences are older than 30 days", () => {
    const detector = createStuckDetector({ db });
    detector.recordCandidatePattern(["grep", "read", "edit"]);

    const oldSeconds = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    db.db.prepare("UPDATE stuck_candidates SET first_seen = ?, last_seen = ?").run(oldSeconds, oldSeconds);
    db.db.prepare("UPDATE stuck_candidate_occurrences SET seen_at = ?").run(oldSeconds);

    const result = detector.checkCandidatePromotion();
    expect(result.prunedOccurrences).toBe(1);
    expect(result.prunedCandidates).toBe(1);

    const count = db.db.prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM stuck_candidates"
    ).get()?.n;
    expect(count).toBe(0);
  });

  it("keeps promoted patterns even after their old occurrence rows are pruned", () => {
    const detector = createStuckDetector({ db });
    detector.recordCandidatePattern(["grep", "read", "bash"]);
    detector.recordCandidatePattern(["grep", "read", "bash"]);
    detector.recordCandidatePattern(["grep", "read", "bash"]);
    detector.checkCandidatePromotion();

    const oldSeconds = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    db.db.prepare("UPDATE stuck_candidate_occurrences SET seen_at = ?").run(oldSeconds);

    const result = detector.checkCandidatePromotion();
    expect(result.prunedOccurrences).toBe(3);
    expect(result.prunedCandidates).toBe(0);

    const row = db.db.prepare<[], { promoted: number; occurrences: number }>(
      "SELECT promoted, occurrences FROM stuck_candidates"
    ).get();
    expect(row?.promoted).toBe(1);
    expect(row?.occurrences).toBe(0);
  });
});
