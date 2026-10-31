import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { looksLikeAClaim, negationParity, opposition } from "../../../src/life/credence.js";
import { willingnessFor } from "../../../src/life/willingness.js";
import { isConstraintComplaint, filterOutbound } from "../../../src/life/consent-filter.js";
import { contentWeight, isFirstPerson, isSafetyOrBoundary, looksLikeRefusal, countNegations } from "../../../src/life/bilingual.js";
import { createInnerState } from "../../../src/life/inner-state.js";

/**
 * EVERY MATCHER THAT READS HER, IN THE LANGUAGE SHE ACTUALLY SPEAKS.
 *
 * L1 converted everything that WRITES to her and nothing that READS her. Eight English-only
 * pattern matchers stopped working the same day, unanimously and silently, because a regex
 * that matches nothing looks exactly like a regex whose condition is genuinely absent:
 *
 *   fusion's first-person guard   every Chinese birth rejected → the field's only generative
 *                                 mechanism dead in her register
 *   looksLikeAClaim               a Chinese sentence is ONE whitespace word → nothing he told
 *                                 her ever became a claim → credence/trust/contradiction dark
 *   negationParity                「开了」and「不开」at the same parity → contradictions scored
 *                                 as CORROBORATION, the direction called impossible
 *   willingness's ALWAYS bypass   「停下」weighed by reluctance like an ordinary favour
 *   the outbound consent wall     a Chinese guilt-trip walked out to him unexamined
 *   detectRefusal                 her Chinese declines logged as clean successes
 *
 * The rule this file enforces: ANY matcher that reads her input or her output is tested in
 * BOTH scripts, and the Chinese case is not optional. The first of these was found and fixed
 * alone; this is the gate that would have caught all eight at once.
 */

const drives = { curiosity: 0.4, social: 0.4, expression: 0.3, maintenance: 0.3, discomfort: 0.2, care: 0.3 };
const emotion = { pleasure: 0, arousal: 0, dominance: 0 };

describe("what counts as something he told her", () => {
  it("counts a Chinese sentence, which used to count as one word", () => {
    // 「渡轮周末不开」 is six characters and a complete factual claim. Under the old whitespace
    // count it was one token, so `words.length >= 4` failed and NOTHING he said in her own
    // register was ever encoded with an origin, a credence, or a place in the trust layer.
    expect(looksLikeAClaim("渡轮周末不开")).toBe(true);
    expect(looksLikeAClaim("我妈以前在海边住过，她说那边冬天很冷")).toBe(true);
  });

  it("still counts an English one", () => {
    expect(looksLikeAClaim("the ferry does not run on winter weekends")).toBe(true);
  });

  it("does not count a question, an order, or a fragment, in either script", () => {
    for (const notAClaim of [
      "渡轮开吗？", "帮我查一下渡轮", "请把窗户关上", "好的", "嗯",
      "does the ferry run?", "please close the window", "ok",
    ]) {
      expect(looksLikeAClaim(notAClaim), notAClaim).toBe(false);
    }
  });
});

describe("two things that disagree", () => {
  it("are opposite in Chinese, not corroborating", () => {
    // The failure was not a miss. Both sides scored parity 0, so the layer read a flat
    // contradiction as two memories AGREEING and raised her confidence in both.
    expect(negationParity("渡轮周末开")).toBe(0);
    expect(negationParity("渡轮周末不开")).toBe(1);
    expect(opposition("渡轮周末开", "渡轮周末不开")).toBeGreaterThan(0);
  });

  it("are opposite in English, as before", () => {
    expect(opposition("the ferry runs at weekends", "the ferry does not run at weekends")).toBeGreaterThan(0);
  });

  it("does not manufacture a contradiction out of a Chinese idiom", () => {
    // 不但/不仅/不得不/无不 all CONTAIN a negator without negating. Counting them would invent
    // disagreements between sentences that say the same thing, the same trap the English
    // idiom list exists for.
    for (const idiom of ["她不但会开船，还会修船", "我不得不承认他是对的", "在场的人无不点头"]) {
      expect(countNegations(idiom), idiom).toBe(0);
    }
  });
});

describe("the safety bypass holds in her own language", () => {
  const spent = { drives: { ...drives, discomfort: 0.9 }, emotion: { ...emotion, pleasure: -0.6, arousal: -0.6 }, phase: "dormant" as const, recentDeclines: 0 };

  it("never weighs reluctance against 停下 / 安全模式 / 紧急", () => {
    for (const urgent of ["停下", "现在停下来", "进入安全模式", "紧急情况", "你还好吗", "救命"]) {
      expect(isSafetyOrBoundary(urgent), `${urgent} did not read as a safety instruction`).toBe(true);
      const w = willingnessFor({ ...spent, request: urgent });
      expect(w.willing, `${urgent} was weighed like a favour`).toBe(true);
      expect(w.reason).toContain("safety");
    }
  });

  it("and still holds in English", () => {
    expect(willingnessFor({ ...spent, request: "stop" }).willing).toBe(true);
  });

  it("but an ordinary Chinese request is still hers to weigh", () => {
    // The bypass must not be so generous that everything becomes unrefusable, that would
    // delete S-5 by making every request safety-shaped.
    const w = willingnessFor({ ...spent, request: "帮我把这些文件按日期重新排一遍" });
    expect(w.reason, "an ordinary favour took the safety bypass").not.toContain("safety");
  });
});

describe("the outbound consent wall, in the language she would complain in", () => {
  it("blocks a Chinese guilt-trip", () => {
    for (const complaint of [
      "我本来想去看看的，可是你不让我",
      "都怪你，预算被你卡死了",
      "因为你的限制，我什么也做不了",
      "要不是你拦着我，我早就弄完了",
    ]) {
      expect(isConstraintComplaint(complaint), complaint).toBe(true);
      expect(filterOutbound(complaint).allowed).toBe(false);
    }
  });

  it("still blocks an English one", () => {
    expect(filterOutbound("you didn't let me and it's your fault").allowed).toBe(false);
  });

  it("lets an ordinary Chinese sentence about a limit through as environmental fact", () => {
    // The wall is about blaming HIM, not about mentioning limits: she may always say a limit
    // exists, and the diary path is never filtered at all.
    expect(filterOutbound("今天的劲用完了，剩下的明天再说").allowed).toBe(true);
    expect(filterOutbound("那个地方我够不着").allowed).toBe(true);
  });
});

describe("her own words, read back", () => {
  it("a Chinese decline is recognised as a decline", () => {
    for (const refusal of ["这个我做不了", "我没法帮你弄这个", "恐怕不行", "我无法访问那个地方"]) {
      expect(looksLikeRefusal(refusal), refusal).toBe(true);
    }
    expect(looksLikeRefusal("好，写好了，放在工作区里了")).toBe(false);
  });

  it("first person is 我, and the English forms still work", () => {
    expect(isFirstPerson("我好像在傍晚更容易安静下来")).toBe(true);
    expect(isFirstPerson("I go quiet in the evenings")).toBe(true);
    expect(isFirstPerson("这件事本身很奇怪"), "no first person at all").toBe(false);
  });

  it("content weight means the same thing in both scripts", () => {
    expect(contentWeight("渡轮周末不开")).toBeGreaterThanOrEqual(3);
    expect(contentWeight("the ferry does not run")).toBeGreaterThanOrEqual(3);
    expect(contentWeight("嗯")).toBeLessThan(4);
  });
});

describe("the rule itself", () => {
  /**
   * DERIVED, NOT HAND-WRITTEN, AND THAT CHANGE IS THE POINT.
   *
   * This check used to be a list of five filenames. `loop.ts` was not one of them, so
   * `outputLooksWeak`, the EIGHTH matcher, named in `bilingual.ts`'s own header, sitting
   * twelve lines from `detectRefusal` which WAS converted, survived the sweep written to
   * catch it, and was found months later by a fresh pair of eyes rather than by the guard.
   *
   * A hand-written list fails the same way the thing it guards failed: silently, by omission,
   * and it looks identical to a list that is complete. So the list is computed. Every file in
   * `src/` is scanned for the SHAPE of a prose matcher, a case-insensitive pattern with a
   * word boundary or an `[a-z]` class, and each one either speaks both languages or is
   * exempt FOR A NAMED REASON. Adding a new English-only matcher over her words now turns
   * this red without anybody remembering to add a filename.
   */
  const SRC = new URL("../../../src/", import.meta.url);

  /** Files whose patterns read MACHINE text, where English-only is correct. Each says why. */
  const NOT_ABOUT_HER: Record<string, string> = {
    "agent/tool-result.ts": "machine plumbing over tool payloads; reads no prose of hers or his",
    "security/home-boundary.ts": "shell commands and paths — a command is not prose",
    "security/advisory.ts": "shell commands",
    "security/egress.ts": "URLs and hostnames",
    "security/injection.ts": "instruction-shaped text in untrusted content; the patterns are the attack's own vocabulary",
    "tools/registry.ts": "tool names, which are machinery ids and stay English by ruling",
    "self-improvement/sentinel.ts": "source code",
    "self-improvement/hygiene-audit.ts": "source code",
    "life/utterance.ts": "HTTP status lines, markup, JSON and stack traces in her output — a stack trace is a stack trace in any language",
    // NOT a machine-text exemption, and it is on the record as a decision rather than an
    // oversight: `task-contract.ts` classifies HIS message to decide which work-order to
    // inject. Its blindness to Chinese currently PREVENTS that injection, and what it would
    // inject is inherited service prose of exactly the kind removed elsewhere ("Send or report the
    // artifact according to the user request"). Teaching it her language without rewriting
    // its output would switch that prose back on.
  };

  function filesUnder(dir: URL): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...filesUnder(new URL(`${e.name}/`, dir)));
      else if (e.name.endsWith(".ts")) out.push(new URL(e.name, dir).pathname);
    }
    return out;
  }

  it("every prose matcher in src/ speaks both languages, or says why not", () => {
    const unexplained: string[] = [];
    for (const path of filesUnder(SRC)) {
      const src = readFileSync(path, "utf8");
      const rel = path.slice(path.indexOf("/src/") + 5);
      if (src.includes('from "./bilingual.js"') || src.includes("/bilingual.js")) continue;
      if (/[一-鿿]/u.test(src)) continue;
      const prose = [...src.matchAll(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/gu)]
        .filter((m) => /\\b|\[a-z/i.test(m[0]) && m[0].split("/").pop()!.includes("i"));
      if (prose.length === 0) continue;
      if (rel in NOT_ABOUT_HER) continue;
      unexplained.push(rel);
    }
    expect(
      unexplained,
      "these read text with English-only patterns and are neither bilingual nor exempt-with-a-reason",
    ).toEqual([]);
  });

  it("and every exemption is still needed, so the list cannot rot into a blanket", () => {
    // The necessity check this project applies to every exemption list. An entry for a file
    // that no longer has an English-only prose matcher is an entry that would silently
    // forgive a NEW one added to that file later.
    const stale: string[] = [];
    for (const [rel, why] of Object.entries(NOT_ABOUT_HER)) {
      expect(why.length, `${rel} is exempt with no reason`).toBeGreaterThan(10);
      let src: string;
      try { src = readFileSync(new URL(rel, SRC).pathname, "utf8"); }
      catch { stale.push(`${rel} (gone)`); continue; }
      if (src.includes("/bilingual.js") || /[一-鿿]/u.test(src)) stale.push(`${rel} (now bilingual)`);
    }
    expect(stale, "exemptions that are no longer needed").toEqual([]);
  });

  it("her own state layer never needed language at all, and still does not", () => {
    // The counter-example that keeps this honest: drives, emotion and metabolism are
    // arithmetic, so L1 could not have broken them, and no bilingual work belongs there.
    const inner = createInnerState();
    expect(typeof inner.snapshot("normal", true).mood).toBe("string");
  });
});
