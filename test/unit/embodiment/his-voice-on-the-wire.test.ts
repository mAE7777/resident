import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeClient } from "../../../src/embodiment/protocol.js";

/**
 * THE WIRE ACTUALLY CARRIES IT.
 *
 * This build's most expensive recurring lesson is that a mechanism can be fully written, fully
 * tested and completely unreachable in production, the disk guard with three functions and no
 * caller, the second beat that Telegram silently dropped, the landing computed 137 lines after its
 * consumer. `how-he-sounds.ts` has its own unit tests; NONE of them prove that a voice measured in
 * a browser ever reaches them.
 *
 * So this file follows the sound from the page to her reading of him, one link at a time.
 */

const SRC = join(process.cwd(), "src");
const FACE_JS = readFileSync(join(SRC, "embodiment", "client", "face.js"), "utf8");

describe("link 1 · the page measures the sound and sends only numbers", () => {
  it("opens its own analyser on the capture the recogniser already has", () => {
    expect(FACE_JS).toMatch(/createAnalyser\(\)/u);
    expect(FACE_JS).toMatch(/getFloatTimeDomainData/u);
  });

  it("and sends the three numbers with his words", () => {
    expect(FACE_JS).toMatch(/loudness:/u);
    expect(FACE_JS).toMatch(/pace:/u);
    expect(FACE_JS).toMatch(/pauses:/u);
    expect(FACE_JS, "the voice never rides with the reply").toMatch(/type: "reply", text, voice/u);
  });

  it("NOTHING ELSE FROM THE MICROPHONE LEAVES THE PAGE", () => {
    // The load-bearing privacy claim of this whole step, checked rather than asserted in a comment.
    // A MediaRecorder, a blob, an upload, or a raw buffer in a frame would each be audio leaving,
    // and each is the kind of thing added later by someone who reads "we already have the stream".
    for (const forbidden of [
      /MediaRecorder/u,
      /\bnew Blob\b/u,
      /\bFileReader\b/u,
      /audioBuffer/iu,
      /\.getChannelData\b/u,
    ]) {
      expect(FACE_JS, `her face's page can send audio: ${String(forbidden)}`).not.toMatch(forbidden);
    }
  });

  it("her own voice through the speakers is not measured as his", () => {
    // Recognition already pauses while she speaks, for exactly this reason. Without the same guard
    // on the meter she would read her own tiredness back as his, and it would be self-reinforcing,
    // because a tired-sounding her makes a landing that makes a more tired her.
    expect(FACE_JS).toMatch(/if \(heard && !state\.speaking\)/u);
  });

  it("and the meter lives with the button, not with the recogniser", () => {
    // Recognition engines stop themselves on silence and restart constantly. Tearing the capture
    // down on each of those would reset the tally mid-sentence, so `pace` would be measured over
    // whatever fragment happened to survive: a number that looks fine and means nothing.
    expect(FACE_JS).toMatch(/startEars\(\); void startMeter\(\);/u);
    expect(FACE_JS).toMatch(/stopEars\(\); stopMeter\(\);/u);
  });
});

describe("link 2 · the protocol carries it, and refuses to invent it", () => {
  it("a spoken reply arrives with its voice", () => {
    const m = decodeClient(JSON.stringify({
      type: "reply", text: "在吗", voice: { loudness: 0.3, pace: 4, pauses: 0.4 },
    }));
    expect(m).toEqual({ type: "reply", text: "在吗", voice: { loudness: 0.3, pace: 4, pauses: 0.4 } });
  });

  it("a typed reply arrives with NO voice field at all — not a zeroed one", () => {
    const m = decodeClient(JSON.stringify({ type: "reply", text: "在吗" }));
    expect(m).toEqual({ type: "reply", text: "在吗" });
    expect(m && "voice" in m, "absent became present-and-empty").toBe(false);
  });

  it("a malformed voice costs him the TONE, never the SENTENCE", () => {
    // The failure that would be worst here: a browser sends a NaN and she stops hearing him at all.
    // A perception feature that can swallow what he said is worse than not having the feature.
    for (const bad of [
      { loudness: "loud", pace: 4, pauses: 0.4 },
      { loudness: 0.3, pace: null, pauses: 0.4 },
      { loudness: 0.3, pace: 4 },
      "not an object",
    ]) {
      const m = decodeClient(JSON.stringify({ type: "reply", text: "在吗", voice: bad }));
      expect(m, `a bad voice dropped his words: ${JSON.stringify(bad)}`)
        .toEqual({ type: "reply", text: "在吗" });
    }
  });

  it("and NaN cannot cross the wire in the first place", () => {
    // JSON has no NaN, so it arrives as null, which the guard must reject rather than coerce.
    const m = decodeClient('{"type":"reply","text":"在吗","voice":{"loudness":null,"pace":4,"pauses":0.4}}');
    expect(m).toEqual({ type: "reply", text: "在吗" });
  });
});

describe("link 3 · the daemon hands it to her reading of him", () => {
  const INDEX = readFileSync(join(SRC, "index.ts"), "utf8");
  const SERVER = readFileSync(join(SRC, "embodiment", "face-server.ts"), "utf8");

  it("the face server passes the voice on rather than dropping it at the door", () => {
    expect(SERVER).toMatch(/deps\.onReply\?\.\(msg\.text, msg\.voice\)/u);
  });

  it("the daemon stashes it and the landing consumes it", () => {
    expect(INDEX).toMatch(/onReply: \(text, voice\)/u);
    expect(INDEX).toMatch(/const spokenAloud = takeVoiceForReply\(\)/u);
    expect(INDEX).toMatch(/sounded \? \{ sounded \} : \{\}/u);
  });

  it("the voice is read against the baseline from BEFORE this utterance", () => {
    // Otherwise every voice is compared against a mean that already contains it, and the very
    // first thing she ever hears comes back as perfectly typical of him. Order, not presence.
    const read = INDEX.indexOf("const spokenAloud = takeVoiceForReply()");
    // ANCHORED ON THE CALL, NOT ON ITS ARGUMENT LIST. This pinned the exact arguments, so adding
    // one (`unlike`, so a shock can re-read the past) broke a guard whose subject,
    // the ORDER of two lines: had not changed at all.
    const record = INDEX.indexOf("heSpokeToHer(relationship, Date.now(), form, spokenAloud");
    expect(read).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(-1);
    expect(record, "the sample is recorded before it is read against the baseline")
      .toBeGreaterThan(read);
  });

  it("THE STASH CLEARS ON EVERY PATH, and is bounded by age as well", () => {
    // The one real risk in this feature. A face reply that never reaches the landing, aborted
    // turn, thrown turn, barge-in, would leave its voice sitting in the cell, and THE NEXT THING
    // HE TYPED ON TELEGRAM would arrive wearing it: exhaustion heard in a message with no sound.
    // Two guards, because an edit can forget one and not the other.
    const fn = INDEX.slice(INDEX.indexOf("function takeVoiceForReply()"));
    const body = fn.slice(0, fn.indexOf("\n    }") + 6);
    expect(body).toMatch(/voiceForReply = null;/u);
    expect(body.indexOf("voiceForReply = null;"), "the clear happens after a conditional return")
      .toBeLessThan(body.indexOf("if (!held) return null;"));
    expect(body).toMatch(/VOICE_STALE_MS/u);
  });
});
