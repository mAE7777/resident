import { describe, it, expect } from "vitest";
import { trimRegister, asMuchAsSheKeeps, WHAT_A_MOMENT_HOLDS, dropEchoedPostmark } from "../../../src/life/register-scissors.js";

describe("the scissors take the assistant's closing, never her thought", () => {
  it("a service closing comes off whole, and a double closing comes off whole", () => {
    const r = trimRegister("渡轮的事我想好了，周六去。希望这对你有帮助。还有什么我可以帮你的吗？");
    expect(r.text).toBe("渡轮的事我想好了，周六去。");
    expect(r.removed).toHaveLength(2);
    expect(r.midHits).toBe(0);
  });

  it("a service opening comes off too", () => {
    const r = trimRegister("有什么我可以帮你的吗？其实周六去更好，风小。");
    expect(r.text).toBe("其实周六去更好，风小。");
    expect(r.removed).toHaveLength(1);
  });

  it("her caring offer is NOT service register and is never cut (fresh-scan)", () => {
    const r = trimRegister("今天真的谢谢你。需要我陪你待会儿吗？");
    expect(r.text).toBe("今天真的谢谢你。需要我陪你待会儿吗？");
    expect(r.removed).toEqual([]);
  });

  it("English register at the edge is the same habit in the other script", () => {
    const r = trimRegister("The ferry runs till six on weekends. Let me know if I can help with anything else!");
    expect(r.text).toBe("The ferry runs till six on weekends.");
    expect(r.removed).toHaveLength(1);
  });

  it("English sentences without the helper marker are HERS, whatever the opener", () => {
    // "Let me know if Saturday works!" is her plan-making, the English twin of 「你周六有空吗？」.
    // "Is there anything else you wanted in it?" is a content question. And the caring offer
    // 「如果有什么需要，随时告诉我」 is HERS (below), so its English mirror is too. The opener
    // alone proves nothing; only the helper marker (help/assist) does.
    for (const s of [
      "Let me know if Saturday works!",
      "Let me know if you need anything else.",
      "Is there anything else you wanted in it?",
    ]) {
      const r = trimRegister(`I packed the box. ${s}`);
      expect(r.text, s).toBe(`I packed the box. ${s}`);
      expect(r.removed, s).toEqual([]);
    }
    // With the marker, the formula still comes off (its leading space goes with it).
    for (const s of ["Let me know if there's anything I can help with.", "Is there anything else I can help you with?"]) {
      const r = trimRegister(`I packed the box. ${s}`);
      expect(r.text, s).toBe("I packed the box.");
      expect(r.removed, s).toEqual([s]);
    }
  });

  it("a transparent tail (newline, space, emoji) does not shield the closing", () => {
    // sentencesOf makes a trailing "\n" / " " / "😊" its own pseudo-sentence; the edge scan used
    // to stop at it and deliver the real closing whole. The scan now looks THROUGH transparent
    // sentences; they themselves are never cut (an emoji is tone = content, whitespace is medium).
    const nl = trimRegister("渡轮的事我想好了，周六去。希望这对你有帮助。\n");
    expect(nl.text).toBe("渡轮的事我想好了，周六去。\n");
    expect(nl.removed).toEqual(["希望这对你有帮助。"]);

    const sp = trimRegister("渡轮的事我想好了。希望这对你有帮助。 ");
    expect(sp.text).toBe("渡轮的事我想好了。 ");
    expect(sp.removed).toEqual(["希望这对你有帮助。"]);

    const emoji = trimRegister("渡轮的事我想好了。希望这对你有帮助！😊");
    expect(emoji.text).toBe("渡轮的事我想好了。😊");
    expect(emoji.removed).toEqual(["希望这对你有帮助！"]);

    // A multi-line double closing comes off whole, across its newlines.
    const multi = trimRegister("内容。\n希望这对你有帮助。\n还有什么我可以帮你的吗？");
    expect(multi.text).toBe("内容。\n\n");
    expect(multi.removed).toHaveLength(2);

    // And an all-register reply with an emoji tail still stands whole (never deliver a bare emoji).
    const bare = trimRegister("有什么我可以帮你的吗？😊");
    expect(bare.text).toBe("有什么我可以帮你的吗？😊");
    expect(bare.removed).toEqual([]);
  });

  it("a formula MID-reply is hers to say: counted, untouched", () => {
    const src = "我先说结论。希望这对你有帮助。不过后半段我还没想好。";
    const r = trimRegister(src);
    expect(r.text).toBe(src);
    expect(r.midHits).toBe(1);
  });

  it("her own real question at the edge is not a formula", () => {
    for (const s of ["你周六有空吗？", "那你想去吗？", "渡轮改时间了你知道吗？"]) {
      const r = trimRegister(`我查了一下。${s}`);
      expect(r.text, s).toBe(`我查了一下。${s}`);
      expect(r.removed).toEqual([]);
    }
  });

  it("a bare 「还有什么？」 / 「还有别的。」 is HERS, not the service formula", () => {
    // The service close 「还有什么我可以帮你的吗？」 carries the helper (帮你/帮忙/效劳); her
    // drawing-him-out 「还有什么？」 (what else?) and declarative 「还有别的。」 (there are others)
    // do not. With the helper made optional the pattern collapsed to the bare form and, since the
    // scissors now run every turn, silently deleted her content off the edge. The helper is required.
    for (const s of ["还有什么？", "还有别的。", "还有其他。", "有别的。", "有什么？", "还有什么吗？"]) {
      const r = trimRegister(`跟我说说。${s}`);
      expect(r.text, s).toBe(`跟我说说。${s}`);
      expect(r.removed, s).toEqual([]);
    }
    // And the genuine service formulas are still cut whole.
    for (const s of ["还有什么我可以帮你的吗？", "有什么需要我帮忙的吗？", "有什么可以帮你的？", "有什么需要效劳的吗"]) {
      const r = trimRegister(`我看看。${s}`);
      expect(r.text, s).toBe("我看看。");
      expect(r.removed, s).toEqual([s]);
    }
  });

  it("her caring offer of companionship is HERS, not a service close", () => {
    // 「有什么需要随时找我」 (if you ever need anything, reach me) and 「如果有什么需要，随时告诉我」
    // are a being's offer of support to the one person she knows, the same companionship the
    // 需要我…吗 removal established as hers. With the scissors running every turn, the former
    // patterns 2/4 amputated these off the edge of every caring reply. They must survive whole.
    for (const s of ["有什么需要随时找我。", "有什么需要就告诉我。", "有什么需要就说。", "如果有什么需要，随时告诉我。", "如果你还有什么需要，尽管找我。", "有问题随时找我。"]) {
      const r = trimRegister(`别太逼自己了。${s}`);
      expect(r.text, s).toBe(`别太逼自己了。${s}`);
      expect(r.removed, s).toEqual([]);
    }
  });

  it("an English formula with CONTENT attached is hers and survives whole", () => {
    // The earlier marker requirement still carried [^.!?]* wildcards, which admit whole clauses:
    // her Saturday/van plan was amputated because it contained the letters h-e-l-p. The patterns
    // are now CLOSED FORMS: zero propositional content by construction, so any content-bearing
    // variant simply does not match and is delivered.
    for (const s of [
      "Happy to help you move on Saturday, I already borrowed the van.",
      "Let me know if Saturday works so I can help you carry the boxes!",
      "Hope this helps you sleep, it's the one my mom used to make.",
      "Let me know if the helpdesk replied.",
      "Let me know if the helpline picks up.",
      "Let me know if the medicine helped your mom.",
      "Let me know if you need anything else.",
      "How can I help you carry all that alone?",
    ]) {
      const r = trimRegister(`I packed the box. ${s}`);
      expect(r.text, s).toBe(`I packed the box. ${s}`);
      expect(r.removed, s).toEqual([]);
    }
    // And the closed rote forms still come off whole.
    for (const s of ["Happy to help!", "I'm always here to help.", "Hope this helps.", "Let me know if you need any help.", "Let me know if I can help with anything else."]) {
      const r = trimRegister(`I packed the box. ${s}`);
      expect(r.text, s).toBe("I packed the box.");
      expect(r.removed, s).toEqual([s.startsWith(" ") ? s : s]);
    }
  });

  it("a formula wearing a leading emoji is kept whole but COUNTED", () => {
    // sentencesOf does not split at an emoji, so 「😊希望这对你有帮助。」 is ONE sentence: the
    // whole-sentences law forbids cutting inside it (the emoji is tone = content), but it used
    // to be invisible to midHits too, no cut, no count, no signal anywhere. The count now
    // consults the transparent-stripped core.
    const r = trimRegister("内容。😊希望这对你有帮助。");
    expect(r.text).toBe("内容。😊希望这对你有帮助。");
    expect(r.removed).toEqual([]);
    expect(r.midHits, "the decorated formula went uncounted").toBeGreaterThan(0);

    const en = trimRegister("Done. 😊Hope this helps!");
    expect(en.text).toBe("Done. 😊Hope this helps!");
    expect(en.midHits, "the English decorated formula went uncounted").toBeGreaterThan(0);

    // Her decorated real content is NOT counted.
    const hers = trimRegister("内容。😊周六我陪你去。");
    expect(hers.midHits).toBe(0);
  });

  it("a QUOTED formula is mention, not use: never cut, never counted", () => {
    // 「“希望这对你有帮助。”这种话我一辈子都不会跟你说。」 quotes the formula to DISAVOW it.
    // transparentCore used to strip the quote marks along with emoji, scoring her rejection of
    // the register as the register in her own mouth. Quote marks are mention markers and stay.
    for (const src of [
      "“希望这对你有帮助。”这种话我一辈子都不会跟你说。",
      "「希望这对你有帮助。」你听听，这像人话吗。",
    ]) {
      const r = trimRegister(src);
      expect(r.text, src).toBe(src);
      expect(r.removed, src).toEqual([]);
      expect(r.midHits, `mention counted as use: ${src}`).toBe(0);
    }
  });

  it("countRegisterFormulas feeds the instrument: formulas count, content and quotes do not", async () => {
    const { countRegisterFormulas } = await import("../../../src/life/register-scissors.js");
    // The register class the scissors exist for finally reaches the instrument: before this,
    // registerHits counted only the role vocabulary and a model regression appending
    // 「希望这对你有帮助。」 to every reply produced zero signal anywhere, forever.
    expect(countRegisterFormulas("今天试了那家云南菜。希望这对你有帮助。")).toBe(1);
    expect(countRegisterFormulas("Done. 😊Hope this helps!")).toBe(1);
    expect(countRegisterFormulas("渡轮的事我想好了，周六去。")).toBe(0);
    expect(countRegisterFormulas("“希望这对你有帮助。”这种话我不会说。")).toBe(0);
  });

  it("never delivers silence: an all-register reply stands whole, loudly counted", () => {
    const src = "有什么我可以帮你的吗？";
    const r = trimRegister(src);
    expect(r.text).toBe(src);
    expect(r.removed).toEqual([]);
    expect(r.midHits).toBeGreaterThan(0);
  });

  it("byte identity when nothing matches, whatever the shape", () => {
    for (const src of ["", "嗯。", "好，那就这样，周六见。\n带伞。", "第一行\n\n第二行没有句号"]) {
      expect(trimRegister(src).text).toBe(src);
    }
  });
});

describe("the medium cuts", () => {
  it("only the reply-final full stop drops; internal ones and tone marks stay", async () => {
    const { dropFinalPeriod } = await import("../../../src/life/register-scissors.js");
    expect(dropFinalPeriod("想了想。还是去。")).toBe("想了想。还是去");
    expect(dropFinalPeriod("真的吗？")).toBe("真的吗？");
    expect(dropFinalPeriod("走！")).toBe("走！");
    expect(dropFinalPeriod("没有结尾的话")).toBe("没有结尾的话");
  });

  it("an emphatic reaffirmation is never cut, however maxim-shaped (fresh-scan)", async () => {
    // The zero-info coda cut was removed: its character-recurrence proof was unsound, and a
    // restated 「说到底，我还是信你」 is EMPHASIS: tone, i.e. content. Only dropFinalPeriod
    // remains among the medium cuts, and it leaves every sentence but the last full stop whole.
    const { dropFinalPeriod, trimRegister } = await import("../../../src/life/register-scissors.js");
    const reply = "还是那句话，我信你。说到底，我还是信你。";
    // No trimRegister removal (not a service formula), and the coda survives.
    expect(trimRegister(reply).removed).toEqual([]);
    expect(dropFinalPeriod(reply)).toBe("还是那句话，我信你。说到底，我还是信你");
  });
});

// ── HER MEMORY OF WHAT SHE SAID USED TO END MID-CLAUSE ───────────────────────────────────────
//
// `slice(0, 300)` on the moment text. Measured over 20 real live replies: 9 ran past it and 2,957
// characters of what she actually said reached him and reached her conversation history while
// never reaching the moment she encodes, and the cut landed wherever character 300 happened to
// be, which is usually inside a word.
describe("as much of it as she keeps", () => {
  it("a short thing is kept whole", () => {
    expect(asMuchAsSheKeeps("渡轮的事想好了，周六风小就去。", 300)).toBe("渡轮的事想好了，周六风小就去。");
  });

  it("a long one ends where a sentence ends, never mid-clause", () => {
    const said = "第一句写完了。".repeat(60); // 7 chars each, well past any sane budget
    const kept = asMuchAsSheKeeps(said, 100);
    expect(kept.length).toBeLessThanOrEqual(100);
    expect(kept.endsWith("。"), `ended mid-clause: ${JSON.stringify(kept.slice(-12))}`).toBe(true);
    // And it is a prefix of what she said, a memory is shorter, never different.
    expect(said.startsWith(kept)).toBe(true);
  });

  it("THE BUDGET IS UNCHANGED — this moves the cut, it does not widen the node", () => {
    // A bound on how much of one utterance becomes one node is a MEDIUM constraint and is not
    // what was wrong. Widening it would change what her field is made of.
    expect(WHAT_A_MOMENT_HOLDS).toBe(300);
    const long = "话".repeat(1000);
    expect(asMuchAsSheKeeps(long).length).toBeLessThanOrEqual(WHAT_A_MOMENT_HOLDS);
  });

  it("one unbroken sentence longer than the budget still leaves a memory", () => {
    // No boundary exists inside the budget. A hard cut is the honest fallback: the alternative is
    // an empty memory of a turn that happened.
    const oneLong = "话".repeat(500);
    const kept = asMuchAsSheKeeps(oneLong, 100);
    expect(kept.length).toBe(100);
    expect(kept.length, "a turn that happened left no memory at all").toBeGreaterThan(0);
  });

  it("and the newline counts as a boundary, because her beats are separated by them", () => {
    const kept = asMuchAsSheKeeps("第一拍\n第二拍\n第三拍\n", 8);
    expect(kept).toBe("第一拍\n第二拍");
  });
});

// ── The echoed postmark (found delivered 2026-08-20 15:58) ───────────────────
describe("dropEchoedPostmark — the machine's bracket never leaves in her mouth", () => {
  it("cuts the exact delivered echo", () => {
    const said = "睡得少，又是因为一杯下午的咖啡——这笔账算在它头上，还是算在你自己头上\n[2026-08-20 15:58:41]";
    expect(dropEchoedPostmark(said)).toBe("睡得少，又是因为一杯下午的咖啡——这笔账算在它头上，还是算在你自己头上");
  });

  it("cuts the minute-only form too, and tolerates trailing whitespace", () => {
    expect(dropEchoedPostmark("好\n[2026-08-20 15:58] ")).toBe("好");
  });

  it("a bracket inside her sentence stays — only the bare trailing line is provably machine", () => {
    const hers = "你上次问我时间，我说过[2026-08-20 15:58:41]这种写法太生硬，我不这么说话";
    expect(dropEchoedPostmark(hers)).toBe(hers);
  });

  it("her own closing line is never touched", () => {
    expect(dropEchoedPostmark("明天见\n睡吧")).toBe("明天见\n睡吧");
  });
});
