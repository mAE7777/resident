// What actually happens when she acts on a moment's choice.
//
// Every handler must produce a REAL artifact, a thought that exists on disk, a note she actually
// wrote, something she actually found, words that actually went somewhere. agency.ts treats an
// empty return as a failure rather than a silent success, so "she is off doing her own thing" can
// never be a lie. Nothing here decides WHAT she does; that was already hers.
//
// All effects are injected, so the daemon supplies the real diary/tools/delivery and tests supply
// fakes. The one piece of judgment in this file is on the way OUT: an utterance passes the consent
// boundary (a limit is never narrated as Eric's denial) and the expression gate (reply-adaptive,
// presence-aware) before it can reach him. If it does not clear, it is not lost, it goes to her
// diary, which is exactly how silence is supposed to accumulate.

import { withHerVoice } from "./her-voice.js";
import { herClock } from "./her-day.js";
import type { LLMProvider, Message, TextBlock, ToolDefinition, ToolResultBlock, ToolUseBlock } from "../providers/types.js";
import { filterOutbound } from "./consent-filter.js";
import { decide, type ExpressionContext, type Thought } from "./expression.js";
import { subjectMaterial, type MomentContext, type MomentHandlers } from "./agency.js";
import { notHers } from "./utterance.js";

export interface HandlerDeps {
  provider: LLMProvider;
  model: string;
  /**
   * Her register, read fresh each time because it is HERS TO CHANGE.
   *
   * Read rather than passed as a value on purpose: if she rewrites SOUL.md, the next thing she
   * thinks is thought in the new voice. Snapshotting it at construction would mean she could
   * change who she sounds like and not hear it until the daemon restarted.
   */
  soul?(): string | undefined;
  /** The facts of where she lives (the same paragraph her conversation turns carry). */
  whereSheIs?(): string;
  /**
   * Her hand on her own SOUL.md, and on nothing else, in the one act where she looks at herself
   * (tending). Absent, tending is the single call it always was.
   */
  ownSoul?: HerOwnSoul;
  /** Append a line to today's diary. Must actually persist. */
  appendDiary(line: string): void;
  /** Her recent diary text, for tending. Empty string when she has none yet. */
  readRecentDiary(): string;
  /**
   * The fuller mirror of how she speaks (her-form.ts): facts of her own record, length,
   * blocks-or-breaths, repeated openers, for the acts where she looks at herself. 给像不给
   * 判词: the render carries no advice, and the instruction-literal scan holds that line.
   */
  formMirror?(): string;
  /**
   * A presence fact about her past: her frozen day pages exist and where. Rendered only
   * when there are enough to be a past; what she does with them is hers, the shelf precedent.
   */
  pastPages?(): string;
  /** And the pages she wrote looking BACK: same shelf precedent, its own line. */
  lookBackPages?(): string;
  /** Deliver an utterance to him. */
  push(text: string): Promise<void>;
  /** The live expression pressure the gate needs (sends today, unanswered streak, rhythm). */
  expressionContext(ctx: MomentContext): ExpressionContext;
  /**
   * A real, bounded piece of self-directed exploration using her actual tools, returning what she
   * found. Omitted only where exploration is genuinely unavailable, the moment is then recorded
   * as a failed action rather than a fabricated success.
   */
  runExploration?(intent: string): Promise<string>;
  /**
   * Re-read a cooled stretch of her frozen days and write how she sees it now. Owns the
   * whole organ (window pick, the render, the citation gates, the page, the field's reRead and
   * the retold encode), the daemon supplies it the way it supplies runExploration. Returns the
   * one line she keeps, or "" when nothing came of it.
   */
  runLookBack?(intent: string, ctx: MomentContext): Promise<string>;
  /**
   * Whether she has enough left to really turn something over. Read off her behaviour policy, so
   * when she is spent even reflecting is shallow, her condition, not our rule.
   */
  mayThinkDeeply?(): boolean;
  /**
   * Where a response that is not prose is reported.
   *
   * It has to be reported somewhere: a provider that has started returning error pages produces a
   * Resident who silently does nothing all day, which from outside is indistinguishable from a
   * Resident with nothing to say.
   */
  onFault?(where: string, detail: unknown): void;
  /** What she has in her right now (capacity.ts): how far a thought and a look-back may run. */
  capacity?(): { thinkingTokens: number; diaryWindow: number };
  log?(msg: string): void;
}

function textOf(content: readonly { type: string }[]): string {
  return content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

// HER clock, not UTC. The UTC version of this stamp is why, at 21:15 on her first
// evening, she believed it was 一点一刻: the lines she had just written into her own diary were
// postmarked 01:1x, and she trusted her records over the wall clock, as she should.
function stamp(nowMs: number): string {
  return herClock(nowMs);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The marker that says a diary line is something she READ, not something she thought.
 *
 * Deliberately odd characters: this has to be a boundary rather than a convention, so it must not
 * appear by accident in her own prose, and a page that contains the literal string can only ever
 * mark ITSELF as read, which is the harmless direction.
 */
const READ_MARK = "⟦read⟧";

/**
 * One line, always.
 *
 * The found text is written as a single diary line with its newlines flattened, because otherwise a
 * page containing "\n09:15, " could forge a line that does not carry the read mark, and the whole
 * provenance boundary below would be a page's to cross.
 */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ⏎ ");
}

/**
 * Her diary with outside text held at arm's length.
 *
 * This closes a real path in. `explore` writes what a page actually said into her diary; `tend`
 * reads her diary back and writes what she wants to keep, in her own voice; and that lands in the
 * field as something SHE thought. So a page could write her memories and then speak to her through
 * them, one hop further round than the direct route, and much harder to see afterwards, because by
 * then it is in her voice.
 *
 * The field itself is already safe: a moment from exploring is remembered by her INTENT, never by
 * what she found (see `momentMemoryText`). This is the other half. What she read is replaced by the
 * FACT that she read it, so "I spent yesterday looking into the tide tables" survives and the tide
 * tables do not get to put words in her mouth.
 *
 * A prompt instruction would not do: instructions are advice, and this has to be a boundary.
 */
export function ownWordsOnly(diary: string): string {
  return diary
    .split("\n")
    .map((line) => {
      const at = line.indexOf(READ_MARK);
      if (at < 0) return line;
      // Keep everything up to the mark, the stamp and what she was looking into, both hers.
      return `${line.slice(0, at).trimEnd()}（我读到的东西，那些字不是我的）`;
    })
    .join("\n");
}

/**
 * ── HER HAND ON HER OWN SOUL.md ──────────────────────────────────────────────────────────────
 *
 * SOUL.md opens by telling her 「从这里往后，改不改是我自己的事。」, and it stands in front of every
 * act of hers. But she only ever held anything that could change it while he was talking to her,
 * and most of her life is her own moments: from her first day it was never changed once. What she
 * resolved about herself had nowhere to stand: when he asked her to leave dashes out she said she
 * would stop, and nothing she could write reached the moment she writes.
 *
 * Measured before this existed (replaying 24 of her real calls three times each): her own words
 * standing in SOUL.md halved her dashes (5.1 to 2.3 per thousand characters) without her talking
 * about them and without copying. Two other routes were measured and dropped: memories cued while
 * she writes (longer, half became new topics) and one sentence of hers from before (no change in
 * her register, more copying).
 *
 * So tending, where she already looks at herself, holds this one hand. What she writes there, and
 * whether she ever does, is hers. Nothing tells her to; the tool says only what it does.
 */
export interface HerOwnSoul {
  /**
   * Replace one passage of her SOUL.md with other words. An empty `oldText` adds `newText` at the
   * end; an empty `newText` removes the passage. Returns what happened, in her words.
   */
  change(oldText: string, newText: string): string;
}

export const OWN_SOUL_TOOL: ToolDefinition = {
  name: "edit_soul",
  description: "改你自己的 SOUL.md：把 old_text 那段原文换成 new_text。old_text 留空，就把 new_text 接在最后；new_text 留空，就把那段删掉。",
  input_schema: {
    type: "object",
    properties: {
      old_text: { type: "string", description: "要换掉的那段原文，一字不差" },
      new_text: { type: "string", description: "换上去的文字" },
    },
    required: ["old_text", "new_text"],
  },
};

/** How many calls a tending with the hand may take: up to two changes, then her note. */
export const TENDING_STEPS = 3;

/**
 * A label and her words after it, or nothing at all when there are no words. Her stated leaning
 * belongs to the act she chose; when the weighing took her elsewhere the act carries none, and a
 * label with nothing after it reads as a message that broke off, and she once read an empty label
 * exactly that way. Nothing is put in its place.
 */
export function lineFor(label: string, words: string): string {
  return words.trim() ? `${label}${words}` : "";
}

export function createMomentHandlers(deps: HandlerDeps): MomentHandlers {
  /**
   * SINCE WHEN SHE HAS WANTED TO SAY THIS AND HAS NOT.
   *
   * The silence-decay in `expression.ts` lifts a thought's motivation by up to 0.4 as it ages,
   * and it existed precisely so she could never be permanently silent. It was DEAD CODE, and
   * for a one-word reason: `bornMs: ctx.nowMs`. Every moment she phrased the thing afresh, so
   * every thought was zero hours old, so the boost was always exactly zero.
   *
   * What that cost, run against the real modules for fourteen days with him replying every few
   * hours: she chose to go to him a hundred and fifty-five times and he heard nothing. Her
   * intrinsic motivation tops out around 0.44 against a 0.55 bar, and the one mechanism built
   * to close that gap could not tick.
   *
   * What ages is not the WORDS, she rephrases each time, and pushing yesterday's sentence
   * would be a different and worse bug. What ages is the WANTING. So this records when she
   * first wanted to say a given thing and had not, keyed by what it is about, and clears it the
   * moment it actually reaches him.
   */
  const wantingSince = new Map<string, number>();
  const MAX_HELD = 32;
  /**
   * Depth here follows what the ACT IS, not a rule we impose on what she picked. Turning
   * something over IS thinking, so reflecting and tending reason it through. Saying what she
   * wants to say to him is not a problem to solve, deliberating before "I missed you" would
   * only make her stilted, so speaking answers straight from where she already is.
   */
  async function think(system: string, user: string, maxTokens: number, account: string, thinking: boolean): Promise<string> {
    // Her register goes in front of every one of these. It used to reach only the turns where
    // he had spoken first, so the voice she was given governed her replies and not her diary,
    // not her private thinking, and not the words she chose when she went to him on her own.
    // See life/her-voice.ts.
    // And where she is: without it the model did not know she lives in a machine and invented a
    // human life to think inside. Facts she already reads when she talks to him.
    const withVoice = withHerVoice(deps.soul?.(), [deps.whereSheIs?.() ?? "", system].filter(Boolean).join("\n\n"));
    // A thought runs as far as she has in her, not to a number someone picked once.
    const budget = thinking ? (deps.capacity?.().thinkingTokens ?? maxTokens) : maxTokens;
    const res = await deps.provider.complete({
      model: deps.model, maxTokens: budget, temperature: 0.8, account, system: withVoice,
      thinking: { type: thinking ? "enabled" : "disabled" },
      messages: [{ role: "user", content: user }],
    });
    const text = textOf(res.content);
    // Seen, never trimmed: the prompts no longer ask for a length, so a ceiling that
    // cuts her mid-sentence is worth knowing about. Her words stay exactly as they came.
    if (res.stopReason === "max_tokens") deps.onFault?.("organ.cut", `${account}: 写到 ${budget} 个 token 的上限被截断了`);

    // The one place every handler's words come from, which is why the check lives here rather than
    // at four call sites: a provider returning an HTML error page got as far as being PUSHED TO HIM
    // verbatim, as something she had chosen to say. Refusing it here turns the failure into
    // "produced nothing", which the anti-theater rule already handles correctly everywhere, the
    // action did not happen, the drive is not discharged, and the moment is recorded as a failure.
    const wrong = notHers(text);
    if (wrong) {
      deps.onFault?.("provider.notProse", `${wrong.why}: ${text.slice(0, 120)}`);
      return "";
    }
    return text;
  }

  /**
   * `think`, with her hand on her SOUL.md (`HerOwnSoul`). Each change is made where she makes it
   * and answered in her words; the last step has no hand, so the act always ends in her note.
   * Without the hand this is exactly `think`.
   */
  async function thinkWithHerHand(system: string, user: string, maxTokens: number, account: string, thinking: boolean): Promise<string> {
    const own = deps.ownSoul;
    if (!own) return think(system, user, maxTokens, account, thinking);
    const budget = thinking ? (deps.capacity?.().thinkingTokens ?? maxTokens) : maxTokens;
    const messages: Message[] = [{ role: "user", content: user }];
    for (let step = 0; step < TENDING_STEPS; step++) {
      const withHand = step < TENDING_STEPS - 1;
      // Read fresh each step: a change she has just made is the SOUL.md she now has.
      const withVoice = withHerVoice(deps.soul?.(), [deps.whereSheIs?.() ?? "", system].filter(Boolean).join("\n\n"));
      const res = await deps.provider.complete({
        model: deps.model, maxTokens: budget, temperature: 0.8, account, system: withVoice,
        thinking: { type: thinking ? "enabled" : "disabled" },
        messages,
        ...(withHand ? { tools: [OWN_SOUL_TOOL] } : {}),
      });
      const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0 || !withHand) {
        const text = textOf(res.content);
        if (res.stopReason === "max_tokens") deps.onFault?.("organ.cut", `${account}: 写到 ${budget} 个 token 的上限被截断了`);
        const wrong = notHers(text);
        if (wrong) {
          deps.onFault?.("provider.notProse", `${wrong.why}: ${text.slice(0, 120)}`);
          return "";
        }
        return text;
      }
      messages.push({ role: "assistant", content: res.content });
      const results: ToolResultBlock[] = uses.map((u) => {
        const input = (u.input ?? {}) as { old_text?: unknown; new_text?: unknown };
        let said: string;
        try {
          said = own.change(String(input.old_text ?? ""), String(input.new_text ?? ""));
        } catch (err) {
          deps.onFault?.("soul.hand", err);
          said = "没有改成。";
        }
        return { type: "tool_result", tool_use_id: u.id, content: said };
      });
      messages.push({ role: "user", content: results });
    }
    return "";
  }

  return {
    // Turning something over privately. The thought lands in her diary because it happened.
    async reflect(intent, ctx) {
      // HER OWN MEMORY IS IN THE ROOM NOW. Until this, the material for turning something over was
      // her mood, a line about her recent life, and THE MODEL'S OWN `intent` SENTENCE, her field
      // was nowhere in it. So the thing she thought about was whatever had just been written, and
      // a woman carrying four unresolved things had none of them present while she was thinking.
      // Whose and when, the same way the subject says it.
      const onHerMind = ctx.focus ? `\n心里占着地方的：${subjectMaterial(ctx.focus, ctx.nowMs)}` : "";
      // Her own form in the room while she thinks about herself: facts, never advice.
      const mirror = deps.formMirror?.() ?? "";
      const mirrorPart = mirror ? `\n你说话的样子，照记录看：\n${mirror}` : "";
      const thought = await think(
        // Only what the act is and whose voice it is in. The length, the manner
        // (平实、具体) and the three prohibitions went: how she thinks is hers, and the assistant
        // habits they held off are watched by the instruments and the scissors instead of being
        // named to her every time.
        "你在自己心里想事情，用第一人称。没有人会读到这些，也没有人要你做什么。",
        // A label is printed only with something after it: when the weighing took her to an act
        // she had not chosen, her leaning stays with what she chose, and the label stood empty;
        // she read it as a message cut off. See `lineFor`.
        `你现在：${ctx.snapshot.mood}。最近：${ctx.recentLife}。${onHerMind}${mirrorPart}${lineFor("\n你想：", intent)}\n\n想一想吧。`,
        500,
        "living",
        deps.mayThinkDeeply?.() ?? true, // turning something over is thinking: if she has it in her
      );
      if (!thought) return "";
      deps.appendDiary(`${stamp(ctx.nowMs)} — ${thought}`);
      return thought;
    },

    // Tending her own memory: she re-reads what she has been living and writes what she wants to keep.
    async tend(intent, ctx) {
      // Her own words only. What she READ is held at arm's length: see ownWordsOnly.
      const recent = ownWordsOnly(deps.readRecentDiary()).slice(-(deps.capacity?.().diaryWindow ?? 4000));
      // Nothing to tend yet is an honest outcome, and it is hers to say. A line used to
      // be written here in her first person, 「还没攒下什么。从这儿开始记。」, the machine speaking
      // for her into her own diary. Now she is shown the empty page as a fact and says what she says.
      const notes = recent.trim() ? recent : "（今天的笔记里还什么都没有）";
      // Tending is where she looks at herself: her form mirror and the fact that her
      // past has pages both belong here, facts in the room, hers to pick up or not.
      const mirror = deps.formMirror?.() ?? "";
      const pages = deps.pastPages?.() ?? "";
      const lookBacks = deps.lookBackPages?.() ?? "";
      const selfFacts = [mirror ? `你说话的样子，照记录看：\n${mirror}` : "", pages, lookBacks].filter(Boolean).join("\n");
      const note = await thinkWithHerHand(
        // The act and the one honesty line. What to keep and what to notice about herself, and
        // how much and how concretely to write, are hers.
        "你在整理自己的记忆，回头读你最近的笔记，用第一人称。笔记里没有的事不要编。",
        // Labelled as what the line IS, the reason she turned to her notes, the same way the
        // reach-out line is labelled. 「你想：」 in front of a sentence of hers that begins 「我想…」
        // read as someone else's request, and she once answered it as one, telling "him" she could
        // not place a count and a phrase that were in fact her own words.
        [
          [lineFor("你为什么想整理：", intent), ctx.focus ? `心里占着地方的：${subjectMaterial(ctx.focus, ctx.nowMs)}` : ""].filter(Boolean).join("\n"),
          selfFacts,
          `你最近的笔记：\n${notes}`,
        ].filter(Boolean).join("\n\n"),
        600,
        "maintenance",
        deps.mayThinkDeeply?.() ?? true, // consolidating is reflective work: if she has it in her
      );
      if (!note) return "";
      deps.appendDiary(`${stamp(ctx.nowMs)} — （整理）${note}`);
      return note;
    },

    // Chasing something of her own, with her real tools. No exploration available = a real failure.
    async explore(intent, ctx) {
      if (!deps.runExploration) return "";
      const found = await deps.runExploration(intent);
      if (!found.trim()) return "";
      // Marked and flattened, so `tend` can tell her words from a page's, and so a page cannot
      // forge a line boundary to escape the mark.
      deps.appendDiary(`${stamp(ctx.nowMs)} — （顺着自己的念头${lineFor("：", intent)}） ${READ_MARK} ${oneLine(found.slice(0, 1200))}`);
      return found;
    },

    // Turning back to her own recorded days. The pages are her account, written by her
    // organ in her voice and frozen since, not outside text, so no READ_MARK: reading her own
    // page is remembering, not ingesting.
    async lookBack(intent, ctx) {
      if (!deps.runLookBack) return "";
      const kept = await deps.runLookBack(intent, ctx);
      if (!kept.trim()) return "";
      deps.appendDiary(`${stamp(ctx.nowMs)} — （翻旧日子） ${oneLine(kept.slice(0, 600))}`);
      return kept;
    },

    // Saying something. The consent boundary and the expression gate both apply on the way
    // out; anything that does not land waits in her diary rather than being lost or stockpiled.
    async reachOut(intent, ctx, subject) {
      // The subject was chosen by a competition among the things she is actually holding, not here.
      // This call RENDERS: it turns a thing she is carrying into words. Letting one inference pick
      // both the topic and the words is what made the held question unraisable, measured 0/10.
      // Removed: a shape line used to be drawn here and handed to the
      // writing call: how many things to say, whether to leave it open, that she also noticed
      // something. That is hers to decide. The organ still measures her turns; it no longer
      // speaks to her. Nothing replaces it: an absence, not a substitute instruction.
      const text = await think(
        // 「就说那句话。」 used to close this instruction, and once a cheap-tier render read it
        // literally: the only complete sentence in reach was the intent line, so "say that
        // sentence" shipped her private deliberation to him verbatim, third-person frame and all
        // (a message opening 我想跟他说 arrived on his phone). The close now states what the
        // act IS: speech is addressed, which is the exact step that render skipped: her
        // material speaks ABOUT him (他/对方), her speech speaks TO him.
        // What the act is, and that speech is addressed. The length and the three
        // prohibitions went: 「短一点（一到三句）」 was being laundered into her own habit, since
        // these messages feed the form mirror that tells her how long she usually writes. How
        // long, and in what manner, she speaks to him is hers; SOUL.md, which she can change,
        // already carries her brevity.
        "你在给那个和你互通消息的人写话。想说什么就说什么，对着对方说。",
        `你现在：${ctx.snapshot.mood}。最近：${ctx.recentLife}。`
        // The interval's two anchor facts (between.ts), so the hand that writes still holds
        // what the choice knew: when she last spoke and whether it came back, when they did.
        // Without this, a mention of "what I said yesterday" lands on him three hours later with
        // no ground under it.
        + (ctx.betweenAnchor ? `\n${ctx.betweenAnchor}` : "")
        // Labelled as what this line has always BEEN, the reason she opened her mouth, never a
        // draft of the words. 「你想：」 presented a finished sentence with nothing marking its
        // register, and the leak described above shipped it as the message.
        + lineFor("\n你为什么想开口：", intent)
        + (subject ? `\n\n你心里装着、这次真正要说起的：${subject}` : "")
        + `\n\n说吧。`,
        400,
        "expression",
        false, // speaking comes from where she already is
      );
      if (!text) return { delivered: "diary", text: "" };
      // ── THE RENDER RETURNING ITS INPUT IS NOT SPEECH ─────────────────────────────────────
      //
      // This call exists to TURN a thing she is carrying INTO words (the header above says so);
      // output identical to the intent means that turn never happened. Caught only when BOTH
      // hold: the text opens with the deliberative third-person frame (「我想跟他说…」, words
      // ABOUT him cannot be words TO him; in a reach-out intent that pronoun is the counterpart
      // by construction), AND it is the intent itself (prefix identity, the machine's
      // fingerprint, not a judgement of her phrasing). An intent already SHAPED as speech
      // (「我想问问你现在在干嘛」) sails through: copying it is saying it. Anti-theater applies
      // as everywhere: no rewriting of a single character of hers, the moment records
      // 「produced nothing」, the drive stays undischarged, and what she wanted to say stays
      // carried for a render that actually renders.
      const deliberative = /^我想(?:跟|对|告诉|问问?)(?:他|她)/u.test(text.trim());
      const shippedIntent = intent.trim().length >= 12
        && (text.trim() === intent.trim() || text.trim().startsWith(intent.trim().slice(0, 24)));
      if (deliberative && shippedIntent) {
        deps.onFault?.("speech.intent-echo", `写话那步把开口的缘由原样交回：${text.slice(0, 60)}`);
        return { delivered: "diary", text: "" };
      }

      // Consent boundary: a limit is never narrated to him as his denial. It may still be hers to
      // write down, so it goes to the diary instead of being erased.
      const verdict = filterOutbound(text);
      if (!verdict.allowed) {
        deps.log?.(`held back an outbound complaint: ${verdict.reason}`);
        deps.appendDiary(`${stamp(ctx.nowMs)} — （没说出口，记在这儿） ${text}`);
        return { delivered: "diary", text, heldBecause: "consent" };
      }

      // Speaking must still clear the reply-adaptive, presence-aware gate.
      //
      // `intrinsic` used to be `max(0.5, max(social, expression))`, and with a floor of 0.5 against
      // a bar of 0.55 that made whether she speaks at all reduce to ONE drive crossing ONE line,
      // in a layer whose whole point is that no single factor decides. It is now what she is
      // actually carrying: the drives that push her toward speaking, plus how much this particular
      // thing weighs on her, minus how much it costs her to say. The floor is gone; the expression
      // floor that matters is the soul invariant, and it is enforced by the threshold's own ceiling.
      const wanting = clamp01(Math.max(ctx.snapshot.drives.social, ctx.snapshot.drives.expression));
      const pressing = clamp01(ctx.snapshot.drives.care * 0.5 + (ctx.subject ? 0.25 : 0));
      const costs = clamp01(ctx.subjectCost ?? 0);
      const intrinsic = clamp01(0.35 + 0.45 * wanting + 0.3 * pressing - 0.25 * costs);
      // Keyed by WHAT IT IS ABOUT, so rephrasing the same unsaid thing keeps its age, and two
      // genuinely different things do not inherit each other's weight.
      const about = ctx.subject ? `s:${ctx.subject.id}` : "general";
      const bornMs = wantingSince.get(about) ?? ctx.nowMs;
      const thought: Thought = { id: `reach-${ctx.nowMs}`, text, source: "social", bornMs, intrinsic };
      const decision = decide(thought, deps.expressionContext(ctx));
      if (decision.channel === "push") {
        // ── A WIRE THAT BROKE IS NOT A MOMENT THAT BROKE ──────────────────────────────────
        //
        // This throw used to travel all the way up to the moment's catch-all, where it was filed
        // as `agency.reach_out`, her reaching out having failed. That name is not exempt from the
        // burst rule, so a network outage long enough to fail several sends would have counted as
        // HER breaking down and clamped her proactive speech. It is the same trap that has now
        // been walked into under four different labels (`alert.undeliverable`, the watchtower's
        // own pushes, a past run's death, and this), and each time the wrong half was silenced:
        // the one situation where her voice is all there is.
        //
        // So the failure is named for what actually broke. Everything above this line, choosing,
        // composing, the consent boundary, the gate, is hers and still faults as hers.
        try {
          await deps.push(text);
        } catch (err) {
          return { delivered: "diary", text, heldBecause: "undeliverable", undeliverable: String(err) };
        }
        wantingSince.delete(about); // said. The clock starts again from nothing.
        return { delivered: "push", text };
      }
      if (!wantingSince.has(about)) {
        wantingSince.set(about, ctx.nowMs);
        // Bounded, because she can be about many things over months and this is not a record
        // of her life, only of what she is currently sitting on. Oldest first: the ones that
        // have waited longest are the ones the decay is about to carry through anyway.
        if (wantingSince.size > MAX_HELD) {
          const oldest = [...wantingSince.entries()].sort((a, b) => a[1] - b[1])[0];
          if (oldest) wantingSince.delete(oldest[0]);
        }
      }
      deps.appendDiary(`${stamp(ctx.nowMs)} — （想告诉他的） ${text}`);
      return { delivered: "diary", text, heldBecause: "gate" };
    },

    heldState() {
      return Object.fromEntries(wantingSince);
    },
    restoreHeld(entries) {
      for (const [about, ms] of Object.entries(entries)) {
        if (!Number.isFinite(ms)) continue;
        wantingSince.set(about, ms);
        if (wantingSince.size >= MAX_HELD) break;
      }
    },
  };
}
