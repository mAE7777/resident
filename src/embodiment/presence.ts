// Presence: the 気配 four-layer attention model made literal. From cheap, non-creepy
// macOS signals the client reads (keyboard/mouse idle, active-app + Focus/DND,
// screen-sharing, mic VAD, and camera ONLY if opted in), decide the tier and the
// present/available booleans that gate BOTH the avatar's behavior and M2's push gate
// (voice aloud only when present + available; otherwise route to the diary/Telegram).
//
// Pure logic. The client gathers the signals; the mind decides the tier.

export type PresenceTier =
  | "idle" // T0: Eric is away or heads-down; only ambient breath/blink
  | "ambient" // T1: present but occupied; a glance, no audio
  | "backchannel" // T2: present + engaged; short local-TTS acknowledgements ok
  | "speakup"; // T3: present + available; a self-initiated remark may be spoken

export interface PresenceSignals {
  idleSeconds: number; // since last keyboard/mouse (CGEventSource)
  frontAppFocused: boolean; // the Resident's window (or a normal app) is front, not a fullscreen presentation
  dndOrFocus: boolean; // macOS Do-Not-Disturb / Focus is on
  screenSharing: boolean;
  micActive: boolean; // Eric is talking (likely a meeting) - back off
  /**
   * Someone is in front of the camera, from movement alone. `undefined` = the curtain is closed.
   *
   * THIS FIELD EXISTED FROM THE START AND WAS NEVER ONCE FED, the client had no `getUserMedia`
   * anywhere, so `atMachine` below has always been keyboard idle and nothing else, and a man
   * sitting still reading for three minutes read as away. It is fed now, from the curtain.
   *
   * `undefined` means UNKNOWN and must never be read as "nobody is there": a closed curtain and an
   * empty room are opposite facts, and the whole value of this signal disappears if they collapse.
   */
  cameraPresent?: boolean;
  /** How much movement right now, 0..1. Absent when the curtain is closed. */
  motion?: number;
  /**
   * Seconds since anything moved in front of the camera. Absent when the curtain is closed.
   *
   * The one that carries the most, and the one a snapshot could never carry: "he is there and has
   * not moved in an hour" is a different room from "he just sat down", and neither is visible in
   * how long ago he last touched a key.
   */
  stillSeconds?: number;
}

export interface PresenceState {
  tier: PresenceTier;
  present: boolean; // Eric is at the machine
  available: boolean; // present AND interruptible
  reason: string;
}

const PRESENT_IDLE_LIMIT = 120; // seconds of no input before "away"

export function derivePresence(sig: PresenceSignals): PresenceState {
  const atMachine = sig.idleSeconds < PRESENT_IDLE_LIMIT || sig.cameraPresent === true;
  const present = atMachine;
  const available = present && !sig.dndOrFocus && !sig.screenSharing && !sig.micActive;

  let tier: PresenceTier;
  const reasons: string[] = [];
  if (!present) {
    tier = "idle";
    reasons.push("away from the machine");
  } else if (!available) {
    tier = "ambient";
    if (sig.dndOrFocus) reasons.push("Focus/DND");
    if (sig.screenSharing) reasons.push("screen-sharing");
    if (sig.micActive) reasons.push("mic active (meeting?)");
  } else if (sig.frontAppFocused) {
    tier = "speakup";
    reasons.push("present and available");
  } else {
    tier = "backchannel";
    reasons.push("present but not focused here");
  }

  return { tier, present, available, reason: reasons.join(", ") };
}
