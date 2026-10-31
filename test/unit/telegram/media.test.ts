import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMediaHandler, sanitizeTelegramFilename } from "../../../src/telegram/media.js";
import type { Context } from "grammy";
import { Buffer } from "buffer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(overrides: Record<string, unknown> = {}): Context {
  return {
    message: {},
    getFile: vi.fn(),
    ...overrides,
  } as unknown as Context;
}

function makePhotoCtx(opts: {
  photoSizes?: Array<{ file_id: string; width: number; height: number }>;
  caption?: string;
}): Context {
  return makeContext({
    message: {
      photo: opts.photoSizes ?? [
        { file_id: "small_id", width: 100, height: 100, file_unique_id: "u1" },
        { file_id: "large_id", width: 800, height: 600, file_unique_id: "u2" },
      ],
      caption: opts.caption,
    },
  });
}

function makeDocumentCtx(opts: {
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  fileSize?: number;
}): Context {
  return makeContext({
    message: {
      document: {
        file_id: opts.fileId ?? "doc_file_id",
        file_unique_id: "du1",
        file_name: opts.fileName,
        mime_type: opts.mimeType,
        file_size: opts.fileSize,
      },
      caption: opts.caption,
    },
  });
}

// ── createMediaHandler factory ────────────────────────────────────────────────

describe("createMediaHandler — factory", () => {
  it("returns downloadPhoto, downloadDocument, and extractTextContent", () => {
    const handler = createMediaHandler(async () => undefined);
    expect(typeof handler.downloadPhoto).toBe("function");
    expect(typeof handler.downloadDocument).toBe("function");
    expect(typeof handler.extractTextContent).toBe("function");
  });
});

// ── downloadPhoto ─────────────────────────────────────────────────────────────

describe("createMediaHandler.downloadPhoto", () => {
  const photoData = Buffer.from("fake-image-data");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("downloads the highest-resolution photo (last in array)", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => photoData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({});

    const result = await handler.downloadPhoto(ctx);

    expect(getFileUrl).toHaveBeenCalledWith("large_id");
    expect(result).not.toBeNull();
    expect(result?.fileId).toBe("large_id");
    expect(result?.data).toBeInstanceOf(Buffer);
  });

  it("includes caption from context message", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => photoData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({ caption: "Look at this!" });

    const result = await handler.downloadPhoto(ctx);
    expect(result?.caption).toBe("Look at this!");
  });

  it("returns null when photo array is missing", async () => {
    const getFileUrl = vi.fn();
    const handler = createMediaHandler(getFileUrl);
    const ctx = makeContext({ message: { photo: undefined } });

    const result = await handler.downloadPhoto(ctx);
    expect(result).toBeNull();
    expect(getFileUrl).not.toHaveBeenCalled();
  });

  it("returns null when photo array is empty", async () => {
    const getFileUrl = vi.fn();
    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({ photoSizes: [] });

    const result = await handler.downloadPhoto(ctx);
    expect(result).toBeNull();
  });

  it("returns null when getFileUrl returns undefined", async () => {
    const getFileUrl = vi.fn().mockResolvedValue(undefined);
    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({});

    const result = await handler.downloadPhoto(ctx);
    expect(result).toBeNull();
  });

  it("blocks oversized documents before fetching bytes", async () => {
    const getFileUrl = vi.fn();
    const handler = createMediaHandler(getFileUrl);
    const ctx = makeDocumentCtx({ fileSize: 11 * 1024 * 1024 });

    const result = await handler.downloadDocument(ctx);

    expect(result).toBeNull();
    expect(getFileUrl).not.toHaveBeenCalled();
  });

  it("returns null when fetch fails (non-ok response)", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({});

    const result = await handler.downloadPhoto(ctx);
    expect(result).toBeNull();
  });

  it("returns null and logs when fetch throws", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({});

    const result = await handler.downloadPhoto(ctx);
    expect(result).toBeNull();
  });

  it("blocks non-Telegram URLs (SSRF defense)", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://evil.com/steal-data");
    global.fetch = vi.fn() as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({});

    const result = await handler.downloadPhoto(ctx);
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns caption as undefined when no caption on photo", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => photoData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({ caption: undefined });

    const result = await handler.downloadPhoto(ctx);
    expect(result?.caption).toBeUndefined();
  });
});

// ── downloadDocument ──────────────────────────────────────────────────────────

describe("createMediaHandler.downloadDocument", () => {
  const docData = Buffer.from("hello world\n");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("downloads document and returns data + metadata", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/documents/doc.txt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => docData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makeDocumentCtx({
      fileName: "hello.txt",
      mimeType: "text/plain",
    });

    const result = await handler.downloadDocument(ctx);

    expect(result).not.toBeNull();
    expect(result?.filename).toBe("hello.txt");
    expect(result?.mimeType).toBe("text/plain");
    expect(result?.data).toBeInstanceOf(Buffer);
    expect(getFileUrl).toHaveBeenCalledWith("doc_file_id");
  });

  it("includes caption from document message", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/documents/doc.txt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => docData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makeDocumentCtx({ caption: "See attached" });

    const result = await handler.downloadDocument(ctx);
    expect(result?.caption).toBe("See attached");
  });

  it("uses default filename when file_name is absent", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/documents/doc.txt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => docData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makeDocumentCtx({ fileName: undefined });

    const result = await handler.downloadDocument(ctx);
    expect(result?.filename).toBe("document");
  });

  it("sanitizes path traversal in document filenames", () => {
    expect(sanitizeTelegramFilename("../../AGENT.md")).toBe("AGENT.md");
    expect(sanitizeTelegramFilename("..\\..\\secret token.txt")).toBe("secret_token.txt");
  });

  it("uses default mimeType when mime_type is absent", async () => {
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/documents/doc.txt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => docData.buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makeDocumentCtx({ mimeType: undefined });

    const result = await handler.downloadDocument(ctx);
    expect(result?.mimeType).toBe("application/octet-stream");
  });

  it("returns null when no document on context", async () => {
    const getFileUrl = vi.fn();
    const handler = createMediaHandler(getFileUrl);
    const ctx = makeContext({ message: { document: undefined } });

    const result = await handler.downloadDocument(ctx);
    expect(result).toBeNull();
    expect(getFileUrl).not.toHaveBeenCalled();
  });

  it("returns null when getFileUrl returns undefined", async () => {
    const getFileUrl = vi.fn().mockResolvedValue(undefined);
    const handler = createMediaHandler(getFileUrl);
    const ctx = makeDocumentCtx({});

    const result = await handler.downloadDocument(ctx);
    expect(result).toBeNull();
  });
});

// ── extractTextContent ────────────────────────────────────────────────────────

describe("createMediaHandler.extractTextContent", () => {
  const handler = createMediaHandler(async () => undefined);

  it("extracts .txt files as UTF-8 string", async () => {
    const data = Buffer.from("Hello, world!");
    expect(await handler.extractTextContent(data, "file.txt", "text/plain")).toBe(
      "Hello, world!"
    );
  });

  it("extracts .md files as UTF-8 string", async () => {
    const data = Buffer.from("# Title\n\nContent");
    expect(await handler.extractTextContent(data, "README.md", "text/markdown")).toBe(
      "# Title\n\nContent"
    );
  });

  it("extracts .json files as UTF-8 string", async () => {
    const data = Buffer.from('{"key":"value"}');
    expect(
      await handler.extractTextContent(data, "data.json", "application/json")
    ).toBe('{"key":"value"}');
  });

  it("extracts .csv files as UTF-8 string", async () => {
    const data = Buffer.from("a,b,c\n1,2,3");
    expect(await handler.extractTextContent(data, "data.csv", "text/csv")).toBe(
      "a,b,c\n1,2,3"
    );
  });

  it("extracts .log files as UTF-8 string", async () => {
    const data = Buffer.from("2024-01-01 INFO started");
    expect(await handler.extractTextContent(data, "app.log", "text/plain")).toBe(
      "2024-01-01 INFO started"
    );
  });

  it("extracts text/* MIME types even with unknown extension", async () => {
    const data = Buffer.from("some text content");
    expect(
      await handler.extractTextContent(data, "file.xyz", "text/something")
    ).toBe("some text content");
  });

  it("returns null for .png files (binary)", async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    expect(await handler.extractTextContent(data, "image.png", "image/png")).toBeNull();
  });

  it("returns null for malformed .pdf files (binary stub)", async () => {
    const data = Buffer.from("%PDF-1.4");
    // A tiny stub isn't a valid PDF, extraction fails, returns null
    expect(
      await handler.extractTextContent(data, "document.pdf", "application/pdf")
    ).toBeNull();
  });

  it("returns null for .jpg files (binary)", async () => {
    const data = Buffer.from([0xff, 0xd8, 0xff]); // JPEG header
    expect(await handler.extractTextContent(data, "photo.jpg", "image/jpeg")).toBeNull();
  });

  it("returns null for .zip files (binary)", async () => {
    const data = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP header
    expect(
      await handler.extractTextContent(data, "archive.zip", "application/zip")
    ).toBeNull();
  });

  it("handles files with no extension using MIME type only", async () => {
    const data = Buffer.from("plain text");
    expect(await handler.extractTextContent(data, "noextension", "text/plain")).toBe(
      "plain text"
    );
  });

  it("is case-insensitive for extensions", async () => {
    const data = Buffer.from("CONTENT");
    expect(await handler.extractTextContent(data, "FILE.TXT", "text/plain")).toBe(
      "CONTENT"
    );
  });
});

// ── Caption UTF-16 length validation ─────────────────────────────────────────

describe("createMediaHandler — caption UTF-16 validation", () => {
  it("preserves captions within 1024 UTF-16 code units", async () => {
    const caption = "A".repeat(1024);
    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("data").buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({ caption });

    const result = await handler.downloadPhoto(ctx);
    expect(result?.caption).toBe(caption);
  });

  it("truncates captions exceeding 1024 UTF-16 code units", async () => {
    // Use emoji (U+1F600, 2 UTF-16 code units) to create an overlong caption
    // 513 emoji = 1026 UTF-16 units, which exceeds the 1024 limit
    const emoji = "\u{1F600}"; // grinning face: 2 UTF-16 code units
    const caption = emoji.repeat(513); // 1026 UTF-16 units

    const getFileUrl = vi.fn().mockResolvedValue("https://api.telegram.org/file/bot123/photos/photo.jpg");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("data").buffer,
    }) as unknown as typeof fetch;

    const handler = createMediaHandler(getFileUrl);
    const ctx = makePhotoCtx({ caption });

    const result = await handler.downloadPhoto(ctx);
    // Result must be at most 1024 UTF-16 code units
    const utf16Length = [...(result?.caption ?? "")].reduce(
      (acc, ch) => acc + (ch.codePointAt(0)! > 0xffff ? 2 : 1),
      0
    );
    expect(utf16Length).toBeLessThanOrEqual(1024);
  });
});
