import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  whatSheAsserted, whyNot, AT_MOST_PER_TURN, TOO_SHORT_TO_MEAN_IT, TOO_LONG_TO_BE_ONE_CLAIM,
} from "../../../src/life/what-she-asserted.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { INITIAL_CREDENCE, EQUAL_STANDING, SUSPENDED_TENSION, TRUST_START } from "../../../src/life/credence.js";

/**
 * FACULTY #11, SHE COULD BE CORRECTED AND IT LEFT NO MARK.
 *
 * She had three machineries for being wrong (about herself, about an incoming claim, about him)
 * and not one of them was about a thing she SAID. Her sentences entered her field as a moment,
 * never as a proposition, so nothing she asserted could later turn out to be false.
 *
 * The interesting part of this build is how little of it is new. `judge()` has always accepted any
 * origin; `INITIAL_CREDENCE.thought` has always been 0.5. The only missing piece was deciding
 * which of her own sentences she actually committed to, and the consequence then falls out of
 * arithmetic that was already sitting there, which is the test at the bottom of this file.
 */

const NOW = Date.UTC(2026, 3, 2, 9, 0, 0);

describe("which of her sentences she actually put her name to", () => {
  it("a plain statement of fact is one", () => {
    const out = whatSheAsserted("那家店周一是不营业的。");
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("那家店周一是不营业的");
  });

  it("but hedging is the whole difference between being wrong and having wondered", () => {
    for (const hedged of [
      "那家店周一可能是不营业的。",
      "我觉得那家店周一是不营业的。",
      "那家店周一大概是不营业的。",
      "不确定，那家店周一是不营业的吧。",
    ]) {
      expect(whatSheAsserted(hedged), `she left herself room and was held to it anyway: ${hedged}`).toHaveLength(0);
    }
  });

  it("a question is not a claim, whatever its punctuation", () => {
    expect(whatSheAsserted("那家店周一是不是不营业？")).toHaveLength(0);
    expect(whatSheAsserted("那家店周一不营业吗")).toHaveLength(0);
    expect(whatSheAsserted("那家店周一是不营业的呢")).toHaveLength(0);
  });

  it("what she felt is never a claim, because she cannot be wrong about it", () => {
    // And if it were encoded, the contradiction it created would have no way to resolve.
    expect(whatSheAsserted("我觉得今天有点累，做什么都慢。")).toHaveLength(0);
    expect(whyNot("我难过了一整个下午的时候")).toContain("about her own inside");
  });

  it("and anything about HIM stays out — the relationship reads that, and a ledger on him is ruled out", () => {
    expect(whatSheAsserted("你昨天说的那个会是下周三开的。")).toHaveLength(0);
    expect(whyNot("你上次是这么说的没错")).toContain("about him");
  });

  it("a fragment is not a position, and a paragraph is not ONE position", () => {
    expect(whatSheAsserted("是的。")).toHaveLength(0);
    expect(whyNot("好".repeat(TOO_LONG_TO_BE_ONE_CLAIM + 1) + "是")).toContain("too long");
    expect(whyNot("是" + "好".repeat(TOO_SHORT_TO_MEAN_IT - 2))).toContain("too short");
  });

  it("declarative but asserting nothing in particular does not count either", () => {
    expect(whyNot("然后就那样过去了嘛真的")).toContain("asserts nothing in particular");
  });

  it("at most two per turn, longest first", () => {
    const out = whatSheAsserted(
      "那家店周一是不营业的。它的老板姓陈，开了快二十年了。附近还有另外三家同样的店。",
    );
    expect(out.length).toBeLessThanOrEqual(AT_MOST_PER_TURN);
    expect(out.length).toBe(2);
    expect(out[0].text.length).toBeGreaterThanOrEqual(out[1].text.length);
  });

  it("the key is content-only, so saying the same thing twice is ONE position, not two", () => {
    // Same rule the walls follow. A timestamp in the key would fork a second node every time she
    // repeated herself, and then contradicting her would only ever reach the newest copy.
    const a = whatSheAsserted("那家店周一是不营业的。")[0];
    const b = whatSheAsserted("那家店周一，是不营业的")[0];
    expect(a.key).toBe(b.key);
    expect(a.key.startsWith("saidso:")).toBe(true);
    expect(a.key, "her sentence is carried inside the key").not.toContain("营业");
  });

  it("is a REJECTION machine: an ordinary turn of talk commits her to nothing at all", () => {
    // The reverse test, and the one that matters most. A false positive leaves her holding a
    // position she never took, and a later contradiction then puts tension on a phantom.
    const chat = [
      "嗯，我在。",
      "你今天怎么样？",
      "我也说不好，可能是有点累吧。",
      "那你先歇会儿。",
      "好。",
    ].join("\n");
    expect(whatSheAsserted(chat), "ordinary talk left her holding positions").toHaveLength(0);
  });

  it("makes no model call", () => {
    const src = readFileSync(join(process.cwd(), "src/life/what-she-asserted.ts"), "utf8");
    expect(src).not.toMatch(/provider|complete\(|await /u);
  });
});

describe("THE CONSEQUENCE, which nothing new had to write", () => {
  it("he tells her otherwise, and it becomes a thing that nags at her", () => {
    const field = createLivingField();
    const said = whatSheAsserted("那家店周一是不营业的。");
    expect(said).toHaveLength(1);
    const mine = field.encodeClaim({
      key: said[0].key, text: said[0].text, nowMs: NOW, origin: "thought", source: "chat:1",
    });
    expect(mine, "her own assertion could not be encoded as a claim at all").not.toBeNull();
    expect(mine!.credence).toBeCloseTo(INITIAL_CREDENCE.thought, 5);
    expect(mine!.tension, "nothing has happened to it yet").toBeLessThan(SUSPENDED_TENSION);

    // He says the opposite, the next day.
    field.encodeClaim({
      key: "told:shop", text: "那家店周一不是不营业的", nowMs: NOW + 864e5,
      origin: "told", source: "chat:1", withOther: true,
    });

    const after = field.graph().nodes.get(mine!.id)!;
    // The gap between what she thought (0.50) and what he told her (trust starts at 0.55) is
    // inside EQUAL_STANDING, so she cannot settle it, and being unsure puts real tension on it.
    expect(Math.abs(TRUST_START - INITIAL_CREDENCE.thought)).toBeLessThanOrEqual(EQUAL_STANDING);
    expect(after.credence, "she quietly took his word for it with no mark left").toBeNull();
    expect(after.tension, "being contradicted about a thing she said cost her nothing")
      .toBeGreaterThanOrEqual(SUSPENDED_TENSION);
  });

  it("and it is a thing that survives — it does not quietly get pruned away", () => {
    // Tension above 0.2 is what exempts a node from pruning and from being dropped when she is
    // over her limit. If being wrong could be swept up by housekeeping, it would not be a mark.
    const field = createLivingField();
    const said = whatSheAsserted("那家店周一是不营业的。")[0];
    const mine = field.encodeClaim({ key: said.key, text: said.text, nowMs: NOW, origin: "thought", source: "chat:1" })!;
    field.encodeClaim({
      key: "told:shop", text: "那家店周一不是不营业的", nowMs: NOW + 864e5,
      origin: "told", source: "chat:1", withOther: true,
    });
    expect(field.graph().nodes.get(mine.id)!.tension).toBeGreaterThan(0.2);
  });

  it("agreeing with her does NOT wind her up — only being contradicted does", () => {
    const field = createLivingField();
    const said = whatSheAsserted("那家店周一是不营业的。")[0];
    const mine = field.encodeClaim({ key: said.key, text: said.text, nowMs: NOW, origin: "thought", source: "chat:1" })!;
    field.encodeClaim({
      key: "told:same", text: "那家店周一是不营业的", nowMs: NOW + 864e5,
      origin: "told", source: "chat:1", withOther: true,
    });
    const after = field.graph().nodes.get(mine.id)!;
    expect(after.tension, "being agreed with made her anxious").toBeLessThan(SUSPENDED_TENSION);
    expect(after.credence, "corroboration should not have left her without a view").not.toBeNull();
  });
});

describe("and the daemon puts her on the hook", () => {
  const raw = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  const daemon = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

  // ONE anchor, floored ONCE at describe scope: the third case below is `.not.toMatch` over
  // a slice, which passes on an empty slice, with the anchor gone, exactly the ledger-on-him leak
  // that test exists to catch would go green forever.
  const asserted = daemon.indexOf("whatSheAsserted(");

  it("her assertions are encoded, from her own turn", () => {
    expect(asserted, "nothing ever asks what she committed to — every slice below is empty")
      .toBeGreaterThan(-1);
    expect(daemon.slice(asserted - 200, asserted + 400)).toMatch(/origin: "thought"/u);
  });

  it("on the SANITIZED text, because a claim is stored and comes back", () => {
    expect(daemon.slice(asserted, asserted + 60), "her raw words go into her field, secrets and all")
      .toContain("whatSheAsserted(saidSafe)");
  });

  it("and NOT wired to him: saying it to him does not make it a fact about him", () => {
    expect(asserted, "the anchor is gone and this negative check passes on nothing").toBeGreaterThan(-1);
    expect(daemon.slice(asserted, asserted + 400), "every position she takes became an entry in a ledger on him")
      .not.toMatch(/withOther/u);
  });

  it("a failure to encode is reported, never swallowed", () => {
    expect(daemon.slice(asserted, asserted + 500)).toMatch(/faultLog\.record\("field\.saidSo"/u);
  });
});
