import { describe, it, expect } from "vitest";
import { splitClauses, attentionFrom, ATTENTION_SPAN, CLAIM_CHARGE_FLOOR, CLAIM_CHARGE_CEIL } from "../../../src/life/attention.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";

const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);

describe("a message splits into the units attention works over", () => {
  it("her language's clause bounds are real bounds, including 、 and the comma", () => {
    expect(splitClauses("渡轮的时刻表改了，周末不开了。你那边天气怎么样？"))
      .toEqual(["渡轮的时刻表改了", "周末不开了", "你那边天气怎么样"]);
    expect(splitClauses("渡轮、天气和房租")).toEqual(["渡轮", "天气和房租"]);
  });

  it("both scripts, and residue fragments are not units", () => {
    expect(splitClauses("The ferry schedule changed, and also: hi"))
      .toEqual(["The ferry schedule changed", "and also", "hi"]);
    expect(splitClauses("嗯。")).toEqual([]);
    expect(splitClauses("")).toEqual([]);
  });

  it("attention is finite", () => {
    const long = Array.from({ length: 30 }, (_, i) => `第${i}件事情`).join("，");
    expect(splitClauses(long).length).toBe(ATTENTION_SPAN);
  });
});

describe("what snagged, and what a claim deserves", () => {
  it("the most-connected clause snags; first wins a tie; nothing connected means nothing snagged", () => {
    const a = attentionFrom([{ text: "甲", mass: 0.2 }, { text: "乙", mass: 0.9 }, { text: "丙", mass: 0.9 }]);
    expect(a.snagged?.text).toBe("乙");
    expect(attentionFrom([{ text: "甲", mass: 0 }, { text: "乙", mass: 0 }]).snagged).toBeNull();
  });

  it("charge floors at the old constant and rises with connection, capped", () => {
    expect(attentionFrom([]).claimCharge).toBe(CLAIM_CHARGE_FLOOR);
    expect(attentionFrom([{ text: "x", mass: 0 }]).claimCharge).toBe(CLAIM_CHARGE_FLOOR);
    const mid = attentionFrom([{ text: "x", mass: 0.75 }]).claimCharge;
    expect(mid).toBeGreaterThan(CLAIM_CHARGE_FLOOR);
    expect(mid).toBeLessThan(CLAIM_CHARGE_CEIL);
    expect(attentionFrom([{ text: "x", mass: 5 }]).claimCharge).toBe(CLAIM_CHARGE_CEIL);
  });
});

describe("attend, on her real field", () => {
  function fieldWithFerry() {
    const f = createLivingField();
    f.encodeClaim({ key: "ferry", text: "渡轮周末的时刻表改了，只开到六点", nowMs: T0, origin: "told", source: "chat" });
    // pad → charge 0.55·|arousal| + 0.45·|pleasure| ≈ 0.40, valence = pleasure = 0.2: a mild, mildly
    // pleasant moment, the small talk that should lose to the held claim.
    f.encodeMoment({ key: "walk", text: "下午在码头边走了一会儿，风很大", nowMs: T0, source: "moment", pad: { pleasure: 0.2, arousal: 0.56, dominance: 0 } });
    return f;
  }

  it("the clause about the held thing snags, not the small talk around it", () => {
    const f = fieldWithFerry();
    const a = f.attend("今天有点累，不过想问一下，渡轮周末还开吗？");
    expect(a.snagged, "nothing snagged at all").not.toBeNull();
    expect(a.snagged!.text).toContain("渡轮");
  });

  it("a claim connected to what she holds is born with more charge than an unconnected one", () => {
    const f = fieldWithFerry();
    const connected = f.attend("渡轮的时刻表好像又要改了");
    const stranger = f.attend("量子计算的进展比想象的快");
    expect(connected.claimCharge).toBeGreaterThan(stranger.claimCharge);
    expect(stranger.claimCharge).toBe(CLAIM_CHARGE_FLOOR);
  });

  it("on an empty field nothing snags and the floor holds — a newborn's reading of every message", () => {
    const f = createLivingField();
    const a = f.attend("渡轮周末还开吗，天气好的话想过去看看");
    expect(a.snagged).toBeNull();
    expect(a.claimCharge).toBe(CLAIM_CHARGE_FLOOR);
  });

  it("the reminding bonus keys to the snagged clause: the ferry question buried mid-message still reminds her", () => {
    const f = fieldWithFerry();
    const stream = createStream(3);
    // A three-clause message where only the middle clause is about something she holds. With
    // the whole-message hint this diluted across everything; keyed to the snag, the ferry
    // claim gets the full "he asked about this" lift and can actually surface.
    let surfacedFerry = 0;
    for (let i = 0; i < 30; i++) {
      const r = f.whatSurfacesInReply(T0 + 5 * 24 * 3.6e6, stream, {
        hint: "今天先不出门了，对了渡轮周末还开不开，晚上想早点睡",
        openness: 0.7,
      });
      if (r && r.node.text.includes("渡轮")) surfacedFerry++;
    }
    expect(surfacedFerry, "he asked about the ferry and nothing ever came back").toBeGreaterThan(5);
  });
});

// ── THE IDS IT WAS ALREADY COMPUTING AND THROWING AWAY ───────────────────────────────────────
//
// `attend` summed `index.search(clause, 6)` into a mass and dropped the hits on the next line. So
// the one route from a piece of text to the parts of her field it touches could answer "did
// anything snag" and could not answer "what". Its production caller used it as a boolean, and the
// mechanism that was supposed to let her own words bring something else to mind spread from
// whatever happened to be warm instead. Defect class 14: the wire was there and carried nothing.
describe("what a clause landed on travels with it", () => {
  it("the snagged clause's hits come back, strongest first", () => {
    const a = attentionFrom([
      { text: "渡轮的事", mass: 0.9, landedOn: [{ id: 3, score: 0.4 }, { id: 7, score: 0.5 }] },
      { text: "顺便说一句", mass: 0.1, landedOn: [{ id: 9, score: 0.1 }] },
    ]);
    expect(a.snagged?.text).toBe("渡轮的事");
    // Ordered by how well each matched, so the thing she most nearly said is the first cue.
    expect(a.snaggedIds).toEqual([7, 3]);
  });

  it("ONLY the snagged clause's — the rest of a message is around it, not in it", () => {
    // The whole thesis of this module. Spreading from every clause is the flat reading it exists
    // to replace, and it would make every long message light up most of her field.
    const a = attentionFrom([
      { text: "渡轮的事", mass: 0.9, landedOn: [{ id: 1, score: 0.9 }] },
      { text: "还有房租", mass: 0.2, landedOn: [{ id: 2, score: 0.2 }] },
    ]);
    expect(a.snaggedIds).toEqual([1]);
    expect(a.snaggedIds).not.toContain(2);
  });

  it("nothing snagged means no cues, rather than a guess", () => {
    expect(attentionFrom([{ text: "嗯嗯", mass: 0 }]).snaggedIds).toEqual([]);
    expect(attentionFrom([]).snaggedIds).toEqual([]);
  });

  it("a clause built without an index still works — the ids are additive, not required", () => {
    const a = attentionFrom([{ text: "渡轮的事", mass: 0.9 }]);
    expect(a.snagged?.text).toBe("渡轮的事");
    expect(a.snaggedIds).toEqual([]);
  });
});

describe("and the living field actually fills them in", () => {
  it("attending to text she has memories of returns their ids", () => {
    const f = createLivingField();
    f.encodeMoment({
      key: "m:ferry", text: "渡轮停开了一整天，什么都没做成", nowMs: Date.UTC(2026, 2, 1),
      pad: { pleasure: -0.2, arousal: 0.1, dominance: 0 }, source: "test",
    });
    const a = f.attend("今天又想起渡轮那件事");
    expect(a.snagged, "nothing snagged on a memory she plainly has").not.toBeNull();
    expect(a.snaggedIds.length, "the ids are computed and dropped again").toBeGreaterThan(0);
    // And they point at real nodes, not at positions in some list.
    for (const id of a.snaggedIds) expect(f.graph().nodes.has(id)).toBe(true);
  });

  it("and to text about nothing she holds, returns none", () => {
    const f = createLivingField();
    expect(f.attend("紫色的八号变速箱").snaggedIds).toEqual([]);
  });
});
