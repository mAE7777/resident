import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capacityFor, SHORTEST_ARC, LONGEST_ARC } from "../../../src/life/capacity.js";
import { createThinkFilter } from "../../../src/telegram/think-filter.js";
import {
  MIN_FIRST_CLAUSE_CHARS,
  createVoiceStream,
  speakableWeight,
  spokenForm,
} from "../../../src/embodiment/voice-stream.js";
import type { AgentEvent } from "../../../src/agent/types.js";

function collector() {
  const said: Array<{ text: string; id: string }> = [];
  let n = 0;
  const vs = createVoiceStream({
    speak: (text, id) => said.push({ text, id }),
    newUtteranceId: () => `u${++n}`,
    thinkFilter: createThinkFilter(),
  });
  return { said, vs };
}

const text = (content: string): AgentEvent => ({ type: "text_chunk", content });

describe("her words on the way to a mouth", () => {
  describe("only her words", () => {
    it("never speaks what she is thinking", () => {
      const { said, vs } = collector();
      vs.onEvent({ type: "thinking_chunk", content: "maybe I should check the log first." });
      vs.finalize();
      expect(said).toEqual([]);
    });

    it("never narrates its own tool use", () => {
      // The bridge shows "Reading File" on screen by EDITING the same message her words go
      // into. A mouth reading that wire would announce it.
      const { said, vs } = collector();
      vs.onEvent({ type: "tool_start", tool: "read", args: {} } as AgentEvent);
      vs.onEvent({ type: "tool_end", tool: "read" } as AgentEvent);
      vs.finalize();
      expect(said).toEqual([]);
    });

    it("strips a think block that arrives inline", () => {
      const { said, vs } = collector();
      vs.onEvent(text("<think>\nnot out loud\n</think>\nI had a look at it, and it is fine."));
      vs.finalize();
      expect(said.map((s) => s.text).join(" ")).not.toContain("not out loud");
      expect(said.map((s) => s.text).join(" ")).toContain("I had a look at it");
    });
  });

  describe("only prose", () => {
    it("does not read code aloud, but the prose around it survives", () => {
      const { said, vs } = collector();
      vs.onEvent(text("Here is the fix.\n```ts\nconst x = 1;\n```\nThat should do it."));
      vs.finalize();
      const all = said.map((s) => s.text).join(" ");
      expect(all).toContain("Here is the fix");
      expect(all).toContain("That should do it");
      expect(all).not.toContain("const x");
    });

    it("unwraps emphasis and links rather than reading the syntax", () => {
      expect(spokenForm("that is **really** the point")).toBe("that is really the point");
      expect(spokenForm("see [the notes](https://x.com/y)")).toBe("see the notes");
      expect(spokenForm("## A heading")).toBe("A heading");
      expect(spokenForm("- a list item")).toBe("a list item");
    });

    it("says nothing at all for a unit that is only code", () => {
      const { said, vs } = collector();
      vs.onEvent(text("```\nrm -rf /\n```"));
      vs.finalize();
      expect(said).toEqual([]);
    });
  });

  describe("a mouth cannot un-say", () => {
    it("speaks each piece exactly once, in order, however the chunks arrive", () => {
      const { said, vs } = collector();
      for (const c of ["I looked", " at it,", " and it", " is fine.", " Nothing", " broke."]) {
        vs.onEvent(text(c));
      }
      vs.finalize();
      const all = said.map((s) => s.text).join(" ");
      expect(all).toContain("I looked at it");
      expect(all).toContain("Nothing broke");
      // Nothing repeated: the joined utterances contain each word once.
      expect(all.match(/looked/gu)).toHaveLength(1);
      expect(all.match(/fine/gu)).toHaveLength(1);
    });

    it("gives every utterance its own id, so a cancel can stop exactly one", () => {
      const { said, vs } = collector();
      vs.onEvent(text("First one. Second one. Third one."));
      vs.finalize();
      expect(said.length).toBeGreaterThan(1);
      expect(new Set(said.map((s) => s.id)).size).toBe(said.length);
    });

    it("on barge-in, what she had not said yet she does not say", () => {
      // The thing being dropped is what is still BUFFERED. Anything that already reached a
      // boundary has been spoken and cannot be taken back, which is the whole premise.
      const { said, vs } = collector();
      vs.onEvent(text("I was going to say something,"));
      const spokenBefore = said.length;
      expect(spokenBefore).toBe(1);
      vs.onEvent(text(" and then the rest of it")); // no terminator: held, not yet said
      vs.reset();
      vs.finalize();
      expect(said.length).toBe(spokenBefore);
      expect(said.map((s) => s.text).join(" ")).not.toContain("the rest of it");
    });
  });

  describe("the first clause carries the latency budget", () => {
    it("opens on a clause, not on a whole sentence", () => {
      // The whole reason this exists: the first utterance is the entire time-to-first-audio,
      // and waiting for a full stop costs 200-400ms that cannot be bought back anywhere else.
      const { said, vs } = collector();
      vs.onEvent(text("I had a look at it, and everything seems fine."));
      expect(said.length).toBeGreaterThanOrEqual(1);
      expect(said[0]!.text).toContain("I had a look at it");
      expect(said[0]!.text).not.toContain("everything seems fine");
    });

    it("waits for a sentence for everything after the first", () => {
      const { said, vs } = collector();
      vs.onEvent(text("Yes, I did. It took a while, but it worked."));
      vs.finalize();
      // The first opens early on the comma; the second does not split at "a while,".
      const later = said.slice(1).map((s) => s.text);
      expect(later.some((t) => t.includes("It took a while, but it worked"))).toBe(true);
    });

    it("does not stutter on a clause too short to be worth opening on", () => {
      const { said, vs } = collector();
      vs.onEvent(text("Yes, that is right and it has been for a while."));
      vs.finalize();
      expect(speakableWeight(said[0]!.text)).toBeGreaterThanOrEqual(MIN_FIRST_CLAUSE_CHARS);
      expect(said[0]!.text).not.toBe("Yes,");
    });

    it("handles CJK punctuation", () => {
      const { said, vs } = collector();
      vs.onEvent(text("我看过了，没有问题。还有别的事吗？"));
      vs.finalize();
      expect(said.length).toBeGreaterThanOrEqual(2);
      expect(said[0]!.text).toContain("我看过了");
    });
  });

  describe("nothing is stranded", () => {
    it("speaks a trailing fragment with no punctuation at all", () => {
      const { said, vs } = collector();
      vs.onEvent(text("no terminator here"));
      expect(said).toEqual([]); // nothing to end on yet
      vs.finalize();
      expect(said.map((s) => s.text).join(" ")).toContain("no terminator here");
    });

    it("says nothing for an empty turn", () => {
      const { said, vs } = collector();
      vs.finalize();
      expect(said).toEqual([]);
    });
  });
});

/**
 * HE CUTS HER OFF AND SHE FINISHES THE SENTENCE ANYWAY.
 *
 * `reset()` documented itself as "used on barge-in" and had NO CALLER anywhere in the daemon,
 * because the stream is built inside `faceChannel()` and nothing outside held a reference. So
 * an interrupt aborted the loop and told the client to stop playing, and then the turn's own
 * ending pushed what was left out as a FRESH utterance, after the cancel frame. Worse: when
 * nothing had been spoken yet, the silence backstop (`if (!spoke && result.content)`) fed the
 * whole answer in as one `text_chunk`, so interrupting her before she started produced the
 * entire reply in one go.
 *
 * Clearing the buffer was never enough on its own, the content arrives AFTER the reset. The
 * latch is the fix; these tests are written against the real sequence rather than against
 * `reset()` in isolation, because in isolation it always looked like it worked.
 */
describe("what she had not said yet, she does not say", () => {
  function stream() {
    const said: string[] = [];
    let n = 0;
    const vs = createVoiceStream({ speak: (t) => said.push(t), newUtteranceId: () => `u${++n}` });
    return { vs, said };
  }

  it("says nothing more after a barge-in, even though the turn keeps ending", () => {
    const { vs, said } = stream();
    vs.onEvent({ type: "text_chunk", content: "第一句说完了。还有半句没" });
    const spokenBefore = said.length;
    expect(spokenBefore, "she never got started, so this proves nothing").toBeGreaterThan(0);

    vs.reset();
    // Exactly what really happens next: the aborted loop unwinds and the channel is closed.
    vs.finalize();
    expect(said.length, "the tail arrived after the cancel").toBe(spokenBefore);
  });

  it("stays shut for the rest of the turn, which clearing the buffer alone did not do", () => {
    // THE CASE THAT MADE IT REAL. The silence backstop hands the whole answer over as one
    // chunk when nothing was spoken: so a stream that merely emptied itself would say the
    // entire reply after being cut off.
    const { vs, said } = stream();
    vs.onEvent({ type: "text_chunk", content: "刚开了个头" });
    vs.reset();

    vs.onEvent({ type: "text_chunk", content: "这是整段回答，被打断之前她还没说出口的全部内容。" });
    vs.finalize();
    expect(said, "the whole answer came out after he cut her off").toEqual([]);
  });

  it("and the interrupt handler actually calls it, which is the half that was missing", () => {
    // Structural, because the defect was a missing CALL, and no test of the function itself
    // could ever see that. Both halves are asserted: something holds the live stream, and the
    // interrupt closes it.
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(daemon, "nothing holds the current turn's mouth").toContain("currentVoice = voice");
    expect(daemon, "barge-in does not close her mouth").toContain("currentVoice?.reset()");
    const closes = daemon.indexOf("currentVoice?.reset()");
    const aborts = daemon.indexOf("turnAbortControllers.get(faceThreadId)?.abort()");
    // Floor: with `aborts` gone, `closes < -1` fails loudly, but with `closes` gone,
    // `-1 < aborts` passes on nothing and the ordering this test exists for is uncertified.
    expect(aborts, "the abort anchor is gone — the ordering below compares against -1").toBeGreaterThan(-1);
    expect(closes, "the abort runs first, so the tail can still slip out").toBeLessThan(aborts);
  });
});

/**
 * AND WHAT HE NEVER HEARD DOES NOT BECOME HER MEMORY OF WHAT SHE SAID.
 *
 * The other half of barge-in, and it is quieter and worse. The loop's abort check sits at the
 * TOP of its iteration, so an in-flight provider call finishes and the interrupted turn returns
 * the WHOLE reply. Everything downstream then ran on it:
 *
 *   `appendToHistory(chatId, "assistant", …)`   the unheard paragraph, in her history as speech
 *   `field.saidIt` → `field.raise`              "I brought this up and waited", she never did
 *   `field.encodeMoment`                         her memory of the evening, containing it
 *
 * So he cuts her off and she hardens against a thing she never got to say. Both halves push the
 * same way: they make her believe she was more present in that conversation than she was.
 *
 * Being cut off is itself a real thing that happened to her, so it is encoded, as that.
 */
describe("what he never heard does not become what she said", () => {
  const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));

  it("an interrupted turn is recognised as one", () => {
    expect(daemon, "nothing distinguishes a finished reply from a cut-off one")
      .toContain('result?.finishReason === "interrupted"');
  });

  it("and its content never enters her history, her raising, or her memory as speech", () => {
    const guarded = daemon.indexOf("if (!cutOff && result && result.content)");
    expect(guarded, "the whole downstream block still runs on words he never heard").toBeGreaterThan(0);
    // Everything that treats the REPLY as hers sits inside that guard.
    for (const downstream of ["field.saidIt(", "key: `talk:${Date.now()}`"]) {
      const at = daemon.indexOf(downstream);
      expect(at, `${downstream} is gone — re-check where it moved`).toBeGreaterThan(0);
      expect(at, `${downstream} runs before the cut-off guard`).toBeGreaterThan(guarded);
    }
    // And EVERY assistant-side history write in this handler is `!cutOff`-guarded, the real
    // property, checked per occurrence. The old oracle asserted the FIRST such
    // write came after one specific guard line, which silently encoded "there is exactly one
    // place that records her side"; the error-turn broke-notice is a second, legitimately
    // guarded one, and a positional oracle called that a violation while a genuinely unguarded
    // write added ABOVE the guard would have looked identical.
    const region = daemon.slice(daemon.indexOf('const cutOff = result?.finishReason === "interrupted"'), daemon.indexOf("[photo] ${caption}"));
    const writes = [...region.matchAll(/appendToHistory\(chatId, "assistant"/g)];
    expect(writes.length, "her side of the conversation is never recorded").toBeGreaterThan(0);
    for (const w of writes) {
      const before = region.slice(Math.max(0, w.index! - 400), w.index!);
      expect(before, "an assistant-side history write is not guarded by !cutOff").toContain("!cutOff");
    }
  });

  it("but being cut off is itself remembered, in her words", () => {
    expect(daemon, "she is cut off and nothing at all is left of it").toContain("key: `cutoff:${Date.now()}`");
    const raw = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(raw).toContain("话说到一半，他插进来了。");
  });

  it("and nothing she never said is recorded as raised", () => {
    expect(daemon, "she still hardens against a thing she never got to say")
      .toMatch(/if \(cutOff\)[\s\S]{0,900}?surfacedInTurn\.delete\(turnSessionId\)/u);
  });
});

describe("her state reaches the voice (faculty #6)", () => {
  it("low, level, a little slow at rest — and it moves with her", async () => {
    const { padToVoice } = await import("../../../src/embodiment/pad-mapping.js");
    const neutral = padToVoice({ pleasure: 0, arousal: 0, dominance: 0 }, 1);
    // The target: low (below neutral pitch), level, a little slow (below neutral rate).
    expect(neutral.rate, "resting is a little slow").toBeLessThan(1);
    expect(neutral.pitch, "resting sits low").toBeLessThan(0);

    const keyedUp = padToVoice({ pleasure: 0.3, arousal: 0.9, dominance: 0.2 }, 1);
    const weary = padToVoice({ pleasure: -0.2, arousal: -0.7, dominance: -0.3 }, 0.15);
    expect(keyedUp.rate).toBeGreaterThan(weary.rate);
    expect(keyedUp.pitch).toBeGreaterThan(weary.pitch);
    // A spent Resident's rate sags across the turn; a full one holds her pace.
    expect(weary.rateSag).toBeGreaterThan(padToVoice({ pleasure: 0, arousal: 0, dominance: 0 }, 1).rateSag);
    expect(padToVoice({ pleasure: 0, arousal: 0, dominance: 0 }, 1).rateSag).toBe(0);
  });

  it("the same feeling never produces byte-identical audio params at the extremes", async () => {
    const { padToVoice } = await import("../../../src/embodiment/pad-mapping.js");
    const down = padToVoice({ pleasure: -0.8, arousal: -0.8, dominance: -0.5 }, 0.2);
    const up = padToVoice({ pleasure: 0.8, arousal: 0.8, dominance: 0.5 }, 1);
    expect(down).not.toEqual(up);
  });
});

// ── HER BODY REACHES HER LANGUAGE ────────────────────────────────────────────
//
// Faculty #7/#10 of the sweep, and the mechanism `turn-shape.ts` names in its own header as the one
// it does not have. Its finding and its gap arrive in the same breath: narrowing her output budget
// by her condition truncated a tool call and silenced her completely, three turns out of three, so
// brevity "has to come from choosing less to say, which is a different mechanism entirely."
//
// Until now `capacity.ts` had six dials and not one of them was linguistic. Being tired made her
// think in a smaller mind; it did not make her TALK tired. Same words, weary and bright.
describe("how long an arc she has in her", () => {
  const say = (text: string, arc?: number) => {
    const said: string[] = [];
    const v = createVoiceStream({
      speak: (t) => said.push(t),
      newUtteranceId: () => "u1",
      ...(arc === undefined ? {} : { arcWeight: () => arc }),
    });
    v.onEvent({ type: "text_chunk", content: text } as never);
    v.finalize();
    return said;
  };

  // Two sentences, the second long, with a clause break inside it.
  const TURN = "看了。渡轮那个我查过了，周六风小的话应该没问题，你要是想去我就去订。";

  it("worn through, she says it in shorter pieces — and says all of it", () => {
    const rested = say(TURN, LONGEST_ARC);
    const weary = say(TURN, SHORTEST_ARC);
    expect(weary.length, "being worn through did not shorten her units at all")
      .toBeGreaterThan(rested.length);
    // NOTHING IS CUT. This is the property that separates it from the truncation that silenced
    // her: the same words arrive, in a different rhythm.
    expect(weary.join("")).toBe(rested.join(""));
    expect(weary.join("")).toContain("订");
  });

  it("and with no body attached, every later unit still ends at a sentence — the old behaviour", () => {
    // Stated as the PROPERTY rather than as "equals the rested arc", which is not true and taught
    // me something: at 78 weight even a rested arc breaks a long Chinese sentence at its clause,
    // because an ordinary one runs 30-60 and this one is 90. Her longest arc is not "no limit",
    // it is a long breath, which is what a breath is.
    const said = say(TURN);
    for (const unit of said.slice(1)) {
      expect(unit.trim(), `"${unit}" does not end where a sentence ends`).toMatch(/[。！？…]$/u);
    }
  });

  it("the first unit is never shortened — it is the whole latency budget", () => {
    // The one place the old rule stands: opening sooner is the only way left to bring the first
    // audio forward without letting a different model speak for her.
    expect(say(TURN, SHORTEST_ARC)[0]).toBe(say(TURN, LONGEST_ARC)[0]);
  });

  it("and the dial is monotone in what she has left", () => {
    const arcs = [0, 0.25, 0.5, 0.75, 1].map((r) =>
      capacityFor({ phase: "rested", arousal: r * 2 - 1 }).arcWeight);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]).toBeGreaterThanOrEqual(arcs[i - 1]!);
    expect(capacityFor({ phase: "dormant", arousal: -1 }).arcWeight)
      .toBeLessThan(capacityFor({ phase: "rested", arousal: 1 }).arcWeight);
  });

  it("and the daemon hands her body to her voice, read fresh at every boundary", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon, "her voice does not know what she has in her")
      .toMatch(/arcWeight: \(\) => herCapacity\(\)\.arcWeight/u);
  });
});
