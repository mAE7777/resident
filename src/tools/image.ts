// image.ts, image processing for vision API integration.
// Resizes, compresses, and encodes images for use with Claude's vision
// capabilities. Uses sharp for high-quality JPEG output with progressive
// quality reduction to meet size constraints.

import { Buffer } from "buffer";

// ── Constants ────────────────────────────────────────────────────────────────

/** Quality levels to try in descending order until output fits target size. */
export const IMAGE_REDUCE_QUALITY_STEPS = [85, 75, 65, 55, 45, 35] as const;

/** Maximum input image area in pixels (width * height). */
export const MAX_IMAGE_INPUT_PIXELS = 25_000_000;

/** Default maximum dimension for either side after resize. */
export const DEFAULT_MAX_SIDE = 2048;

/** Default target output size in bytes (1 MB). */
export const DEFAULT_TARGET_SIZE = 1_048_576;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ImageOptions {
  /** Maximum width/height (default 2048). Image is resized to fit within. */
  maxSide?: number;
  /** Target output file size in bytes (default 1 MB). */
  targetSize?: number;
  /** Starting quality (default: first step in IMAGE_REDUCE_QUALITY_STEPS). */
  quality?: number;
}

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
  quality: number;
}

// ── Lazy sharp loader ────────────────────────────────────────────────────────

// sharp uses `export = sharp`, TypeScript sees the namespace directly,
// but at ESM runtime `import("sharp")` yields `{ default: sharpFn }`.
// We store the callable as an opaque type to avoid the mismatch.
// `Parameters<>` resolves to sharp's LAST overload, whose first argument omits the create/text
// options form (`sharp({ create: {...} })`) that sharp genuinely supports for making a blank
// image. Widening the input to also accept SharpOptions restores that documented call.
type SharpFn = (
  input?: Parameters<typeof import("sharp")>[0] | import("sharp").SharpOptions,
  options?: Parameters<typeof import("sharp")>[1],
) => import("sharp").Sharp;

let sharpCached: SharpFn | null | undefined;

/**
 * Lazy-load sharp. Returns the callable sharp function on success, null
 * if unavailable. Caches the result so subsequent calls are instant.
 */
export async function loadSharp(): Promise<SharpFn | null> {
  if (sharpCached !== undefined) return sharpCached;

  try {
    const mod: { default?: SharpFn } = await import("sharp") as never;
    sharpCached = mod.default ?? (mod as unknown as SharpFn);
    return sharpCached;
  } catch {
    sharpCached = null;
    return null;
  }
}

/** Check whether sharp is available without throwing. */
export async function isSharpAvailable(): Promise<boolean> {
  return (await loadSharp()) !== null;
}

// ── Core processing ─────────────────────────────────────────────────────────

/**
 * Process an image buffer: validate pixel count, resize to fit max dimensions,
 * then progressively reduce JPEG quality until output fits the target size.
 *
 * Throws if the image exceeds the pixel limit or sharp is unavailable.
 */
export async function processImage(
  input: Buffer,
  options: ImageOptions = {},
): Promise<ProcessedImage> {
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error("sharp is not available");
  }

  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;
  const targetSize = options.targetSize ?? DEFAULT_TARGET_SIZE;

  // Create sharp instance with safety limits
  const image = sharp(input, {
    failOnError: false,
    limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
  });

  // Read metadata to check pixel count
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pixels = width * height;

  if (pixels > MAX_IMAGE_INPUT_PIXELS) {
    throw new Error(
      `Image exceeds ${MAX_IMAGE_INPUT_PIXELS / 1_000_000}M pixel limit (${width}x${height} = ${(pixels / 1_000_000).toFixed(1)}M pixels)`,
    );
  }

  if (width === 0 || height === 0) {
    throw new Error("Unable to read image dimensions");
  }

  // Build the quality steps to try
  const startQuality = options.quality ?? IMAGE_REDUCE_QUALITY_STEPS[0];
  const steps = IMAGE_REDUCE_QUALITY_STEPS.filter((q) => q <= startQuality);

  // Resize with EXIF orientation correction, then try quality levels
  let outputBuffer: Buffer | undefined;
  let outputQuality = steps[0]!;

  for (const quality of steps) {
    const buf = await sharp(input, {
      failOnError: false,
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    })
      .rotate() // apply EXIF orientation
      .resize({
        width: maxSide,
        height: maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    outputBuffer = Buffer.from(buf);
    outputQuality = quality;

    if (outputBuffer.length <= targetSize) {
      break;
    }
  }

  if (!outputBuffer) {
    throw new Error("Failed to process image");
  }

  // Get final dimensions from the processed output
  const outputMeta = await sharp(outputBuffer, { failOnError: false }).metadata();

  return {
    buffer: outputBuffer,
    width: outputMeta.width ?? 0,
    height: outputMeta.height ?? 0,
    format: "jpeg",
    quality: outputQuality,
  };
}

export interface VisionImage {
  base64: string;
  mediaType: string;
}

/**
 * Process an image and return raw base64 + media type suitable for Claude's
 * vision API content blocks.
 *
 * Falls back to raw base64 encoding if sharp is unavailable, using the
 * original buffer and guessing the MIME type from magic bytes.
 */
export async function toBase64ForVision(input: Buffer): Promise<VisionImage> {
  const sharp = await loadSharp();

  if (sharp) {
    const processed = await processImage(input);
    return {
      base64: processed.buffer.toString("base64"),
      mediaType: "image/jpeg",
    };
  }

  // Graceful degradation: return raw buffer as base64 with detected MIME
  return {
    base64: input.toString("base64"),
    mediaType: detectImageMime(input),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Detect image MIME type from magic bytes. */
function detectImageMime(buf: Buffer): string {
  if (buf.length < 4) return "application/octet-stream";

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif";
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return "application/octet-stream";
}
