import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIntegrityChecker,
  CONTRADICTION_THRESHOLD,
  UNTRUSTED_INITIAL_CONFIDENCE,
  USER_CONFIRMED_CONFIDENCE,
  DEFAULT_CONFIDENCE,
} from "../../../src/memory/integrity.js";
import type { IntegrityCheckerDeps } from "../../../src/memory/integrity.js";
import { createFauxProvider, fauxText } from "../../../src/providers/faux.js";

// ── Logger stub ───────────────────────────────────────────────────────────────

const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as any;

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "integrity-test-"));
}

/** Build a unit vector of given length in the first dimension. */
function unitVec(len: number): number[] {
  const v = new Array(len).fill(0);
  v[0] = 1;
  return v;
}

/** Build a vector with given cosine similarity to unitVec(len). */
function vecWithSimilarity(similarity: number, len: number): number[] {
  // v = [similarity, sqrt(1 - similarity^2), 0, 0, ...]
  const v = new Array(len).fill(0);
  v[0] = similarity;
  if (len > 1) v[1] = Math.sqrt(Math.max(0, 1 - similarity * similarity));
  return v;
}

// ── AC1: Contradiction detection ──────────────────────────────────────────────

describe("AC2 — identity file integrity check raises alert on BLAKE3 mismatch", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  it("verifyWithSidecar returns null when file matches sidecar", () => {
    const filePath = join(dir, "MEMORY.md");
    writeFileSync(filePath, "# Memory\nSome fact.\n");

    const checker = createIntegrityChecker({ logger });
    checker.writeChecksum(filePath);

    const alert = checker.verifyWithSidecar(filePath);
    expect(alert).toBeNull();
  });

  it("verifyWithSidecar returns IntegrityAlert when file was modified outside Dream", () => {
    const filePath = join(dir, "MEMORY.md");
    writeFileSync(filePath, "# Memory\nOriginal content.\n");

    const checker = createIntegrityChecker({ logger });
    checker.writeChecksum(filePath);

    // Modify file outside Dream
    writeFileSync(filePath, "# Memory\nTampered content.\n");

    const alert = checker.verifyWithSidecar(filePath);
    expect(alert).not.toBeNull();
    expect(alert?.type).toBe("checksum_mismatch");
    expect(alert?.filePath).toBe(filePath);
    expect(alert?.expected).not.toBe(alert?.actual);
  });

  it("verifyWithSidecar throws when sidecar does not exist", () => {
    const filePath = join(dir, "SOUL.md");
    writeFileSync(filePath, "# Soul\n");

    const checker = createIntegrityChecker({ logger });

    expect(() => checker.verifyWithSidecar(filePath)).toThrow();
  });

  it("computeChecksum is deterministic", () => {
    const filePath = join(dir, "IDENTITY.md");
    writeFileSync(filePath, "# Identity\nVersion 1.\n");

    const checker = createIntegrityChecker({ logger });
    const h1 = checker.computeChecksum(filePath);
    const h2 = checker.computeChecksum(filePath);
    expect(h1).toBe(h2);
  });

  it("verifyChecksum returns false for wrong expected value", () => {
    const filePath = join(dir, "AGENT.md");
    writeFileSync(filePath, "# Agent\n");

    const checker = createIntegrityChecker({ logger });
    const result = checker.verifyChecksum(filePath, "deadbeef");
    expect(result).toBe(false);
  });

  it("verifyChecksum returns true for correct expected value", () => {
    const filePath = join(dir, "USER.md");
    writeFileSync(filePath, "# User\n");

    const checker = createIntegrityChecker({ logger });
    const checksum = checker.computeChecksum(filePath);
    expect(checker.verifyChecksum(filePath, checksum)).toBe(true);
  });
});

// ── AC3: Confidence values ────────────────────────────────────────────────────

describe("AC3 — confidence constants and getInitialConfidence", () => {
  const checker = createIntegrityChecker({ logger });

  it("UNTRUSTED_INITIAL_CONFIDENCE = 0.3 for mcp source", () => {
    expect(checker.getInitialConfidence("mcp")).toBe(UNTRUSTED_INITIAL_CONFIDENCE);
    expect(checker.getInitialConfidence("mcp")).toBe(0.3);
  });

  it("USER_CONFIRMED_CONFIDENCE = 0.9 for user source", () => {
    expect(checker.getInitialConfidence("user")).toBe(USER_CONFIRMED_CONFIDENCE);
    expect(checker.getInitialConfidence("user")).toBe(0.9);
  });

  it("DEFAULT_CONFIDENCE = 0.6 for tool source", () => {
    expect(checker.getInitialConfidence("tool")).toBe(DEFAULT_CONFIDENCE);
    expect(checker.getInitialConfidence("tool")).toBe(0.6);
  });

  it("CONTRADICTION_THRESHOLD = 0.8", () => {
    expect(CONTRADICTION_THRESHOLD).toBe(0.8);
  });
});
