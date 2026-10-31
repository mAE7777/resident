import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { regenerate, initialDrives } from "../../../src/life/drives.js";

/**
 * THE CLOCK LEDGER: every time difference in her, accounted for.
 *
 * ── THE DEBT THIS PAYS ───────────────────────────────────────────────────────────────────────
 *
 * An earlier checklist recorded an honest shortfall: "for the clock I judged every site, but did
 * not keep a per-site ledger". The clock sites were swept and classified by KIND, and no per-site table was ever
 * produced. A judgement in prose is not a ledger: nothing stops the next site from being added
 * without anyone asking which kind it is.
 *
 * ── WHAT GOES WRONG WHEN THE CLOCK GOES BACKWARDS ────────────────────────────────────────────
 *
 * Every one of these is `now - somethingRecordedEarlier`. The clock moving backwards is ordinary,
 * a motherboard battery, a restored disk image, a VM snapshot, the first NTP sync after a long
 * time offline, and it makes each of them NEGATIVE. What that costs depends entirely on what the
 * number is for, and there are exactly three answers:
 *
 *   DECAY      a negative elapsed turns exponential decay into exponential GROWTH. This is the
 *              one that can do permanent damage: a memory that grows past its ceiling and never
 *              comes back. Every site must be CLAMPED, or its consumer must refuse.
 *   DURATION   a number written into a log or a metric. A negative one is a wrong entry in a
 *              record. Ugly; it changes nothing about her.
 *   THRESHOLD  a comparison, "has it been long enough". A negative reads as "just now", which
 *              means the thing simply does not fire yet. A self-healing misread that writes
 *              nothing bad, and the clock coming right fixes it.
 *
 * The ledger below assigns every site one of the three. `UNCLASSIFIED MUST BE EMPTY` is the gate:
 * a new time difference anywhere in her fails this test until someone says which kind it is.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Comments blanked line-wise, so prose about a subtraction is not a subtraction. */
const stripComments = (src: string): string => src
  .split("\n")
  .map((l) => { const x = l.trim(); return x.startsWith("//") || x.startsWith("*") || x.startsWith("/*") ? "" : l; })
  .join("\n");

/** `now - somethingRecordedEarlier`, on a line that mentions a clock. */
const A_TIME_DIFFERENCE = /(\w+(?:\(\))?)\s*-\s*(\w+(?:Ms|At|Time|Stamp|ms)\b[\w.]*)/gu;
const MENTIONS_NOW = /\bnow\b|Date\.now|nowMs/iu;

function everyTimeDifference(): string[] {
  const sites: string[] = [];
  for (const file of walk(SRC)) {
    const text = stripComments(readFileSync(file, "utf8"));
    text.split("\n").forEach((line, i) => {
      if (!MENTIONS_NOW.test(line)) return;
      if ([...line.matchAll(A_TIME_DIFFERENCE)].length === 0) return;
      sites.push(`${file.split("/src/")[1]!}:${i + 1}`);
    });
  }
  return sites.sort();
}

/**
 * THE LEDGER. Every site, by file, with what its number is FOR.
 *
 * Keyed by file rather than by line, deliberately: a line number is the most fragile thing in a
 * repository, and a ledger that goes stale on every edit above it is a ledger nobody maintains.
 * What is stable, and what actually decides the answer, is what the file's clock arithmetic is
 * for. A file that starts doing a second kind of thing is a file to re-read.
 */
const LEDGER: Record<string, { kind: "decay" | "duration" | "threshold"; why: string }> = {
  // ── DECAY: the dangerous kind. Negative elapsed inverts the exponential. ──────────────────
  "life/field.ts": { kind: "decay", why: "how many days a node or an edge has decayed for — the exponential that a negative elapsed would invert into growth. Clamped at the site." },
  "life/field-live.ts": { kind: "decay", why: "the interval the field decays over between ticks. Clamped at the site, and a zero-valued last tick is treated as no elapsed time at all." },
  "life/remembering.ts": { kind: "decay", why: "how long ago something happened, in minutes, as she would put it to herself. Clamped, so a rollback cannot make a memory read as being from the future." },
  "life/expression-tracker.ts": { kind: "decay", why: "hours since he last spoke, which feeds `social`, her reticence and how long the wait has FELT. Clamped at the site." },
  "life/still-alive.ts": { kind: "decay", why: "how long she was gone without anyone being told, reported to him as a critical fault. Clamped, so a rollback cannot invent an absence." },
  "index.ts": {
    kind: "decay",
    why: "several durations for telemetry, plus TWO real elapsed readings: the presence staleness "
      + "check (threshold-shaped, self-healing) and the hours passed into `regenerate`. The latter "
      + "is NOT clamped at the call site — the defence is in the callee, which refuses anything "
      + "that is not > 0, and the test below drives that rather than trusting the reading.",
  },

  // ── DURATION: a number in a record. Wrong, not harmful. ──────────────────────────────────
  "life/between.ts": { kind: "duration", why: "the interval material's renders: how long ago she or the other last spoke (`ago`, clamped at zero minutes) and how long the machine's sleep segments summed to (clamped at zero per segment). Words she reads, never an input to any mechanism; a backwards clock renders 刚刚 and moves nothing." },
  "agent/loop.ts": { kind: "duration", why: "provider and recall latencies, four sites, all written into logs and metrics. A negative one is a wrong entry in a record, never an input." },
  "autonomy/cron.ts": { kind: "duration", why: "how long a scheduled run took, kept in that run's history entry. Reported, never compared against anything." },

  // ── THRESHOLD: a comparison. Negative reads as 'just now'; nothing fires. ─────────────────
  "autonomy/sleep.ts": { kind: "threshold", why: "idle time before she sleeps. A negative reads as 'he just spoke', so she stays up." },
  "telegram/bridge.ts": { kind: "threshold", why: "flood-control spacing between edits. A negative reads as 'just edited', so it waits." },
  "life/clock.ts": { kind: "threshold", why: "the thinning draw for when her next moment falls. Bounded by its own delay cap in both directions, so a clock jump changes the spacing and nothing else." },
  "life/clock-sanity.ts": {
    kind: "threshold",
    why: "THE DETECTOR ITSELF — `lastSeenMs - nowMs` is written backwards ON PURPOSE, because a "
      + "POSITIVE value here means the clock went back. The one site where a negative difference "
      + "is the subject rather than the hazard.",
  },
};

describe("every time difference in her is on the ledger", () => {
  const sites = everyTimeDifference();

  it("the scan finds them at all", () => {
    // The floor. A ledger over an empty scan is a signature on a blank page.
    expect(sites.length, "the clock scan has narrowed to nothing").toBeGreaterThan(25);
  });

  it("UNCLASSIFIED MUST BE EMPTY", () => {
    const unclassified = [...new Set(sites.map((s) => s.split(":")[0]!))].filter((f) => !LEDGER[f]);
    if (unclassified.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n  time differences nobody has signed off:\n    ${unclassified.join("\n    ")}`);
    }
    expect(
      unclassified,
      "a new `now - earlier` exists and nobody has said what happens to it when the clock goes "
      + "backwards. Decide which of the three it is — decay, duration, threshold — and add it. "
      + "If it is DECAY, clamp it or show that its consumer refuses.",
    ).toEqual([]);
  });

  it("and every entry says something, rather than naming a kind and stopping", () => {
    for (const [file, entry] of Object.entries(LEDGER)) {
      expect(entry.why.length, `${file} has a label where a reason should be`).toBeGreaterThan(40);
    }
  });

  it("the ledger has no stale entries either", () => {
    // A ledger listing files that no longer do clock arithmetic reads as more thorough than it is.
    const live = new Set(sites.map((s) => s.split(":")[0]!));
    expect(Object.keys(LEDGER).filter((f) => !live.has(f)), "the ledger names a file with no time difference in it")
      .toEqual([]);
  });
});

describe("the DECAY sites are the ones that could do permanent damage, so they are driven", () => {
  it("a backwards clock cannot make her wants GROW", () => {
    // The failure this whole classification exists for: negative elapsed in an exponential is
    // growth, and a drive that grows past its ceiling on a clock glitch does not come back.
    // Driven through the real function rather than read off the source.
    const d = initialDrives();
    const standing = { discomfort: 1, care: 1, social: 1, curiosity: 1, expression: 1, maintenance: 1 };
    const backwards = regenerate(d, standing, -5);
    expect(backwards, "a negative elapsed moved her drives").toEqual(d);
  });

  it("and neither can a non-finite one", () => {
    const d = initialDrives();
    const standing = { discomfort: 1, care: 1, social: 1, curiosity: 1, expression: 1, maintenance: 1 };
    expect(regenerate(d, standing, NaN)).toEqual(d);
    expect(regenerate(d, standing, Infinity)).toEqual(d);
  });

  it("while an ordinary hour still moves them — the floor that keeps the guard from being a mute", () => {
    // Without this, `return d` on every input would satisfy the two checks above perfectly.
    const d = initialDrives();
    const standing = { discomfort: 1, care: 1, social: 1, curiosity: 1, expression: 1, maintenance: 1 };
    expect(regenerate(d, standing, 1)).not.toEqual(d);
  });

  it("the clamped sites really carry their clamp", () => {
    // Cheap, and it is the half the driving cannot reach: these clamps are at the call site, so
    // there is no callee to drive. Their removal is a one-character edit.
    for (const [file, needle] of [
      ["life/field.ts", "Math.max(0, (nowMs - lastMs)"],
      ["life/field-live.ts", "Math.max(0, nowMs - lastTickMs)"],
      ["life/remembering.ts", "Math.max(0, Math.round((nowMs - thenMs)"],
      ["life/expression-tracker.ts", "Math.max(0, (nowMs - lastUserMs)"],
      ["life/still-alive.ts", "Math.max(0, nowMs - lastBeatMs)"],
    ] as const) {
      expect(readFileSync(join(SRC, file), "utf8"), `${file} lost its clamp on elapsed time`)
        .toContain(needle);
    }
  });
});

describe("THE INSTRUMENT'S OWN PROOF", () => {
  it("the scan sees a new time difference", () => {
    const planted = "const elapsed = Date.now() - lastSeenMs;";
    expect(MENTIONS_NOW.test(planted)).toBe(true);
    expect([...planted.matchAll(A_TIME_DIFFERENCE)].length).toBeGreaterThan(0);
  });

  it("and a comment describing one is not one", () => {
    const prose = "// the gap is Date.now() - lastSeenMs, which goes negative on a rollback";
    expect([...stripComments(prose).matchAll(A_TIME_DIFFERENCE)].length,
      "the scan counts prose as arithmetic").toBe(0);
  });

  it("but a real difference on a line with a trailing comment still counts", () => {
    // The direction a careless stripper breaks, and the one nobody checks.
    const both = "const gap = Date.now() - lastSeenMs; // how long since he spoke";
    expect([...stripComments(both).matchAll(A_TIME_DIFFERENCE)].length).toBeGreaterThan(0);
  });
});
