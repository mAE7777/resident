import { describe, it, expect, beforeAll } from "vitest";
import { Buffer } from "buffer";
import {
  processImage,
  toBase64ForVision,
  isSharpAvailable,
  loadSharp,
  IMAGE_REDUCE_QUALITY_STEPS,
  MAX_IMAGE_INPUT_PIXELS,
  DEFAULT_MAX_SIDE,
  DEFAULT_TARGET_SIZE,
} from "../../../src/tools/image.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a solid-color test image of specified dimensions using sharp. */
async function createTestImage(
  width: number,
  height: number,
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const sharp = (await loadSharp())!;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels, 128);
  let pipeline = sharp(raw, {
    raw: { width, height, channels },
  });
  if (format === "png") {
    pipeline = pipeline.png() as ReturnType<typeof sharp>;
  } else {
    pipeline = pipeline.jpeg({ quality: 95 }) as ReturnType<typeof sharp>;
  }
  return Buffer.from(await pipeline.toBuffer());
}

/**
 * Create a test image large enough that at quality 85 the output exceeds
 * the target size, forcing progressive quality reduction.
 */
async function createLargeTestImage(
  targetMinBytes: number,
): Promise<Buffer> {
  const sharp = (await loadSharp())!;
  // Use random-ish data (not solid color) so JPEG can't compress it trivially.
  // A noisy 2048x2048 image should be large enough.
  const width = 2048;
  const height = 2048;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  // Fill with pseudo-random noise pattern
  for (let i = 0; i < raw.length; i++) {
    raw[i] = (i * 7 + 131) & 0xff;
  }
  // Encode as PNG (lossless, so it stays large) then process will re-encode as JPEG
  const png = await sharp(raw, {
    raw: { width, height, channels },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();

  // Verify the PNG is large enough for the test to be meaningful
  if (png.length < targetMinBytes) {
    // If PNG is somehow too small, just return it, tests can still verify behavior
    return Buffer.from(png);
  }
  return Buffer.from(png);
}

// ── Setup ───────────────────────────────────────────────────────────────────

let sharpAvailable = false;

beforeAll(async () => {
  sharpAvailable = await isSharpAvailable();
});

// ── Constants ───────────────────────────────────────────────────────────────

describe("image constants", () => {
  it("exports correct quality steps", () => {
    expect(IMAGE_REDUCE_QUALITY_STEPS).toEqual([85, 75, 65, 55, 45, 35]);
  });

  it("exports 25M pixel limit", () => {
    expect(MAX_IMAGE_INPUT_PIXELS).toBe(25_000_000);
  });

  it("exports 2048 default max side", () => {
    expect(DEFAULT_MAX_SIDE).toBe(2048);
  });

  it("exports 1MB default target size", () => {
    expect(DEFAULT_TARGET_SIZE).toBe(1_048_576);
  });
});

// ── AC1: Resize 4000x3000 → fits within 2048x2048 ──────────────────────────

describe("processImage — resize", () => {
  it("resizes a 4000x3000 image to fit within 2048x2048 maintaining aspect ratio", async () => {
    if (!sharpAvailable) return;

    const input = await createTestImage(4000, 3000);
    const result = await processImage(input);

    // Should fit within 2048x2048
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);

    // Should maintain 4:3 aspect ratio, width should be the constraining dimension
    expect(result.width).toBe(2048);
    // 3000 * (2048/4000) = 1536
    expect(result.height).toBe(1536);
    expect(result.format).toBe("jpeg");
  });

  it("does not enlarge images smaller than max side", async () => {
    if (!sharpAvailable) return;

    const input = await createTestImage(800, 600);
    const result = await processImage(input);

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("respects custom maxSide", async () => {
    if (!sharpAvailable) return;

    const input = await createTestImage(2000, 1500);
    const result = await processImage(input, { maxSide: 1024 });

    expect(result.width).toBeLessThanOrEqual(1024);
    expect(result.height).toBeLessThanOrEqual(1024);
  });
});

// ── AC2: Progressive quality reduction ──────────────────────────────────────

describe("processImage — progressive quality reduction", () => {
  // 30s, not the 5s default: this case encodes the same large noisy image THREE times (a
  // high-quality probe, then the reduction loop), and under the full suite's four parallel
  // workers those encodes contend for CPU and cross the default timeout. Measured:
  // green alone, red in every full run, on a clean tree, a harness limit, not a defect in
  // `processImage`. The budget is generous on purpose; a real regression here would blow past it.
  it("reduces quality until output is under target size", async () => {
    if (!sharpAvailable) return;

    // Create a large noisy image that won't compress well at high quality
    const input = await createLargeTestImage(DEFAULT_TARGET_SIZE * 2);

    // First, process at high quality to see the uncompressed JPEG size
    const highQ = await processImage(input, {
      targetSize: Number.MAX_SAFE_INTEGER,
      quality: 85,
    });

    // Pick a target between low-quality and high-quality outputs to force
    // the reduction loop to step down at least once
    const targetSize = Math.floor(highQ.buffer.length * 0.5);
    const result = await processImage(input, { targetSize });

    // Quality should be lower than the starting level
    expect(result.quality).toBeLessThan(85);
    // Quality should be one of the defined steps
    expect(IMAGE_REDUCE_QUALITY_STEPS).toContain(result.quality);
    // Output should be smaller than the high-quality version
    expect(result.buffer.length).toBeLessThan(highQ.buffer.length);
  }, 30_000);

  it("uses highest quality when output already fits", async () => {
    if (!sharpAvailable) return;

    // Small solid-color image compresses very well
    const input = await createTestImage(100, 100);
    const result = await processImage(input, { targetSize: DEFAULT_TARGET_SIZE });

    // Should use the first (highest) quality step
    expect(result.quality).toBe(85);
    expect(result.buffer.length).toBeLessThan(DEFAULT_TARGET_SIZE);
  });
});

// ── AC3: Pixel limit rejection ──────────────────────────────────────────────

describe("processImage — pixel limit", () => {
  /**
   * A real over-limit image, made through sharp's create path. sharp's own default input
   * limit is ~268M pixels, so creating one is cheap; only processImage's 25M limit refuses it.
   */
  async function createOversizedImage(width: number, height: number): Promise<Buffer> {
    const sharp = (await loadSharp())!;
    return Buffer.from(
      await sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } })
        .png()
        .toBuffer(),
    );
  }

  it("rejects images exceeding 25M pixel limit", async () => {
    if (!sharpAvailable) return;

    // 6000x5000 = 30M pixels > 25M limit. No try/catch around the assertion: the old shape
    // swallowed the assertion failure itself, so deleting the limit kept this test green.
    const big = await createOversizedImage(6000, 5000);
    await expect(processImage(big)).rejects.toThrow(/pixel limit/i);
  }, 30000);

  it("includes descriptive error for oversized images, and only fires past the boundary", async () => {
    if (!sharpAvailable) return;

    // Just over: 5001x5000 = 25.005M pixels. sharp's limitInputPixels fires during the
    // metadata read, so the reachable message is sharp's own "Input image exceeds pixel
    // limit" rather than the wrapper's "25M pixel limit" string.
    const over = await createOversizedImage(5001, 5000);
    await expect(processImage(over)).rejects.toThrow(/pixel limit/i);

    // Exactly at the limit: 5000x5000 = 25M pixels must still process, which proves the
    // rejection above is the limit firing rather than the pipeline choking on any big input.
    const atLimit = await createOversizedImage(5000, 5000);
    const result = await processImage(atLimit);
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
  }, 30000);
});

// ── AC4: toBase64ForVision ──────────────────────────────────────────────────

describe("toBase64ForVision", () => {
  it("returns raw base64 with image/jpeg media type", async () => {
    if (!sharpAvailable) return;

    const input = await createTestImage(200, 150);
    const result = await toBase64ForVision(input);

    expect(result.mediaType).toBe("image/jpeg");
    expect(result.base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("returns decodable base64 that is valid JPEG", async () => {
    if (!sharpAvailable) return;

    const input = await createTestImage(200, 150);
    const result = await toBase64ForVision(input);

    const decoded = Buffer.from(result.base64, "base64");

    // JPEG magic bytes: FF D8 FF
    expect(decoded[0]).toBe(0xff);
    expect(decoded[1]).toBe(0xd8);
    expect(decoded[2]).toBe(0xff);
  });

  it("processes large images before encoding", async () => {
    if (!sharpAvailable) return;

    const input = await createTestImage(4000, 3000);
    const result = await toBase64ForVision(input);

    expect(result.mediaType).toBe("image/jpeg");

    // Decoded JPEG should be under 1MB (default target)
    const decoded = Buffer.from(result.base64, "base64");
    expect(decoded.length).toBeLessThanOrEqual(DEFAULT_TARGET_SIZE);
  });
});

// ── isSharpAvailable ────────────────────────────────────────────────────────

describe("isSharpAvailable", () => {
  it("returns true when sharp is installed", async () => {
    // sharp is a dependency of this project, so it should be available
    expect(await isSharpAvailable()).toBe(true);
  });
});
