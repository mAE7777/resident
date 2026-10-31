// E-8 gate ② · NOTHING REACHES HER HANDS AROUND THE BIRTH GATE.
//
// `connect_mcp` (removed 2026-08-20) was registered at the daemon's top level, outside
// `holds.has()`, so it sat in all 12/12 of her real turns' tool lists without ever being
// opened: a tool she was never given, held anyway, because one call site skipped the gate.
// This gate makes the bypass class structural: every `toolRegistry.register(` in src must
// live in the one registration site (bootstrap) and be guarded by the birth toolkit.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Registration call sites that are NOT visibly downstream of a `holds` guard.
 * A site passes when the enclosing line starts with `if (holds.has(` or when the nearest
 * preceding guard within its loop body is the withheld-continue (`!holds.has(name)`).
 */
export function unguardedRegistrations(source: string): number[] {
  const lines = source.split("\n");
  const bad: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.includes("toolRegistry.register(")) continue;
    const line = lines[i]!.trim();
    if (line.startsWith("if (holds.has(")) continue;
    // Inside the factory loop: accept when the withheld-continue guard appears a few lines up.
    const above = lines.slice(Math.max(0, i - 6), i).join("\n");
    if (above.includes("!holds.has(name)")) continue;
    bad.push(i + 1);
  }
  return bad;
}

describe("nothing is registered around the birth gate", () => {
  const files = walk(join(ROOT, "src")).map((p) => relative(ROOT, p));

  it("the only registration site is the bootstrap", () => {
    const sites = files.filter((rel) =>
      readFileSync(join(ROOT, rel), "utf8").includes("toolRegistry.register("));
    expect(sites, "a second registration site is how connect_mcp got in").toEqual(
      ["src/telegram/bootstrap.ts"],
    );
  });

  it("every registration in the bootstrap is behind holds", () => {
    const src = readFileSync(join(ROOT, "src/telegram/bootstrap.ts"), "utf8");
    const total = src.split("toolRegistry.register(").length - 1;
    expect(total, "the registration count moved — re-audit each site against the birth gate")
      .toBe(4);
    expect(unguardedRegistrations(src)).toEqual([]);
  });

  it("PLANTED: the detector flags a top-level registration", () => {
    const planted = [
      'import { createFooTool } from "./foo.js";',
      "toolRegistry.register(createFooTool());",
    ].join("\n");
    expect(unguardedRegistrations(planted)).toEqual([2]);
    const guarded = 'if (holds.has("foo")) toolRegistry.register(createFooTool());';
    expect(unguardedRegistrations(guarded)).toEqual([]);
  });
});
