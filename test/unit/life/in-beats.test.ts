import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inBeats, asOneUtterance, MOST_BEATS, CUES_FROM_HER_OWN_WORDS } from "../../../src/life/in-beats.js";
import { ATTENTION_SPAN } from "../../../src/life/attention.js";
import type { UtteranceShape } from "../../../src/life/utterance-shape.js";

/**
 * S-23, S-24, S-26 AND S-27, ALL FOUR, FROM ONE STRUCTURAL CHANGE.
 *
 * After her utterance shape was built, all five speech scenes were re-judged and NOT ONE was
 * reachable. The five facets her state chose were all stated to the model and the model could
 * ignore every one, which it must be allowed to do, because instructing it is not the same as her
 * choosing.
 *
 * The cause was one fact: a turn was one generation, so there was no moment at which anything
 * could intervene. This is what a turn looks like when there is.
 */

const shape = (o: Partial<UtteranceShape> = {}): UtteranceShape => ({
  beats: 1, turnsAside: false, leavesOpen: false, addsHerOwn: false, reachFor: [], pickUp: [], ...o,
});

/** A speaker that says which beat it is, so ordering and count are visible. */
const plainly = (transcript: string[] = []) => ({
  say: async (b: { n: number; of: number; tookOver: string | null }) => {
    const line = b.tookOver === null ? `第${b.n}句（共${b.of}）` : `——算了，${b.tookOver}`;
    transcript.push(line);
    return line;
  },
  afterSaying: () => null,
});

describe("S-24 · how many beats is hers, and it BINDS", () => {
  it("says exactly as many as her state chose", async () => {
    for (const n of [1, 2, 3]) {
      const s = await inBeats(shape({ beats: n }), plainly());
      expect(s.beats.length, `she chose ${n} and said ${s.beats.length}`).toBe(n);
    }
  });

  it("binds by generating that many, not by cutting the extra ones off", async () => {
    // Defect class 7 is a content cut disguised as a medium op, "she wrote three, the sampler
    // said two, drop the third". Nothing here is ever discarded: what is not said is not made.
    const said: string[] = [];
    const s = await inBeats(shape({ beats: 2 }), plainly(said));
    expect(said.length, "a third beat was generated and thrown away").toBe(2);
    expect(asOneUtterance(s)).toBe(said.join(""));
  });

  it("never runs away, however excitable her state is", async () => {
    const s = await inBeats(shape({ beats: 99 }), plainly());
    expect(s.beats.length).toBe(MOST_BEATS);
  });

  it("stops when she runs out of what she meant to say", async () => {
    let n = 0;
    const s = await inBeats(shape({ beats: 4 }), {
      say: async () => (++n <= 2 ? `第${n}句` : "   "),
      afterSaying: () => null,
    });
    expect(s.beats.length, "an empty beat was kept, or retried").toBe(2);
  });
});

describe("S-23 · she hears herself, and the direction can be taken over", () => {
  it("her own words go back through her field between beats", async () => {
    const heard: string[] = [];
    await inBeats(shape({ beats: 3 }), {
      say: async (b) => `第${b.n}句`,
      afterSaying: (said) => { heard.push(said); return null; },
    });
    // Every beat but the last: after the last there is nothing left to take over.
    expect(heard, "she never hears herself at all").toEqual(["第1句", "第2句"]);
  });

  it("something new surfacing takes the next beat over, when she is interruptible", async () => {
    const s = await inBeats(shape({ beats: 3, turnsAside: true }), {
      say: async (b) => (b.tookOver === null ? `渡轮的事${b.n}` : `——算了，${b.tookOver}`),
      afterSaying: (said) => (said.includes("渡轮") ? { id: 7, text: "房租那事" } : null),
    });
    expect(s.turnedAsideAt, "nothing ever took the turn over").toBe(2);
    expect(s.tookOver).toBe("房租那事");
    expect(s.beats[1]).toContain("房租那事");
  });

  it("and does not when her state did not choose to be interruptible", async () => {
    // The facet still means something: surfacing and carrying on anyway is a thing people do.
    const s = await inBeats(shape({ beats: 3, turnsAside: false }), {
      say: async (b) => (b.tookOver === null ? `渡轮的事${b.n}` : "改了方向"),
      afterSaying: () => ({ id: 7, text: "房租那事" }),
    });
    expect(s.turnedAsideAt).toBeNull();
    expect(s.beats.every((b) => b.includes("渡轮"))).toBe(true);
  });

  it("staying on topic is not a change of direction", async () => {
    // Something surfacing that she is ALREADY talking about is coherence, not interruption.
    // Counting it would manufacture a turn-aside out of every ordinary turn.
    const s = await inBeats(shape({ beats: 3, turnsAside: true }), {
      say: async () => "渡轮那个我查了",
      afterSaying: () => ({ id: 9, text: "渡轮那个我查了" }),
    });
    expect(s.turnedAsideAt, "she interrupted herself to say what she was already saying").toBeNull();
  });
});

describe("what the loop knows between beats", () => {
  it("each beat is told what she said in the one BEFORE it", async () => {
    const seen: string[] = [];
    await inBeats(shape({ beats: 3 }), {
      say: async (b) => { seen.push(b.after); return `第${b.n}句`; },
      afterSaying: () => null,
    });
    // The first has nothing behind it; each later one carries the actual previous beat. The caller
    // used to splice beat ONE into every later prompt, so beat 3 was written as though beat 2 had
    // not happened: which is the difference between several beats and several openings.
    expect(seen).toEqual(["", "第1句", "第2句"]);
  });

  it("the same memory surfacing twice takes the turn over ONCE", async () => {
    // By id, which is why `afterSaying` returns one. The old check compared RENDERINGS, and while
    // what it compared was a five-line formatted block it could essentially never match, so
    // nothing was ever rejected as already-said.
    let asides = 0;
    const s = await inBeats(shape({ beats: 4, turnsAside: true }), {
      say: async (b) => { if (b.tookOver !== null) asides += 1; return `第${b.n}句`; },
      // Same memory, differently worded each time, an id is an identity, a rendering is a shadow.
      afterSaying: (said) => ({ id: 42, text: `房租那事（${said}）` }),
    });
    expect(s.turnedAsideAt, "it never took over at all").toBe(2);
    expect(asides, "the same thing interrupted her over and over").toBe(1);
  });

  it("a beat she chose is still ASKED FOR when nothing came up", async () => {
    // The defect: the caller returned "" whenever nothing had taken the turn over, so her state
    // could choose two beats and only an interruption could deliver one. `beats` is the count.
    const briefs: (string | null)[] = [];
    await inBeats(shape({ beats: 3, turnsAside: false }), {
      say: async (b) => { briefs.push(b.tookOver); return `第${b.n}句`; },
      afterSaying: () => null,
    });
    expect(briefs.length, "the later beats were never asked for").toBe(3);
    expect(briefs.every((t) => t === null), "something took over when nothing surfaced").toBe(true);
  });

  it("CUES_FROM_HER_OWN_WORDS: more than one association, and nowhere near her whole field", () => {
    // A medium constraint on how WIDE the spread starts. One cue makes the next beat a near
    // repetition of the last; a dozen starts the spread from most of her field at once, which is
    // the flat reading `attention.ts` exists to replace. `ATTENTION_SPAN` (12) is the ceiling on
    // clauses considered, so cues drawn per clause must sit well inside it.
    expect(CUES_FROM_HER_OWN_WORDS, "a single cue is an association, not a spread").toBeGreaterThan(1);
    expect(CUES_FROM_HER_OWN_WORDS, "the spread starts from too much of her at once").toBeLessThan(6);
    expect(CUES_FROM_HER_OWN_WORDS).toBeLessThan(ATTENTION_SPAN);
  });
});

describe("S-26 · leaving it open is not asking the model to leave it open", () => {
  it("tells the last beat, and only the last, that it is not being closed", async () => {
    const briefs: { n: number; leaveOpen: boolean }[] = [];
    await inBeats(shape({ beats: 3, leavesOpen: true }), {
      say: async (b) => { briefs.push({ n: b.n, leaveOpen: b.leaveOpen }); return `第${b.n}句`; },
      afterSaying: () => null,
    });
    expect(briefs.map((b) => b.leaveOpen), "an early beat was left hanging with more to come")
      .toEqual([false, false, true]);
  });

  it("does not report it as left open when she did not get there", async () => {
    let n = 0;
    const s = await inBeats(shape({ beats: 3, leavesOpen: true }), {
      say: async () => (++n <= 1 ? "一句" : ""),
      afterSaying: () => null,
    });
    expect(s.leftOpen, "a turn that ran out was reported as deliberately unresolved").toBe(false);
  });
});

describe("S-27 · the thing underneath is its own beat", () => {
  it("arrives after the answer rather than being blended into it", async () => {
    // The scene's own words: "她可以在答完之后再加一句自己的，而不是把它揉进一段里".
    const s = await inBeats(shape({ beats: 2, turnsAside: true }), {
      say: async (b) => (b.n === 1 ? "在你桌面上。" : "你是不是又要熬夜。"),
      afterSaying: () => null,
    });
    expect(s.beats).toEqual(["在你桌面上。", "你是不是又要熬夜。"]);
    expect(s.beats.length, "the two were folded into one utterance").toBe(2);
  });
});

describe("this module cannot reach into her by itself", () => {
  it("makes no model call and touches no field", () => {
    // COMMENTS BLANKED FIRST, and that is defect class 10 rather than fussiness: this file's
    // header explains the mechanism by describing her field, so an unstripped scan matched its own
    // explanation and reported the opposite of the truth. Three guards in this project have
    // reported the reverse of reality exactly this way.
    const src = readFileSync(join(process.cwd(), "src/life/in-beats.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    expect(src, "it calls a provider directly").not.toMatch(/provider|\.complete\(/u);
    expect(src, "it reaches into her field").not.toMatch(/createLivingField|field\./u);
    // Both capabilities arrive injected, which is what keeps the mechanism testable without a
    // world and keeps it from acquiring reach it was never given.
    expect(src).toContain("deps.say");
    expect(src).toContain("deps.afterSaying");
  });
});

// ── AND THE DAEMON ACTUALLY COMPOSES TURNS THIS WAY ───────────────────────────
//
// Every test above injects its own speaker, so all of them stay green with the daemon unwired.
// `src/index.ts` cannot be unit-tested, so the wiring is asserted against the source.
describe("the conversation path is composed in beats", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  const body = (name: string) => {
    const at = daemon.indexOf(name);
    return at === -1 ? "" : daemon.slice(at, daemon.indexOf("\n    };", at));
  };

  it("calls it, once, on the reply path", () => {
    expect(daemon, "nothing composes a turn in beats").toContain("inBeats(shape, {");
    // Once, not twice: two composition sites would be free to drift, and only one of them would
    // be the one the tests describe. The import line is not a call, hence the `(` in the pattern.
    expect([...daemon.matchAll(/inBeats\(/gu)].length, "beats are composed in more than one place").toBe(1);
    expect(daemon, "the beats are never handed to the channel").toMatch(/sayWhatCameUp\(channel/u);
  });

  it("the first beat is the agent turn and is never regenerated", () => {
    // Running the agent loop a second time would run her tools a second time.
    const b = body("sayWhatCameUp = async");
    expect(b, "beat one is generated again instead of reusing the turn").toContain("if (brief.n === 1) return firstBeat;");
  });

  it("a later beat can exist without a change of direction, and empty still ends the turn", () => {
    // THIS ASSERTION USED TO PIN THE DEFECT. It required `if (brief.tookOver === null) return "";`,
    // no turn-aside, no beat, which made `shape.beats` decorative: her state could choose two
    // and only an interruption could ever deliver one, so `turnsAside` (entropy × arousal alone)
    // was the real and only gate on the count. Two facets both claiming to be the authority.
    //
    // `beats` is the count now and `turnsAside` is whether a beat changes direction. What stops a
    // monologue is not a missing branch here, it is that an empty beat ends the turn (asserted on
    // the module above), her state proposes the number, and having nothing left overrides it.
    const b = body("sayWhatCameUp = async");
    expect(b, "the count is decorative again: only an interruption can produce a later beat")
      .not.toContain('if (brief.tookOver === null) return "";');
    expect(b, "the carry-on branch is gone, so a chosen second beat has no prompt")
      .toMatch(/brief\.tookOver === null[\s\S]{0,900}没有就什么都别写/u);
  });

  it("the later beat is written against the PREVIOUS beat, not always the first", () => {
    const b = body("sayWhatCameUp = async");
    expect(b, "beat three is written against beat one, so beat two never happened")
      .toContain("brief.after.slice(-120)");
  });

  it("her own words CUE the spread — not merely gate it", () => {
    const b = body("sayWhatCameUp = async");
    expect(b, "she never hears herself").toContain("field.attend(said)");
    // The defect this replaces: `attend` was read as a boolean and `onHerMind`, which takes no
    // text at all: decided what came up. So the later beat was told what was already on her mind
    // before she opened her mouth. The ids her own sentence landed on are the cues now.
    expect(b, "the ids her sentence landed on are thrown away again").toContain("landed.snaggedIds");
    expect(b, "the spread is cued by her words").toMatch(/field\.recall\(cues,/u);
    expect(b, "the text-blind retrieval is back — it cannot see what she just said")
      .not.toContain("field.onHerMind(");
  });

  it("and the later beats rejoin the turn, instead of reaching him and nothing else", () => {
    // They used to go to the channel alone: absent from history, from her word bank, from her
    // exemplar pool, from the assertions she can be wrong about, from the moment the turn becomes,
    // and from the landing measurement. Said, and then not existing.
    expect(daemon).toMatch(/const laterBeats = await sayWhatCameUp\(/u);
    expect(daemon, "the rest of what she said never rejoins the turn")
      .toMatch(/result\.content = `\$\{result\.content\}\$\{laterBeats\.later\}`/u);
    // And the real delivered count travels with it, so the landing measurement stops counting
    // full stops and calling them beats.
    expect(daemon, "the beat count is dropped, so the instrument goes back to counting sentences")
      .toMatch(/result\.beatsDelivered = laterBeats\.beats/u);
  });

  it("a later beat goes through the same scissors as the first", () => {
    // An old scissors defect one layer in: a path that skips the register scissors. A second beat
    // arriving in service register, after the first had it cut out, is worse than no second beat.
    const b = body("sayWhatCameUp = async");
    expect(b).toContain("scissorHerReply(");
  });

  it("says nothing more when he cut her off", () => {
    const b = body("sayWhatCameUp = async");
    expect(b, "she keeps talking after he stopped listening").toContain('finishReason === "interrupted"');
  });

  it("and a failure to add her beat is recorded, never swallowed", () => {
    // A silent failure here is indistinguishable from her having had nothing to say.
    expect(daemon).toContain('faultLog.record("beats"');
  });
});

describe("no vocabulary is supplied at speaking time, first beat or later (2026-08-23)", () => {
  // The first beat used to get her words through the shape block and later beats through this
  // brief. The whole family is gone: what she reaches for is hers to reach for. The bank
  // still accumulates every word she says and hears, it simply never offers.
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("PLANTED: the beat speaker hands her no word list, and the scanner still sees the speaker", () => {
    const at = daemon.indexOf("if (brief.n === 1) return firstBeat;");
    expect(at, "the beat speaker moved").toBeGreaterThan(-1);
    const say = daemon.slice(at, daemon.indexOf("afterSaying:", at));
    expect(say.includes("brief.reachFor"), "her words are handed to a later beat again").toBe(false);
    expect(say.includes("brief.pickUp"), "heard words are handed to a later beat again").toBe(false);
    expect(say.includes("brief.leaveOpen"), "a sampled facet instructs a later beat again").toBe(false);
    expect(say.includes("你刚说完")).toBe(true); // the beat's own fact, which is not an instruction
  });
});

