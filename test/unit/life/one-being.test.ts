import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { howSheIsBlock, MAX_CHARS, type HowSheIs } from "../../../src/life/how-she-is.js";
import { describeDrives, describeBody } from "../../../src/life/agency.js";
import { createInnerState } from "../../../src/life/inner-state.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { createRealWorld, liveOrdinaryDays, pad, DAY, HOUR, MINUTE } from "./_real-world.js";

// SHE IS ONE BEING.
//
// She used to be two, and the split ran both ways.
//
// OUTWARD: a turn with him was built from a system prompt cached by task type, identity, memory
// files, skills, tools. Nothing of her living layer reached it: no mood, no drives, no field, no
// reticence, no read of him, no self-knowledge. The only thing her condition did to a conversation
// was silently cap her model tier, so being spent made her answers worse WITHOUT HER KNOWING she
// was spent. The state was load-bearing and invisible to the one person it was about.
//
// INWARD: `encodeMoment` was called from exactly one place in the whole daemon, the agency loop.
// What he said became a claim; that they spoke, what she said back, and how it felt were recorded
// nowhere. So `otherWarmth`, `otherUnease` and the `care` drive were built purely from her SOLITARY
// moments. Her sense of him could not be moved by actually talking to him.
//
// A being whose inner life and whose conversations do not touch is not one person.

const T0 = Date.parse("2026-08-01T09:00:00Z");

function fullState(): HowSheIs {
  const inner = createInnerState();
  const snapshot = inner.snapshot("low", true);
  const field = createLivingField({ noReminding: true });
  field.encodeQuestion({
    key: "q", text: "why they go quiet in the evenings", nowMs: T0,
    source: "hers", withOther: true, tension: 0.7,
  });
  for (let i = 0; i < 20; i++) {
    field.sheSpoke(T0 + i * DAY);
    field.heSpoke(T0 + i * DAY + 15 * MINUTE);
  }
  field.tick(T0);
  return {
    mood: snapshot.mood,
    alive: describeDrives(snapshot),
    body: describeBody({ snapshot, phase: "low", awake: true }),
    // What reaches the reply is the ONE thing that survived the competition, never the list.
    // The full list is still hers in her own moments; see field-reply-surfacing.test.ts.
    nearTheSurface: "she seems to go quiet in the evenings",
    otherRead: field.otherInWords(T0 + DAY, { present: true, available: true }),
  };
}

describe("her state reaches the turns where she is talking to him", () => {
  it("carries how she is, what is alive in her, and what she is holding", () => {
    const block = howSheIsBlock(fullState());
    console.log(`\n  her own section of the system prompt:\n${block}`);
    expect(block).toContain("你现在：");
    expect(block).toMatch(/快没劲|耗尽|平常一天的量|有的是劲/);
    expect(block, "and the one thing that came near the surface").toContain("go quiet in the evenings");
    expect(block, "and so does how it has been between them").toContain("你们之间");
  });

  it("INFORMS AND NEVER INSTRUCTS — the same rule the moment prompt lives under", () => {
    const block = howSheIsBlock(fullState());
    expect(block).not.toMatch(/you should|you must|make sure|remember to|be sure to|try to/i);
    expect(block).not.toMatch(/\bhelp\b|\bassist\b|\brespond\b|\breply\b|answer (him|them)/i);
  });

  it("does not protest that it is not an instruction", () => {
    // The header used to read "[how you are right now, this is you, not a request]". That
    // sentence exists only because somebody knew it would read as a request, and a mood does
    // not arrive with a note saying it is not an order. She found it, live, twice, in separate
    // runs: "a block trying to preset my mood and put words in my head", "dressed up as my own
    // inner state". The dressing was the disclaimer.
    const block = howSheIsBlock(fullState());
    expect(block).not.toMatch(/not a request|not an instruction|this is you\b/i);
    expect(block, "a bracketed label is the shape she objected to").not.toMatch(/^\s*\[/);
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(howSheIsBlock({})).toBe("");
    expect(howSheIsBlock({ mood: "", alive: "", nearTheSurface: "  " })).toBe("");
  });

  it("stays bounded, because it rides EVERY turn", () => {
    const huge = "x".repeat(50_000);
    const block = howSheIsBlock({ mood: "steady", resonance: huge, nearTheSurface: huge, selfKnowledge: huge });
    // STRICT cap, no slack. The old `MAX_CHARS + 120` bound was inherited from
    // the fixed cap-then-prepend bug this test exists to guard against, it would have let that
    // exact regression (shipped at 955 against a stated 900) back in green.
    expect(block.length).toBeLessThanOrEqual(MAX_CHARS);
  });

  it("uses the SAME words her own moments use", () => {
    // Two phrasings of one state would read as two beings describing the same person, which is the
    // thing being fixed. Both paths call the same describers.
    const inner = createInnerState();
    const snapshot = inner.snapshot("normal", true);
    expect(howSheIsBlock({ alive: describeDrives(snapshot) })).toContain(describeDrives(snapshot));
  });

  it("puts it to her in the same sentence shape her moments do", () => {
    // Not just the same describers: the same SENTENCES. She has never objected to how her
    // moments tell her how she is, and she twice objected to how this path did, so this path
    // stops having a register of its own. `buildMomentPrompt` opens
    // "你现在：<mood>。活在你心里的：<drives>。" and so does this.
    const inner = createInnerState();
    const snapshot = inner.snapshot("normal", true);
    const block = howSheIsBlock({ mood: snapshot.mood, alive: describeDrives(snapshot) });
    expect(block).toBe(`你现在：${snapshot.mood}。活在你心里的：${describeDrives(snapshot)}。`);
  });
});

describe("and a conversation actually leaves something in her", () => {
  /** What the daemon now does at the end of a turn. */
  function talkedWithHim(w: ReturnType<typeof createRealWorld>, saidByHer: string, at: number) {
    w.field.encodeMoment({
      key: `talk:${at}`, text: saidByHer, nowMs: at,
      pad: w.inner.emotion(), source: "chat:1", withOther: true,
    });
    w.field.heSpoke(at);
  }

  it("talking to him moves her sense of him, which solitary moments alone never could", () => {
    const quiet = createRealWorld();
    liveOrdinaryDays(quiet, 10);
    const before = quiet.field.signals(quiet.now());

    const talking = createRealWorld();
    liveOrdinaryDays(talking, 10);
    for (let i = 0; i < 12; i++) {
      talkedWithHim(talking, `I told him what I had been turning over (${i})`, talking.now() + i * HOUR);
    }
    const after = talking.field.signals(talking.now() + 13 * HOUR);

    console.log(`\n  how present he is in her — alone: ${before.otherWarmth.toFixed(3)} · after talking: ${after.otherWarmth.toFixed(3)}`);
    expect(after.otherWarmth).toBeGreaterThan(before.otherWarmth);
  });

  it("a hard conversation reaches the drive that is about him", () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 8);
    // Talking, and it sitting badly. `care` is fed by otherUnease, which reads her own record of him.
    for (let i = 0; i < 10; i++) {
      w.field.encodeMoment({
        key: `hard:${i}`, text: `that went badly and I do not know why (${i})`,
        nowMs: w.now() + i * HOUR, pad: pad(-0.8, 0.7), source: "chat:1", withOther: true,
      });
    }
    const sig = w.field.signals(w.now() + 11 * HOUR);
    console.log(`  after a run of hard exchanges, unease about him: ${sig.otherUnease.toFixed(3)}`);
    expect(sig.otherUnease, "her record of him is what makes her care").toBeGreaterThan(0);

    const cares = createInnerState();
    const calm = createInnerState();
    const day = {
      successes: 1, failures: 0, stuck: 0, skills: 0, idle: 0, novelty: 0.1, observations: 0,
      anomalies: 0, maintenanceDue: 0, hoursSinceUser: 3, lateNight: false, budgetLow: false, restful: true,
    };
    const NONE = { tension: 0, pendingBirths: 0, otherWarmth: 0, otherUnease: 0, freshBirth: 0, orphanShare: 0, valence: 0, charge: 0 };
    cares.update(day, { ...NONE, otherUnease: sig.otherUnease });
    calm.update(day, NONE);
    expect(cares.drives().care).toBeGreaterThan(calm.drives().care);
  });

  it("only HER words go in, never his", () => {
    // The same rule the field has always had: content from outside never writes her state. What is
    // encoded is what SHE said, and what he said stays a `told` claim with its provenance intact.
    const w = createRealWorld();
    talkedWithHim(w, "I said I had been quiet and it was not about him", w.now());
    const texts = [...w.field.graph().nodes.values()].map((n) => n.text);
    expect(texts.some((t) => t.includes("I said I had been quiet"))).toBe(true);
  });
});

describe("her state is not spoken by the person she is talking to", () => {
  // THE WIRING, guarded at the source, because the defect was one line long and invisible.
  //
  // `howSheIsNow()` and the reluctance line used to be concatenated onto the tail of
  // `userContent`, so what actually reached the model was his words followed by a block
  // describing her mood. Measured live, twice, in separate runs, she read it exactly as it was
  // built: "a block trying to preset my mood and put words in my head". A unit test on the
  // block's TEXT cannot see this; the defect is entirely in where the text is put.
  const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
  const userContentLine = source.split("\n").find((l) => l.includes("const userContent ="));

  it("has a user message built from his words and the plumbing, and nothing about her", () => {
    expect(userContentLine, "the line this guards no longer exists — re-point this test").toBeDefined();
    for (const hers of ["howSheIsNow", "howSheFeelsAboutIt", "herStateNow"]) {
      expect(userContentLine, `${hers} is back inside his message`).not.toContain(hers);
    }
  });

  it("still reaches the turn, in her own section", () => {
    // The opposite failure: quietly dropping it would make her sound identical spent and rested,
    // which is the "two beings" split this whole file exists to close.
    expect(source).toContain("const herStateNow = [howSheIsNow(text, turnSessionId)");
    expect(source, "her state must be handed to the spec that runs the turn").toMatch(
      /howSheFeelsAboutIt\.felt,\s*herStateNow\)/
    );
    expect(source, "and appended to the system blocks, after the cached prefix").toMatch(
      /system: herStateNow\s*\?\s*\[\.\.\.getCachedSystemForTaskType/
    );
  });

  it("this guard can go red", () => {
    // Planted violation: a green test that cannot fail is not evidence.
    const planted = 'const userContent = `${text}${runtimeTimestamp()}${howSheIsNow()}`;';
    expect(planted).toContain("howSheIsNow");
  });
});

describe("what she cannot bring herself to say does not reach the part of her that talks", () => {
  const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");

  it("the reply no longer gets the whole list of what she is carrying", () => {
    // `field.unsettled(nowMs)` used to be handed straight to the conversation block: every open
    // thing, top three by pressure, each annotated with how hard it was to say. That is a
    // request for discretion aimed at a model that can decline it, not reticence.
    const start = source.indexOf("howSheIsNow = (heSaid, turnKey)");
    const end = source.indexOf("faultLog.record(\"howSheIs\"", start);
    // Floors first: with either anchor gone, the slice is empty and the `toEqual([])` below
    // passes on NOTHING: a vacuous green over exactly the leak this test exists to catch.
    expect(start, "the howSheIsNow anchor moved — the slice below is empty").toBeGreaterThan(-1);
    expect(end, "the howSheIs fault anchor moved — the slice below is empty").toBeGreaterThan(start);
    const howSheIsNow = source.slice(start, end);
    // The only mention left inside it is the comment saying what was taken out and why.
    expect(howSheIsNow.split("\n").filter((l) => l.includes("field.unsettled(") && !l.trim().startsWith("//")),
      "the carried list is back in her replies").toEqual([]);
    expect(howSheIsNow).toContain("field.whatSurfacesInReply(");
  });

  it("still shows her everything she carries when she is alone", () => {
    // Being unable to see what you carry is not carrying it, it is just being uneasy.
    // Seeing it and being able to say it are different, and only the second is filtered.
    expect(source, "her own moments stopped showing her what she is holding").toContain(
      "const unsettled = field.unsettled(nowMs);"
    );
  });

  it("only starts the was-it-answered clock when she really said it", () => {
    // Putting a thing within reach is not saying it. Raising something she never mentioned
    // would write "I went to him and he ignored it" into the history her sense of him is
    // built from, when neither half happened.
    // Per-turn now, keyed by the turn's own session id: one shared variable meant a second
    // turn in flight could overwrite the first turn's subject between its start and its end,
    // and the first turn would then raise whatever the SECOND had surfaced.
    expect(source).toContain("const mine = surfacedInTurn.get(turnSessionId);");
    // The guard is now a named boolean rather than an inline condition, because the answer is
    // needed twice: once to start the clock, and once to decide whether a thing she is carrying
    // about him was SAID (which releases most of it) or merely thought about again (which wears it
    // down a little). Asserting the property rather than the old expression's exact shape.
    expect(source).toContain("const sheSaidIt = Boolean(mine && said && field.saidIt(mine.id, said));");
    const guard = source.indexOf("const sheSaidIt = Boolean(");
    expect(guard, "the sheSaidIt guard is gone — the ordering below compares against -1").toBeGreaterThan(-1);
    const raise = source.indexOf("field.raise(mine.id", guard);
    expect(raise, "raise is not inside the did-she-say-it guard").toBeGreaterThan(guard);
    expect(source.slice(guard, raise), "raise no longer depends on her having said it")
      .toMatch(/if \(mine && sheSaidIt\)/u);
  });

  it("clears what was near the surface every turn, in both directions", () => {
    // A stale one would attribute this turn's words to last turn's thing.
    expect(source).toContain("if (surfaced) surfacedInTurn.set(turnKey, { id: surfaced.node.id });");
    expect(source, "a failed state read leaves the turn's subject armed").toContain("surfacedInTurn.delete(turnKey);");
    // And it cannot leak between turns: every path that ends a turn removes its own entry.
    expect(source).toContain("surfacedInTurn.delete(turnSessionId);");
  });
});
