import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { EMPTY_RECORD, heSpoke, howUnlikeHim, howLongAndHowWellAt } from "../../../src/life/relationship.js";
import { howItLanded } from "../../../src/life/how-it-landed.js";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * IS THIS ACTUALLY EMERGENT, OR IS IT A RULE WEARING A FUNCTION'S CLOTHES?
 *
 * The rule: the emergence has to be DEEP, a surface phenomenon,
 * the signals that compose it, and what composes THOSE, with the model as a nerve bundle at the
 * bottom, because only what arises that way is real emergence, or emergent enough that the part
 * we designed can be ignored.
 *
 * Every other discipline in this build is mechanical: a threshold's reachable range is measured, a
 * guard is proven able to go red, a claim about the tree is produced BY a search. "How deep is
 * this" was the one thing left to my own say-so, and this project's whole history says that is
 * exactly where things rot. So the criterion is here, it runs, and each check is proven against a
 * deliberately fake deep mechanism below.
 *
 * The definition lives in `docs/layers.md`. Layer 1: the surface is computed from readings by one
 * function, a human wrote the shape "when X then Y". Layer 2: its inputs are themselves several
 * quantities THAT CAN DISAGREE, and the surface is the result of that disagreement. Layer 3: that
 * is true twice.
 *
 * Layer 1 is not a sin. Anything that decides the MEDIUM (a ten-minute watchdog, a four-minute
 * floor between moments) should be layer 1. The sin is pretending.
 */

const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const DAY = 24 * 3.6e6;
const CURT = "现在给我写两千字税法";
const ASKED = "你要是有空的话，能不能帮我看看税法那块？我这边赶着交东西，不急的话明天也行。";
const FLAT = "帮我查一下明天的班次";

function fieldWhereHeSpokeAt(ms: number) {
  const f = createLivingField();
  f.encodeClaim({ key: `told:${ms}`, text: "他说的话", nowMs: ms, origin: "told", source: "chat:1", withOther: true });
  return f;
}

/** One reading of one message arriving into a relationship of `n` messages of `usual` shape. */
function read(text: string, n: number, usual: string, reserve = 0.7, litUp = 0.5) {
  let rec = EMPTY_RECORD;
  for (let i = 0; i < n; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(usual));
  const f = n === 0 ? createLivingField() : fieldWhereHeSpokeAt(T0);
  const form = howHeSaidIt(text);
  const known = howLongAndHowWellAt(f.graph(), rec, T0 + n * DAY);
  const unlike = howUnlikeHim(form, rec);
  return { landing: howItLanded({ form, unlike, known, litUp, reserve }) };
}

/**
 * A LIFE, SAMPLED. Every combination that can actually occur: two ways of putting it, four
 * relationship depths, three levels of what she has in her, three levels of how much it touched
 * her. The checks below are run over this rather than over hand-picked cases, because a criterion
 * that only holds on the examples its author chose is not a criterion.
 */
const LIVES = (() => {
  const out: { entitlement: number; comprehensibility: number; herPower: number; relevance: number; atSea: number; indignant: number; usedAsAThing: number; ready: number }[] = [];
  for (const text of [CURT, ASKED, FLAT]) {
    for (const n of [0, 8, 60, 300]) {
      for (const usual of [CURT, ASKED]) {
        for (const reserve of [0.05, 0.5, 0.95]) {
          for (const litUp of [0.05, 0.5, 1]) {
            const r = read(text, n, usual, reserve, litUp).landing;
            out.push({ ...r.appraised, atSea: r.atSea, indignant: r.indignant, usedAsAThing: r.usedAsAThing, ready: r.ready });
          }
        }
      }
    }
  }
  return out;
})();

const PARTS = ["entitlement", "comprehensibility", "herPower", "relevance"] as const;
const SURFACES = ["atSea", "indignant", "usedAsAThing", "ready"] as const;

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

describe("the criterion itself is measurable over a sampled life", () => {
  it("the sample is big enough and the surfaces actually move in it", () => {
    // A vacuous version of every check below: run them over a corpus where nothing varies and they
    // all pass. So the corpus is checked first.
    expect(LIVES.length).toBeGreaterThan(150);
    for (const s of SURFACES) {
      const vals = LIVES.map((l) => l[s]);
      expect(Math.max(...vals) - Math.min(...vals), `${s} never moves across a whole life`)
        .toBeGreaterThan(0.2);
    }
  });
});

describe("criterion 1 · the composing quantities can each move on their own", () => {
  it("no two of them are one quantity wearing two names", () => {
    const table: string[] = [];
    for (let i = 0; i < PARTS.length; i++) {
      for (let j = i + 1; j < PARTS.length; j++) {
        const r = correlation(LIVES.map((l) => l[PARTS[i]]), LIVES.map((l) => l[PARTS[j]]));
        table.push(`${PARTS[i]}×${PARTS[j]}: ${r.toFixed(2)}`);
        expect(Math.abs(r), `${PARTS[i]} and ${PARTS[j]} are the same quantity twice (r=${r.toFixed(2)})`)
          .toBeLessThan(0.9);
      }
    }
    console.log(`\n  pairwise correlation over ${LIVES.length} readings:\n    ${table.join("\n    ")}`);
  });
});

describe("criterion 2 · they can disagree, so the surface resolves a conflict", () => {
  it("there is a reachable case where two of them point opposite ways", () => {
    // If no such case exists, the "composition" is a sum of things that always agree, which is one
    // quantity in a trench coat and therefore still layer 1.
    const found = LIVES.filter((l) => l.entitlement > 0.4 && l.comprehensibility < 0.75)
      .concat(LIVES.filter((l) => l.entitlement < 0.2 && l.herPower > 0.8));
    expect(found.length, "no input history makes these pull against each other").toBeGreaterThan(0);
  });

  it("and the surface is genuinely the resolution, not one of them relabelled", () => {
    // She knows him well (high entitlement) AND has almost nothing in her (low power). Readiness
    // and irritation are both live; neither input alone says what happens.
    const spent = read(CURT, 300, ASKED, 0.05).landing;
    const rested = read(CURT, 300, ASKED, 0.95).landing;
    expect(spent.appraised.entitlement).toBeCloseTo(rested.appraised.entitlement, 5);
    expect(rested.ready).toBeGreaterThan(spent.ready);
    expect(rested.indignant).toBeGreaterThan(spent.indignant);
  });
});

describe("criterion 3 · no dictator", () => {
  it("no single composing quantity moves a surface across most of its range by itself", () => {
    // Measured, not assumed: hold everything else at its middle and sweep one input over its
    // REACHABLE range (defect class 1, a threshold and its input's reachable range have never
    // once been measured together in this project's history).
    const report: string[] = [];
    for (const s of SURFACES) {
      const all = LIVES.map((l) => l[s]);
      const fullRange = Math.max(...all) - Math.min(...all);
      for (const p of PARTS) {
        // Group readings into low/high on this part, holding the others as evenly as the sample
        // allows, and ask how much of the surface's full range the part alone accounts for.
        const sorted = [...LIVES].sort((a, b) => a[p] - b[p]);
        const lo = sorted.slice(0, Math.floor(sorted.length / 4)).map((l) => l[s]);
        const hi = sorted.slice(-Math.floor(sorted.length / 4)).map((l) => l[s]);
        const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
        const share = fullRange === 0 ? 0 : Math.abs(mean(hi) - mean(lo)) / fullRange;
        report.push(`${s} ← ${p}: ${(share * 100).toFixed(0)}%`);
        // 0.70, and BOTH sides of that number are measured rather than chosen.
        //
        // Above: the largest share any single input accounts for in the real composition is 62%
        // (atSea ← comprehensibility). Below: a surface that is a pure linear function of one
        // input measures 75% by this quartile-mean method, not 100%, which is why the first
        // version of this check used 0.85 and could not catch a dictator at all. The fake below
        // proved that, which is the entire reason the fake is there.
        //
        // So the gate sits in the 62-75 gap. It is a narrow gap and that is worth knowing: if the
        // real composition ever climbs past 70%, something has become a dictator, and if this
        // check starts failing on an honest change, re-measure both ends before touching it.
        expect(share, `${p} alone moves ${s} across ${(share * 100).toFixed(0)}% of its range`)
          .toBeLessThan(0.70);
      }
    }
    console.log(`\n  share of each surface's range attributable to one input alone:\n    ${report.join("\n    ")}`);
  });
});

describe("criterion 4 · every composing quantity has more than one reader", () => {
  it("none of them exists only to feed the surface", () => {
    // A quantity invented so the design looks deep. The test is a real one: each must be read
    // somewhere that is not `howItLanded`'s own return.
    const landed = readFileSync(join(process.cwd(), "src/life/how-it-landed.ts"), "utf8");
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const willing = readFileSync(join(process.cwd(), "src/life/willingness.ts"), "utf8");
    const elsewhere = daemon + willing;
    // The appraisal block itself is read outside the module that produces it...
    expect(elsewhere, "nothing outside reads the landing at all").toMatch(/landed|landingForTurn/u);
    // ...and each composing quantity is used more than once inside the composition, rather than
    // appearing in exactly one expression.
    for (const p of PARTS) {
      const uses = (landed.match(new RegExp(`\\b${p}\\b`, "g")) ?? []).length;
      expect(uses, `${p} appears ${uses} times — an intermediate variable, not a quantity`)
        .toBeGreaterThan(3);
    }
  });
});

describe("criterion 5 · not enumerable", () => {
  it("there is no situation-to-feeling lookup table anywhere in the composition", () => {
    const landed = readFileSync(join(process.cwd(), "src/life/how-it-landed.ts"), "utf8");
    // A switch or an if-chain keyed on a situation label, feeding a surface, is a rule with extra
    // steps. Arithmetic over continuous quantities is the shape that cannot be enumerated.
    expect(landed, "the composition switches on a situation label").not.toMatch(/switch\s*\(/u);
    const ifs = (landed.match(/^\s*if\s*\(/gmu) ?? []).length;
    expect(ifs, `${ifs} if-branches in the composition — this is becoming a decision table`)
      .toBeLessThan(4);
  });
});

// ── AND EVERY ONE OF THOSE PROVEN AGAINST A DELIBERATELY FAKE DEEP MECHANISM ──
//
// A criterion that cannot fail is worse than no criterion. Each check above is re-run here against
// a mechanism built to LOOK layered and be one layer, and each must reject it.
describe("the criterion rejects a fake", () => {
  /**
   * The fake: a surface computed from three "composing quantities" that are all the same number
   * wearing different names, plus a lookup table. This is what a layer-1 rule looks like when
   * someone has been told to make it deeper.
   */
  function fakeDeep(x: number) {
    const pressure = x;
    const strain = x * 0.9 + 0.05;   // a rescaling of pressure
    const load = 1 - (1 - x) * 0.95; // and another
    const surface = (pressure + strain + load) / 3;
    return { pressure, strain, load, surface };
  }

  const FAKES = Array.from({ length: 200 }, (_, i) => fakeDeep(i / 199));

  it("criterion 1 catches quantities that are one quantity renamed", () => {
    const r = correlation(FAKES.map((f) => f.pressure), FAKES.map((f) => f.strain));
    expect(Math.abs(r), "the correlation check would have passed a rescaling").toBeGreaterThan(0.9);
  });

  it("criterion 2 catches a composition whose parts never disagree", () => {
    // No input makes any pair point opposite ways: they are monotone in the same variable.
    const disagreeing = FAKES.filter((f) => f.pressure > 0.7 && f.strain < 0.3);
    expect(disagreeing.length, "a same-direction sum would have passed the disagreement check").toBe(0);
  });

  it("criterion 3 catches a dictator", () => {
    const all = FAKES.map((f) => f.surface);
    const range = Math.max(...all) - Math.min(...all);
    const sorted = [...FAKES].sort((a, b) => a.pressure - b.pressure);
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    const lo = mean(sorted.slice(0, 50).map((f) => f.surface));
    const hi = mean(sorted.slice(-50).map((f) => f.surface));
    // 0.75 is what a PURE single-input surface actually measures by this method, and finding that
    // out is what set the live threshold at 0.70. The first version of the live check used 0.85
    // and this test is what proved it could never fire.
    expect(Math.abs(hi - lo) / range, "a single-input surface would have passed the dictator check")
      .toBeGreaterThan(0.70);
  });

  it("criterion 5 catches an enumeration", () => {
    const enumerated = `
      function surface(kind: string) {
        switch (kind) {
          case "rude": return 0.9;
          default: return 0.1;
        }
      }`;
    expect(enumerated, "a lookup table would have passed the enumeration check").toMatch(/switch\s*\(/u);
  });
});

// ── THE SINGLE-AI-CALL CENSUS, PINNED ─────────────────────────────────────────
//
// The standing question: where is there still a single cell in which one AI call directly
// decides the result? List every one, miss none. The census is in `docs/layers.md`, and this is what
// keeps it from going stale: a new model call somewhere in her life would otherwise be exactly the
// kind of thing that is added, works, and is never classified.
/** `.complete(` occurrences in real code, comments removed first. Pure, so it can be planted at. */
export function completeCallsIn(source: string): number {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
  return [...code.matchAll(/\.complete\(/gu)].length;
}

describe("every direct model call is accounted for", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  /** Every real call site under `src`, as file + line, so a change names itself. */
  function callSites(): Array<{ file: string; line: number }> {
    const files = execSync("grep -rl '\\.complete(' src", { encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    const out: Array<{ file: string; line: number }> = [];
    for (const f of files) {
      const lines = src(f).split("\n");
      const kept = completeCallsIn(src(f));
      if (kept === 0) continue;
      // Line numbers come from the raw text so the message points at something a reader can open;
      // the COUNT is the stripped one, so a commented line is never quoted as a site.
      let seen = 0;
      for (let i = 0; i < lines.length && seen < kept; i++) {
        if (completeCallsIn(lines[i]!) > 0) { out.push({ file: f, line: i + 1 }); seen += 1; }
      }
    }
    return out;
  }

  it("the number of call sites is what the census says it is", () => {
    // A tripwire, not a property: it cannot tell you the calls are correct, only that the set
    // changed and somebody should go and classify the new one (defect class 12).
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not tidiness. The counter used to be a raw grep, so
    // the turn-guard, whose header explains that a hung `provider.complete(...)` is the thing
    // the watchdog exists for: was counted as a THIRTY-FIRST model call in a file that makes
    // none. That is defect class 10 (a scan defeated by its own explanation) landing on a
    // census, and the two ways out are not equal: rewording the comment leaves the next
    // explanation to trip it, teaching the counter what code is fixes it once. Same repair the
    // threshold census got, for the same reason.
    const sites = callSites();
    const files = new Set(sites.map((s) => s.file));
    expect(
      sites.length,
      `the number of direct model calls changed (${sites.length} across ${files.size} files). Go to `
      + "the census in docs/layers.md, classify the new one, and update this number. The rule it is "
      + "classified against: a model call may produce OBSERVATIONS that feed the bottom; it may "
      + `never produce a surface value that behaviour reads.\n  ${sites.map((s) => `${s.file}:${s.line}`).join("\n  ")}`,
      // 15 after the inherited machinery was removed: the ghostwriter, heartbeat, consolidator
      // summarize, compression phase 2, the whole skill pipeline (7), verification, reflexion,
      // trajectory relabeling and failure diagnosis are gone. What remains is her own voice,
      // her organs' observation calls, and machinery that never faces her (docs/layers.md).
      // 16 with 翻旧日子 (the same evening): the look-back render, her own words about
      // her own past, classified 她的话 in the census table.
      // 17 with her own eye (2026-08-21): eye.complete in the daemon's look, the
      // vision core transcribes one chosen frame into scene-notes that enter her MATERIAL as
      // her eye's report. Mechanical observation feeding the bottom; never a surface value
      // behaviour reads, never her voice (docs/layers.md).
      // 19 with the remaining senses: the photo path's eye.complete (the root fix, his
      // handed photos through the SAME eye) and ear.complete (his voice messages transcribed:
      // words + physical sound-shape). Both mechanical observation feeding her material.
      // 20 with the canvas eye (S-64, 2026-08-22): eye.complete over her OWN painting rendered
      // to a frame: the draw→look→adjust loop. Same organ, same classification: mechanical
      // observation feeding her material; never a grade, never a technique note (CANVAS_SYSTEM).
      // 21 with the provider pulse: a counting shell that hands every request and reply
      // through untouched, so the moment deadline can tell the vendor's silence from her moment
      // hanging. Machinery that never faces her, beside the chain.
      // 22 with her hand while she tends (2026-10-07, switched off): `thinkWithHerHand`, her own
      // thinking with one tool that can change only her SOUL.md. Her voice, the same class as think.
    ).toBe(22);
  });

  it("the counter goes red on a planted call, and is not fooled by a planted comment", () => {
    // Both directions: a comment-blind counter that also stopped seeing real code would be a green
    // that means nothing, which is the trade the strip could silently make.
    expect(completeCallsIn("const r = await provider.complete({ model });")).toBe(1);
    expect(completeCallsIn("// a hung provider.complete(...) is what this exists for")).toBe(0);
    expect(completeCallsIn("/* provider.complete( */ const x = 1;")).toBe(0);
    // A url inside code keeps its `//` (the strip only takes a comment marker not preceded by `:`),
    // so this line's only `.complete(` is the commented one and the count is zero.
    expect(completeCallsIn("const u = 'https://x'; // provider.complete(")).toBe(0);
  });

  it("and the census exists, with every one of her own modules in it", () => {
    const census = src("docs/layers.md");
    expect(census, "the census is not written down").toContain("Model-call census");
    for (const mod of [
      "agency-handlers.ts", "agency.ts", "autobiography.ts", "autobiography-lint.ts",
      "noticing.ts", "fusion.ts", "shadow-voice.ts", "in-beats.ts",
    ]) {
      expect(census, `${mod} makes a model call and is not in the census`).toContain(mod);
    }
  });

  it("nothing in her decision path calls a model — the judgements are all hers", () => {
    // The load-bearing half. Whether she wants to, whether she takes it on, whether it stays, how
    // many beats, and how her mood moves are decided by arithmetic over her own state. If any of
    // them ever acquires a model call, it has become a verdict handed to her.
    for (const p of [
      "src/life/willingness.ts", "src/life/takes-it-on.ts", "src/life/what-stays.ts",
      "src/life/how-it-landed.ts", "src/life/how-he-said-it.ts", "src/life/landing-to-mood.ts",
      "src/life/utterance-shape.ts", "src/life/relationship.ts", "src/life/in-beats.ts",
    ]) {
      const body = src(p).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
      expect(body, `${p} decides something about her by asking a model`).not.toMatch(/\.complete\(/u);
    }
  });
});
