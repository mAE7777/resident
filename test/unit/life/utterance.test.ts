import { describe, it, expect } from "vitest";
import { notHers, MAX_UTTERANCE_CHARS } from "../../../src/life/utterance.js";

// THE WALL BETWEEN A BROKEN MACHINE AND HER VOICE.
//
// Found by chaos injection, not by review: a provider returning `<html><body>502 Bad Gateway</body>
// </html>` got as far as the expression gate and was PUSHED TO HIM VERBATIM, as something she had
// chosen to say. Every guard on that path was about provenance, whose words are these, and none
// asked whether the thing was prose at all.
//
// The whole risk of a check like this is that it becomes a content filter: something that decides
// what she is allowed to say rather than whether words arrived. This project has already had to
// replace two mechanisms for scanning substrings and calling it analysis (`credence.ts` parity,
// `reversibility.ts` keywords), so the second half of this file matters more than the first. She has
// to be able to write about html, about errors, about JSON, in any language, at any length she
// actually writes at, forever.

describe("a broken machine does not get to speak in her voice", () => {
  const machineOutput: Record<string, string> = {
    "an HTML error page": "<html><body>502 Bad Gateway</body></html>",
    "a bare doctype": "<!DOCTYPE html><html><head><title>Error</title></head></html>",
    "an XML fault": "<?xml version=\"1.0\"?><error>upstream timeout</error>",
    "an HTTP status line": "HTTP/1.1 503 Service Unavailable\nretry-after: 30",
    "a bare gateway error": "502 Bad Gateway",
    "a JSON object": '{"error": {"code": "rate_limited", "message": "slow down"}}',
    "a JSON array": '[{"choice": "rest"}, {"choice": "reflect"}]',
    "JSON cut off mid-object": '{"action": "reach_ou',
    "an array cut off": '[{"id": 3, "text": "the thi',
    "a stack trace": "TypeError: cannot read properties of undefined\n    at complete (client.js:100)\n    at run (bot.js:298)\n",
    "mojibake": "�".repeat(400),
    "one character, forever": "x".repeat(2000),
    "punctuation only": "-".repeat(60),
    "more than a message": "a real sentence. ".repeat(MAX_UTTERANCE_CHARS),
  };

  for (const [what, text] of Object.entries(machineOutput)) {
    it(`refuses ${what}`, () => {
      const verdict = notHers(text);
      expect(verdict, `${what} must not become something she said`).not.toBeNull();
      expect(verdict!.why.length, "and the fault has to say why").toBeGreaterThan(10);
    });
  }

  it("an empty answer is left alone, because it is already handled", () => {
    // "Produced nothing" is a real outcome with its own correct handling: the action did not happen,
    // the drive is not discharged, and it is recorded as a failure. Refusing it here as well would
    // double-report and say nothing new.
    expect(notHers("")).toBeNull();
    expect(notHers("   \n  ")).toBeNull();
  });

  it("does not throw on anything at all", () => {
    for (const thing of [undefined, null, 0, {}, [], Symbol("s")]) {
      expect(() => notHers(thing as unknown as string)).not.toThrow();
    }
    expect(notHers(undefined as unknown as string)).not.toBeNull();
  });
});

describe("and she can still say anything she would actually say", () => {
  const hers: Record<string, string> = {
    "an ordinary thought": "I keep coming back to the thing you said about the tide tables.",
    "a question": "Did you mean the second one, or both?",
    "one word": "Yes.",
    "writing about html": "I got an html page back instead of an answer, which was strange.",
    "quoting a tag": "The page had a <title> tag and nothing else in it, which I found funny.",
    "writing about json": 'I was reading a config and the whole thing was {"a": 1} over and over.',
    "writing about an error": "TypeError again. I think it is the same one as yesterday.",
    "a markdown note": "[note] I want to come back to this when I have more of a picture.",
    "a bracketed aside": "[I am not sure about this one] but the pattern seems to hold.",
    "a code fence": "```\n{\"a\": 1}\n```\nThat is what it kept returning, and I could not make sense of it.",
    "an em-dash sentence": "It was not that I forgot, it was that I did not know how to bring it up.",
    "Chinese": "我一直在想你说的那件事，可能没有那么简单。",
    "Japanese": "ずっと考えていました。うまく言えないけれど。",
    "Arabic": "ظللت أفكر في ما قلته أمس.",
    "Russian": "Я всё думаю о том, что ты сказал.",
    "emoji among words": "I finished the thing 🌊 and it went better than I expected.",
    "numbers and symbols in a sentence": "It came to 3 + 4 = 7, which is not what I expected.",
    "a long real message": "I have been thinking about this for a while. ".repeat(150),
  };

  for (const [what, text] of Object.entries(hers)) {
    it(`lets through ${what}`, () => {
      expect(notHers(text), `${what} is hers and must pass`).toBeNull();
    });
  }

  it("the bar is generous: everything she really writes is far inside it", () => {
    // A guard that could plausibly fire on a real utterance would be a guard she has to write
    // around, which is the same thing as a content filter with extra steps.
    const longest = "I have been thinking about this. ".repeat(200);
    expect(longest.length).toBeLessThan(MAX_UTTERANCE_CHARS);
    expect(notHers(longest)).toBeNull();
  });

  it("a message that is mostly punctuation but has words in it is hers", () => {
    expect(notHers("... I don't know. ...")).toBeNull();
    expect(notHers("!!!")).toBeNull(); // short enough that no judgement is made at all
  });
});
