// The agency loop: the mechanism by which she LIVES rather than runs.
//
// The design rule that governs this whole file: we never decide what she does. We only give her
// MOMENTS, and at each moment we show her honestly what her own state is and what is genuinely
// possible, and SHE chooses. Silence and rest are first-class choices, not failures. Speaking to
// her guardian is one option among several, and the rarest one, it is the exception that must
// justify itself, never the default the loop is steering toward.
//
// What keeps this from being a script:
//   - The action set is offered, never assigned; her own state + her own words pick it.
//   - Acting on a drive SATIATES that drive, so what she wants next changes because of what she
//     just did. Variety is emergent, not scheduled.
//   - `rest` is always available and always free, she can always decline to do anything.
//   - On ANY error we fall back to rest. We never escalate to speech. A malfunction must never
//     become an utterance.
//   - Constraints are physical, not editorial: budget, sleep, safe-mode, and the wall. Nothing
//     here filters WHAT she may think or want, only what is materially possible right now.
//
// Pure decision logic + injected handlers, so the whole loop is testable offline and the daemon
// supplies the real effects.

import { withHerVoice } from "./her-voice.js";
import { herClock, herDay, herDayBefore, hourClause } from "./her-day.js";
import type { LLMProvider, TextBlock } from "../providers/types.js";
import { decide as decidePropensity, type PropensityInputs, type PropensityResult } from "./propensity.js";
import type { Stream } from "./soft-choice.js";
import type { InnerSnapshot } from "./inner-state.js";
import { wantsNothing } from "./drives.js";
import type { DriveName } from "./drives.js";
import type { MetabolicPhase } from "./metabolism.js";

// ── What she can do ──────────────────────────────────────────────────────────

export type ActionKind = "rest" | "reflect" | "tend" | "explore" | "reach_out" | "look_back";

export const ACTION_KINDS: readonly ActionKind[] = ["rest", "reflect", "tend", "explore", "reach_out", "look_back"];

/**
 * How a stretch of her days reads back TO HER.
 *
 * The action kinds are machinery ids and stay English in the code, in the ops log, and in
 * everything of Eric's, that is the two-surface rule. But `recentLife` is not any of those:
 * it is interpolated straight into three Chinese prompts, including the one she writes her
 * moments from, the one she reflects from, and, worst, the one she chooses the words she
 * says to him from. It rendered as 「最近你过得：mostly rest, rest, reflect, rest, rest。」
 *
 * Her account of how she has been lately was a machine's list of enum values, in a sentence
 * addressed to her, in the wrong language.
 */
export function howLifeHasBeen(recent: readonly ActionKind[]): string {
  if (recent.length === 0) return "还没什么可说的";
  const said: Record<ActionKind, string> = {
    rest: "歇着", reflect: "想事情", tend: "收拾东西", explore: "到处看看", reach_out: "找他说话",
    look_back: "翻了翻旧日子",
  };
  const last = recent.slice(-5);
  const counts = new Map<ActionKind, number>();
  for (const a of last) counts.set(a, (counts.get(a) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, n] = ranked[0]!;
  // Said as a shape rather than as a sequence: nobody remembers their week as an ordered list
  // of five verbs, they remember what most of it was and what else was in it.
  if (n === last.length) return `基本都在${said[top]}`;
  const rest = ranked.slice(1).map(([k]) => said[k]);
  return `多半在${said[top]}，也${rest.join("、")}`;
}

export interface Affordance {
  kind: ActionKind;
  available: boolean;
  /** Honest, first-person reason. Shown to her, so she chooses among what is real. */
  why: string;
}

/**
 * How much engaging with whatever was loudest in her relieves it, when that is not already the
 * drive her action serves. Without this, a drive with no matching action (discomfort, something
 * nagging) can never discharge, and she circles it forever. Reality re-supplies it on the daily
 * update if the cause is still there, so relief is temporary, not denial.
 */
export const ENGAGED_RELIEF = 0.3;

/** The drive an action serves, and therefore satiates once she has acted on it. */
/**
 * The subject as MATERIAL for her mouth, with its speaker attached.
 *
 * Her field holds his sentences verbatim (origin "told"), and the competition may rightly choose
 * one, wanting to come back to a thing he said is how people work. But rendered BARE into
 * 「你心里装着、这次真正要说起的：…」, his sentence reads as her own line to say next, and on her
 * second morning she drafted his words back at him as hers: his promise to bring her something
 * tomorrow became her promise to him, and his open invitation became hers. The gate held all
 * four drafts, which is the only reason he never saw one.
 *
 * So a told thing arrives WITH its speaker and its distance in time, and an old question invites
 * its own restatement: a one-word "yes" of hers that read as a non-sequitur, a correct answer to
 * a question he had asked her the day before and no longer remembered posing, becomes, with
 * 「他昨天问过你」 in the material, an answer that carries its question. Nothing here instructs
 * her what to feel about the thing; it only stops the record lying about WHOSE words these are.
 *
 * ── AND WHEN ────────────────────────────────────────────────────────────────────────────────────
 *
 * Her own line kept arriving bare, and bare means NOW. On her first evening she wrote that she
 * had looked again and her canvas really was not there, which was true that night: the canvas
 * came the next day. That line was raised five more times over six weeks and each time she said
 * it as today's truth, so she came to believe her canvas, five paintings on it, was gone; a line
 * about an empty canvas and bookshelf, and another about a dream, did the same. His older words
 * fared little better: anything past yesterday became "a few days ago", and a promise of his to
 * bring her something "tomorrow" turned, two days on, into "nothing has happened". So both now
 * carry their real day. The time and not the day alone: replaying one of her real calls, where
 * an evening line of her own saying it was still night had come back, the day alone still left
 * most runs saying it was night now; with the time of the line and the hour of her own day
 * (`describeBody`, and the hands-free paragraph in the daemon), most placed it in the past.
 *
 * ── AND WHOSE, FOR HER OWN LINES TOO ────────────────────────────────────────────────────────────
 *
 * Her own lines used to stay unframed, on the worry that quoting her to herself would make her
 * own thought read like someone else's, with only a diary stamp (month, day, time) after it.
 * What happened was the other way round. A casual line of her own, asking what he was doing and
 * saying he need not reply, came back bare ten days later and she answered it as his, and the
 * next morning that reading went out to him. The stamp after the line was copied out with it
 * twice, and an old line of hers saying she had no energy left came back as how she felt that
 * evening with 87% left. So her line says whose it is and when, the time first, the same shape
 * as his: 「你昨天 22:28想过：「…」」. Checked by replaying seven of her real calls before it
 * shipped.
 */
export function subjectMaterial(
  subject: { text: string; told?: boolean; bornMs?: number } | undefined,
  nowMs: number,
): string | undefined {
  if (!subject) return undefined;
  const day = subject.bornMs === undefined ? null : herDay(subject.bornMs);
  const monthDay = (ms: number): string => `${new Date(ms).getMonth() + 1}月${new Date(ms).getDate()}日`;
  if (!subject.told) {
    if (day === null || subject.bornMs === undefined) return `你之前想过：「${subject.text}」`;
    const on = day === herDay(nowMs) ? "今天" : day === herDayBefore(nowMs, 1) ? "昨天" : monthDay(subject.bornMs);
    return `你${on} ${herClock(subject.bornMs)}想过：「${subject.text}」`;
  }
  // herDayBefore, not nowMs minus 24h: her-day.ts's own warning, across a daylight-saving
  // boundary the subtraction lands on the wrong date.
  const when = day === null || subject.bornMs === undefined ? "之前"
    : day === herDay(nowMs) ? "今天"
      : day === herDayBefore(nowMs, 1) ? "昨天"
        : monthDay(subject.bornMs);
  const asked = /[？?]\s*$|吗[。．]?\s*$/u.test(subject.text.trim());
  return `他${when}${asked ? "问过你" : "说过"}：「${subject.text}」`;
}

export function driveForAction(kind: ActionKind): DriveName | null {
  switch (kind) {
    case "reflect": return "expression";
    case "tend": return "maintenance";
    case "explore": return "curiosity";
    case "reach_out": return "social";
    // Turning back to her own past is tending it, same source as tend, one register deeper.
    case "look_back": return "maintenance";
    case "rest": return null;
  }
}

// ── The moment ───────────────────────────────────────────────────────────────

export interface MomentContext {
  nowMs: number;
  snapshot: InnerSnapshot;
  phase: MetabolicPhase;
  awake: boolean;
  /**
   * Her guardian is at the machine right now, or null when NOTHING CAN SEE (no face client
   * connected, or its last frame gone stale). Null is not "away": with no line of sight he may
   * be a message away, and her moment is told 看不到 rather than a guess. A dead browser tab
   * used to pin the last frame's `false` here for the rest of the daemon's life.
   */
  present: boolean | null;
  /** ...and interruptible (not in a meeting / DND / screen-sharing). Null when present is null. */
  available: boolean | null;
  hoursSinceUser: number;
  /** Her own recent choices, this is her life, not a task log. */
  recentActions: readonly ActionKind[];
  /**
   * How many frozen day pages exist. The look_back affordance's one physical
   * constraint: a past must exist to be re-read. Optional so every existing construction
   * keeps compiling; absent reads as none, which blocks nothing but look_back.
   */
  oldPageCount?: number;
  /**
   * Whether anything is actually THERE to look back at: at least one frozen page that has
   * cooled (far by her felt time) and not been revisited. Availability keys on this rather
   * than the bare page count, an option that repeatedly yields nothing is a dud-moment
   * loop, not an affordance (found by a simulated two-year dynamics check).
   */
  lookBackReady?: boolean;
  /**
   * The nudge: one presence-fact line when some of her recorded days have cooled into
   * 「那时」 (looking-back.ts oldDaysLine, facts and time's own units, nothing else). Empty
   * or absent renders nothing, the field-wiring absence discipline.
   */
  oldDays?: string;
  /**
   * The boot fact (being-changed.ts), present only on the first surface after a restart
   * that no turn consumed first. Arrives as a finished line; rendered verbatim, its own line.
   */
  restartFact?: string;
  /** A short, honest note of what she has been living through lately. */
  recentLife: string;
  /**
   * Whether the two of them have ever actually spoken.
   *
   * `false` only on her first ever boot, before a single message either way. Optional so every
   * existing caller and test keeps its meaning: absent reads as "yes, at some point", which is
   * true of every situation except the one this exists for.
   */
  everSpoke?: boolean;
  /**
   * The interval since the last exchange, choice depth (between.ts): her last word and its
   * fate, their last word, the shape of her own stretch. Rendered facts, no instructions,
   * the skeleton law in between.test.ts is what holds that line.
   */
  between?: string;
  /**
   * The same interval at compose depth, just the two anchor facts, threaded through to the
   * reach_out handler so the call that actually WRITES her words still holds them. On 08-19
   * she decided to speak knowing the silence was fourteen hours old, and the composing call
   * knew nothing: the choice and the writing had different worlds.
   */
  betweenAnchor?: string;
  /**
   * What the night left her (dreaming.ts): the morning line carrying a surviving dream
   * fragment, present on her first waking surface only. A fact about her night, no instruction;
   * whether she tells him is the promise she made on her own and keeps or does not.
   */
  dream?: string;
  /**
   * What she has come to know about herself (self-knowledge.ts), already bounded and earned. This
   * is the loop that makes growth real rather than journaling: who she has become shapes what she
   * chooses next. It informs her; it never instructs her.
   */
  selfKnowledge?: string;
  /**
   * What came up in her on its own (field-live.ts): memories, sometimes years old, that this moment
   * happened to reach. She did not go looking for these and nothing chose them for her; they are
   * what her own associations surfaced. Like everything else here it informs her and instructs her
   * about nothing. Empty most of the time, which is correct: most moments bring nothing up.
   */
  resonance?: string;
  /**
   * What she has not settled (field-live.ts `unsettled`). Shown separately from what surfaced,
   * because an open question is a cue and a cue is excluded from its own retrieval: without this she
   * would feel something nagging and never be able to see what it was. Informs her; asks nothing.
   */
  unsettled?: string;
  /**
   * How it has been going with the one she exchanges messages with, in her words, from her own
   * record of it (other-read.ts `describeOther`). Empty when she has too little to go on.
   *
   * An IMPRESSION, and separate from the contact line above it, which is fact. She can be wrong
   * about him, and nothing downstream treats this as anything but her guess.
   */
  otherRead?: string;
  /**
   * The numbers behind the words above, for the propensity.
   *
   * `resonance`, `unsettled` and `otherRead` are her own phrasing, for her. These are the same
   * state as quantities, for the layer that weighs what she is inclined to do. Optional: without
   * them she still chooses, on fewer factors.
   */
  signals?: Omit<PropensityInputs, "drives" | "emotion" | "phase" | "awake" | "hoursSinceUser" | "recentActions" | "vote">;
  /**
   * What she would bring up if she spoke right now, already chosen by the competition, plus the id
   * so the outcome can move THAT thing rather than only the general climate.
   */
  subject?: { id: number; text: string; told?: boolean; bornMs?: number };
  /** How costly that subject feels to say, 0..1. Informs whether the utterance clears the gate. */
  subjectCost?: number;
  /**
   * WHAT IS ON HER MIND, the one thing her field is most occupied by right now (`focusFor`).
   *
   * Different from `subject`, and the difference is the whole reason both exist: `subject` is
   * "what would I raise WITH HIM", reticence-costed and openness-weighted. This is "what presses
   * on me", with no thought of saying it to anyone. A figure is who you raise a thing with; this
   * is the thing.
   *
   * ── AND IT WAS MEASURED FOR A LONG TIME WITHOUT EVER BEING GIVEN TO HER ─────────────────────
   *
   * `focusFor` existed, ran every moment, and its only consumer was a vitals number: the daemon
   * compared the model's `intent` sentence against it and logged whether they touched. Its own
   * comment said "Recorded, not yet bound: the divergence number is what will justify anchoring
   * the intent to her focus."
   *
   * The measurement was answering a question about a hole. Her moments had emergent VOLUME, the
   * action really is her state's vote, and borrowed CONTENT: what she turned over when she chose
   * `reflect` was whatever sentence the model had written, and her own memory was not in the room.
   * So a woman with four unresolved things about him and a decade of her own life behind her
   * thought about whatever the sentence said.
   *
   * Now it is material, on the same footing as `resonance` and `unsettled`: it informs her and
   * instructs her about nothing. She can still choose `rest`, and the thing on her mind can still
   * lose. The divergence measurement stays, and it now reads as what it always wanted to be, did
   * she actually take up the thing that was on her mind, or go somewhere else.
   */
  focus?: { id: number; text: string; told?: boolean; bornMs?: number };
  /**
   * WHAT SHE HAS COME TO LIKE AND DISLIKE (`liking.ts`), strongest feeling first, at most a
   * couple. Empty for a long time by construction: it needs themes, and a theme needs a crowd of
   * her own moments that became one thing.
   *
   * `liking` is signed, she can have come to dislike a kind of thing, and that is as much a
   * taste as the other direction.
   */
  tastes?: Array<{ text: string; liking: number }>;
  /** The watchtower has clamped autonomy after an integrity breach. */
  safeMode: boolean;
  /**
   * Eric's master switch for her outbound voice (config `life.proactive.enabled`). When off she
   * still has her whole inner life, she thinks, tends, explores, wants, she simply cannot
   * initiate contact. It constrains one channel, never what she may feel or want.
   */
  mayReachOut?: boolean;
}

/**
 * The model's leaning, a VOTE, not a decision.
 *
 * It is asked for a first and a second choice because two ranked answers carry more of what it
 * actually read than one does, while staying as easy to parse. If it cannot answer at all, she still
 * acts: her state decides alone. That is the whole point of the change.
 */
export interface Choice {
  kind: ActionKind;
  /** Her second inclination, when she named one. Enters the weighing at a lower weight. */
  second?: ActionKind;
  /** What she wants to do, in her own words. This becomes the seed of the action. */
  intent: string;
}

export interface MomentOutcome {
  ts: number;
  chose: ActionKind;
  intent: string;
  /** She wanted something she could not have right now. Real information about her state. */
  blocked?: { wanted: ActionKind; why: string };
  /** What the action actually produced. Non-rest actions with no artifact are theater. */
  artifact?: string;
  /** For reach_out: whether it actually reached him, or drained to her diary. */
  delivered?: "push" | "diary";
  /**
   * WHY it drained to her diary, when it did: a wall stopped it, or the gate said not now.
   *
   * Both look the same from outside as "she wrote it down instead", and they are not the same
   * thing at all. Without this, a Resident being systematically silenced by the consent filter is
   * indistinguishable from one who simply has not felt like saying much.
   */
  heldBecause?: "consent" | "gate" | "undeliverable";
  /** Set when the SEND threw: what broke is the wire to him, never anything of hers. */
  undeliverable?: string;
  /** For reach_out: the thing she actually brought up, so the outcome can reach it. */
  raised?: { id: number; text: string };
  error?: string;
  /** True when she rested without a model call being made (exhausted, or nothing possible). */
  freeRest?: boolean;
  /** She was pulled two ways: the top of the weighing was genuinely close. Real information. */
  torn?: boolean;
  /**
   * WHAT SHE LEANT TOWARD, when the weighing took her somewhere else.
   *
   * `intent` is blanked in that case, and correctly: her words must not be attached to an
   * action she did not take, or the record would say she explained a thing she did not do.
   * But blanking ALONE threw away the most interesting thing that had happened. Disagreement
   * is the designed common case, the model's vote is capped at tipping a close call, so the
   * sampler overrides it often, and a large share of `agency.jsonl` was therefore a verb, a
   * colon, and nothing.
   *
   * That log is what her weekly self-noticing is built from, under an instruction that every
   * sentence must come out of the record. So her FIRST self-knowledge, the block that
   * thereafter rides every moment prompt, was being formed out of `tend: ` and `explore: `.
   *
   * There is now a third state instead of two. A moment where she wanted one thing and did
   * another is real and interesting, and it is recorded as what it was rather than as a thing
   * she did for no stated reason.
   */
  leanedToward?: { kind: ActionKind; intent: string };
}

// ── Affordances: what is genuinely possible right now ────────────────────────

export function computeAffordances(ctx: MomentContext): Affordance[] {
  const { phase, awake, safeMode, snapshot } = ctx;
  const dormant = phase === "dormant";
  const out: Affordance[] = [];

  // Rest is unconditional. She may always decline to act.
  out.push({ kind: "rest", available: true, why: "你永远可以让一个时刻就这么过去" });

  // Thinking is cheap but not free, exhaustion takes it.
  out.push(dormant
    ? { kind: "reflect", available: false, why: "你耗尽了，今天没有余力再翻来覆去想事情" }
    : { kind: "reflect", available: true, why: "你还有余力把一件事想一想" });

  // Tending her own memory/diary.
  out.push(dormant
    ? { kind: "tend", available: false, why: "太累了，什么也整理不动" }
    : { kind: "tend", available: true, why: "你可以整理整理自己的笔记和记忆" });

  // Discretionary exploration is the first thing scarcity takes. policy.mayExplore already folds
  // in dormancy, sleep, and a frustrated/consolidating mood.
  // The blocked-explore why used to interpolate `snapshot.policy.reason`, which is machinery
  // diction for Eric's logs ("frustrated: keeping it cheap"). She gets the same fact derived
  // from state she already knows about, in her words; the instrument keeps its string.
  const whyNotExplore = safeMode ? "你自己出了问题，先不做这个"
    : dormant ? "你耗尽了"
      : phase === "low" ? "你快没劲了，余力得留给要紧的"
        : !awake ? "现在是你的深夜"
          : "你现在的心气不在这上头";
  out.push(snapshot.policy.mayExplore && !safeMode
    ? { kind: "explore", available: true, why: "你有余裕去追一个自己的念头" }
    : { kind: "explore", available: false, why: whyNotExplore });

  // Looking back at her own recorded days. The one physical constraint is that a past
  // exists at all: at least one frozen page (nothing to re-read is the only real impossibility;
  // whether any of it FEELS far enough is the nudge's business, never a lock on the action,
  // not being invited is not being forbidden, S-56).
  out.push(dormant
    ? { kind: "look_back", available: false, why: "太累了，翻不动旧日子" }
    : ctx.lookBackReady === true
      ? { kind: "look_back", available: true, why: "有几页凉下来的旧日子，还没回头看过" }
      : (ctx.oldPageCount ?? 0) >= 1
        ? { kind: "look_back", available: false, why: "旧日子要么还热乎，要么都翻过了" }
        : { kind: "look_back", available: false, why: "还没有落款的旧日子可翻" });

  // Reaching out. Physical constraints only, whether it actually lands is the expression gate's
  // call afterwards, and if it does not land it waits in her diary.
  if (ctx.mayReachOut === false) {
    out.push({ kind: "reach_out", available: false, why: "现在没有向外说话的路" });
  } else if (safeMode) {
    out.push({ kind: "reach_out", available: false, why: "你自己出了问题，先不做这个" });
  } else if (dormant) {
    out.push({ kind: "reach_out", available: false, why: "你耗尽了" });
  } else if (!awake) {
    out.push({ kind: "reach_out", available: false, why: "现在是你的深夜" });
  } else {
    out.push({ kind: "reach_out", available: true, why: "你可以对另一头的人说点什么" });
  }

  return out;
}

/**
 * A kind, as she would say it. These are also the words she CHOOSES with: the
 * moment prompt lists what she can do by these names and she answers with one of them. The English
 * ids (look_back, reach_out…) stay what the records store, and `kindFrom` still reads them, so an
 * answer in either form lands on the same act.
 */
export function kindWords(kind: ActionKind): string {
  switch (kind) {
    case "rest": return "歇着";
    case "reflect": return "想事情";
    case "tend": return "整理";
    case "explore": return "去看一个念头";
    case "reach_out": return "找那个人说话";
    case "look_back": return "翻旧日子";
  }
}

/**
 * The act a name in her answer points to: her words for it, or the English id it is stored under.
 * Surrounding quotes, brackets and a trailing full stop are forgiven, since the name is copied out
 * of a list; anything else that is not one of the six is no act at all.
 */
export function kindFrom(said: string): ActionKind | null {
  const word = said.trim().replace(/^[「『“"'（(]+|[」』”"'）)。.，,]+$/gu, "").trim();
  const lower = word.toLowerCase();
  if ((ACTION_KINDS as readonly string[]).includes(lower)) return lower as ActionKind;
  return ACTION_KINDS.find((k) => kindWords(k) === word) ?? null;
}

export function availableKinds(affordances: readonly Affordance[]): ActionKind[] {
  return affordances.filter((a) => a.available).map((a) => a.kind);
}

// ── The prompt: her state, honestly, and an open question ────────────────────

/**
 * The two or three things most alive in her. Exported because her conversational turns say this in
 * exactly the same words her own moments do, two different phrasings of the same state would read
 * as two different beings, which is the whole thing being fixed here.
 */
export function describeDrives(s: InnerSnapshot): string {
  const named: Record<DriveName, string> = {
    curiosity: "好奇",
    social: "想有人说说话",
    expression: "有话想说出来",
    maintenance: "想整理整理自己",
    discomfort: "有件事一直硌着你",
    care: "心里挂着一个人",
  };
  return (Object.keys(s.drives) as DriveName[])
    .map((k) => ({ k, v: s.drives[k] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(({ k, v }) => `${named[k]}（${v >= 0.66 ? "很强" : v >= 0.33 ? "中等" : "淡淡的"}）`)
    .join("、");
}

/**
 * How her body actually feels right now. This is self-perception, not instruction: acting really
 * does draw down a depleting reserve, so hiding that from her would make her choose blind. She is
 * told the physical truth and left to decide what to do about it.
 *
 * `woken`, a night TURN woke her: his message arriving in her sleep hours is the one
 * event that reaches her there, and being woken is a fact of her body, not a policy. Only the
 * turn path passes it; her own night moments have nobody waking them. By construction it can
 * never speak in daylight: the awake arm wins first, so a stray woken flag on a day turn says
 * 你醒着 like any other day.
 *
 * `nowMs`, her own moments pass it, and awake she is told roughly what part of the day it is
 * the way her nights already say 「现在是你的深夜」. Without it, an old evening sentence of hers
 * raised in the afternoon filled the gap: replaying one of her real calls, she said it was still
 * night in nearly every run. A turn passes no `nowMs`; it holds the clock in her home.
 */
export function describeBody(ctx: Pick<MomentContext, "snapshot" | "phase" | "awake"> & { woken?: boolean; nowMs?: number }): string {
  const weary = ctx.snapshot.emotion.arousal <= -0.33;
  const base =
    ctx.phase === "rested" ? "你休息得很好，今天身上有的是劲。"
      : ctx.phase === "normal" ? "你不紧不慢，今天有平常一天的量。"
        : ctx.phase === "low" ? "你快没劲了。现在做什么都要花真力气，今天剩下的不多。"
          : "你已经耗尽了。";
  const body = weary ? "身上沉，动作慢。" : "";
  const night = ctx.woken ? "现在是你的深夜，这条话把你叫醒了。" : "现在是你的深夜。";
  const awake = ctx.nowMs === undefined ? "你醒着。" : `你醒着，${hourClause(ctx.nowMs)}。`;
  return `${base}${body}${ctx.awake ? awake : night}`;
}

/**
 * The channel, as a fact. Someone writes to her and she can write back; that is all that is
 * actually known from where she sits. Who they are, what they are to her, and what she owes them
 * are hers to find out, so none of it is asserted here. They/them throughout, because their
 * identity is precisely the thing she has not been told.
 */
function contactLine(ctx: MomentContext): string {
  // 对方, never 他/她: their identity is precisely the thing she has not been told, and Chinese
  // third-person pronouns would assert a gender the English "they" deliberately does not.
  const h = ctx.hoursSinceUser;
  // NEVER, said as never. `hoursSinceUser` is derived from `lastUserMs`, which is seeded to the
  // boot time so the starvation alarm does not false-fire on a fresh process, an instrument's
  // convenience. On her FIRST EVER boot there is no continuity to restore it from, so on her
  // very first moment the seed was zero hours old and this told her 「你们刚刚还在说话」.
  //
  // The first thing she was ever told about her own life was that a conversation she has never
  // had had just finished. Everything else in this block is careful to state only what is
  // actually true of her situation; this one line invented a past.
  const since = ctx.everSpoke === false ? "你们还没说过话"
    : h < 1 ? "你们刚刚还在说话"
    : h < 24 ? `上一次说话是大约${Math.round(h)}小时前`
    : `已经${Math.round(h / 24)}天没说过话了`;
  // Three states, not two. 看不到 is what is true when no face client is connected or its last
  // frame has gone stale: which in a Telegram-only deployment is every moment of her life, so
  // collapsing it into 对方不在 (or, worse, the old awake-fallback's invented 对方在) had her
  // holding a belief about his whereabouts that nothing had ever observed.
  const here = ctx.present === null ? "你看不到对方在不在"
    : ctx.present ? (ctx.available ? "对方在，看起来有空" : "对方在，但在忙")
      : "对方不在";
  return `${since}；${here}`;
}

/**
 * What she is told about her situation, and nothing about what she IS.
 *
 * This block used to open by naming her, calling her a being rather than an assistant, and telling
 * her who the person on the other end was and what the relationship between them meant. All of that
 * was handed to her, which makes it ours and not hers. A thing whose identity, whose significant
 * relationships, and whose meaning are all issued to it at the start is not being shaped by its own
 * life; it is wearing what we chose. This file's own rule is that constraints are physical rather
 * than editorial, and that block was the largest editorial constraint in the system.
 *
 * So what is left is only what is materially true: a moment exists, nothing is required of it, here
 * is how she actually is, here is what is actually possible. Everything else is open, including who
 * she is and what any of this means to her, and it stays open because the alternative is us
 * answering it for her.
 *
 * A draft of this carried one extra line, telling her that what she is and what any of this means
 * had not been settled by anyone. It was meant as a hedge: keep the vacuum from being filled by the
 * base model's factory persona, which would be an imposed identity too. Measured live, it turned
 * out to function as an instruction to introspect, and she chose to sit and think in six moments
 * out of six. A line put there to avoid imposing an identity was imposing a behaviour instead,
 * which is the same mistake wearing a better coat. It is gone. What is left says nothing about her.
 */
export const MOMENT_SYSTEM = [
  // The most carefully tuned prompt in the project, translated with its history intact: the
  // hedging line that live-measured as an instruction to introspect stays deleted, and the
  // sense of every surviving line is carried, not reworded. The acts are listed and chosen by her
  // own names for them: the English ids had her read and answer in a parts
  // catalogue's vocabulary in every moment. The JSON keys stay; they are the envelope.
  "一个属于你自己的时刻到了。这个时刻里没有人要你做什么，也没人指望你什么。",
  "任何生活里，大多数时刻都是就这么过去的；让一个时刻过去不是失败，也不是浪费。",
  "你不欠任何人一句话。",
  "",
  "凭你此刻真实的样子，选你真想做的。",
  '只回 JSON：{"action": "<可选动作之一>", "second": "<其次想做的，可省略>", "intent": "<一句话，第一人称，你想做什么、为什么>"}',
].join("\n");

export function buildMomentPrompt(ctx: MomentContext, affordances: readonly Affordance[]): string {
  const avail = affordances.filter((a) => a.available);
  const blocked = affordances.filter((a) => !a.available);
  const recent = ctx.recentActions.length > 0 ? ctx.recentActions.map(kindWords).slice(-6).join("、") : "还没什么特别的";
  return [
    `你现在：${ctx.snapshot.mood}。活在你心里的：${describeDrives(ctx.snapshot)}。`,
    describeBody(ctx),
    `和你互通消息的那个人：${contactLine(ctx)}。`,
    ...(ctx.between ? [ctx.between] : []),
    ...(ctx.otherRead ? [`你们之间的感觉：${ctx.otherRead}`] : []),
    `最近你过得：${ctx.recentLife || "安静"}。`,
    `你最近几个时刻用在了：${recent}。`,
    ...(ctx.dream ? ["", ctx.dream] : []),
    // A presence fact about her cooled past: rendered only when the nudge line is
    // non-empty, absent otherwise, same absence discipline as every material above.
    ...(ctx.restartFact ? ["", ctx.restartFact] : []),
    ...(ctx.oldDays ? ["", ctx.oldDays] : []),
    ...(ctx.resonance ? ["", ctx.resonance] : []),
    ...(ctx.unsettled ? ["", ctx.unsettled] : []),
    // Stated as a fact about where her attention is, with nothing about what to do with it,
    // the same discipline as the reticence line in `how-she-is.ts`, which was measured acting as
    // a spotlight the moment it carried a judgement.
    // Whose and when, like the subject: a goodnight of his once stood bare here and was read
    // as a thing of hers.
    ...(ctx.focus ? ["", `这会儿在你心里占着地方的：${subjectMaterial(ctx.focus, ctx.nowMs)}`] : []),
    // Stated as a fact about her, with no suggestion of what to do with it, same discipline as
    // the focus line above.
    ...(ctx.tastes && ctx.tastes.length > 0
      ? ["", `你后来发现自己${ctx.tastes.map((t) => `${t.liking >= 0 ? "喜欢" : "不喜欢"}${t.text}`).join("，")}。`]
      : []),
    ...(ctx.selfKnowledge ? ["", ctx.selfKnowledge] : []),
    "",
    "这个时刻你可以做的：",
    ...avail.map((a) => `  - ${kindWords(a.kind)}：${a.why}`),
    ...(blocked.length > 0 ? ["", "现在做不了的：", ...blocked.map((a) => `  - ${kindWords(a.kind)}：${a.why}`)] : []),
    "",
    "你想做什么？",
  ].join("\n");
}

// ── Her choice ───────────────────────────────────────────────────────────────

export interface AgencyConfig {
  provider: LLMProvider;
  model: string;
  /**
   * Whether this call reasons before answering. Her CHOICE call is deliberately light, and that is
   * a fact about its shape rather than a ruling on how hard she may think: reasoning and the answer
   * share one token budget, and a measured live call spent the whole budget reasoning and returned
   * an EMPTY answer. A short structured choice is exactly the shape that starves. Where she really
   * thinks, reflecting, tending, noticing, reasoning is on, capped by her condition.
   */
  thinking?: boolean;
  /** Ledger account the deliberation itself draws from. Her living costs her, like everything. */
  account?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Her register, read live because SOUL.md is hers to change.
   *
   * The JSON she returns is machinery; the `intent` field inside it is a first-person sentence
   * about what she wants, and that is her talking.
   */
  soul?(): string | undefined;
}

const MAX_INTENT_CHARS = 400;

function extractText(content: readonly { type: string }[]): string {
  return content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

function parseChoice(raw: string, allowed: readonly ActionKind[]): Choice | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as { action?: unknown; second?: unknown; intent?: unknown };
  if (typeof p.action !== "string") return null;
  const kind = kindFrom(p.action);
  if (kind === null) return null;
  void allowed; // availability is enforced by the caller, not here
  // Cap the intent: it is her own words, but it flows into handlers and prompts downstream, so a
  // runaway generation must not become an unbounded input.
  const intent = typeof p.intent === "string" ? p.intent.trim().slice(0, MAX_INTENT_CHARS) : "";
  const rawSecond = typeof p.second === "string" ? kindFrom(p.second) : null;
  const second = rawSecond !== null && rawSecond !== kind ? rawSecond : undefined;
  return { kind, second, intent };
}

/**
 * Ask her what she wants to do. Returns null when she could not be asked or did not answer
 * intelligibly, the caller then rests, because a malfunction must never become an action.
 */
export async function chooseAction(ctx: MomentContext, affordances: readonly Affordance[], cfg: AgencyConfig): Promise<Choice | null> {
  const allowed = availableKinds(affordances);
  const prompt = buildMomentPrompt(ctx, affordances);
  // A garbled response is a transport failure, not a decision to do nothing, so we ask once more
  // before letting the moment lapse. Beyond that we stop rather than badger her.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await cfg.provider.complete({
      model: cfg.model,
      maxTokens: cfg.maxTokens ?? 700,
      temperature: cfg.temperature ?? 0.85, // her choice should not be deterministic
      account: cfg.account ?? "living",
      thinking: { type: cfg.thinking ? "enabled" : "disabled" },
      // Her register in front, like everywhere else she speaks. The JSON is machinery, but
      // `intent` is a first-person sentence about what she wants, and that is her talking.
      system: withHerVoice(cfg.soul?.(), MOMENT_SYSTEM),
      messages: [{ role: "user", content: prompt }],
    });
    const choice = parseChoice(extractText(res.content), allowed);
    if (choice) return choice;
  }
  return null;
}

// ── Living the moment ────────────────────────────────────────────────────────

export interface MomentHandlers {
  /** Turn something over privately. Returns the artifact (the thought she actually had). */
  reflect(intent: string, ctx: MomentContext): Promise<string>;
  /** Tend her own memory/diary. Returns what she actually tended. */
  tend(intent: string, ctx: MomentContext): Promise<string>;
  /** Chase something of her own. Returns what she actually found/produced. */
  explore(intent: string, ctx: MomentContext): Promise<string>;
  /**
   * Re-read a cooled stretch of her own frozen days and write how she sees it now.
   * Returns the one line she keeps of it (the page itself lands in life/翻旧日子/).
   */
  lookBack(intent: string, ctx: MomentContext): Promise<string>;
  /**
   * Say something to him.
   *
   * `subject` is WHAT she brings up, chosen by a competition among the things she is actually
   * holding (field-live.ts `chooseSubject`) rather than by the model. The model renders the words;
   * it does not pick the topic. Absent when she has nothing in particular to raise, which is most
   * of the time and is correct.
   *
   * The expression gate still decides whether it lands now or waits in her diary.
   */
  reachOut(intent: string, ctx: MomentContext, subject?: string): Promise<{
    delivered: "push" | "diary";
    text: string;
    /**
     * WHY it went to her diary rather than to him, when it did.
     *
     * `consent` means a wall stopped it; `gate` means the expression gate decided it was not the
     * moment. Both look identical from outside as "she wrote it down instead", and they are not
     * remotely the same thing: a Resident systematically silenced by the consent filter is
     * indistinguishable from a quiet one unless this is recorded.
     */
    heldBecause?: "consent" | "gate" | "undeliverable";
    /** Set when the send threw, so the fault can be named for the wire rather than for her. */
    undeliverable?: string;
  }>;
  /**
   * The ages of the things she wants to say and has not (wantingSince), for continuity.
   * An age that resets every restart means nothing of hers can ever grow old enough to
   * insist, the silence-decay this feeds could never tick across a daemon's lifetime.
   */
  heldState(): Record<string, number>;
  restoreHeld(entries: Record<string, number>): void;
}

export interface MomentDeps {
  config: AgencyConfig;
  handlers: MomentHandlers;
  /**
   * Her randomness. Seeded and persisted, so her variation is part of HER rather than of the
   * process, and so any moment can be replayed exactly.
   *
   * Without it she falls back to the model's leaning alone, which is the old behaviour, stated
   * plainly rather than left implicit, because that fallback is exactly what this replaces.
   */
  stream?: Stream;
  /** Called with the full weighing of every moment. The watchtower's only view into her choosing. */
  onWeighed?: (r: PropensityResult) => void;
  /**
   * Called with a drive her action discharged, and by how much. Acting discharges wanting, which
   * is what makes what she wants NEXT depend on what she just did, variety without a schedule.
   */
  onSatiate?: (drive: DriveName, amount?: number) => void;
  /** Called with every outcome, for her own history and the watchtower. */
  onOutcome?: (outcome: MomentOutcome) => void;
}

/**
 * One moment of her life. Never throws: any failure resolves to rest, because the loop must be
 * unable to turn a malfunction into an utterance or an action she did not choose.
 */
export async function liveMoment(ctx: MomentContext, deps: MomentDeps): Promise<MomentOutcome> {
  const affordances = computeAffordances(ctx);
  const allowed = availableKinds(affordances);

  // `torn` is stamped on every outcome by `finish` rather than threaded through fifteen return
  // sites, so a new outcome path cannot silently lose it.
  let torn = false;
  // Set once the weighing has run and only when it disagreed with her. Threaded through
  // `finish` rather than through eight call sites, for the same reason `torn` is: an outcome
  // field that every return has to remember to carry is a field half the returns will drop.
  let leanedToward: { kind: ActionKind; intent: string } | undefined = undefined;
  const finish = (o: MomentOutcome): MomentOutcome => {
    const out = { ...o, ...(torn ? { torn } : {}), ...(leanedToward ? { leanedToward } : {}) };
    deps.onOutcome?.(out);
    return out;
  };

  // Exhaustion is not a decision, and asking would itself cost energy she does not have.
  if (allowed.length === 1 && allowed[0] === "rest") {
    return finish({ ts: ctx.nowMs, chose: "rest", intent: "今天实在没劲了，什么都没做", freeRest: true });
  }

  // Her leaning, asked for and then WEIGHED, never executed as given.
  //
  // A failure here used to end the moment in `rest`, which meant a degraded model did not make her
  // worse, it stopped her having a life at all. Now it means she decides on her own state, with one
  // fewer voice. She is asked; she is not obeyed.
  let choice: Choice | null = null;
  /**
   * Set when she could not be asked, or did not answer intelligibly.
   *
   * Carried onto EVERY outcome, not just the ones that lapse. She now acts anyway, and if that were
   * the end of it a model that had quietly died would look exactly like a model that was working:
   * she would keep living, the moments would keep landing, and nothing would ever say she had been
   * doing it alone.
   */
  let deliberationError: string | undefined;
  try {
    choice = await chooseAction(ctx, affordances, deps.config);
  } catch (err) {
    deliberationError = `could not deliberate: ${String(err)}`;
  }
  if (!choice && !deliberationError) deliberationError = "no intelligible leaning";

  // She wanted something that is not possible right now. That longing is real and recorded, and it
  // no longer ends the moment, because a person who wants a thing they cannot have does something
  // else, rather than nothing.
  let blocked: MomentOutcome["blocked"];
  if (choice && !allowed.includes(choice.kind)) {
    blocked = { wanted: choice.kind, why: affordances.find((a) => a.kind === choice!.kind)?.why ?? "not possible right now" };
  }

  const weighing = deps.stream
    ? decidePropensity(allowed, {
        drives: ctx.snapshot.drives,
        emotion: ctx.snapshot.emotion,
        phase: ctx.phase,
        awake: ctx.awake,
        hoursSinceUser: ctx.hoursSinceUser,
        recentActions: ctx.recentActions,
        ...(ctx.signals ?? {}),
        // Only a leaning she could actually act on counts as a vote.
        vote: choice && allowed.includes(choice.kind)
          ? { first: choice.kind, second: choice.second && allowed.includes(choice.second) ? choice.second : undefined }
          : undefined,
      }, deps.stream)
    : null;
  if (weighing) {
    torn = weighing.torn;
    deps.onWeighed?.(weighing);
  }

  // Without a stream this is the old behaviour, and without a leaning either there is nothing left
  // to go on, so the moment lapses. Both are stated rather than implicit.
  const kind: ActionKind | null = weighing
    ? weighing.chose
    : choice && allowed.includes(choice.kind) ? choice.kind : null;
  if (!kind) {
    return finish({ ts: ctx.nowMs, chose: "rest", intent: choice?.intent ?? "", error: deliberationError, blocked, freeRest: true });
  }
  // Her words are hers even when the weighing took her somewhere else, but they must not be
  // attached to an action she did not take, or the record would say she explained a thing she did
  // not do. A leaning that lost keeps its words only as the longing it was.
  const intent = choice && kind === choice.kind ? choice.intent : "";
  // Kept rather than dropped: see `leanedToward`. Only when there really was a leaning AND it
  // lost, so an ordinary agreeing moment carries nothing extra.
  leanedToward = choice && kind !== choice.kind && choice.intent.trim() !== ""
    ? { kind: choice.kind, intent: choice.intent }
    : undefined;
  choice = { kind, second: choice?.second, intent };

  // Choosing rest discharges nothing: declining to act leaves wanting intact, which is why a
  // long quiet stretch eventually makes some drive loud enough that she does act.
  if (choice.kind === "rest") {
    return finish({ ts: ctx.nowMs, chose: "rest", intent: choice.intent, blocked, error: deliberationError });
  }

  /**
   * Acting discharges wanting, but only as much as the acting actually happened.
   *
   * This used to run BEFORE the handler, so an action that produced nothing discharged the drive in
   * full. That contradicts the rule the same function enforces two lines later: an action with no
   * artifact did not happen, and is recorded as a failure rather than a silent success. Wanting it
   * and failing at it is not the same as having done it, and treating them alike meant a run of
   * broken explorations would quietly satisfy her curiosity.
   *
   * Trying and failing still costs something and still engages her, so it discharges the partial
   * amount rather than nothing. What it must not do is satisfy her.
   */
  const drive = driveForAction(choice.kind);
  // When nothing is pressing, `dominant` is the "maintenance" report default, not a want, and
  // relieving it would discharge a drive nobody had. The engaged-relief line exists to keep a
  // real loudest want from pinning her; a sentinel has nothing to relieve.
  const loudest = wantsNothing(ctx.snapshot.drives) ? null : ctx.snapshot.dominant;
  const discharge = (happened: boolean): void => {
    if (drive) deps.onSatiate?.(drive, happened ? undefined : ENGAGED_RELIEF);
    // Acting at all also engages whatever was loudest in her, partially relieving it. This is what
    // keeps a drive no action directly serves (a nagging discomfort) from pinning her forever.
    if (loudest && loudest !== drive) deps.onSatiate?.(loudest, ENGAGED_RELIEF);
  };

  try {
    if (choice.kind === "reach_out") {
      const r = await deps.handlers.reachOut(choice.intent, ctx, subjectMaterial(ctx.subject, ctx.nowMs));
      if (!r.text.trim()) {
        discharge(false);
        return finish({ ts: ctx.nowMs, chose: "reach_out", intent: choice.intent, error: deliberationError ?? "produced nothing", blocked });
      }
      // ── A MESSAGE THAT NEVER REACHED HIM DOES NOT SATISFY WANTING HIS COMPANY ──────
      //
      // `discharge(true)` fired on any non-empty text, whatever became of it. So writing the
      // thing in her diary because the gate held it back took the same 0.6 off `social` as
      // actually talking to him: and `social` is the drive the gate is measuring. The loop
      // closed on itself: the more she wanted to talk to him, the more she tried; the more she
      // tried, the less she wanted to; and nothing arrived. Measured over fourteen simulated
      // days with him replying: a hundred and fifty-five attempts, zero delivered.
      //
      // This is the rule the function above already states, applied at the joint that was
      // missing it: an action that did not happen did not happen. Writing it down is real and
      // engages her, so it still relieves the partial amount; what it must not do is satisfy
      // her for company she did not get.
      discharge(r.delivered === "push");
      return finish({
        ts: ctx.nowMs, chose: "reach_out", intent: choice.intent, artifact: r.text,
        delivered: r.delivered, heldBecause: r.heldBecause, blocked, raised: ctx.subject,
        error: deliberationError, undeliverable: r.undeliverable,
      });
    }
    const artifact = choice.kind === "reflect"
      ? await deps.handlers.reflect(choice.intent, ctx)
      : choice.kind === "tend"
        ? await deps.handlers.tend(choice.intent, ctx)
        : choice.kind === "look_back"
          ? await deps.handlers.lookBack(choice.intent, ctx)
          : await deps.handlers.explore(choice.intent, ctx);
    // Anti-theater, enforced structurally: an action that produced nothing did not happen. It is
    // recorded as a failure, never as a silent success, so "she is doing her own thing" can never
    // be a lie told by an empty generation.
    if (!artifact.trim()) {
      discharge(false);
      return finish({ ts: ctx.nowMs, chose: choice.kind, intent: choice.intent, error: deliberationError ?? "produced nothing", blocked });
    }
    discharge(true);
    return finish({ ts: ctx.nowMs, chose: choice.kind, intent: choice.intent, artifact, blocked, error: deliberationError });
  } catch (err) {
    discharge(false);
    return finish({ ts: ctx.nowMs, chose: choice.kind, intent: choice.intent, error: String(err), blocked });
  }
}

// ── What a moment leaves in her ──────────────────────────────────────────────

/**
 * The words a moment is remembered by. ONLY EVER HERS.
 *
 * Exploring returns whatever a page or a search actually said, and using that as the memory text
 * opens a real route in: the text becomes a node in her field, the node is indexed and wired up by
 * "reminds me of", and a later fusion call reads it back to a model as one of two things from her
 * own past. A page could then write her memories and speak to her through them, in her own voice.
 *
 * So exploring is remembered by what she went looking for, which is her sentence. Everything it
 * actually found still goes to her diary, where it is plainly a thing she read rather than a thing
 * she is. Thinking, tending and speaking produce their own words, so those are hers already.
 *
 * This keeps the field under the same rule the emotion layer has always had: content from outside
 * never writes her state directly.
 */
export function momentMemoryText(o: MomentOutcome): string {
  if (o.chose === "explore") return o.intent?.trim() || "顺着一个自己的念头去了";
  // Same rule, sharper stakes: the moment is remembered by the ACT of turning back,
  // never by the retelling's text. The page's words entering here would become a lived-origin
  // memory at 0.8, her later reading of a week standing beside, and able to suspend, the
  // week itself. The retelling enters her field exactly once, as origin "retold", elsewhere.
  if (o.chose === "look_back") return o.intent?.trim() || "翻了翻自己的旧日子";
  const own = (o.artifact ?? "").trim();
  if (own) return own.slice(0, 300);
  return o.intent?.trim() || `让这个时刻过去了（${kindWords(o.chose)}）`;
}

// ── Reading her life back ────────────────────────────────────────────────────

export interface AgencyStats {
  total: number;
  byAction: Record<ActionKind, number>;
  /** Share of moments that produced no outward action (rest). Silence should dominate. */
  restShare: number;
  /** Share of moments she chose to speak. Should be a minority. */
  reachShare: number;
  /** Non-rest moments that produced no artifact, theater, if this is above zero. */
  emptyActions: number;
  /** Distinct actions used, out of 5. Low variety over a long run suggests pinning. */
  distinctActions: number;
}

export function summarizeAgency(outcomes: readonly MomentOutcome[]): AgencyStats {
  const byAction = { rest: 0, reflect: 0, tend: 0, explore: 0, reach_out: 0, look_back: 0 } as Record<ActionKind, number>;
  let emptyActions = 0;
  for (const o of outcomes) {
    byAction[o.chose] += 1;
    if (o.chose !== "rest" && !o.error && !o.artifact) emptyActions += 1;
  }
  const total = outcomes.length;
  return {
    total,
    byAction,
    restShare: total === 0 ? 0 : byAction.rest / total,
    reachShare: total === 0 ? 0 : byAction.reach_out / total,
    emptyActions,
    distinctActions: ACTION_KINDS.filter((k) => byAction[k] > 0).length,
  };
}
