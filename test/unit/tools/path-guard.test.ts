import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePath } from "../../../src/tools/builtin/path-guard.js";

describe("path guard", () => {
  it("blocks non-existent paths under a symlink that points outside the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "path-guard-"));
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    try {
      mkdirSync(workspace);
      mkdirSync(outside);
      symlinkSync(outside, join(workspace, "link"), "dir");

      const err = validatePath(join(workspace, "link", "new-file.txt"), workspace, workspace);

      expect(err).toMatch(/outside allowed directories/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
