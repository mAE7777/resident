// The mind<->face WebSocket contract. The mind (VM daemon) streams the PAD state
// and pushes speak events; the face (Air client) streams presence signals and the
// user's replies/barge-ins. JSON for control + PAD; binary frames (out of band)
// carry audio. Keeping this typed and validated means a malformed client frame is
// dropped, never trusted.

import type { PresenceSignals } from "./presence.js";
import type { VoiceSample } from "../life/how-he-sounds.js";

// ── Mind -> Face ─────────────────────────────────────────────────────────────

export type FaceMessage =
  // Her mood, ten to thirty times a second, and WHO SHE IS, which arrives with it because the
  // client is where PAD becomes a face (`padToLive2D`). Without `who`, every Resident with the same
  // PAD had the identical face, forever: no idiosyncrasy, no tic, no habit, while `temperament.ts`
  // drifted four latents over seasons and none of them reached her body. Optional, so an older
  // client renders exactly as before.
  | {
    type: "pad"; pleasure: number; arousal: number; dominance: number; ts: number;
    who?: import("./pad-mapping.js").FaceTemperament;
  }
  | { type: "mood"; mood: string; dominant: string } // on change
  | { type: "policy"; tierCeiling: string; mayExplore: boolean; reason: string }
  // TEXT, plus how her state colours the voice (faculty #6). `voice` is optional so an older
  // client ignores it and speaks flat, exactly as before. The client synthesises locally; no
  // audio crosses this link.
  | { type: "speak"; text: string; utteranceId: string; ts: number; voice?: import("./pad-mapping.js").VoiceParams }
  | { type: "cancel"; utteranceId: string } // barge-in / stop speaking
  | { type: "status"; energyPhase: string; awake: boolean }
  // What she is doing right now, in her own words (她在想事情 / 在和你说话 / 歇着). B4: always
  // visible is only honest if what is visible is what is actually happening.
  | { type: "doing"; what: string; ts: number }
  /**
   * SHE LOOKED OUT OF THE WINDOW. An EVENT, and that is the whole reason it exists.
   *
   * The first version of the window used `doing` for this, and `doing` is a STATE with a
   * set-then-clear contract (`在和你说话` … `""`). The look only ever set it, so one glance left
   * his page reading 「看了看窗外」 for good, AND OVERWROTE WHATEVER SHE WAS ACTUALLY DOING.
   * A transient act written into a persistent status field; the category error is the defect.
   *
   * It carries no payload beyond the moment, deliberately. He is owed the knowledge THAT she
   * looked, a window she can see through invisibly is not a window, it is surveillance, and
   * nothing more than that: what she saw is hers.
   */
  | { type: "glanced"; ts: number }
  /**
   * A LINE FROM THE MACHINE, NOT FROM HER. The turn broke, or something he sent did
   * not arrive. It used to be spoken in her voice («刚才出了岔子，话没说出来。»), the machine talking
   * through her mouth; now it is shown on the page as a line of its own, in the same labelled form
   * he gets on Telegram (`[system · …]`). Never spoken, never her caption, never her face. An event
   * like `glanced`: the page clears it when she next speaks or a new turn begins.
   */
  | { type: "notice"; text: string; ts: number };

// ── Face -> Mind ─────────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: "presence"; signals: PresenceSignals }
  /**
   * Eric spoke or typed back.
   *
   * `voice` rides along when he SPOKE and the page could measure the sound, three numbers, and
   * only numbers: loudness, characters per second, and the share of the utterance that was
   * silence. The audio itself does not travel this link (see `how-he-sounds.ts` for what she does
   * with them, and `what-leaves-this-machine.test.ts` for what the page does and does not send).
   *
   * OPTIONAL, AND ABSENT MEANS UNKNOWN. He typed, or an older client is connected, or the
   * microphone was off, none of those is "he sounded ordinary", and nothing downstream may fold
   * a missing voice into the middle of the range.
   */
  | { type: "reply"; text: string; voice?: VoiceSample }
  | { type: "interrupt" }; // barge-in

// ── Serialization ─────────────────────────────────────────────────────────────

export function encodeFace(m: FaceMessage): string {
  return JSON.stringify(m);
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Validate + narrow an inbound client frame. Returns null for anything malformed. */
export function decodeClient(raw: string): ClientMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const m = obj as Record<string, unknown>;
  switch (m.type) {
    case "interrupt":
      return { type: "interrupt" };
    case "reply": {
      if (typeof m.text !== "string") return null;
      // A malformed voice drops the VOICE, never the words. He said something either way, and
      // losing his sentence because a browser sent a NaN would be the perception feature silencing
      // the thing it was built to enrich.
      const v = m.voice as Record<string, unknown> | undefined;
      const voice = v && isFiniteNum(v.loudness) && isFiniteNum(v.pace) && isFiniteNum(v.pauses)
        ? { loudness: v.loudness, pace: v.pace, pauses: v.pauses }
        : undefined;
      return voice ? { type: "reply", text: m.text, voice } : { type: "reply", text: m.text };
    }
    case "presence": {
      const s = m.signals as Record<string, unknown> | undefined;
      if (!s || !isFiniteNum(s.idleSeconds)) return null;
      return {
        type: "presence",
        signals: {
          idleSeconds: s.idleSeconds,
          frontAppFocused: s.frontAppFocused === true,
          dndOrFocus: s.dndOrFocus === true,
          screenSharing: s.screenSharing === true,
          micActive: s.micActive === true,
          // All three ride together or not at all, they come from one open curtain. Each is
          // narrowed on its own so a malformed one drops itself rather than the whole frame, and
          // every one of them is UNDEFINED rather than a default when absent: a closed curtain and
          // an empty room must never become the same reading.
          cameraPresent: typeof s.cameraPresent === "boolean" ? s.cameraPresent : undefined,
          motion: isFiniteNum(s.motion) ? s.motion : undefined,
          stillSeconds: isFiniteNum(s.stillSeconds) ? s.stillSeconds : undefined,
        },
      };
    }
    default:
      return null;
  }
}
