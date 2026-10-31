import { describe, it, expect, vi, beforeEach } from "vitest";
import { Buffer } from "buffer";
import {
  extractText,
  stripXmlTags,
  truncateText,
  MAX_DOCUMENT_SIZE,
  MAX_EXTRACTED_TEXT_LEN,
} from "../../../src/tools/document.js";

// ── stripXmlTags ─────────────────────────────────────────────────────────────

describe("stripXmlTags", () => {
  it("strips basic tags and joins text with spaces", () => {
    expect(stripXmlTags("<root><p>Hello</p><p>World</p></root>")).toBe(
      "Hello World",
    );
  });

  it("decodes XML entities", () => {
    expect(stripXmlTags("<t>A &amp; B &lt; C &gt; D</t>")).toBe(
      "A & B < C > D",
    );
  });

  it("decodes &quot; and &apos;", () => {
    expect(stripXmlTags("<t>&quot;hi&apos;s&quot;</t>")).toBe('"hi\'s"');
  });

  it("collapses whitespace", () => {
    expect(stripXmlTags("<p>  hello   world  </p>")).toBe("hello world");
  });

  it("returns empty string for tag-only input", () => {
    expect(stripXmlTags("<a><b><c/></b></a>")).toBe("");
  });

  it("handles nested tags", () => {
    expect(
      stripXmlTags(
        '<w:body><w:p><w:r><w:t>Some text</w:t></w:r></w:p></w:body>',
      ),
    ).toBe("Some text");
  });
});

// ── truncateText ─────────────────────────────────────────────────────────────

describe("truncateText", () => {
  it("passes through text shorter than the limit", () => {
    expect(truncateText("hello")).toBe("hello");
  });

  it("truncates at the codepoint boundary and appends notice", () => {
    const long = "a".repeat(MAX_EXTRACTED_TEXT_LEN + 500);
    const result = truncateText(long);
    expect(result).toContain("[... truncated, document too long ...]");
    // The core text portion should be exactly MAX_EXTRACTED_TEXT_LEN codepoints
    const withoutNotice = result.split("\n\n[... truncated")[0]!;
    expect(Array.from(withoutNotice).length).toBe(MAX_EXTRACTED_TEXT_LEN);
  });

  it("handles supplementary plane characters (emoji) without splitting surrogates", () => {
    // Build a string of emoji (2 UTF-16 code units each, 1 codepoint each)
    const emoji = "\u{1F600}"; // grinning face
    const long = emoji.repeat(MAX_EXTRACTED_TEXT_LEN + 10);
    const result = truncateText(long);
    expect(result).toContain("[... truncated, document too long ...]");
    // Verify no broken surrogate pairs: every char should be valid
    for (const ch of result.split("\n\n[... truncated")[0]!) {
      expect(ch.codePointAt(0)).toBeGreaterThan(0);
    }
  });
});

// ── extractText: size limit ─────────────────────────────────────────────────

describe("extractText — size limit", () => {
  it("rejects files exceeding 10 MB", async () => {
    const buf = Buffer.alloc(MAX_DOCUMENT_SIZE + 1, 0x41);
    const result = await extractText(buf, "text/plain", "big.txt");
    expect(result.text).toBeNull();
    expect(result.diagnostic).toContain("exceeds");
    expect(result.diagnostic).toContain("10 MB");
  });

  it("accepts files at exactly the limit", async () => {
    const buf = Buffer.alloc(MAX_DOCUMENT_SIZE, 0x41);
    const result = await extractText(buf, "text/plain", "exact.txt");
    expect(result.text).not.toBeNull();
  });
});

// ── extractText: plain text ─────────────────────────────────────────────────

describe("extractText — plain text", () => {
  it("extracts text/plain", async () => {
    const buf = Buffer.from("Hello world");
    const result = await extractText(buf, "text/plain", "notes.txt");
    expect(result.text).toBe("Hello world");
  });

  it("extracts text/csv", async () => {
    const buf = Buffer.from("name,age\nAlice,30");
    const result = await extractText(buf, "text/csv", "data.csv");
    expect(result.text).toBe("name,age\nAlice,30");
  });

  it("extracts application/json", async () => {
    const buf = Buffer.from('{"key":"value"}');
    const result = await extractText(buf, "application/json", "data.json");
    expect(result.text).toBe('{"key":"value"}');
  });

  it("extracts text/markdown", async () => {
    const buf = Buffer.from("# Heading\n\nParagraph");
    const result = await extractText(buf, "text/markdown", "readme.md");
    expect(result.text).toBe("# Heading\n\nParagraph");
  });

  it("extracts text/* MIME types not in the explicit set", async () => {
    const buf = Buffer.from("some code");
    const result = await extractText(buf, "text/x-custom", "file.x");
    expect(result.text).toBe("some code");
  });

  it("falls back to extension for unknown MIME", async () => {
    const buf = Buffer.from("code here");
    const result = await extractText(
      buf,
      "application/octet-stream",
      "script.py",
    );
    expect(result.text).toBe("code here");
  });

  it("strips MIME parameters (charset, etc.)", async () => {
    const buf = Buffer.from("utf8 text");
    const result = await extractText(
      buf,
      "text/plain; charset=utf-8",
      "file.txt",
    );
    expect(result.text).toBe("utf8 text");
  });
});

// ── extractText: unsupported format ─────────────────────────────────────────

describe("extractText — unsupported format", () => {
  it("returns null with diagnostic for a .zip archive", async () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const result = await extractText(buf, "application/zip", "archive.zip");
    expect(result.text).toBeNull();
    expect(result.diagnostic).toBeDefined();
    expect(result.diagnostic).toContain("Unsupported");
  });

  it("returns null for image/png", async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await extractText(buf, "image/png", "photo.png");
    expect(result.text).toBeNull();
    expect(result.diagnostic).toContain("Unsupported");
  });

  it("returns null for application/octet-stream without known extension", async () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const result = await extractText(
      buf,
      "application/octet-stream",
      "file.xyz",
    );
    expect(result.text).toBeNull();
  });
});

// ── extractText: truncation ─────────────────────────────────────────────────

describe("extractText — truncation", () => {
  it("truncates text exceeding 100K chars", async () => {
    const longText = "x".repeat(MAX_EXTRACTED_TEXT_LEN + 1000);
    const buf = Buffer.from(longText);
    const result = await extractText(buf, "text/plain", "long.txt");
    expect(result.text).not.toBeNull();
    expect(result.text!.length).toBeLessThan(
      MAX_EXTRACTED_TEXT_LEN + 100, // account for the appended notice
    );
    expect(result.text).toContain("[... truncated, document too long ...]");
  });
});

// ── extractText: PDF ────────────────────────────────────────────────────────

describe("extractText — PDF", () => {
  it("extracts text from a minimal PDF", async () => {
    // Minimal valid PDF with text "Hello World"
    const pdfContent = `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 44>>
stream
BT /F1 24 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000340 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
434
%%EOF`;
    const buf = Buffer.from(pdfContent);
    const result = await extractText(buf, "application/pdf", "test.pdf");
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("Hello World");
  });

  it("extracts PDF by file extension fallback", async () => {
    const pdfContent = `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 44>>
stream
BT /F1 24 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000340 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
434
%%EOF`;
    const buf = Buffer.from(pdfContent);
    // Send with generic MIME but .pdf extension
    const result = await extractText(
      buf,
      "application/octet-stream",
      "report.pdf",
    );
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("Hello World");
  });
});

// ── extractText: DOCX ───────────────────────────────────────────────────────

describe("extractText — DOCX", () => {
  it("extracts text from a minimal DOCX (jszip fallback)", async () => {
    // Create a minimal DOCX ZIP with word/document.xml
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?>
       <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <w:body>
           <w:p><w:r><w:t>Meeting notes from Tuesday</w:t></w:r></w:p>
         </w:body>
       </w:document>`,
    );
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );

    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await extractText(
      buf,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "notes.docx",
    );
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("Meeting notes from Tuesday");
  });
});

// ── extractText: PPTX ───────────────────────────────────────────────────────

describe("extractText — PPTX", () => {
  it("extracts text from multiple slides joined with separator", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );
    zip.file(
      "ppt/slides/slide2.xml",
      '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );

    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await extractText(
      buf,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "deck.pptx",
    );
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("Slide One");
    expect(result.text).toContain("Slide Two");
    expect(result.text).toContain("\n\n---\n\n");
  });

  it("sorts slides numerically (slide2 before slide10)", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    // Add slides out of order
    zip.file(
      "ppt/slides/slide10.xml",
      '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Ten</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );
    zip.file(
      "ppt/slides/slide2.xml",
      '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );

    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await extractText(
      buf,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "deck.pptx",
    );
    expect(result.text).not.toBeNull();
    const slides = result.text!.split("\n\n---\n\n");
    expect(slides[0]).toContain("Slide One");
    expect(slides[1]).toContain("Slide Two");
    expect(slides[2]).toContain("Slide Ten");
  });
});

// ── extractText: extension fallback ─────────────────────────────────────────

describe("extractText — extension fallback", () => {
  it("uses .txt extension when MIME is generic", async () => {
    const buf = Buffer.from("plain text content");
    const result = await extractText(
      buf,
      "application/octet-stream",
      "readme.txt",
    );
    expect(result.text).toBe("plain text content");
  });

  it("uses .docx extension when MIME is generic", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document><w:body><w:p><w:r><w:t>Fallback DOCX</w:t></w:r></w:p></w:body></w:document>',
    );

    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await extractText(
      buf,
      "application/octet-stream",
      "paper.docx",
    );
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("Fallback DOCX");
  });
});
