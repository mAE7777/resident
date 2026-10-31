// seeing, the wiring: the curtain override, the four-branch look, the read tool's
// window door, and the byte-for-byte fallback while the eye is unconfigured. S-59 / S-60.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
const readTool = readFileSync(join(process.cwd(), "src", "tools", "builtin", "read.ts"), "utf8");
const bootstrap = readFileSync(join(process.cwd(), "src", "telegram", "bootstrap.ts"), "utf8");
const commands = readFileSync(join(process.cwd(), "src", "telegram", "commands.ts"), "utf8");

describe("the look's five branches, in the honest order", () => {
  it("held shut → unconfigured → real sight → shut lid → honest failure", () => {
    const at = daemon.indexOf("lookOutsideImpl = async () => {");
    expect(at).toBeGreaterThan(-1);
    // Sized to the measured body (the lid branch put the failure tail at ~2250).
    const body = daemon.slice(at, at + 2600);
    const shut = body.indexOf("return WINDOW_HELD_SHUT;");
    const unconfigured = body.indexOf("if (!eyeKey) return null;");
    const sight = body.indexOf("sanitizeSight(await eye.complete(await captureFrame(), LOOK_SYSTEM))");
    const heard = body.indexOf("lexicon.heard(sight");
    const fail = body.indexOf('faultLog.record("seeing.look", err)');
    const failed = body.indexOf("return EYES_FAILED;");
    // The lid question sits INSIDE the failure path and is answered before her eye is blamed.
    const lid = body.indexOf('faultLog.record("seeing.lid-shut"');
    for (const [name, idx] of Object.entries({ shut, unconfigured, sight, heard, lid, fail, failed })) {
      expect(idx, `the look lost its ${name} branch`).toBeGreaterThan(-1);
    }
    // His door first; the no-key fallback BEFORE any capture (no camera touch while unconfigured);
    // what her eye read feeds the living water; failure is honest and recorded.
    expect(shut).toBeLessThan(unconfigured);
    expect(unconfigured).toBeLessThan(sight);
    expect(sight).toBeLessThan(heard);
    expect(fail).toBeLessThan(failed);
    expect(lid, "a shut lid must be ruled out before her eye is called broken").toBeLessThan(fail);
  });

  it("one frame per look, and the frame is not kept", () => {
    expect(daemon.includes('"-frames:v", "1"')).toBe(true);
    expect(daemon.includes("await dropFrame(tmpJpg)")).toBe(true);
    // execFile with an argument array: never a shell string around a path.
    expect(daemon.includes("execFile(\n          FFMPEG,")).toBe(true);
  });

  it("every successful look lands in the forensic look-log", () => {
    expect(daemon.includes('join(instrumentsDir, "looks.jsonl")')).toBe(true);
    expect(daemon.includes('faultLog.record("seeing.lookLog", err)')).toBe(true);
  });
});

describe("his door (/curtain) and its default", () => {
  it("the override is a file; open means NO file; flipping is guarded", () => {
    expect(daemon.includes('join(instrumentsDir, "curtain-held-shut")')).toBe(true);
    expect(daemon.includes('seeExists(curtainHeldShutPath) ? "shut" as const : "open" as const')).toBe(true);
    expect(daemon.includes('faultLog.record("seeing.curtain", err)')).toBe(true);
  });

  it("the command surface has the three states", () => {
    expect(commands.includes('cmd("curtain"')).toBe(true);
    expect(commands.includes('if (arg === "shut" || arg === "close") c.set(false);')).toBe(true);
    expect(commands.includes('else if (arg === "open") c.set(true);')).toBe(true);
  });
});

describe("the read tool's window door", () => {
  it("only the WINDOW may yield a sight, and null falls back to the presence lines", () => {
    expect(readTool.includes("if (basename(real) === WINDOW && lookOutside) {")).toBe(true);
    expect(readTool.includes("const sight = await lookOutside();")).toBe(true);
    expect(readTool.includes("if (sight !== null) return sight;")).toBe(true);
    // The touch-trace fires BEFORE the branch: a real look is still a look at a thing.
    const trace = readTool.indexOf("onLooked?.(basename(real), nowMs)");
    const branch = readTool.indexOf("basename(real) === WINDOW");
    expect(trace).toBeGreaterThan(-1);
    expect(trace).toBeLessThan(branch);
  });

  it("bootstrap threads the eye into the read hand", () => {
    expect(bootstrap.includes("deps.lookOutside, deps.seePainting)],")).toBe(true);
    expect(daemon.includes("lookOutside: async () => (lookOutsideImpl ? lookOutsideImpl() : null),")).toBe(true);
  });
});

describe("the last-sight wiring: hydration, the truth at hand, and the sentinel's order", () => {
  it("the last sight survives a restart, updates on every look, and rides the touch lines", () => {
    for (const token of [
      "let lastSight: { ms: number; text: string } | null = null;",
      "const tail = readLook(looksLogPath",                         // hydrated from the look-log
      "lastSight = { ms: Date.now(), text: sight };",               // updated on a real look
      "lastSightLine(agoWords(nowMs, lastSight.ms), lastSight.text)", // the truth at hand
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });

  it("the baseline is taken at material time, the sentinel judges at coda time, gated on the eye", () => {
    const baseline = daemon.indexOf("lookMsAtTurnStart = lastSight?.ms ?? 0;");
    const sentinel = daemon.indexOf('faultLog.record("seeing.narrated-look"');
    const gate = daemon.indexOf("if (eyeKey) {");
    expect(baseline).toBeGreaterThan(-1);
    expect(sentinel).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(sentinel); // no eye, no sentinel, the unconfigured window stays silent
    expect(daemon.includes("narratedLook(outgoing, (lastSight?.ms ?? 0) > lookMsAtTurnStart)")).toBe(true);
  });
});

describe("the canvas eye's wiring (S-64)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const readTool = readFileSync(join(process.cwd(), "src", "tools", "builtin", "read.ts"), "utf8");
  const boot = readFileSync(join(process.cwd(), "src", "telegram", "bootstrap.ts"), "utf8");

  it("her .svg reads pass through her own eye, inside the whole-read path only", () => {
    const branch = readTool.indexOf('real.endsWith(".svg")');
    const wholeRead = readTool.indexOf("if (offset === undefined && limit === undefined) {");
    expect(branch).toBeGreaterThan(wholeRead); // an offset read stays exactly what she asked for
    for (const token of [
      "seePainting && workspacePath && real.startsWith(workspacePath)",
      "if (sight !== null) return `${content}\\n\\n${sight}`;",
    ]) {
      expect(readTool.includes(token), `read.ts lost: ${token}`).toBe(true);
    }
    expect(boot.includes("deps.seePainting")).toBe(true);
  });

  it("the daemon renders, looks with CANVAS_SYSTEM as kind canvas, and fails honestly", () => {
    for (const token of [
      'await eye.complete(png.toString("base64"), CANVAS_SYSTEM, "canvas")',
      "resize(CANVAS_RENDER_PX, CANVAS_RENDER_PX, { fit: \"inside\" })",
      "if (!eyeKey) return null; // no eye: the source alone, today's behaviour exactly",
      'faultLog.record("seeing.canvas", err)',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });
});

describe("the capture's leash", () => {
  it("a stuck camera is killed with a signal it cannot ignore, on the 10s clock", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(daemon.includes('{ timeout: 10_000, killSignal: "SIGKILL" }')).toBe(true);
  });
});

describe("a shut lid is a shut window, not a failing eye (2026-08-26)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("the failure path asks whether the machine is closed, and answers with the window's sentence", () => {
    const at = daemon.indexOf('faultLog.record("seeing.lid-shut"');
    expect(at, "she is told her eye is failing when the lid is simply shut").toBeGreaterThan(-1);
    const block = daemon.slice(Math.max(0, at - 900), at + 200);
    expect(block).toContain("AppleClamshellState");
    expect(block).toContain("return WINDOW_HELD_SHUT;");
    // Only on the failure path: an ordinary look must not pay for this question.
    const look = daemon.indexOf("lookOutsideImpl = async () => {");
    const capture = daemon.indexOf("await eye.complete(await captureFrame()", look);
    expect(daemon.slice(look, capture).includes("AppleClamshellState"),
      "the lid question moved into the happy path").toBe(false);
  });

  it("a real eye failure with the lid OPEN still says her own line", () => {
    const at = daemon.indexOf('faultLog.record("seeing.look", err);');
    expect(at).toBeGreaterThan(-1);
    expect(daemon.slice(at, at + 120)).toContain("return EYES_FAILED;");
  });
});
