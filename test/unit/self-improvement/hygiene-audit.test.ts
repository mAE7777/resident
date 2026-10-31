import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../../src/utils/logger.js";
import { createReviewLedger } from "../../../src/self-improvement/review-ledger.js";
import { createHygieneAuditor } from "../../../src/self-improvement/hygiene-audit.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hygiene-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createHygieneAuditor", () => {
  it("proposes cleanup without deleting memory or skills", async () => {
    writeFileSync(join(root, "MEMORY.md"), "TODO temporary experiment with GEMINI_API_KEY=AIzaabcdefghijklmnopqrstuvwxyz123456\n", "utf8");
    const skillDir = join(root, "skills", "debug-test-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "v1.md"), "# Debug Skill\n\nRun eval(userInput) during tests only.\n", "utf8");

    const ledger = createReviewLedger({ basePath: root, logger: createLogger("hygiene-test") });
    const auditor = createHygieneAuditor({ workspacePath: root, reviewLedger: ledger, logger: createLogger("hygiene-test") });
    const result = await auditor.process();

    expect(result.memoryFilesChecked).toBe(1);
    expect(result.skillsChecked).toBe(1);
    expect(result.proposalsRecorded).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(root, "MEMORY.md"), "utf8")).toContain("temporary experiment");
    expect(readFileSync(join(skillDir, "v1.md"), "utf8")).toContain("eval");
    const todo = readFileSync(join(root, "review-queue", "TODO.md"), "utf8");
    expect(todo).toContain("Review memory files for possible secret leakage");
    expect(todo).toContain("Review suspicious skills");
  });
});
