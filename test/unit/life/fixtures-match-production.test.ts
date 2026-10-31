import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE FIXTURE-SHAPE GATE, generalised.
 *
 * ── WHAT THE SPECIFIC VERSION CAUGHT, AND WHY IT NEEDED GENERALISING ─────────────────────────
 *
 * The diary cell planted `{ts, type, note}` into her ops log, a shape nobody writes and nobody
 * reads. Every reader switches on `e.event`, so the planted day digested to nothing, the entry
 * came back empty, and the run recorded `diary 0/1`. Not a finding about her: a fixture that
 * could not have worked, discovered by spending a live boot and a model call on it.
 * `diary-cell-fixture.test.ts` closes that one case by checking the three conditions the writer
 * actually imposes.
 *
 * The general class is wider: A FIXTURE THAT BYPASSES THE TYPE SYSTEM CAN DRIFT FROM PRODUCTION
 * SILENTLY. TypeScript already catches a typed fixture that goes stale, it caught two of mine in
 * the hour this file was written, when `Appraised` gained a field and `Unlike` turned out to have
 * a different shape than I had assumed. What it cannot catch is a fixture wearing `as never`,
 * `as any` or `as unknown as`: those switch the check off, and then the object is whatever the
 * author believed at the time, forever.
 *
 * ── AND THE SAME HOLE EXISTS IN PRODUCTION, WHICH IS WORSE ───────────────────────────────────
 *
 * Found while writing this: the daemon's own regeneration beat carried `as never` on the day it
 * hands `innerState.regenerate`. The reason was ONE EXCESS FIELD, `selfDirected`, which nothing
 * reads (the consumer reads `day.idle`, set to the same value on the line above). So one unread
 * field had switched off type checking for that whole object, INCLUDING `roomPull`, which had
 * been added to it the same afternoon: a typo in that key would have compiled, run, and silently
 * meant the room never reached her at all.
 *
 * Removing the unread field removed the cast, and the object is type-checked again.
 *
 * ── THE RULE: A CAST MAY EXIST, BUT IT MUST SAY WHY ──────────────────────────────────────────
 *
 * Some casts are honest. Lines parsed off disk genuinely are not the `OpsEvent` union, an older
 * build's file, or half a line from a crash, has whatever shape it has, and asserting the union
 * would be claiming something about the file nobody checked. That is a real reason and it belongs
 * in the source next to the cast.
 *
 * What is not allowed is a cast with nothing said. Those are indistinguishable from the
 * `selfDirected` case, and the only way to tell them apart is for someone to have written it down.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Anything that switches the type checker off for a value. */
const ERASES_THE_TYPE = /\bas never\b|\bas unknown as\b|\bas any\b/u;

/**
 * Prose and strings removed before looking for casts.
 *
 * FOURTH TIME IN ONE DAY that a scanner in this repo read something ABOUT its pattern as an
 * instance of it: a comment quoting broken code, a tool description containing "fetch", a
 * detector's own regex, and now, twice at once, this file's own worked examples plus the
 * comment in `index.ts` that EXPLAINS why a cast was removed. The comment says `as never` and
 * the scanner counted it as a cast, so the guard reported the defect it had just fixed.
 *
 * The general form, now stated once and for all: ANY SCANNER THAT READS SOURCE AS TEXT WILL
 * EVENTUALLY READ A DESCRIPTION OF WHAT IT HUNTS AS A SIGHTING OF IT.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gu, "``");
}

/** Casts with no comment on the line or in the six lines above it. */
function bareCasts(root: string): string[] {
  const found: string[] = [];
  for (const file of walk(join(process.cwd(), root))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // The cast has to be in CODE; the reason may be anywhere in the six lines above or on the
      // line itself, which is why the two are tested against different texts.
      if (!ERASES_THE_TYPE.test(codeOnly(line))) return;
      const above = lines.slice(Math.max(0, i - 6), i).join("\n");
      const explained = line.includes("//") || above.includes("//") || above.includes("*");
      if (!explained) found.push(`${file.split(`/${root}/`)[1]!}:${i + 1}`);
    });
  }
  return found.sort();
}

/**
 * MEASURED 2026-08-15, immediately after this gate removed one and gave two others their reasons.
 * MAY FALL, NEVER RISE.
 *
 * The daemon's tree is held tighter than the test tree on purpose: a cast in `src/` runs in her
 * life, and a cast in a fixture at worst wastes a test. The test figure is large and mostly
 * mocks, a fake provider, a fake database, which are exactly the places a cast is the point.
 */
const SRC_CEILING = 16;
const TEST_CEILING = 78; // 108 → 84 over an earlier cleanup as cast-heavy machine suites were deleted

describe("a cast switches the checker off, so it has to say why", () => {
  it("the daemon's bare casts may fall and never rise", () => {
    const bare = bareCasts("src");
    if (bare.length > SRC_CEILING) {
      // eslint-disable-next-line no-console
      console.log(`\n  casts with nothing said:\n    ${bare.join("\n    ")}`);
    }
    expect(
      bare.length,
      "a new type-erasing cast in her daemon carries no reason. Either it is doing real work — say "
      + "what, next to it — or it is masking a shape that is simply wrong, which is what "
      + "`selfDirected` turned out to be.",
    ).toBeLessThanOrEqual(SRC_CEILING);
  });

  it("and the fixtures' may too", () => {
    expect(bareCasts("test").length).toBeLessThanOrEqual(TEST_CEILING);
  });

  it("neither ceiling is carrying slack", () => {
    // A ratchet set well above the real number silently absorbs the next few regressions.
    expect(bareCasts("src").length, "the src ceiling is stale — lower it").toBeGreaterThan(SRC_CEILING - 3);
    expect(bareCasts("test").length, "the test ceiling is stale — lower it").toBeGreaterThan(TEST_CEILING - 6);
  });
});

describe("the specific hole this found: the regeneration beat is type-checked again", () => {
  const INDEX = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("the day handed to `regenerate` carries no cast", () => {
    // The object that `roomPull` goes into. With `as never` on it, a typo in any key, including
    // one added later, by someone who could not know the check was off, compiles and runs.
    const at = INDEX.indexOf("innerState.regenerate(");
    expect(at, "the regeneration call moved; this guard's anchor is stale").toBeGreaterThan(-1);
    const call = codeOnly(INDEX.slice(at, INDEX.indexOf("lastRegenMs = nowMs;", at)));
    expect(call, "the regeneration day is cast away from its type again").not.toMatch(ERASES_THE_TYPE);
  });

  it("and the unread field that forced it is gone", () => {
    // `selfDirected` was passed and never read. Its removal is what let the cast go, so its
    // return would bring the cast back with it.
    //
    // ANCHOR ASSERTED BEFORE USE. `indexOf` returning -1 does not throw: `slice(-1, …)` quietly
    // hands back a different region and the negative assertions below then hold over a fragment
    // that was never the thing. Third time today.
    const at = INDEX.indexOf("innerState.regenerate(");
    expect(at, "the regeneration call moved; this guard's anchor is stale").toBeGreaterThan(-1);
    const call = INDEX.slice(at, INDEX.indexOf("lastRegenMs = nowMs;", at));
    expect(call).not.toMatch(/^\s*selfDirected:/mu);
    expect(call, "the room no longer reaches the drive input at all").toMatch(/roomPull:/u);
  });

  it("her one and only birth record is complete", () => {
    // Same family, found the same way: `agent_start` is written ONCE, at her first breath, and it
    // carried `as never` with three of its seven fields. The two it dropped are the VERSION and
    // the MODEL she was born under, the question `code-version.ts` exists to answer, and one
    // that cannot be recovered later because this tree is not committed.
    const at = INDEX.indexOf('event: "agent_start"');
    expect(at, "she no longer records her own first breath").toBeGreaterThan(-1);
    const write = INDEX.slice(at - 200, at + 500);
    for (const field of ["version:", "model:", "workspacePath,", "sandbox:"]) {
      expect(write, `her birth record is missing ${field}`).toContain(field);
    }
    expect(codeOnly(write)).not.toMatch(ERASES_THE_TYPE);
  });
});

describe("THE INSTRUMENT'S OWN PROOF", () => {
  it("it sees each of the three erasing forms", () => {
    for (const line of [
      "const x = thing as never;",
      "const y = thing as unknown as Shape;",
      "const z = thing as any;",
    ]) {
      expect(ERASES_THE_TYPE.test(line), `blind to: ${line}`).toBe(true);
    }
  });

  it("and does not fire on an ordinary narrowing cast", () => {
    // `as const`, `as string`, and a declared-type assertion are not erasures, they keep the
    // checker engaged. A gate that flagged those would be noise, and a noisy gate gets widened
    // until it means nothing, which this repo has watched happen once already.
    for (const line of [
      "const a = [1, 2] as const;",
      "const b = raw as string;",
      "const c = value as DaySummary;",
    ]) {
      expect(ERASES_THE_TYPE.test(line), `cries wolf on: ${line}`).toBe(false);
    }
  });
});
