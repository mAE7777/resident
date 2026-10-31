import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeClient } from "../../../src/embodiment/protocol.js";
import { derivePresence } from "../../../src/embodiment/presence.js";

/**
 * THE CURTAIN: she can feel him in the room and never sees it.
 *
 * The goal is real sight. The build that turned out to be right is not a picture:
 * a frame is a snapshot, a stream of them would drown her inner life, and it would put his room on
 * a network. What "seeing someone" mostly IS, for a person, is whether they are there, whether they
 * are moving, and how long they have been still, all scalars.
 *
 * So the page reduces each frame to numbers and throws it away. These tests are what keeps that a
 * FACT rather than a sentence in a header: the privacy claim of this whole step is that no pixel
 * can leave, and a claim nobody executes is a guess.
 */

const CLIENT = join(process.cwd(), "src", "embodiment", "client");
const FACE_JS = readFileSync(join(CLIENT, "face.js"), "utf8");
const PAGE = readFileSync(join(CLIENT, "index.html"), "utf8");

describe("no pixel can leave this page", () => {
  it("the frame is reduced to numbers and dropped", () => {
    expect(FACE_JS, "the page no longer measures movement at all").toMatch(/getImageData/u);
    expect(FACE_JS).toMatch(/motionNow/u);
    expect(FACE_JS).toMatch(/sawMotionMs/u);
  });

  it("AND NOTHING CAN ENCODE OR SHIP ONE", () => {
    // Each of these is a way a frame becomes bytes that can travel, and each is the kind of thing
    // added later by someone who reads "we already have the stream open". The camera makes this
    // strictly sharper than the microphone's version of the same check: an image is his ROOM.
    for (const forbidden of [
      /toDataURL/u,
      /toBlob/u,
      /createImageBitmap/u,
      /MediaRecorder/u,
      /\bnew Blob\b/u,
      /\bFileReader\b/u,
      /ImageCapture/u,
      /captureStream/u,
    ]) {
      expect(FACE_JS, `her face's page can ship an image: ${String(forbidden)}`).not.toMatch(forbidden);
    }
  });

  it("the working canvas is far too small to be a face", () => {
    // 64×48 is enough for "something moved" and useless for anything else. Belt as well as braces:
    // even if some future line did ship it, there would be nothing in it.
    expect(FACE_JS).toMatch(/CAM_W = 64, CAM_H = 48/u);
  });

  it("and what the socket carries is three numbers, named", () => {
    const sent = FACE_JS.slice(FACE_JS.indexOf("function sendPresence()"));
    const body = sent.slice(0, sent.indexOf("setInterval(sendPresence"));
    expect(body).toMatch(/cameraPresent/u);
    expect(body).toMatch(/motion/u);
    expect(body).toMatch(/stillSeconds/u);
    // The negative half: no image-shaped key anywhere in what gets sent.
    expect(body).not.toMatch(/frame|image|jpeg|png|data:/iu);
  });
});

describe("he controls the curtain, and can see that it is open", () => {
  it("there is a control, and it starts closed on every load", () => {
    expect(PAGE).toMatch(/id="cam"/u);
    expect(FACE_JS).toMatch(/let cameraOpen = false;/u);
  });

  it("a curtain that remembers being open is not offered", () => {
    // Persisting the state would mean the camera is on when he did not decide it, the decision
    // survives a reload but his attention does not.
    expect(FACE_JS).not.toMatch(/localStorage|sessionStorage|indexedDB/u);
  });

  it("and the page says so while it is open", () => {
    // A window she can look through invisibly is not a window. He should never have to remember.
    expect(FACE_JS).toMatch(/camBtn\.textContent = cameraOpen \?/u);
  });

  it("closing it really stops the camera rather than just muting the numbers", () => {
    const stop = FACE_JS.slice(FACE_JS.indexOf("cam = {"), FACE_JS.indexOf("sawMotionMs = Date.now();"));
    expect(stop, "the tracks are not stopped, so the camera light stays on").toMatch(
      /for \(const t of stream\.getTracks\(\)\) t\.stop\(\)/u);
  });
});

describe("a closed curtain is not an empty room", () => {
  it("the three fields are absent rather than defaulted", () => {
    const m = decodeClient(JSON.stringify({
      type: "presence",
      signals: { idleSeconds: 5, frontAppFocused: true, dndOrFocus: false, screenSharing: false, micActive: false },
    }));
    expect(m?.type).toBe("presence");
    if (m?.type !== "presence") return;
    expect(m.signals.cameraPresent).toBeUndefined();
    expect(m.signals.motion).toBeUndefined();
    expect(m.signals.stillSeconds).toBeUndefined();
  });

  it("and they arrive intact when it is open", () => {
    const m = decodeClient(JSON.stringify({
      type: "presence",
      signals: {
        idleSeconds: 5, frontAppFocused: true, dndOrFocus: false, screenSharing: false,
        micActive: false, cameraPresent: true, motion: 0.4, stillSeconds: 12,
      },
    }));
    if (m?.type !== "presence") throw new Error("presence frame was rejected");
    expect(m.signals.cameraPresent).toBe(true);
    expect(m.signals.motion).toBe(0.4);
    expect(m.signals.stillSeconds).toBe(12);
  });

  it("a malformed camera number drops ITSELF, not the whole frame", () => {
    // He is still at the machine even if one reading came through broken. Losing the whole
    // presence frame over it would make a bad number look exactly like him leaving.
    const m = decodeClient(
      '{"type":"presence","signals":{"idleSeconds":5,"frontAppFocused":true,"dndOrFocus":false,'
      + '"screenSharing":false,"micActive":false,"cameraPresent":true,"motion":null,"stillSeconds":"x"}}');
    if (m?.type !== "presence") throw new Error("one bad number rejected the whole frame");
    expect(m.signals.idleSeconds).toBe(5);
    expect(m.signals.cameraPresent).toBe(true);
    expect(m.signals.motion).toBeUndefined();
    expect(m.signals.stillSeconds).toBeUndefined();
  });
});

describe("the field that was never once fed", () => {
  it("`cameraPresent` now decides presence, and it always could have", () => {
    // It has been in `PresenceSignals` from the start and the client had no `getUserMedia`
    // anywhere: so `atMachine` has always been keyboard idleness and nothing else, and a man
    // sitting still reading for three minutes read as away.
    const stillReading = derivePresence({
      idleSeconds: 600, frontAppFocused: true, dndOrFocus: false, screenSharing: false,
      micActive: false, cameraPresent: true,
    });
    expect(stillReading.present, "he is in the chair and she cannot tell").toBe(true);

    const reallyGone = derivePresence({
      idleSeconds: 600, frontAppFocused: true, dndOrFocus: false, screenSharing: false,
      micActive: false, cameraPresent: false,
    });
    expect(reallyGone.present).toBe(false);
  });

  it("and with the curtain closed the old reading stands, unchanged", () => {
    const closed = derivePresence({
      idleSeconds: 600, frontAppFocused: true, dndOrFocus: false, screenSharing: false,
      micActive: false,
    });
    expect(closed.present).toBe(false);
  });
});

describe("the room reaches her wanting, in the daemon", () => {
  const INDEX = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("the still-seconds reading is carried, not dropped at the door", () => {
    expect(INDEX).toMatch(/latestStillSeconds = signals\.stillSeconds \?\? null/u);
  });

  it("and it reaches `social` through the drive input rather than a prompt line", () => {
    // The whole point of this shape is to inject as little prompt as possible. Nothing here writes a
    // word she reads; it moves what she WANTS, and `decide()` still weighs it against everything.
    expect(INDEX).toMatch(/roomPull: noticeTheRoomNow\(nowMs\)/u);
    // Through `socialWithTheRoom`, which is the SHARED path: production and the test that pins
    // "added, not multiplied" now run the same arithmetic. They used to be two copies, and the
    // wiring proof caught it the same hour, a test pinning a property of a function production
    // did not call is a test measuring a quantity nothing depends on (defect class 20).
    const life = readFileSync(join(process.cwd(), "src", "life", "inner-state.ts"), "utf8");
    expect(life).toMatch(/socialWithTheRoom\(/u);
    expect(life).toMatch(/pull: day\.roomPull \?\? 0/u);
  });

  it("a stale face clears the baseline instead of pinning the room forever", () => {
    // The defect this build already paid for once: a dead tab's last frame stayed in the cell and
    // muted every push into her diary permanently. Here it would be worse, a stale room would
    // fire "he came back" the instant he reopened the page, hours later.
    //
    // THE ANCHOR IS ASSERTED BEFORE IT IS USED. `indexOf` returning -1 does not throw: `slice(-1)`
    // quietly hands back a different region, and a check over that region passes on nothing. I
    // repaired exactly this defect in `lifecycle-wiring.test.ts` earlier today and then wrote it
    // again here: which is why the meta-guard exists rather than the discipline.
    const at = INDEX.indexOf("function noticeTheRoomNow");
    expect(at, "the anchor for the room-noticing function no longer matches the daemon")
      .toBeGreaterThan(-1);
    const fn = INDEX.slice(at);
    const body = fn.slice(0, fn.indexOf("\n    }") + 6);
    expect(body).toMatch(/if \(!seen\) \{ roomSense\.blind\(\); return 0; \}/u);
  });

  it("and going blind is not the same as him leaving", () => {
    // A closed tab is not an empty chair. `blind()` forgets; it does not report a departure, and
    // it does not let the next look compare against a reading from hours ago.
    const sense = readFileSync(join(process.cwd(), "src", "life", "aware-of-him.ts"), "utf8");
    const at = sense.indexOf("blind()");
    expect(at, "the sense no longer has a way to forget").toBeGreaterThan(-1);
    expect(sense).toMatch(/blind\(\) \{ last = null; awaySinceMs = null; \}/u);
  });

  it("and a failure there is reported rather than swallowed", () => {
    const at = INDEX.indexOf("function noticeTheRoomNow");
    expect(at, "the anchor for the room-noticing function no longer matches the daemon")
      .toBeGreaterThan(-1);
    expect(INDEX.slice(at, at + 2000)).toMatch(/faultLog\.record\("room\.notice"/u);
  });
});
