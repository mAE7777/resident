// media.ts, photo and document download handler for Telegram bot.
// Uses grammY's ctx.getFile() to retrieve file metadata, then downloads
// via the Telegram file API. Text extraction is performed for common
// document formats (PDF, DOCX, PPTX, plain text); binary files are
// returned as-is for base64 encoding.

import type { Context } from "grammy";
import { basename } from "node:path";
import { Buffer } from "buffer";
import {
  extractText as extractDocumentText,
  MAX_DOCUMENT_SIZE,
} from "../tools/document.js";
import { toBase64ForVision, type VisionImage } from "../tools/image.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max caption length in UTF-16 code units (Telegram API guarantee). */
const MAX_CAPTION_UTF16 = 1024;

/** File extensions treated as extractable plain text. */
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".log"]);

/** Allowed origin for Telegram file download URLs, SSRF defense. */
const TELEGRAM_FILE_ORIGIN = "https://api.telegram.org/";

/** Defensive download cap for Telegram photos before image compression. */
const MAX_PHOTO_DOWNLOAD_SIZE = 20 * 1024 * 1024;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PhotoDownload {
  data: Buffer;
  fileId: string;
  caption?: string;
}

export interface DocumentDownload {
  data: Buffer;
  filename: string;
  mimeType: string;
  caption?: string;
}

export function sanitizeTelegramFilename(filename: string | undefined): string {
  const base = basename((filename ?? "document").replace(/\\/g, "/"));
  const safe = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return safe || "document";
}

export interface MediaHandler {
  downloadPhoto(ctx: Context, signal?: AbortSignal): Promise<PhotoDownload | null>;
  downloadDocument(ctx: Context, signal?: AbortSignal): Promise<DocumentDownload | null>;
  extractTextContent(
    data: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string | null>;
  /** Process a photo buffer into raw base64 + media type for Claude vision API. */
  processPhotoForVision(data: Buffer): Promise<VisionImage | null>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a media handler that downloads photos and documents from Telegram.
 *
 * @param getFileUrl - Resolves a file_id to a download URL.
 *   Callers typically implement this as:
 *   `async (fileId) => { const f = await bot.api.getFile(fileId); return f.file_path ? \`https://api.telegram.org/file/bot${token}/${f.file_path}\` : undefined; }`
 */
export function createMediaHandler(
  getFileUrl: (fileId: string) => Promise<string | undefined>,
  allowedOrigin = TELEGRAM_FILE_ORIGIN
): MediaHandler {
  /**
   * Download a file by ID and return its content as a Buffer.
   * Returns null on any error (graceful degradation).
   */
  async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
    const contentLength = Number(response.headers?.get?.("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      console.error(`[media] download blocked: content-length ${contentLength} exceeds ${maxBytes}`);
      return null;
    }

    if (!response.body) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > maxBytes) {
        console.error(`[media] download blocked: body ${arrayBuffer.byteLength} exceeds ${maxBytes}`);
        return null;
      }
      return Buffer.from(arrayBuffer);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          console.error(`[media] download blocked: streamed body exceeds ${maxBytes}`);
          try { await reader.cancel(); } catch { /* best-effort */ }
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  }

  async function downloadById(fileId: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer | null> {
    try {
      if (signal?.aborted) return null;
      const url = await getFileUrl(fileId);
      if (!url) return null;
      if (signal?.aborted) return null;

      // SSRF defense: only allow Telegram API file URLs
      if (!url.startsWith(allowedOrigin)) {
        console.error(`[media] blocked non-Telegram URL: ${new URL(url).origin}`);
        return null;
      }

      const response = await fetch(url, { signal });
      if (!response.ok) {
        console.error(
          `[media] download failed: ${response.status} ${response.statusText}`
        );
        return null;
      }

      return readResponseWithLimit(response, maxBytes);
    } catch (err) {
      console.error("[media] download error", err);
      return null;
    }
  }

  /**
   * Validate and trim caption to stay within the UTF-16 limit.
   * Telegram guarantees ≤1024 UTF-16 code units but we validate defensively.
   */
  function sanitizeCaption(raw: string | undefined): string | undefined {
    if (!raw) return undefined;

    // Walk the string counting UTF-16 code units.
    // Stop as soon as adding the next character would exceed the limit.
    let units = 0;
    let i = 0;
    while (i < raw.length) {
      const code = raw.codePointAt(i)!;
      // Supplementary characters (U+10000+) take 2 UTF-16 code units
      const size = code > 0xffff ? 2 : 1;
      if (units + size > MAX_CAPTION_UTF16) break;
      units += size;
      i += size;
    }

    // If we stopped before consuming the full string, truncate
    return i < raw.length ? raw.slice(0, i) : raw;
  }

  return {
    /**
     * Download the highest-resolution photo from a photo message.
     * The Telegram API returns photos as an array sorted by size ascending;
     * the last element is the highest resolution.
     */
    async downloadPhoto(ctx: Context, signal?: AbortSignal): Promise<PhotoDownload | null> {
      try {
        if (signal?.aborted) return null;
        const photos = ctx.message?.photo;
        if (!photos || photos.length === 0) return null;

        // Last element = highest resolution
        const photo = photos[photos.length - 1];
        if (!photo) return null;

        if (photo.file_size !== undefined && photo.file_size > MAX_PHOTO_DOWNLOAD_SIZE) {
          console.error(`[media] photo blocked: size ${photo.file_size} exceeds ${MAX_PHOTO_DOWNLOAD_SIZE}`);
          return null;
        }

        const data = await downloadById(photo.file_id, MAX_PHOTO_DOWNLOAD_SIZE, signal);
        if (!data) return null;

        return {
          data,
          fileId: photo.file_id,
          caption: sanitizeCaption(ctx.message?.caption),
        };
      } catch (err) {
        console.error("[media] downloadPhoto error", err);
        return null;
      }
    },

    /**
     * Download a document from a document message.
     */
    async downloadDocument(ctx: Context, signal?: AbortSignal): Promise<DocumentDownload | null> {
      try {
        if (signal?.aborted) return null;
        const doc = ctx.message?.document;
        if (!doc) return null;

        if (doc.file_size !== undefined && doc.file_size > MAX_DOCUMENT_SIZE) {
          console.error(`[media] document blocked: size ${doc.file_size} exceeds ${MAX_DOCUMENT_SIZE}`);
          return null;
        }

        const data = await downloadById(doc.file_id, MAX_DOCUMENT_SIZE, signal);
        if (!data) return null;

        return {
          data,
          filename: sanitizeTelegramFilename(doc.file_name),
          mimeType: doc.mime_type ?? "application/octet-stream",
          caption: sanitizeCaption(ctx.message?.caption),
        };
      } catch (err) {
        console.error("[media] downloadDocument error", err);
        return null;
      }
    },

    /**
     * Process a photo buffer for Claude vision API use.
     * Resizes, compresses, and returns a base64 data URI.
     * Returns null on any error (graceful degradation).
     */
    async processPhotoForVision(data: Buffer): Promise<VisionImage | null> {
      try {
        return await toBase64ForVision(data);
      } catch (err) {
        console.error("[media] processPhotoForVision error", err);
        return null;
      }
    },

    /**
     * Extract text content from a buffer based on filename and MIME type.
     * Supports PDF, DOCX, PPTX, and plain text formats via the document
     * processing module. Returns null for unsupported or binary files
     * (caller handles those as base64 for vision capabilities).
     * Rejects files exceeding 10 MB.
     */
    async extractTextContent(
      data: Buffer,
      filename: string,
      mimeType: string
    ): Promise<string | null> {
      // Fast path for known text extensions, skip the async pipeline
      const dotIdx = filename.lastIndexOf(".");
      const ext = dotIdx !== -1 ? filename.slice(dotIdx).toLowerCase() : "";
      if (TEXT_EXTENSIONS.has(ext)) {
        return data.toString("utf8");
      }

      // Delegate to document processor for PDF, DOCX, PPTX, and text/* types
      if (data.length > MAX_DOCUMENT_SIZE) return null;

      const result = await extractDocumentText(data, mimeType, filename);
      return result.text;
    },
  };
}
