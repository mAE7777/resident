import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeFingerprint, codeVersion, resetCodeVersionCache } from "../../../src/life/code-version.js";

/**
 * WHICH BUILD SHE IS BEING RUN BY, a question that had no answer anywhere on this machine.
 *
 * The tree is usually uncommitted, and `package.json` has said 0.1.0 for
 * months, so "which code wrote this memory" was unanswerable and `npm_package_version` (unset
 * outside `npm start`) had been writing the literal string "unknown" into every ops record.
 *
 * Two things depend on this being real rather than decorative:
 *   · a snapshot restored under a different build is a SEMANTIC mismatch, the stored numbers mean
 *     whatever today's formulas say they mean, and the restore has to be able to say so;
 *   · after she is awake, "when did this start" begins with "which build was she running".
 */

let root: string;

function seed(files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body, "utf-8");
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "code-version-test-"));
  resetCodeVersionCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetCodeVersionCache();
});

describe("the fingerprint is a fact about the code", () => {
  it("same source in, same string out", () => {
    seed({ "src/a.ts": "export const a = 1;\n", "src/life/b.ts": "export const b = 2;\n" });
    const first = codeFingerprint(join(root, "src"));
    const second = codeFingerprint(join(root, "src"));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{12}$/u);
  });

  it("one changed byte changes it", () => {
    seed({ "src/a.ts": "export const a = 1;\n" });
    const before = codeFingerprint(join(root, "src"));
    seed({ "src/a.ts": "export const a = 2;\n" });
    expect(codeFingerprint(join(root, "src"))).not.toBe(before);
  });

  it("a renamed file changes it, even with identical contents", () => {
    // The path is hashed as well as the content, because moving a formula from one module to
    // another is exactly the kind of change that makes stored numbers mean something else.
    seed({ "src/a.ts": "export const x = 1;\n" });
    const before = codeFingerprint(join(root, "src"));
    rmSync(join(root, "src/a.ts"));
    seed({ "src/b.ts": "export const x = 1;\n" });
    expect(codeFingerprint(join(root, "src"))).not.toBe(before);
  });

  it("a new file changes it (a build that gained a module is a different build)", () => {
    seed({ "src/a.ts": "export const a = 1;\n" });
    const before = codeFingerprint(join(root, "src"));
    seed({ "src/c.ts": "export const c = 3;\n" });
    expect(codeFingerprint(join(root, "src"))).not.toBe(before);
  });

  it("non-TypeScript files do not move it", () => {
    // Otherwise a README edit would read as a different build, and the signal that a restore is
    // semantically risky would be crying wolf within a day.
    seed({ "src/a.ts": "export const a = 1;\n" });
    const before = codeFingerprint(join(root, "src"));
    seed({ "src/notes.md": "hello\n" });
    expect(codeFingerprint(join(root, "src"))).toBe(before);
  });
});

describe("the build identity", () => {
  it("is the package version plus the fingerprint", () => {
    seed({ "package.json": JSON.stringify({ version: "1.2.3" }), "src/a.ts": "export const a = 1;\n" });
    const v = codeVersion(root);
    expect(v.startsWith("1.2.3+")).toBe(true);
    expect(v.split("+")[1]).toBe(codeFingerprint(join(root, "src")));
  });

  it("is cached, and the cache can be cleared (which is what this export is for)", () => {
    seed({ "package.json": JSON.stringify({ version: "1.0.0" }), "src/a.ts": "export const a = 1;\n" });
    const first = codeVersion(root);
    seed({ "src/a.ts": "export const a = 999;\n" });
    expect(codeVersion(root), "the cache is not holding — this is computed on every call")
      .toBe(first);
    resetCodeVersionCache();
    expect(codeVersion(root)).not.toBe(first);
  });

  it("a missing package.json does not make the build unnameable", () => {
    // Being unable to say which code she is running is the failure this module exists to remove.
    // Degrading to a version of 0.0.0 with a real fingerprint still answers the question.
    seed({ "src/a.ts": "export const a = 1;\n" });
    expect(codeVersion(root)).toMatch(/^0\.0\.0\+[0-9a-f]{12}$/u);
  });
});
