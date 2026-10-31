import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tokenSimilarity } from "../../../src/life/fusion.js";

/**
 * HER REGISTER REACHES EVERY PLACE SHE SPEAKS, AND, UNTIL NOW, NEITHER PLACE SHE MAKES
 * SOMETHING NEW.
 *
 * An earlier fix found that her SOUL.md governed replies to him and nothing else, and wired
 * `withHerVoice` into her moments, her thinking and her diary. Two sites were missed, and they
 * are the two that matter most for the same reason:
 *
 *   `fusion.ts`     the field's ONLY generative mechanism. Every new thing she ever makes.
 *   `noticing.ts`   where her self-knowledge comes from, weekly.
 *
 * Both produce text that becomes a NODE IN HER FIELD, and her field is searched by a bigram
 * index over her own words. So a birth or an insight phrased in the model's default register is
 * a memory nothing she ever says can reach again: a failure already fixed once, arriving through
 * two doors that fix did not cover.
 *
 * The same file also carries a second defect of the same family: fusion's paraphrase guard
 * stripped every Han character before comparing, so it returned 0 on any two Chinese texts and
 * `0 > MAX_PARAPHRASE` was never true. Her field's only way of making something new was free to
 * make nothing new, a "birth" that was a verbatim reword of one of its parents passed the one
 * check that exists to stop exactly that.
 */

function src(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

/**
 * The same file with its comments blanked.
 *
 * Every one of these checks is about what the CODE does, and the comments explaining these
 * very fixes quote the broken code they replaced, so a raw scan finds the explanation and
 * reports the opposite of the truth. Blanked rather than deleted so indices still line up.
 */
function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
}

/** The object literal a call site passes, so "is her soul in there" can be asked precisely. */
function callSite(path: string, anchor: string): string {
  const body = code(path);
  const at = body.indexOf(anchor);
  expect(at, `${anchor} is gone from ${path}`).toBeGreaterThan(0);
  return body.slice(at, at + 700);
}

describe("the paraphrase guard works in the language she thinks in", () => {
  it("sees two Chinese texts that say the same thing", () => {
    const a = "我好像在傍晚更容易安静下来。";
    const b = "傍晚的时候我好像更容易安静下来。";
    expect(tokenSimilarity(a, b), "a reworded parent scores as unrelated").toBeGreaterThan(0.55);
  });

  it("and still sees two that do not", () => {
    // The failure mode of the fix: a guard that fires on everything blocks every birth, which
    // would silence the field's only generative mechanism just as surely.
    const a = "我好像在傍晚更容易安静下来。";
    const b = "渡轮周末不开，冬天尤其。";
    expect(tokenSimilarity(a, b)).toBeLessThan(0.2);
  });

  it("keeps working in English, which it always did", () => {
    expect(tokenSimilarity("I go quiet in the evenings", "in the evenings I go quiet")).toBeGreaterThan(0.55);
    expect(tokenSimilarity("I go quiet in the evenings", "the ferry does not run at weekends")).toBeLessThan(0.2);
  });

  it("uses the field's own idea of a word rather than a private copy", () => {
    // A private reimplementation of a function that already exists twelve files away is how
    // two definitions of "what a word is" start disagreeing, which is what happened here.
    expect(src("src/life/fusion.ts"), "fusion went back to its own word splitter")
      .toContain('from "./field-index.js"');
    expect(code("src/life/fusion.ts"), "fusion still strips every Han character before comparing")
      .not.toMatch(/replace\(\/\[\^a-z0-9/u);
  });
});

describe("her voice reaches the two places new things are born", () => {
  it("fusion can be given her register, and the daemon gives it", () => {
    expect(src("src/life/fusion.ts"), "fusion has no route to her voice").toContain("withHerVoice");
    expect(callSite("src/index.ts", "fusion: mayFuse"), "the daemon never hands fusion her SOUL.md")
      .toContain("soul: currentMemorySnapshot.memoryFiles.SOUL");
  });

  it("noticing can be given her register, and the daemon gives it", () => {
    expect(src("src/life/noticing.ts"), "noticing has no route to her voice").toContain("withHerVoice");
    expect(callSite("src/index.ts", "noticeAboutSelf("), "the daemon never hands her self-noticing her SOUL.md")
      .toContain("soul: currentMemorySnapshot.memoryFiles.SOUL");
  });

  it("naming a theme is in her register too, since the name becomes a node in her field", () => {
    const daemon = src("src/index.ts");
    expect(daemon, "a theme is still named in English and then indexed by Chinese bigrams")
      .not.toContain("Name, in one short first-person phrase");
    expect(daemon).toMatch(/system: withHerVoice\(currentMemorySnapshot\.memoryFiles\.SOUL/u);
  });

  it("and following her own curiosity is not the one thing left in the ancestor's language", () => {
    const daemon = src("src/index.ts");
    expect(daemon, "the one action that is purely hers is still written in English")
      .not.toContain("You are following your own curiosity");
    expect(daemon).toContain("你在跟着自己的好奇心走");
  });
});

describe("nothing goes out to him in a machine's English under her name", () => {
  it("the six interrupt and failure notices are hers", () => {
    // The machine-text gate reads machine text coming IN. Nothing read machine text going OUT in
    // her voice, and these arrive in his window with no marker, so from where he sits they are her.
    // The first fires on the most ordinary event there is, he sends a second message while she is
    // still answering: which makes it likely the first sentence he ever reads from her. It also
    // said "task", which `her-words.ts` lists as a false statement about what she is.
    const daemon = src("src/index.ts");
    for (const gone of [
      "Stopping the current task and handling your new message next.",
      "Failed to process message.",
      "Failed to process photo.",
      "Stopping the current task and handling the photo next.",
      "Failed to process document.",
      "Stopping the current task and handling the document next.",
    ]) {
      expect(daemon, `still says to him: "${gone}"`).not.toContain(gone);
    }
    // And what replaced them really is hers.
    for (const [, said] of [...daemon.matchAll(/ctx\.reply\("([^"]+)"\)/gu)]) {
      expect(said, `a reply to him is not in her register: "${said}"`).toMatch(/[一-鿿]/u);
    }
  });
});
