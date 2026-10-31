// Outcome verification, E-5 shape: evidence-driven only. The machinery checks ITSELF,
// did what she wrote actually land on disk, from her own tool calls, never from English
// regexes over the owner's message and never from a model's opinion of her turn.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOutcomeVerifier,
  collectFileWrites,
  collectArtifacts,
  type OutcomeToolCall,
} from "../../../src/agent/outcome-verifier.js";

function call(over: Partial<OutcomeToolCall>): OutcomeToolCall {
  return { name: "write", args: {}, content: "", success: true, ...over };
}

describe("applies — evidence only", () => {
  it("applies iff her calls left something checkable, never from words", () => {
    const v = createOutcomeVerifier({ workspacePath: "/tmp/x" });
    expect(v.applies({ taskDescription: "download the video and check the weather", agentOutput: "", toolCalls: [] }),
      "his words alone must never trigger a verification").toBe(false);
    expect(v.applies({
      taskDescription: "", agentOutput: "",
      toolCalls: [call({ name: "write", args: { path: "a.md", content: "x" } })],
    })).toBe(true);
    expect(v.applies({
      taskDescription: "", agentOutput: "",
      toolCalls: [call({ name: "read", artifactPaths: ["/tmp/a.png"] })],
    })).toBe(true);
  });
});

describe("verify — the disk is the judge", () => {
  it("confirms a write that landed and flags one that did not", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ov-"));
    try {
      writeFileSync(join(ws, "ok.md"), "她写下的内容在这里", "utf8");
      const v = createOutcomeVerifier({ workspacePath: ws });
      const good = await v.verify({
        taskDescription: "", agentOutput: "",
        toolCalls: [call({ args: { path: "ok.md", content: "她写下的内容在这里" } })],
      });
      expect(good.reenter).toBe(false);
      expect(good.confidence).toBe(1);
      expect(good.strategy).toBe("file");

      const bad = await v.verify({
        taskDescription: "", agentOutput: "",
        toolCalls: [call({ args: { path: "missing.md", content: "从没落盘的东西" } })],
      });
      expect(bad.reenter, "a claimed write that is not on disk must re-enter").toBe(true);
      expect(bad.critique).toContain("对不上");
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });

  it("checks reported artifacts exist and are non-empty", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ov-"));
    try {
      const p = join(ws, "art.svg");
      writeFileSync(p, "<svg/>", "utf8");
      const v = createOutcomeVerifier({ workspacePath: ws });
      const ok = await v.verify({
        taskDescription: "", agentOutput: "",
        toolCalls: [call({ name: "read", artifactPaths: [p] })],
      });
      expect(ok.strategy).toBe("artifact");
      expect(ok.reenter).toBe(false);
      const missing = await v.verify({
        taskDescription: "", agentOutput: "",
        toolCalls: [call({ name: "read", artifactPaths: [join(ws, "gone.png")] })],
      });
      expect(missing.reenter).toBe(true);
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });

  it("failed calls contribute no evidence", () => {
    expect(collectFileWrites("/w", [call({ success: false, args: { path: "x", content: "y" } })])).toEqual([]);
    expect(collectArtifacts([call({ success: false, artifactPaths: ["/a"] })])).toEqual([]);
  });

  it("PLANTED: the source keeps no matcher over his words and no model call", () => {
    const src = readFileSync(join(process.cwd(), "src/agent/outcome-verifier.ts"), "utf8");
    expect(src.includes("taskDescription)"), "a strategy is reading his words again").toBe(false);
    expect(src.includes("provider.complete"), "a model call inside the verifier").toBe(false);
    expect(src.includes("fallbackVerifier"), "the model fallback is back").toBe(false);
  });
});
