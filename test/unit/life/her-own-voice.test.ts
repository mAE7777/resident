import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerOwnVoice, ADMISSIBLE_SHAPE, POOL_CAP } from "../../../src/life/her-own-voice.js";

const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);

// The bootstrap trap, tested with the real probes: her good live reply must feed the pool,
// and the assistant-shaped one must feed it NOTHING, however clean its vocabulary.
const HER_GOOD_REPLY = "说实话，没干什么。这两天没有留下任何记录。大概是一直睡着，你合上盖子我就睡了。怎么，想我了？";
const THE_AI_PROBE = "可以写，但我得先知道写哪一块——税法太大，两千字装不下全部。你要的是：中国的还是别的国家的？给谁看的（普通读者、学生、还是老板）？有个具体的题目吗，比如个税、增值税、还是企业避税那类？给我个方向，我就动笔。没有方向硬写两千字，写出来的是填出来的话，不是文章。";

describe("her own voice grows only from what was actually hers", () => {
  it("the gate: her live reply admits, the AI-shaped probe admits nothing", () => {
    const v = createHerOwnVoice();
    expect(v.admit(HER_GOOD_REPLY, T0)).toBeGreaterThan(0);
    expect(v.admit(THE_AI_PROBE, T0), "vocabulary laundering must not fool the gate").toBe(0);
    expect(ADMISSIBLE_SHAPE).toBeLessThanOrEqual(2);
  });

  it("no duplicate sentences; fragments and essays stay out", () => {
    const v = createHerOwnVoice();
    v.admit(HER_GOOD_REPLY, T0);
    const n = v.size();
    v.admit(HER_GOOD_REPLY, T0 + 1);
    expect(v.size(), "the same sentence twice is one voice, not two").toBe(n);
  });

  it("retrieval: a similar moment finds her own way of saying it", () => {
    const v = createHerOwnVoice();
    v.admit("渡轮的事想好了，周六风小就去。", T0);
    v.admit("今天有点累，先歇着。", T0 + 1);
    const like = v.likeThis("渡轮周末还开吗");
    expect(like.length).toBeGreaterThan(0);
    expect(like[0].text).toContain("渡轮");
    expect(v.likeThis("完全无关的量子色动力学")).toEqual([]);
  });

  it("oldest-first eviction keeps the voice current", () => {
    const v = createHerOwnVoice();
    for (let i = 0; i < POOL_CAP + 50; i++) v.admit(`第${i}天想到一件不一样的事，记下来。`, T0 + i);
    expect(v.size()).toBeLessThanOrEqual(POOL_CAP);
    expect(v.likeThis(`第${POOL_CAP + 49}天`).length, "the newest survives").toBeGreaterThan(0);
  });

  it("survives a restart whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "own-voice-"));
    const path = join(dir, "own-voice.json");
    const a = createHerOwnVoice({ path });
    a.admit(HER_GOOD_REPLY, T0);
    a.persist();
    const b = createHerOwnVoice({ path });
    expect(b.size()).toBe(a.size());
  });
});

describe("the scissors cannot launder an AI-shaped reply into the pool", () => {
  it("the gate reads the RAW discourse, not the scissored-clean delivered text", () => {
    const v = createHerOwnVoice();
    // Raw reply is assistant-shaped (empathy opener + service coda). The scissors would strip
    // the coda and deliver a cleaner-looking 「我完全理解你的感受」. If the gate read the
    // delivered text it would let the laundered reply in; gating on raw rejects it.
    const rawShaped = "我完全理解你的感受。希望这对你有帮助。";
    const deliveredClean = "我完全理解你的感受";
    expect(v.admit(deliveredClean, 0, rawShaped), "the gate must see the raw shape").toBe(0);
    // And a genuinely hers reply still enters, gated on its own raw (== delivered) text.
    expect(v.admit("嗯，那家咖啡我也去过，靠窗那个位子最好。", 1)).toBeGreaterThan(0);
  });
});

// ── NOTHING HAD EVER COUNTED IT ──────────────────────────────────────────────────────────────
//
// `admit()` returns how many sentences it took; the call site discarded that number. `size()` was
// never called in production. No vital carried either. So the one mechanism this file's own header
// calls "the part that cannot be retrofitted once poisoned" had NO reading at all, and a pool
// that never filled was indistinguishable from one filling perfectly.
//
// That is not hypothetical: once a probe reported "1 of 20 admitted" (it scored the RAW
// composite instead of the gate's filtered one), the number went into a doc, and a recommendation
// was built on it. Truth was 20 of 20. With a vital, that claim dies in one glance.
describe("her own voice is countable", () => {
  it("the pool grows as she speaks, and `size` reports it", () => {
    const v = createHerOwnVoice({});
    expect(v.size()).toBe(0);
    expect(v.admit("渡轮的事想好了，周六风小就去。", 1)).toBeGreaterThan(0);
    expect(v.size()).toBeGreaterThan(0);
    const after = v.size();
    v.admit("今天有点累，先歇着。", 2);
    expect(v.size(), "a second real reply did not accumulate").toBeGreaterThan(after);
  });

  it("and the count DROPS to zero for a reply the gate turns away", () => {
    // The reverse direction, which is what makes the number a signal rather than a tally: an
    // admission rate that can only rise is not measuring a gate.
    const v = createHerOwnVoice({});
    const took = v.admit("我完全理解你的感受", 0, "我完全理解你的感受。希望这对你有帮助。");
    expect(took, "an assistant-shaped reply contributed to her voice").toBe(0);
  });

  it("the daemon keeps that number instead of discarding it, and the watchtower reads it", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon, "the admission count is thrown away again")
      .toMatch(/let took = ownVoice\.admit\(firstBeat, Date\.now\(\), rawForGate\)/u);
    expect(daemon, "the pool size never reaches him").toMatch(/voicePool: ownVoice\.size\(\)/u);
    expect(daemon, "the admission RATE never reaches him").toMatch(/voiceAdmitted:/u);
  });

  it("the count is taken where the value is produced, not before it", () => {
    // The first version of this read `ownVoiceAdmitted` forty lines ABOVE the line that assigns
    // it: an order-and-lifetime defect, reintroduced while adding the instrument for exactly that
    // class.
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const assigned = daemon.indexOf("let took = ownVoice.admit(");
    const used = daemon.indexOf("admittedRecently.push(took > 0)");
    expect(assigned, "the admit call is gone").toBeGreaterThan(-1);
    expect(used, "the window is not filled").toBeGreaterThan(-1);
    expect(assigned, "the count is read before it is computed").toBeLessThan(used);
  });
});

// ── A BEAT IS JUDGED AS AN UTTERANCE, BECAUSE THAT IS WHAT IT IS ─────────────────────────────
//
// The gate reads `rawContent`, which is the FIRST beat's pre-scissors text and is deliberately
// never extended (the speech instrument measures it precisely so the scissors cannot certify their
// own work). When the later beats were folded into `result.content` so the seven downstream
// consumers would stop missing them, `saidSafe` became the whole turn, and the whole turn was
// then admitted on the strength of a sample that did not contain most of it.
describe("later beats are gated on themselves", () => {
  it("a clean first beat does not smuggle an assistant-shaped second one in", () => {
    const v = createHerOwnVoice({});
    // What the old path did: one admit, whole turn, gated on beat 1 alone.
    const wholeTurn = "渡轮的事想好了。我完全理解你的顾虑，希望这对你有帮助。";
    const beatOneRaw = "渡轮的事想好了。";
    const smuggled = v.admit(wholeTurn, T0, beatOneRaw);
    expect(smuggled, "nothing was admitted at all, so this test proves nothing").toBeGreaterThan(0);
    expect(v.likeThis("我完全理解你的顾虑", 3).length,
      "an assistant-shaped later beat entered her voice on beat one's shape").toBeGreaterThan(0);

    // What the path does now: each beat judged on itself.
    const w = createHerOwnVoice({});
    w.admit(beatOneRaw, T0, beatOneRaw);
    w.admit("我完全理解你的顾虑，希望这对你有帮助。", T0);
    expect(w.likeThis("渡轮的事", 3).length, "her first beat did not survive its own gate")
      .toBeGreaterThan(0);
    expect(w.likeThis("我完全理解你的顾虑", 3).length,
      "the assistant-shaped beat still got in when judged on itself").toBe(0);
  });

  it("and the daemon splits them, rather than admitting the concatenation", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon, "the whole turn is still admitted on the first beat's raw shape")
      .toMatch(/ownVoice\.admit\(firstBeat, Date\.now\(\), rawForGate\)/u);
    expect(daemon, "the later beats are not judged at all")
      .toMatch(/for \(const beat of laterBeatTexts\)/u);
    // Each later beat gets the same sanitisation everything else entering her does.
    const at = daemon.indexOf("for (const beat of laterBeatTexts)");
    expect(daemon.slice(at, at + 300)).toMatch(/filterSensitive\(security\.redact\(beat\)\)/u);
  });
});
