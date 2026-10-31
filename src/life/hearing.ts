// 感官补全 (hearing), her ear: his voice message, transcribed words plus the sound's
// physical shape. The ear is an ORGAN, not an author (seeing.ts's law extended): it reports
// what was said and how the sound was, speed, pitch, pauses, roughness, and NEVER guesses
// a feeling's cause. What she makes of his voice is hers. Audio files are not kept; the
// transcription is the forensic record (instruments/hears.jsonl). S-61.

/** What the hearing core is told. Machine-facing, but it PRODUCES her material, 材料律. */
export const HEAR_SYSTEM = [
  "把这段声音如实记下来：他说了什么词（逐字），声音的物理性状（快慢、高低、停顿、沙哑）。",
  "两三句，中文。",
  "不猜任何人的心情或原因，不给建议，不称呼谁，不提录音或音频文件，就写听见的本身。",
].join("\n");

/** Her ear's report, as it appears in her material. */
export function earReport(transcription: string): string {
  return `他说给你听的（语音），耳朵带回来的：\n${transcription}`;
}

/** The ear failed (download, convert, or transcribe). Honest, never silent. */
export const EARS_FAILED = "听了，这会儿有点听不清。";

/** No ear configured yet: the honest receipt instead of silence. */
export const EAR_NOT_YET = "他发来一段声音，你现在还听不了。";

/** An unseeable medium: the honest receipt line, one per kind. */
export function cannotSeeYet(what: string): string {
  return `他发来${what}，你现在还看不了。`;
}

/** What the watching core is told: frames AND the audio track, one honest record. */
export const WATCH_SYSTEM = [
  "把这段影像如实记下来：画面里有什么、有什么在动、谁说了什么（逐字）、有什么声响。",
  "两三句到四五句，中文。",
  "不评价，不猜任何人的心情，不给建议，不称呼谁，不提视频或文件，就写看见和听见的本身。",
].join("\n");

/** Her watch's report: what he handed over, seen and heard together. */
export function watchReport(transcription: string): string {
  return `他递过来的一段影像，你看见和听见的：\n${transcription}`;
}

/** Inline video ceiling (the native wire's inline_data limit, with headroom). */
export const WATCH_MAX_BYTES = 19_000_000;

/** The clip is beyond the inline ceiling: the honest line, never silence. */
export const WATCH_TOO_BIG = "他发来一段影像，太大了，你看不动。";
