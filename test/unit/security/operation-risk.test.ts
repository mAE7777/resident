import { describe, expect, it } from "vitest";
import { classifyOperationRisk, targetPathForToolArgs } from "../../../src/security/operation-risk.js";

describe("operation-risk", () => {
  it("keeps read-only web_fetch in zone 1", () => {
    expect(classifyOperationRisk("web_fetch", { url: "https://example.com" }).zone).toBe(1);
  });

  it("upgrades mutating web_fetch to zone 2", () => {
    const post = classifyOperationRisk("web_fetch", { url: "https://example.com", method: "POST", body: "x" });
    expect(post.zone).toBe(2);
    expect(post.isSensitive).toBe(false);
    expect(post.isStateChange).toBe(true);

    const save = classifyOperationRisk("web_fetch", { url: "https://example.com", save_path: "out.json" });
    expect(save.zone).toBe(2);
    expect(save.isSensitive).toBe(false);
    expect(save.isStateChange).toBe(true);
  });

  it("treats artifact and video extraction as workspace mutations", () => {
    const artifact = classifyOperationRisk("artifact_fetch", { source: "https://example.com/a.zip" });
    expect(artifact.zone).toBe(2);
    expect(artifact.isSensitive).toBe(false);
    expect(artifact.isStateChange).toBe(true);

    const video = classifyOperationRisk("video_extract", { input: "https://youtu.be/x" });
    expect(video.zone).toBe(2);
    expect(video.isSensitive).toBe(false);
    expect(video.isStateChange).toBe(true);
  });

  it("upgrades self writes", () => {
    expect(classifyOperationRisk("self", { operation: "read", path: "iteration" }).zone).toBe(1);
    expect(classifyOperationRisk("self", { operation: "write", path: "iteration", value: 1 }).zone).toBe(2);
  });

  it("keeps cron list read-only while gating cron mutations", () => {
    const list = classifyOperationRisk("cron", { action: "list" });
    expect(list.zone).toBe(1);
    expect(list.isSensitive).toBe(false);
    expect(list.isStateChange).toBe(false);

    const add = classifyOperationRisk("cron", {
      action: "add",
      name: "daily check",
      message: "check in",
      schedule_type: "cron",
      schedule_value: "0 9 * * *",
    });
    expect(add.zone).toBe(2);
    expect(add.isSensitive).toBe(false);
    expect(add.isStateChange).toBe(true);
  });

  it("classifies mixed-action tools by operation instead of tool name alone", () => {
    const undoList = classifyOperationRisk("undo", { action: "list" });
    expect(undoList.zone).toBe(1);
    expect(undoList.isSensitive).toBe(false);
    expect(undoList.isStateChange).toBe(false);

    const undoLast = classifyOperationRisk("undo", { action: "undo_last" });
    expect(undoLast.zone).toBe(2);
    expect(undoLast.isSensitive).toBe(false);
    expect(undoLast.isStateChange).toBe(true);

    const browserRead = classifyOperationRisk("browser_read", { url: "https://example.com" });
    expect(browserRead.zone).toBe(2);
    expect(browserRead.isSensitive).toBe(true);
    expect(browserRead.isStateChange).toBe(false);

    const browserCapture = classifyOperationRisk("browser_capture", { url: "https://example.com", output_path: "shots/page.png" });
    expect(browserCapture.zone).toBe(2);
    expect(browserCapture.isSensitive).toBe(true);
    expect(browserCapture.isStateChange).toBe(true);
    expect(browserCapture.targetPath).toBe("shots/page.png");

    const documentRead = classifyOperationRisk("document_extract", { path: "private.pdf" });
    expect(documentRead.zone).toBe(2);
    expect(documentRead.isSensitive).toBe(true);
    expect(documentRead.isStateChange).toBe(false);
  });

  it("keeps owner-bound outbound tools state-changing but not generic sensitive access", () => {
    const message = classifyOperationRisk("message", { text: "done" });
    expect(message.zone).toBe(2);
    expect(message.isSensitive).toBe(false);
    expect(message.isStateChange).toBe(true);

    const resourceUpdate = classifyOperationRisk("resource_update", { resource: "Docs" });
    expect(resourceUpdate.zone).toBe(2);
    expect(resourceUpdate.isSensitive).toBe(false);
    expect(resourceUpdate.isStateChange).toBe(true);
  });

  it("treats connect_mcp as a sensitive review proposal rather than direct state change", () => {
    const risk = classifyOperationRisk("connect_mcp", { id: "browser", transport: "stdio", command: "npx" });
    expect(risk.zone).toBe(3);
    expect(risk.isSensitive).toBe(true);
    expect(risk.isStateChange).toBe(false);
  });

  it("extracts target paths for autonomy overrides", () => {
    expect(targetPathForToolArgs("write", { path: "a.txt" })).toBe("a.txt");
    expect(targetPathForToolArgs("message", { file_path: "out.pdf" })).toBe("out.pdf");
    expect(targetPathForToolArgs("artifact_fetch", { output_path: "downloads" })).toBe("downloads");
  });
});
