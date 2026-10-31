import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE GUARD THAT WOULD HAVE CAUGHT THE TWO LARGEST DEFECTS THIS BUILD HAS SHIPPED.
 *
 * Both were in the same handler, both were invisible, and both were mirror images of one another:
 *
 *   • the reading of what he had just said was computed 137 lines TOO LATE, after the reply had
 *     been generated and sent. So the gate that decides whether she wants to do the thing read the
 *     PREVIOUS message, and on her very first turn it read nothing at all.
 *   • the shape her state chose for the reply was destroyed 56 lines TOO EARLY, before the turn
 *     ran. So `inBeats`, the whole mechanism by which a turn becomes several beats with her own
 *     words re-entering her field between them, never ran once on a text turn.
 *
 * WHY EVERY EXISTING GUARD STAYED GREEN, which is the reusable part. The wiring assertions in this
 * project assert that A WIRE EXISTS: that `index.ts` contains `inBeats(shape, {`, that it calls
 * `field.attend`, that a fault is recorded. Every one of those was TRUE. What was false was
 *
 *   (a) the ORDER, the producer ran after its consumer, and
 *   (b) the LIFETIME, a per-turn value was deleted before its consumer read it.
 *
 * An existence check cannot see either. This file checks both, positionally, against the source.
 *
 * (Defect class 10 applies and is handled: comments are blanked before every scan, because this
 * file's own explanation quotes the very identifiers it searches for, and three guards in this
 * project have reported the reverse of the truth exactly that way.)
 */

const RAW = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

/** The source with every comment blanked, keeping line structure so positions stay comparable. */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => m.replace(/[^\n]/gu, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gu, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

const SRC = blankComments(RAW);

/** Every position of a pattern in the comment-free source. */
function positionsOf(pattern: string | RegExp): number[] {
  const re = typeof pattern === "string"
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")
    : new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...SRC.matchAll(re)].map((m) => m.index ?? -1).filter((i) => i >= 0);
}

const first = (p: string | RegExp): number => {
  const all = positionsOf(p);
  return all.length === 0 ? -1 : all[0]!;
};


// ── 1. THE CAUSAL ORDER OF A TURN ─────────────────────────────────────────────
//
// Each row carries its CAUSAL REASON, not its line number, because the next person to read this
// can see the order in the code and cannot see why it has to be that way. A new step in the turn
// goes in this table with its reason; if a step has no reason, it has no place in the order.
const ORDER: Array<{ before: string; after: string; because: string }> = [
  {
    before: "readHowItLanded(chatId, text)",
    after: "wantsToNow(text",
    because:
      "her answer is a response to what he DID. Reading his message after deciding how she feels "
      + "about it is answering before hearing, and it is what the daemon actually did.",
  },
  {
    before: "readHowItLanded(chatId, text)",
    after: "howSheIsNow(text",
    because:
      "the shape of her reply must reflect the message she is replying to, not the one before it.",
  },
  {
    before: "const spec = baseSpec(",
    after: "runAgentAndStream(channel, chatId, spec)",
    because: "the turn cannot run before its own envelope is built.",
  },
  {
    before: "runAgentAndStream(channel, chatId, spec)",
    after: "innerState.feel(appraiseExchange(",
    because:
      "how the exchange felt is read off how it actually WENT (how it ended, how many steps it "
      + "took). Appraising it first would be appraising a turn that had not happened.",
  },
  {
    before: "innerState.feel(appraiseExchange(",
    after: "key: `talk:${Date.now()}`",
    because:
      "a moment carries the feeling she had AT THE TIME. Encoding it before her mood moves stamps "
      + "it with the previous turn's feeling, which is a false memory rather than a stale number.",
  },
  {
    before: "const laterBeats = await sayWhatCameUp(",
    after: "result.content = `${result.content}${laterBeats.later}`",
    because:
      "there is nothing to fold back into the turn until she has finished saying it. This row "
      + "reads as trivially true and is here because its OPPOSITE was shipped: the beats after "
      + "the first went to the channel and nowhere else, so he saw them and the rest of the build "
      + "did not — they were absent from the history, her word bank, her exemplar pool, the "
      + "assertions she can later be wrong about, the moment the turn becomes, and the landing "
      + "measurement. Her second sentence was said and then did not exist.",
  },
  {
    before: "result.content = `${result.content}${laterBeats.later}`",
    after: "channel.done?.()",
    because:
      "the turn is not over while she may still be speaking, and the whole utterance has to be "
      + "assembled before anything downstream is told the turn produced it. Rejoining after the "
      + "turn closes would put her later beats into the NEXT turn's content.",
  },
];

describe("the turn happens in an order that means something", () => {
  for (const row of ORDER) {
    it(`${row.before}  BEFORE  ${row.after}`, () => {
      const a = first(row.before);
      const b = first(row.after);
      expect(a, `\`${row.before}\` is not in src/index.ts at all`).toBeGreaterThan(-1);
      expect(b, `\`${row.after}\` is not in src/index.ts at all`).toBeGreaterThan(-1);
      expect(
        a,
        `ORDER BROKEN — \`${row.before}\` must run before \`${row.after}\`.\nWHY: ${row.because}`,
      ).toBeLessThan(b);
    });
  }

  it("inside the reading itself: compose it, THEN let it move her", () => {
    // Within one function body, so source order is execution order. The reading is composed on the
    // reserve she had BEFORE it moved her; feeding it the post-move value would be the turn eating
    // its own tail: her mood would be an input to the thing that causes it.
    const fn = SRC.slice(SRC.indexOf("readHowItLanded = ("), SRC.indexOf("wantsToNow = ("));
    const composed = fn.indexOf("howItLanded({");
    const moved = fn.indexOf("innerState.feel(moodAfterHeSpoke(");
    const heard = fn.indexOf("heSpokeToHer(relationship");
    expect(composed, "the reading is not composed here any more").toBeGreaterThan(-1);
    expect(moved, "his words do not move her mood").toBeGreaterThan(-1);
    expect(heard, "the relationship does not grow by this message").toBeGreaterThan(-1);
    expect(heard, "the message is weighed before it is counted as having been said").toBeLessThan(composed);
    expect(moved, "her mood moves before the reading that causes it exists").toBeGreaterThan(composed);
  });

  it("and the table is written down where the code is, not only here", () => {
    // A causal order that lives only in a test is one refactor away from being lost, because the
    // person moving the lines is reading the handler, not this file.
    expect(RAW).toContain("THE CAUSAL ORDER OF A TURN");
    expect(RAW).toContain("wired-in-order.test.ts");
  });
});

// ── 2. THE LIFETIME OF EVERY PER-TURN SIDE CHANNEL ────────────────────────────
//
// Each of these maps carries one value from where it is computed to where it is used, WITHIN one
// turn. Two things must hold and only one of them was ever checked: it must be deleted at all
// (nothing accumulates, nothing leaks into the next turn), and the delete must come AFTER every
// read (or the consumer gets `undefined` and does nothing, silently, forever).
/**
 * DERIVED FROM THE SOURCE, never written down here.
 *
 * This was a hand-written list of five names. `index.ts` had six: `takenAsWork` was added
 * later and nobody added it here, so the guard whose entire job is preventing lifetime bugs was
 * blind to the newest per-turn value in the file. That is defect class 12, a membership
 * snapshot that enforces its own falsehood, aimed at the guard instead of at the code, which is
 * the worst place for it, because a guard nobody doubts is a guard nobody checks.
 *
 * The daemon now marks the region (`PER-TURN SIDE CHANNELS · BEGIN` … `END`) and this reads it.
 * A new channel is covered on the day it is declared, whether or not anyone remembered this file.
 */
function perTurnMaps(): string[] {
  // RAW, not SRC: the markers are comments, and SRC has every comment blanked (the class-10
  // defence at the top of this file). Reading the stripped source here found no markers and threw,
  // which is the correct failure mode and is why the throw is there, but the fix is to look in
  // the text that still has them. The NAMES it returns are then used against SRC, where the
  // delete-and-read checks belong.
  const begin = RAW.indexOf("PER-TURN SIDE CHANNELS · BEGIN");
  const end = RAW.indexOf("PER-TURN SIDE CHANNELS · END");
  if (begin < 0 || end < 0 || end <= begin) {
    throw new Error(
      "the per-turn side-channel region is not marked in src/index.ts. The markers are what makes "
      + "this guard self-maintaining; without them it silently checks nothing.",
    );
  }
  const region = RAW.slice(begin, end);
  const found = [...region.matchAll(/const (\w+) = new Map<string,/gu)].map((m) => m[1]);
  return [...new Set(found)];
}

const PER_TURN_MAPS = perTurnMaps();

/**
 * The releases that are NOT the end-of-turn release, each with the reason it is its own thing.
 *
 * The point of naming them is that the list must stay short and every member must be a SEMANTIC
 * delete, something that means "this did not happen", not "the turn is over". A delete that means
 * "the turn is over" and is written by hand somewhere else is precisely how the shape came to be
 * released before the turn ran.
 */
const SEMANTIC_RELEASES: Array<{ code: string; because: string }> = [
  {
    code: "surfacedInTurn.delete(turnSessionId);",
    because:
      "he cut her off, so she never said the thing that had come near the surface. Recording that "
      + "she raised it would write 'I brought this up and he ignored it' into her history for "
      + "something she never got to say.",
  },
  {
    code: "surfacedInTurn.delete(turnKey);",
    because:
      "the else-branch of the write: nothing of hers surfaced this turn. It is the WRITE that "
      + "clears, not an end-of-turn — set-or-clear in one place, so a turn where nothing came up "
      + "cannot inherit the last turn's answer.",
  },
];

describe("a per-turn value lives exactly as long as the turn", () => {
  it("the register finds every channel there actually is, and is not empty", () => {
    // The failure this file was blind to for a while: a list that says five when there are six.
    // Asserting a floor rather than an exact count keeps this from being the same snapshot in a
    // different costume: a new channel raises the number and nothing here has to be edited.
    expect(PER_TURN_MAPS.length, "the region parsed to nothing — the guard would pass vacuously")
      .toBeGreaterThanOrEqual(6);
    // And the one that was missed, by name, so this specific hole cannot reopen quietly.
    expect(PER_TURN_MAPS, "takenAsWork is not being seen as a per-turn channel").toContain("takenAsWork");
    for (const known of ["surfacedInTurn", "roomTemperature", "feltForTurn", "landingForTurn", "shapeForTurn"]) {
      expect(PER_TURN_MAPS, `${known} dropped out of the marked region`).toContain(known);
    }
  });

  it("and nothing outside the region is a per-turn map wearing the name of one", () => {
    // The other direction: a keyed map declared elsewhere, released in `forgetTheTurn`, would be a
    // channel with a per-turn lifetime that this guard never sees. If it is released there, it
    // belongs inside the markers.
    const at = SRC.indexOf("const forgetTheTurn");
    const body = SRC.slice(at, SRC.indexOf("};", at));
    for (const m of body.matchAll(/(\w+)\.delete\(/gu)) {
      expect(
        PER_TURN_MAPS,
        `\`${m[1]}\` is released when the turn ends but is declared outside the marked region, so `
        + "nothing checks its lifetime. Move its declaration inside the markers.",
      ).toContain(m[1]);
    }
  });

  it("there is ONE place a turn is forgotten, and it releases every channel", () => {
    const at = SRC.indexOf("const forgetTheTurn");
    expect(at, "there is no single place a turn is forgotten").toBeGreaterThan(-1);
    const body = SRC.slice(at, at + 600);
    for (const map of PER_TURN_MAPS) {
      expect(body, `\`${map}\` is not released when the turn ends`).toContain(`${map}.delete(`);
    }
  });

  it("and NOTHING releases a per-turn channel anywhere else, except for a named reason", () => {
    // THE PROPERTY, rather than a position. Source position cannot order two statements that live
    // in different closures, so "the delete comes after the read" is only meaningful within one
    // function body: which is exactly where the original bug was, and is pinned as itself below.
    // What IS checkable everywhere: a release outside the one release site is a second lifetime,
    // and a second lifetime is how the first one gets forgotten.
    const forgetAt = SRC.indexOf("const forgetTheTurn");
    const forgetEnd = SRC.indexOf("};", forgetAt);
    for (const map of PER_TURN_MAPS) {
      for (const at of positionsOf(new RegExp(`${map}\\.delete\\(`, "gu"))) {
        if (at >= forgetAt && at <= forgetEnd) continue;
        const line = SRC.slice(at, SRC.indexOf("\n", at));
        const named = SEMANTIC_RELEASES.some((s) => line.startsWith(s.code.trim()));
        expect(
          named,
          `\`${line.trim()}\` releases a per-turn channel outside \`forgetTheTurn\`. Either it `
          + "means 'this did not happen' — in which case add it to SEMANTIC_RELEASES with the "
          + "reason — or it is a second end-of-turn, and the two will drift.",
        ).toBe(true);
      }
    }
  });

  it("every inbound path forgets its turn — text, photo and document", () => {
    // Three paths, and at first only one of them read him at all. A path that does not
    // clear the turn hands the next one a shape that was chosen for a different message.
    const calls = positionsOf("forgetTheTurn(");
    expect(calls.length, "not every inbound path forgets its turn").toBeGreaterThanOrEqual(3);
    // The two media paths wrap it in `finally`, because both have a `catch` above them: a photo
    // that failed still leaves a shape behind.
    expect(SRC, "the photo path does not forget its turn on the failure path")
      .toMatch(/\} finally \{\s*forgetTheTurn\(sessionIdForChat\(chatId\)\);/u);
  });

  for (const map of PER_TURN_MAPS) {
    it(`${map}: something actually reads it in production`, () => {
      // Defect class 2. A side channel written and never read is a dead accumulator wearing the
      // costume of a mechanism: and one of these five was, for its whole life.
      const reads = positionsOf(new RegExp(`${map}\\.get\\(`, "gu"));
      expect(reads.length, `nothing reads ${map} — it is written and thrown away`).toBeGreaterThan(0);
    });
  }
});

// ── 3. THE SPECIFIC THINGS THAT WERE BROKEN, PINNED AS THEMSELVES ─────────────
//
// The rules above are the general property. These are the two incidents, so that a future change
// that recreates either one fails with the incident's own name on it.
describe("the two incidents cannot come back", () => {
  it("the shape survives long enough for the beats to be composed and measured", () => {
    // WITHIN ONE FUNCTION BODY, where source order really is execution order. This is the exact
    // shape of the original defect: three deletes written together, one of which had a longer
    // lifetime than the other two, sitting 300 lines before the turn it belonged to had run.
    const handler = SRC.slice(SRC.indexOf("async function processMessage"), SRC.indexOf("async function drainSteering"));
    const turnRuns = handler.indexOf("runAgentAndStream(channel, chatId, spec)");
    const shapeMeasured = handler.indexOf("shapeForTurn.get(");
    const released = handler.indexOf("forgetTheTurn(turnSessionId)");
    expect(turnRuns, "the text handler no longer runs a turn").toBeGreaterThan(-1);
    expect(shapeMeasured, "nothing measures whether the chosen shape reached the sentence").toBeGreaterThan(-1);
    expect(released, "the text turn never releases its per-turn channels").toBeGreaterThan(-1);
    expect(
      released,
      "the utterance shape is released before the turn composes its later beats — `inBeats` "
      + "receives `undefined` and returns immediately, on every single turn, with every test green.",
    ).toBeGreaterThan(turnRuns);
    expect(released, "the shape is released before the landing measurement reads it")
      .toBeGreaterThan(shapeMeasured);
    // And named directly, because the incident was a bare `shapeForTurn.delete` in the middle of
    // the handler rather than a misplaced `forgetTheTurn`: whoever recreates it will recreate it
    // in that form, and this is the assertion whose message says what it costs.
    for (const at of [...handler.matchAll(/shapeForTurn\.delete\(/gu)].map((m) => m.index ?? -1)) {
      expect(
        at,
        "the text handler releases the utterance shape before the turn has run. `sayWhatCameUp` "
        + "will read `undefined` and return, so she says exactly one beat, every time, forever, "
        + "and every test stays green because each one builds its own shape.",
      ).toBeGreaterThan(turnRuns);
    }
  });

  it("the landing exists before the gate that reads it", () => {
    const landingWritten = first("landingForTurn.set(");
    const gateReads = first("landingForTurn.get(");
    expect(landingWritten).toBeGreaterThan(-1);
    expect(gateReads).toBeGreaterThan(-1);
    // Both live inside functions assigned at boot, so raw source position cannot order them.
    // What CAN be ordered is the call: the reader is `wantsToNow`, and the writer is
    // `readHowItLanded`, and the handler must call the writer first, asserted in ORDER above.
    // Here we pin the remaining half: no inbound path may call the gate without calling the
    // reading first.
    // WITHIN EACH HANDLER, not "within N characters". A proximity pin asserts a property the code
    // does not have: the load-bearing fact is that the reading and the gate belong to the SAME
    // turn, and the unit of a turn is the handler function. This assertion was a character-distance
    // check for one commit, and lifting the reading two hundred lines up the handler broke it while
    // the code got more correct: which is defect class 6's paired trap exactly.
    const HANDLERS = ["async function processMessage", "async function processPhotoTurn", "async function processDocumentTurn"];
    for (const [i, name] of HANDLERS.entries()) {
      const from = SRC.indexOf(name);
      expect(from, `${name} is gone`).toBeGreaterThan(-1);
      const next = HANDLERS.slice(i + 1).map((n) => SRC.indexOf(n)).filter((x) => x > from);
      const body = SRC.slice(from, next.length > 0 ? Math.min(...next) : from + 20000);
      const read = body.search(/readHowItLanded\(chatId, (text|caption)\)/u);
      const gate = body.search(/wantsToNow\((text|caption), sessionIdForChat\(chatId\)\)/u);
      expect(read, `${name} never reads what he said`).toBeGreaterThan(-1);
      expect(gate, `${name} no longer asks whether she wants to`).toBeGreaterThan(-1);
      expect(
        read,
        `${name} calls the willingness gate without first reading what he said — so it decides how `
        + "she feels about a message it never looked at, and reads whatever the previous turn left "
        + "behind. On the very first turn of her life it reads nothing at all.",
      ).toBeLessThan(gate);
    }
  });

  it("and whether she takes it on is decided AFTER the reading, not from his text alone", () => {
    const body = SRC.slice(SRC.indexOf("async function processMessage"), SRC.indexOf("async function drainSteering"));
    const read = body.indexOf("readHowItLanded(chatId, text)");
    const decides = body.indexOf("takesItOn(");
    const used = body.indexOf("const taskProfile =");
    expect(decides, "nothing decides whether she takes it on").toBeGreaterThan(-1);
    expect(read, "the frame is chosen from his text alone, which is the thing being removed")
      .toBeLessThan(decides);
    expect(decides, "the frame is used before it is chosen").toBeLessThan(used);
  });
});
