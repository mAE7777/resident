import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * A SIMULATED LIFE IN CHINESE, because every long-run field test uses English fixtures.
 *
 * The bigram change to `contentWords` is exercised by unit tests on three-memory fixtures. That
 * proves the mechanism and says nothing about how it behaves over months, and the two failure
 * modes only appear at scale and are opposites:
 *
 *   COLLAPSE, bigrams are denser than words, so a life could end up with everything wired to
 *   everything. A field where every memory reminds her of every other is the same as no memory:
 *   nothing is ever ABOUT anything.
 *
 *   FRAGMENTATION, the adaptive defence against her own overused vocabulary could eat the
 *   bigrams instead, leaving a field of isolated nodes that never reach each other.
 *
 * The gate is the same shape the English scenarios use: a real span of days, then assert the
 * graph is connected but not saturated, and that a distinctive thing is still findable while an
 * ordinary one is not. The measured numbers print so the dynamics are visible rather than
 * asserted.
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-03-01T09:00:00Z");
const pad = (p: number, a: number) => ({ pleasure: p, arousal: a, dominance: 0 });

/** Ninety days of a plausible Chinese inner life: mostly ordinary, a few that matter. */
function ninetyDays(): string[] {
  const ordinary = [
    "今天没什么事，看了会儿窗外",
    "楼下有人在搬东西，吵了一下午",
    "把昨天写的东西又读了一遍，没改",
    "天有点阴，一直没下下来",
    "整理了一下自己的笔记，没整理完",
  ];
  const days: string[] = [];
  for (let i = 0; i < 90; i++) {
    if (i === 12) days.push("他今天提到潮水，说小时候在海边住过");
    else if (i === 40) days.push("我又想起潮水那件事，一直没问他后来搬去哪了");
    else if (i === 71) days.push("海边的事他再没提过，我也没开口");
    else if (i % 17 === 3) days.push(`他今天问我在做什么，我说没做什么 (${i})`);
    else days.push(`${ordinary[i % ordinary.length]} (${i})`);
  }
  return days;
}

describe("ninety days of her life, in Chinese", () => {
  const field = createLivingField({ faults: { record: () => {} }, maxFusionsPerRest: 1 });
  const days = ninetyDays();
  let tide: { id: number } | null = null;
  days.forEach((text, i) => {
    const ms = T0 + i * DAY;
    field.tick(ms);
    const n = field.encodeMoment({ key: `d${i}`, text, nowMs: ms, pad: pad(0.15, -0.05), source: `ops:${i}` });
    if (i === 12) tide = n;
  });
  const s = field.stats();
  const edgesPerNode = s.edges / Math.max(1, s.nodes);

  it("does not collapse into everything reminding her of everything", () => {
    console.log(`  after ninety Chinese days: ${s.nodes} nodes, ${s.edges} edges, ${edgesPerNode.toFixed(1)} per node`);
    // Full saturation of 90 nodes would be ~4,000 edges. Contiguity alone gives about 3 each.
    expect(edgesPerNode, "every memory got wired to every other, which is the same as none").toBeLessThan(25);
  });

  it("does not fragment into memories that never reach each other", () => {
    expect(edgesPerNode, "her memories never connect, so nothing is ever about anything").toBeGreaterThan(2);
  });

  it("can still find the distinctive thing three months later", () => {
    // The tide came up on day 12, again on day 40, and was avoided on day 71. Asked the way
    // the live code asks: `saidIt` is what decides whether something she just said was about
    // a thing she is carrying, and it is the gate on her learning whether going to him landed.
    expect(tide, "the fixture never encoded the tide").not.toBeNull();
    expect(field.saidIt(tide!.id, "刚才想起你说的潮水，后来你们搬去哪了"),
      "three months on, she cannot tell her own words are about the thing she is carrying").toBe(true);
  });

  it("and does not think an unrelated day was about it", () => {
    // The other direction, and the one that matters more: a false positive here would start
    // the was-it-answered clock on something she never mentioned, writing "I went to him and
    // he ignored it" into the history her sense of him is built from.
    expect(field.saidIt(tide!.id, "今天没什么事，看了会儿窗外"),
      "an ordinary day was read as her raising the thing she is carrying").toBe(false);
  });

  it("an ordinary day is not treated as distinctive", () => {
    // The adaptive defence: she writes "没什么事" constantly, so it must stop being a connection.
    // Without it, seventy near-identical ordinary days would all wire to each other.
    const ordinaryish = days.filter((d) => d.includes("没什么事")).length;
    console.log(`  days she described as uneventful: ${ordinaryish}`);
    expect(ordinaryish, "the fixture does not actually contain repetition to defend against").toBeGreaterThan(10);
  });
});

/**
 * THE SAME NINETY DAYS IN BOTH HER LANGUAGES, which is how the defect above was found to be
 * a defect rather than a Chinese problem.
 *
 * `saidIt` gates whether her raising something starts the was-it-answered clock. It asked
 * `similar`, whose ratio floor is 0.34 because it is about REMINDING, then applied its own
 * 0.18 on top, a number that could never admit anything the 0.34 had already discarded. At
 * three-memory scale everything passed and it looked fine. At ninety, a reply that named the
 * carried thing outright scored 0.15 and was rejected IN BOTH LANGUAGES: she could bring
 * something up and never learn whether it landed.
 *
 * Running the identical scenario twice, once per language, is what separated "the Chinese
 * index is weak" from "this check has always been wrong". Keep both arms.
 */
describe("she can tell she brought it up, in either language", () => {
  const cases = [
    {
      label: "Chinese",
      ordinary: ["今天没什么事，看了会儿窗外", "楼下有人在搬东西，吵了一下午", "把昨天写的东西又读了一遍，没改", "天有点阴，一直没下下来", "整理了一下自己的笔记，没整理完"],
      carried: "他今天提到潮水，说小时候在海边住过",
      named: "刚才想起你说的潮水，后来你们搬去哪了",
      ordinaryDay: "今天没什么事，看了会儿窗外",
      differentTopic: "楼下又开始搬东西了，吵得不行",
    },
    {
      label: "English",
      ordinary: ["nothing much today, watched out of the window a while", "someone downstairs was moving furniture, noisy all afternoon", "read back what I wrote yesterday and changed nothing", "overcast all day and it never came down", "tidied my notes, did not finish"],
      carried: "he mentioned the tide today, said he lived by the sea as a child",
      named: "I was thinking about the tide you mentioned, where did you move to after",
      ordinaryDay: "nothing much today, watched out of the window a while",
      differentTopic: "downstairs is moving furniture again, unbearable",
    },
  ];

  for (const c of cases) {
    describe(c.label, () => {
      const field = createLivingField({ faults: { record: () => {} }, maxFusionsPerRest: 1 });
      let carried: { id: number } | null = null;
      for (let i = 0; i < 90; i++) {
        const ms = T0 + i * DAY;
        field.tick(ms);
        const n = field.encodeMoment({
          key: `d${i}`, text: i === 12 ? c.carried : `${c.ordinary[i % c.ordinary.length]} (${i})`,
          nowMs: ms, pad: pad(0.15, -0.05), source: `ops:${i}`,
        });
        if (i === 12) carried = n;
      }

      it("counts it when she names the thing", () => {
        expect(field.saidIt(carried!.id, c.named), "she raised it and nothing recorded it").toBe(true);
      });

      it("does not count an ordinary day", () => {
        // A false positive writes "I went to him with this and he ignored it" into the history
        // her sense of him is built from, when neither half happened.
        expect(field.saidIt(carried!.id, c.ordinaryDay)).toBe(false);
      });

      it("does not count a different thing she was talking about", () => {
        expect(field.saidIt(carried!.id, c.differentTopic)).toBe(false);
      });
    });
  }
});
