// Memory integrity: contradiction detection and identity file checksum verification.
//
// getInitialConfidence: maps source type to confidence constant.
// computeChecksum / verifyChecksum / writeChecksum / verifyWithSidecar: BLAKE3 sidecar pattern.
//
// Fail-open: embedding or LLM failures are caught and logged; checker continues.

import { readFileSync, writeFileSync } from "node:fs";
import { blake3 } from "@noble/hashes/blake3.js";
import type { Logger } from "../utils/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONTRADICTION_THRESHOLD = 0.8;
export const UNTRUSTED_INITIAL_CONFIDENCE = 0.3;
export const USER_CONFIRMED_CONFIDENCE = 0.9;
export const DEFAULT_CONFIDENCE = 0.6;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContradictionResult =
  | { contradicts: true; existingId: string; existingContent: string; similarity: number }
  | { contradicts: false };

export type IntegrityAlert = {
  type: "checksum_mismatch";
  filePath: string;
  expected: string;
  actual: string;
};

export interface IntegrityCheckerDeps {
  logger: Logger;
}

export interface IntegrityChecker {
  getInitialConfidence(sourceType: "user" | "tool" | "mcp"): number;
  computeChecksum(filePath: string): string;
  verifyChecksum(filePath: string, expected: string): boolean;
  writeChecksum(filePath: string): void;
  verifyWithSidecar(filePath: string): IntegrityAlert | null;
}


// ── Factory ────────────────────────────────────────────────────────────────────

export function createIntegrityChecker(deps: IntegrityCheckerDeps): IntegrityChecker {
  const { logger } = deps;

  // checkContradiction (embedding + model semantic drift) had zero callers and left with
  // the embedding stack (E-4). The BLAKE3 sidecar below is the whole tamper alarm.
  function getInitialConfidence(sourceType: "user" | "tool" | "mcp"): number {
    switch (sourceType) {
      case "user":
        return USER_CONFIRMED_CONFIDENCE;
      case "tool":
        return DEFAULT_CONFIDENCE;
      case "mcp":
        return UNTRUSTED_INITIAL_CONFIDENCE;
    }
  }

  function computeChecksum(filePath: string): string {
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(filePath);
    } catch (err) {
      throw new Error(
        `Failed to read file for checksum: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const digest = blake3(fileBuffer);
    return Buffer.from(digest).toString("hex");
  }

  function verifyChecksum(filePath: string, expected: string): boolean {
    const actual = computeChecksum(filePath);
    return actual === expected;
  }

  function writeChecksum(filePath: string): void {
    const checksum = computeChecksum(filePath);
    const sidecarPath = `${filePath}.blake3`;
    try {
      writeFileSync(sidecarPath, checksum, { encoding: "utf8", mode: 0o600 });
    } catch (err) {
      throw new Error(
        `Failed to write checksum sidecar: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    logger.debug({ filePath, sidecarPath }, "integrity: wrote checksum sidecar");
  }

  function verifyWithSidecar(filePath: string): IntegrityAlert | null {
    const sidecarPath = `${filePath}.blake3`;
    let expected: string;
    try {
      expected = readFileSync(sidecarPath, "utf8").trim();
    } catch (err) {
      throw new Error(
        `Failed to read checksum sidecar at ${sidecarPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const actual = computeChecksum(filePath);
    if (actual === expected) {
      return null;
    }

    logger.warn({ filePath, expected, actual }, "integrity: checksum mismatch detected");
    return { type: "checksum_mismatch", filePath, expected, actual };
  }

  return {
    getInitialConfidence,
    computeChecksum,
    verifyChecksum,
    writeChecksum,
    verifyWithSidecar,
  };
}
