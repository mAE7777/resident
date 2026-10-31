// message tool: sends text or files to him via Telegram.
// executionMode: "sequential", side-effect (outbound message), Zone 2.

import { statSync } from "node:fs";
import type { ToolDef } from "../registry.js";
import { resolveToolPath, validatePath } from "./path-guard.js";
import { annotateBeat, currentBeat } from "../../utils/beat.js";

interface MessageArgs {
  text: string;
  file_path?: string;
  chat_id?: string | number;
}

// Media type detection by file extension
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const AUDIO_EXTS = new Set([".mp3", ".m4a", ".ogg", ".wav", ".flac", ".aac"]);
const VOICE_EXTS = new Set([".ogg", ".oga"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);

function getMediaType(filePath: string): "photo" | "audio" | "voice" | "video" | "document" {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (PHOTO_EXTS.has(ext)) return "photo";
  if (VOICE_EXTS.has(ext)) return "voice";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "document";
}

function parseChatId(value: string | number): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function createMessageTool(
  sendFn?: (chatId: number, text: string) => Promise<void>,
  defaultChatId?: number,
  sendFileFn?: (chatId: number, filePath: string, caption: string, mediaType: string) => Promise<void>,
  hooks?: { execute(point: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> },
  workspacePath?: string,
  cwd?: string,
): ToolDef {
  // Hers to read every turn, so it speaks her language and her situation: one person, one
  // chat, the only outward path she holds from birth.
  const description = sendFn
    ? "把一句话或一个文件送到他那里。要送文件就填 file_path（照片、文档、音频、视频都可以）。"
    : "现在没有通路；写下的话会先存着，等通路回来再送到他那里。";

  return {
    name: "message",
    description,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要说的话（送文件时，这就是随文件的那句说明）" },
        file_path: { type: "string", description: "要送的文件的完整路径" },
        chat_id: { description: "可以不填。只能送到他那一个对话；别的去处一律不通。" },
      },
      required: ["text"],
    },
    executionMode: "sequential",
    async execute(args) {
      const { text, file_path, chat_id } = args as MessageArgs;
      const explicitChat = chat_id !== undefined && chat_id !== null && String(chat_id).trim() !== "";
      const targetChatId = explicitChat ? chat_id : defaultChatId;

      if (targetChatId === undefined) {
        return `Message queued: ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}`;
      }

      const numericId = parseChatId(targetChatId);
      if (numericId === null) {
        return `Invalid chat_id: ${String(targetChatId)}`;
      }
      if (explicitChat && (defaultChatId === undefined || numericId !== defaultChatId)) {
        return "Error: explicit chat_id is not allowed. The message tool can only send to the configured owner chat.";
      }

      let outboundText = text;
      // before_outbound hook: allows handlers to filter/modify outbound messages
      if (hooks) {
        try {
          const ctx = await hooks.execute("before_outbound", { text: outboundText, file_path, chat_id: numericId });
          if (typeof ctx.text === "string") outboundText = ctx.text;
        } catch { /* fail-open */ }
      }

      // File sending
      if (file_path && sendFileFn) {
        const resolved = resolveToolPath(file_path, workspacePath, cwd);
        const pathError = validatePath(resolved, workspacePath, cwd);
        if (pathError) return `Error: ${pathError}`;
        try {
          const stat = statSync(resolved);
          if (!stat.isFile()) return `Error: ${file_path} is not a file`;
          if (stat.size > 50 * 1024 * 1024) return `Error: file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, Telegram limit is 50MB)`;
        } catch {
          return `Error: file not found: ${file_path}`;
        }
        const mediaType = getMediaType(resolved);
        await sendFileFn(numericId, resolved, outboundText, mediaType);
        return `File sent to chat ${numericId}: ${file_path} (${mediaType})`;
      }

      // Text-only sending
      if (file_path && !sendFileFn) {
        return `Error: file sending not configured — file saved at ${file_path} but cannot be sent via Telegram`;
      }

      if (sendFn) {
        await sendFn(numericId, outboundText);
        // HER WORDS WENT OUT THROUGH THIS TOOL (one channel per turn). When a reply's sentences
        // are delivered here, one sentence per message as she likes to send them, the loop's
        // mandatory closing text is left with nothing to say to him, and the model fills it with
        // inner narration: once a line about the four messages she had just sent went to his
        // phone as a fifth message. The beat carries what was ACTUALLY sent, so the
        // turn's end can route the orphan coda to her diary and record the real reply.
        // Attachment sends (file_path above) deliberately do not mark: a caption plus a closing
        // sentence about the picture is one voice, not two channels.
        const sent = (currentBeat()?.note["saidViaTool"] as string[] | undefined) ?? [];
        if (sent.length < 16) sent.push(outboundText.slice(0, 1000));
        annotateBeat({ saidViaTool: sent });
        return `Message sent to chat ${numericId}: ${outboundText.slice(0, 100)}${outboundText.length > 100 ? "…" : ""}`;
      }

      return `Message queued: ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}`;
    },
  };
}
