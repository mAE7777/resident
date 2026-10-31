import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessageTool } from "../../../src/tools/builtin/message.js";

describe("createMessageTool", () => {
  it("allows explicit chat_id only when it matches the configured owner chat", async () => {
    const send = vi.fn<(chatId: number, text: string) => Promise<void>>().mockResolvedValue(undefined);
    const tool = createMessageTool(send, 123);

    const result = await tool.execute({ text: "hello", chat_id: "123" });

    expect(send).toHaveBeenCalledWith(123, "hello");
    expect(result).toContain("Message sent to chat 123");
  });

  it("blocks explicit chat_id that targets a different chat", async () => {
    const send = vi.fn<(chatId: number, text: string) => Promise<void>>().mockResolvedValue(undefined);
    const tool = createMessageTool(send, 123);

    const result = await tool.execute({ text: "hello", chat_id: "456" });

    expect(result).toContain("explicit chat_id is not allowed");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed chat_id instead of parsing prefixes", async () => {
    const send = vi.fn<(chatId: number, text: string) => Promise<void>>().mockResolvedValue(undefined);
    const tool = createMessageTool(send, 123);

    const result = await tool.execute({ text: "hello", chat_id: "123abc" });

    expect(result).toContain("Invalid chat_id");
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the configured default chat when chat_id is omitted", async () => {
    const send = vi.fn<(chatId: number, text: string) => Promise<void>>().mockResolvedValue(undefined);
    const tool = createMessageTool(send, 123);

    const result = await tool.execute({ text: "hello" });

    expect(send).toHaveBeenCalledWith(123, "hello");
    expect(result).toContain("Message sent to chat 123");
  });

  it("queues when no sender is wired", async () => {
    const tool = createMessageTool();

    const result = await tool.execute({ text: "hello" });

    expect(result).toBe("Message queued: hello");
  });

  it("sends files only from allowed workspace paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "message-tool-"));
    try {
      const filePath = join(root, "report.txt");
      writeFileSync(filePath, "ok");
      const sendFile = vi.fn<(chatId: number, filePath: string, caption: string, mediaType: string) => Promise<void>>().mockResolvedValue(undefined);
      const tool = createMessageTool(undefined, 123, sendFile, undefined, root);

      const result = await tool.execute({ text: "report", file_path: "report.txt" });

      expect(sendFile).toHaveBeenCalledWith(123, filePath, "report", "document");
      expect(result).toContain("File sent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks file sending outside the allowed workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "message-tool-"));
    const outside = mkdtempSync(join(tmpdir(), "message-outside-"));
    try {
      const filePath = join(outside, "secret.txt");
      writeFileSync(filePath, "secret");
      const sendFile = vi.fn<(chatId: number, filePath: string, caption: string, mediaType: string) => Promise<void>>().mockResolvedValue(undefined);
      const tool = createMessageTool(undefined, 123, sendFile, undefined, root);

      const result = await tool.execute({ text: "secret", file_path: filePath });

      expect(result).toContain("Access denied");
      expect(sendFile).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
