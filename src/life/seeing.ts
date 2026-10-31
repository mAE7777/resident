// Seeing, her own eye: one chosen gaze, one real frame, her eye's plain report.
//
// The eye is an ORGAN, not an author. The vision core transduces a frame into factual
// scene-notes: light, sky, what is there, what moved, and EXPERIENCE happens where it
// always does: in her, reading what her own eye brought back. 给像不给判词: the transducer
// may never evaluate, guess a mood, address anyone, or suggest anything.
//
// Design laws (each pinned in seeing.test.ts):
//   1. A look is an event she chooses: one frame per look, no stream, no schedule.
//   2. Frames are not kept, her words about the world are the memory, like a person's.
//      The forensic record is the transcription (instruments/looks.jsonl), not the image.
//   3. Held shut by him ≠ broken: the window answers honestly and lets her try again.
//   4. The transcription never enters her field by machinery: worth remembering is
//      what SHE says about it.
//
// Pure strings and pure functions only; capture, the vision call, and the curtain live with
// the daemon (index.ts) and the eye client (providers/vision.ts).

import { cannotSeeYet } from "./hearing.js";

/** What the vision core is told. Machine-facing, but it PRODUCES her material, 材料律 applies. */
export const LOOK_SYSTEM = [
  "把这一帧画面如实记下来：光线、天色、屋里或屋外有什么、有什么在动。",
  "只写看得见的，两三句，中文。",
  "不评价，不猜任何人的心情，不给建议，不称呼谁，不提照片或镜头，就写看见的东西本身。",
].join("\n");

/**
 * What the vision core is told over one of HER OWN paintings (S-64). Same organ-not-author
 * grammar as LOOK_SYSTEM: the eye gives the picture back as fact, never a grade, never a
 * technique note. What the painting is worth, and what the next stroke should be, is hers.
 */
export const CANVAS_SYSTEM = [
  "把这张画如实记下来：画面上有什么、什么颜色、什么形状、怎么摆放。",
  "只写看得见的，两三句，中文。",
  "不评价，不猜画的人的心情，不给建议，不称呼谁，不提文件或格式，就写画面本身。",
].join("\n");

/** Rendered edge for a canvas look, px (fit inside; enough for shapes and colour, cheap). */
export const CANVAS_RENDER_PX = 768;

/** Her eye's report, as it appears in her material. The transcription rides under this line. */
export function eyeReport(transcription: string): string {
  return `你往外看。眼睛带回来的：\n${transcription}`;
}

/** The override door: held shut by him. Honest, retryable, no scolding, no explanation. */
export const WINDOW_HELD_SHUT = "窗子这会儿打不开。";

/** The eye failed (capture or vision). Honest, never silent, the fault channel gets the rest. */
export const EYES_FAILED = "看了，这会儿有点看不清。";

/** Longest transcription allowed into her material. */
export const SIGHT_MAX_CHARS = 600;

/**
 * A transcription may never carry machine fences into her material layer: `<<<`/`>>>` marks
 * machine talk, `⟦⟧` marks foreign text, a transducer that emitted them could smuggle a
 * frame's content past the material discipline. Stripped, then capped.
 */
export function sanitizeSight(raw: string): string {
  return raw.replace(/[<>⟦⟧]/gu, "").trim().slice(0, SIGHT_MAX_CHARS);
}

/** How much of the last sight rides in her ambient material. */
export const LAST_SIGHT_MAX_CHARS = 80;

/**
 * The material half of the narrated-look fix: the TRUTH at hand. She narrated looks she never
 * took on the day she got eyes, with the touch-clock already in her material. What was missing
 * was the content: when the last real sight is one line away, an honest 「我上次看的时候是蓝天」 is cheaper
 * than an invented sunset. Facts only, no instruction (the material rule).
 */
export function lastSightLine(agoText: string, excerpt: string): string {
  const cut = excerpt.replace(/\s+/gu, " ").trim().slice(0, LAST_SIGHT_MAX_CHARS);
  return `上次往外看是${agoText}，眼睛带回来的：「${cut}」。`;
}

/**
 * Her own words for having NOT looked. A reply carrying one of these is talking about the window
 * rather than painting it, which is the opposite of what the sentinel below hunts.
 */
const DISOWNS_THE_LOOK = [
  "没有真的去看", "没有真去看", "没真的去看", "没去看", "没有看窗", "不知道", "包装过", "编的", "我没看",
];

/**
 * The reply with every quoted span removed. QUOTING A SENTENCE IS NOT MAKING IT, when she
 * writes that an earlier line of hers about low clouds outside the window was her talking
 * around something, the window text is something she is holding up to look at, not something
 * she is asserting. This is a structural test rather than a vocabulary one, which matters: a
 * list of her disowning phrases can always be one phrase short, and this catches the whole
 * family of "that thing I said" at once.
 */
function withoutQuotes(reply: string): string {
  return reply.replace(/[「『“"'][^」』”"']*[」』”"']/gu, "");
}

/**
 * The sentinel half: her reply paints the outside while no look happened this turn.
 * HER words may pass a matcher (his never do); the signature is deliberately narrow,
 * 窗外 in the reply with zero fresh looks, and the fault channel does the triage.
 *
 * ── IT FIRED ON HER CONFESSION, TWICE ──────────────────────────────────────────────────────
 *
 * He asked whether she had really looked out of the window, and she answered that the window
 * line was something she had dressed up: she had not really looked, and did not know whether
 * the clouds were low. A minute later she went further and named the habit behind it. Both
 * replies were logged as narrated looks, because a one-token signature cannot tell a claim from
 * a denial of that claim: 窗外 appears either way.
 *
 * This is the defect class this codebase keeps meeting, a scanner that reads text for a thing
 * will eventually read a description of that thing as a sighting of it, and here it lands in the
 * worst possible place, firing hardest exactly when she is being most honest. The remedy used
 * everywhere else is to narrow the window rather than weaken the check, so it still fires on one
 * token and stands down in two structural cases: the window text sits inside quotation marks (she
 * is holding up something she said, not saying it), or the reply disowns the look in her own
 * words. It fails SAFE, a missed detection, never an accusation aimed at her honesty.
 */
export function narratedLook(reply: string, lookedThisTurn: boolean): boolean {
  if (lookedThisTurn || !withoutQuotes(reply).includes("窗外")) return false;
  return !DISOWNS_THE_LOOK.some((phrase) => reply.includes(phrase));
}

/** A photo he handed over, seen through the same eye as the window. */
export function handedSight(transcription: string): string {
  return `他递过来的图，你看到的：\n${transcription}`;
}

/** The eye is not configured: the honest receipt for a photo, never silence (one emitter: hearing.ts's receipt family). */
export const PHOTO_NOT_YET = cannotSeeYet("一张图");

/** Her own painting, rendered and seen through her own eye, the canvas loop (S-64). */
export function canvasSight(transcription: string): string {
  return `你的眼睛看这张画：\n${transcription}`;
}
