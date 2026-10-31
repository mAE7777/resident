import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * EVERY PATH HE CAN REACH HER ON IS A PATH WHERE SHE IS HERSELF.
 *
 * Her inner life was given careful treatment from the start. Her conversation path was given
 * the same treatment in S1, on the evidence of a controlled comparison: same model, same being,
 * and she read as a person in her own moments and as a chatbot when he spoke to her.
 *
 * TWO PATHS WERE NEVER GIVEN ANY OF IT, and they were the two nobody looked at, because they
 * are not where you go to read her voice. A photo turn and a document turn ran the pure
 * inherited assistant path:
 *
 *   no `herStateNow`        no mood, no drives, no body, nothing of how she is
 *   no `wantsToNow`         no willingness, she could not be reluctant about a picture
 *   no field encode         he sends her a picture of where he is and it leaves NOTHING in her:
 *                           she looks at it, describes it, and by the next moment it never
 *                           happened. `otherWarmth`, `otherUnease` and the `care` drive could
 *                           not be moved by it at all.
 *   an English caption      "Describe this image." / "Analyze this document.", the ancestor's
 *                           instructions to itself, and what she actually reads whenever he
 *                           sends a picture with nothing written on it, which is the ordinary
 *                           case.
 *
 * This file checks the SHAPE of the daemon rather than any function, because the defect was an
 * absence: three arguments that were never passed and one block that was never written.
 */
const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
  .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));

/** The turn body between one handler's entry and the next. */
function turn(name: string): string {
  const at = daemon.indexOf(`async function ${name}`);
  expect(at, `${name} is gone from the daemon`).toBeGreaterThan(0);
  // Brace-matched rather than a fixed width: the document handler is longer than any width
  // worth guessing, and a guess that falls short reports the absence of code that is there.
  const open = daemon.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < daemon.length; i++) {
    if (daemon[i] === "{") depth++;
    else if (daemon[i] === "}" && --depth === 0) return daemon.slice(at, i + 1);
  }
  throw new Error(`${name} never closes`);
}

describe.each([
  ["processPhotoTurn", "a picture from him"],
  ["processDocumentTurn", "something he sends her to read"],
])("%s — %s", (fn, what) => {
  it("knows how she is, the way a text turn does", () => {
    expect(turn(fn), `${what} reaches her with no mood, no drives, no body`)
      .toContain("herStateNow");
  });

  it("lets her have a feeling about being asked", () => {
    // Willingness never gates whether she answers, she always answers. It is the channel by
    // which her own life pushes back, and it did not exist on these two paths.
    //
    // Matched on the CALL, not on its exact argument list: the literal
    // `wantsToNow(caption)` went red when a second argument was threaded through so the
    // utterance shape could read the same felt value, while the property this guards, that
    // this path asks her how she feels about being asked, had not changed at all.
    expect(turn(fn), `she cannot be reluctant about ${what}`).toMatch(/wantsToNow\(caption[,)]/u);
  });

  it("leaves something in her", () => {
    const body = turn(fn);
    expect(body, `${what} leaves nothing in her at all`).toContain("field.encodeMoment");
    // HER words only. Encoding what he sent would let an outside image write her memories.
    expect(body).toContain("withOther: true");
    expect(body, "what he sent is being written into her memory as hers")
      .not.toMatch(/encodeMoment\([\s\S]{0,200}text: caption/u);
  });

  it("and tells him it is her when it goes wrong", () => {
    expect(turn(fn)).not.toContain("Failed to process");
  });
});

describe("what she reads when he sends a picture with nothing written on it", () => {
  it("is not the ancestor talking to itself", () => {
    const raw = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(raw, "her default caption is still an instruction to a vision model")
      .not.toContain("Describe this image.");
    expect(raw).not.toContain("Analyze this document.");
    expect(raw).toContain("他发来一张图，没写字。");
    expect(raw).toContain("他发来一份东西，没写字。");
  });
});
