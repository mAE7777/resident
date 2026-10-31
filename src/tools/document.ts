// document.ts, text extraction from PDF, DOCX, PPTX, and plain text files.
// Ported from IronClaw's document_extraction module. Dynamic imports keep
// heavy dependencies out of the critical path until first use.

import { Buffer } from "buffer";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum document size to accept (10 MB). */
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

/** Maximum extracted text length to keep (100K chars ~25K tokens). */
export const MAX_EXTRACTED_TEXT_LEN = 100_000;

// ── MIME sets ────────────────────────────────────────────────────────────────

const PLAIN_TEXT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
  "text/html",
  "text/xml",
  "text/x-python",
  "text/x-java",
  "text/x-c",
  "text/x-c++",
  "text/x-rust",
  "text/x-go",
  "text/x-ruby",
  "text/x-shellscript",
  "text/javascript",
  "text/css",
  "text/x-toml",
  "text/x-yaml",
  "text/x-log",
]);

const APP_TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-sh",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "tsv", "json", "xml", "yaml", "yml", "toml",
  "md", "markdown", "py", "js", "ts", "rs", "go", "java", "c",
  "cpp", "h", "hpp", "rb", "sh", "bash", "zsh", "fish", "css",
  "html", "htm", "sql", "log", "ini", "cfg", "conf",
]);

// ── Public API ───────────────────────────────────────────────────────────────

export interface ExtractionResult {
  text: string | null;
  diagnostic?: string;
}

/**
 * Extract text from a document buffer based on MIME type and filename.
 *
 * Returns `{ text }` on success, or `{ text: null, diagnostic }` on failure.
 * Rejects files exceeding MAX_DOCUMENT_SIZE with a diagnostic message.
 * Truncates extracted text at a codepoint boundary when it exceeds
 * MAX_EXTRACTED_TEXT_LEN.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<ExtractionResult> {
  // Size gate
  if (buffer.length > MAX_DOCUMENT_SIZE) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(1);
    const maxMb = (MAX_DOCUMENT_SIZE / (1024 * 1024)).toFixed(0);
    return {
      text: null,
      diagnostic: `Document too large: ${mb} MB exceeds ${maxMb} MB limit`,
    };
  }

  const baseMime = mimeType.split(";")[0]!.trim();

  let raw: string | null = null;
  let diagnostic: string | undefined;

  try {
    raw = await dispatchByMime(buffer, baseMime);
  } catch {
    // MIME dispatch failed: try extension fallback
  }

  // Extension fallback when MIME dispatch returned nothing
  if (raw === null && filename) {
    try {
      raw = await extractByExtension(buffer, filename);
    } catch {
      // Extension fallback also failed
    }
  }

  if (raw === null) {
    diagnostic = `Unsupported document type: ${baseMime}`;
    if (filename) diagnostic += ` (${filename})`;
    return { text: null, diagnostic };
  }

  return { text: truncateText(raw) };
}

// ── MIME dispatch ────────────────────────────────────────────────────────────

const AUDIO_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/wav",
  "audio/x-wav", "audio/ogg", "audio/flac", "audio/webm", "audio/aac",
  "audio/x-m4a", "video/mp4", // voice memos sometimes tagged as video
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "m4a", "wav", "ogg", "flac", "webm", "aac", "wma", "opus",
]);

async function dispatchByMime(
  buffer: Buffer,
  baseMime: string,
): Promise<string | null> {
  if (baseMime === "application/pdf") {
    return extractPdf(buffer);
  }

  if (
    baseMime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(buffer);
  }

  if (
    baseMime ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return extractPptx(buffer);
  }

  if (AUDIO_MIMES.has(baseMime) || baseMime.startsWith("audio/")) {
    return transcribeAudio(buffer, baseMime);
  }

  if (PLAIN_TEXT_MIMES.has(baseMime) || baseMime.startsWith("text/")) {
    return extractPlainText(buffer);
  }

  if (APP_TEXT_MIMES.has(baseMime)) {
    return extractPlainText(buffer);
  }

  return null;
}

// ── Extension fallback ───────────────────────────────────────────────────────

async function extractByExtension(
  buffer: Buffer,
  filename: string,
): Promise<string | null> {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();

  if (ext === "pdf") return extractPdf(buffer);
  if (ext === "docx") return extractDocx(buffer);
  if (ext === "pptx") return extractPptx(buffer);
  if (AUDIO_EXTENSIONS.has(ext)) return transcribeAudio(buffer, `audio/${ext}`);
  if (TEXT_EXTENSIONS.has(ext)) return extractPlainText(buffer);

  return null;
}

// ── Extractors ───────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // Primary: pdf-parse for text-based PDFs (instant, no OCR)
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (text.length > 0) return text; // text-based PDF: fast path
  } finally {
    await parser.destroy().catch(() => {});
  }

  // Fallback: OCR for scanned/image-based PDFs (pymupdf render → tesseract)
  return extractPdfWithOcr(buffer);
}

async function extractPdfWithOcr(buffer: Buffer): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const tmpRoot = join(tmpdir(), `_ocr_${Date.now()}`);
  const tmpPdf = join(tmpRoot, "input.pdf");

  try {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(tmpPdf, buffer);

    // Render up to the first 5 pages via pymupdf. Scanned PDFs often contain
    // useful text after page 1; capping keeps Telegram handling bounded.
    execFileSync("python3", [
      "-c",
      "import sys, pathlib, pymupdf\n" +
        "pdf, out = sys.argv[1], pathlib.Path(sys.argv[2])\n" +
        "doc = pymupdf.open(pdf)\n" +
        "limit = min(len(doc), 5)\n" +
        "for i in range(limit):\n" +
        "    doc[i].get_pixmap(dpi=250).save(str(out / f'page-{i+1}.png'))\n",
      tmpPdf,
      tmpRoot,
    ], { timeout: 30_000 });

    const pageImages = readdirSync(tmpRoot)
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
    const pageTexts: string[] = [];
    for (const image of pageImages) {
      const result = execFileSync("tesseract", [join(tmpRoot, image), "stdout"], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      });
      const text = (result as string).trim();
      if (text) pageTexts.push(text);
    }

    return pageTexts.join("\n\n--- page ---\n\n").trim();
  } catch {
    // OCR pipeline unavailable (missing pymupdf or tesseract), return empty
    return "";
  } finally {
    try { if (existsSync(tmpPdf)) unlinkSync(tmpPdf); } catch { /* cleanup */ }
    try { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* cleanup */ }
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  // Primary: mammoth for clean text output
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (text.length > 0) return text;
  } catch {
    // mammoth failed: fall through to jszip fallback
  }

  // Fallback: extract from word/document.xml via jszip
  return extractOfficeXml(buffer, "word/document.xml");
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  // Collect slide filenames: ppt/slides/slide1.xml, slide2.xml, ...
  const slideNames: string[] = [];
  zip.forEach((path) => {
    if (path.startsWith("ppt/slides/slide") && path.endsWith(".xml")) {
      slideNames.push(path);
    }
  });

  // Sort numerically by slide number (slide2 before slide10)
  slideNames.sort((a, b) => {
    const numA = extractSlideNumber(a);
    const numB = extractSlideNumber(b);
    return numA - numB;
  });

  const slideTexts: string[] = [];
  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const text = stripXmlTags(xml);
    if (text.length > 0) {
      slideTexts.push(text);
    }
  }

  if (slideTexts.length === 0) {
    throw new Error("no text found in PPTX slides");
  }

  return slideTexts.join("\n\n---\n\n");
}

function extractPlainText(buffer: Buffer): string {
  return buffer.toString("utf8");
}

// ── Audio transcription (system-level, no agent iterations needed) ─────────

async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, unlinkSync, existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  // Determine file extension from MIME type
  const extMap: Record<string, string> = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
    "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac",
    "audio/webm": "webm", "audio/aac": "aac", "video/mp4": "m4a",
  };
  const ext = extMap[mimeType] ?? "mp3";
  const tmpFile = join(tmpdir(), `_audio_${Date.now()}.${ext}`);

  try {
    writeFileSync(tmpFile, buffer);

    // Local whisper CLI only (free, no silent paid fallback)
    try {
      execFileSync("which", ["whisper"], { timeout: 5_000 });
    } catch {
      return "[Transcription unavailable] whisper CLI not installed. Install: brew install openai-whisper";
    }

    const txtFile = tmpFile.replace(`.${ext}`, ".txt");
    try {
      execFileSync("whisper", [
        tmpFile, "--model", "turbo", "--output_format", "txt",
        "--output_dir", tmpdir(),
      ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    } catch (err) {
      return `[Transcription failed] whisper error: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (existsSync(txtFile)) {
      const text = readFileSync(txtFile, "utf8").trim();
      try { unlinkSync(txtFile); } catch { /* cleanup */ }
      if (text.length > 0) return `[Transcription]\n${text}`;
    }

    return "[Transcription failed] whisper produced no output for this file.";
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* cleanup */ }
  }
}

async function extractOfficeXml(
  buffer: Buffer,
  contentPath: string,
): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(contentPath);
  if (!file) throw new Error(`content file not found: ${contentPath}`);

  const xml = await file.async("string");
  const text = stripXmlTags(xml);
  if (text.length === 0) throw new Error("no text content found");
  return text;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the numeric suffix from a slide filename for sorting. */
function extractSlideNumber(path: string): number {
  const match = /slide(\d+)\.xml$/.exec(path);
  return match ? Number(match[1]) : 0;
}

/**
 * Strip XML tags, collapse whitespace, and decode common XML entities.
 * Mirrors IronClaw's strip_xml_tags function.
 */
export function stripXmlTags(xml: string): string {
  let result = "";
  let inTag = false;
  let lastWasSpace = true;

  for (const ch of xml) {
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      // Add space between tag-delimited text runs
      if (!lastWasSpace && result.length > 0) {
        result += " ";
        lastWasSpace = true;
      }
      continue;
    }
    if (inTag) continue;

    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        result += " ";
        lastWasSpace = true;
      }
    } else {
      result += ch;
      lastWasSpace = false;
    }
  }

  // Decode common XML entities
  return result
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * Truncate text at a codepoint boundary, appending a truncation notice.
 * Uses Array.from() for codepoint-safe slicing (equivalent to Rust's
 * char_indices().take_while()).
 */
export function truncateText(text: string): string {
  if (text.length <= MAX_EXTRACTED_TEXT_LEN) {
    // Fast path: if the string length (in UTF-16 code units) is within
    // the limit, the codepoint count is guaranteed to be within it too.
    return text;
  }

  // Codepoint-safe truncation
  const codepoints = Array.from(text);
  if (codepoints.length <= MAX_EXTRACTED_TEXT_LEN) {
    return text;
  }

  const truncated = codepoints.slice(0, MAX_EXTRACTED_TEXT_LEN).join("");
  return truncated + "\n\n[... truncated, document too long ...]";
}
