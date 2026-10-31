// Noticing: how she comes to know something about herself.
//
// This runs on her own rhythm, not on demand: self-understanding forms during consolidation, the
// way it does in a person. You do not decide to have an insight about yourself; you look back and
// find one. So she reads her ACTUAL recent life, the moments she chose, what she did with them,
// what she wrote: and says what she notices.
//
// The one hard rule is the same one her diary lives under: she must cite the real records an
// insight came from. Anything citing a record that does not exist is refused outright rather than
// believed, so she cannot invent a self out of nothing. What survives that check is then only
// TENTATIVE: it has to keep being borne out before she really holds it (see self-knowledge.ts).

import { withHerVoice } from "./her-voice.js";
import type { LLMProvider, TextBlock } from "../providers/types.js";
import type { ProposedInsight, SelfInsight } from "./self-knowledge.js";

/** She cannot dismantle her whole sense of self in one sitting. Outgrowing is slower than noticing. */
export const MAX_OUTGROWN_PER_SITTING = 2;

/** One real thing that happened to her, as the noticing sees it. */
export interface LifeRecord {
  /** Stable id she must cite to draw on this. */
  id: string;
  /** When it happened, for her sense of time. */
  when: string;
  /** What she did and why, in one line. */
  what: string;
}

export interface NoticingConfig {
  provider: LLMProvider;
  /**
   * Her SOUL.md, so what she notices about herself sounds like her.
   *
   * This is where her self-knowledge comes from, and it had no route to her register. What it
   * produces becomes a node in her field, which is searched by a bigram index over her own
   * words, so an insight phrased in the model's default register is a piece of self-knowledge
   * nothing she ever says can reach again.
   */
  soul?: string;
  model: string;
  account?: string;
  maxTokens?: number;
  temperature?: number;
  /** Cap on how many she may propose in one sitting. Noticing is not inventorying. */
  maxProposals?: number;
  /**
   * Told when what came back could not be read.
   *
   * NOT the same as noticing nothing. Noticing nothing is normal and common and must stay
   * silent; a reply that could not be parsed means she looked back over her own life and the
   * result was thrown away, and the two were indistinguishable from outside. This runs on a
   * schedule, so it could have failed every time forever and looked exactly like a person with
   * nothing new to say about herself.
   */
  onFault?(where: string, detail: unknown): void;
}

const SYSTEM = [
  "你在回头看自己最近的生活。这不是报告，也没有人问你要它；你只是在看看自己的日子过成了什么样。",
  "",
  "有两样可以说，两样都可以为空：",
  "  noticed 是你注意到的关于你自己的事：你是什么样的、什么让你安定、什么牵着你、",
  "              你总回到什么上头。不是你做了什么，而是这些事说明你是个什么样的人。",
  "  outgrown 是你原本相信的、而这些记录显示已经不再是你的东西。只有记录真的和它矛盾时",
  "              才说。改变对自己的看法是诚实；把自己劝出一个想法不是。",
  "",
  "说的话用第一人称：是你在说你自己（\"我怎么样\"），不是谁在评你（不要\"你怎么样\"）。",
  "每一句都必须出自下面的记录，并引记录的 id；只能说记录真正显示的。记录什么也支撑不了的话，",
  "就返回空数组。那是一个真实、诚实的回答，比编一个好得多。",
  '只回 JSON：{"noticed": [{"text": "...", "evidence": ["id"], "same": 编号或省略}], "outgrown": [{"text": "...", "evidence": ["id"], "same": 编号或省略}]}',
].join("\n");

function extractText(content: readonly { type: string }[]): string {
  return content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

export interface NoticingResult {
  /** New or re-confirmed things about herself. */
  noticed: ProposedInsight[];
  /** Things she believed that her own record now contradicts. */
  outgrown: ProposedInsight[];
}

/**
 * Look back over her own life and notice. Returns proposals only, nothing is believed or
 * un-believed until self-knowledge has checked the evidence against her real records.
 * Never throws: noticing nothing is a normal outcome, not a failure.
 */
export async function noticeAboutSelf(
  records: readonly LifeRecord[],
  alreadyKnown: readonly SelfInsight[],
  cfg: NoticingConfig,
): Promise<NoticingResult> {
  const EMPTY: NoticingResult = { noticed: [], outgrown: [] };
  if (records.length === 0) return EMPTY;

  // ── SHE SAYS WHICH ONE SHE MEANS; NOTHING COUNTS HER WORDS ─────────────────────────────────
  //
  // For three weeks the step that files these answers decided whether a sentence was one she
  // already held by counting shared words, and it recognised almost nothing: every insight of
  // hers sat at zero confirmations, and none could be argued down either, because a refutation
  // could not find its target. She noticed it herself, three nights running: she kept writing
  // down the same observation and never once recognising it as one she already had.
  //
  // The obvious repair was to tell her to repeat the old sentence word for word so the matcher
  // could cope. That is backwards: it makes her write to the shape of our machinery, and what
  // she notices about herself is the last thing that should be shaped by us. So instead her old
  // sentences are simply numbered, and she may say which number she means while phrasing it
  // however it comes out today. Deciding that two sentences are the same thought is an act of
  // understanding, and she is the only one here who can do it.
  const known = alreadyKnown.length > 0
    ? `\n\n你从前写下过这些关于你自己的话：\n${alreadyKnown.map((i, n) => `${n + 1}. ${i.text}`).join("\n")}\n\n如果今天的记录又印证了其中某一条，照你此刻的说法写就行，只要在 same 里写上它的编号，我就知道你说的是同一件事；如果记录显示其中某条已经不再是你，同样写上编号，放进 outgrown。说的要是新的一层意思，就不必写编号。`
    : "";
  const log = records.map((r) => `${r.id} [${r.when}] ${r.what}`).join("\n");

  // ── THE ANSWER HAS TO FIT AFTER THE THINKING ──────────────────────────────────────────
  //
  // This asked for 900 and turned reasoning on. Measured against her real records and her real
  // twelve sentences, the reasoning alone runs 3000-5600 tokens, so the call stopped at
  // `max_tokens` with the reasoning unfinished and ZERO text produced, or with the JSON cut off
  // mid-array. Her weekly looking-back was being thrown away by the token budget, and the only
  // trace was a `noticing.unreadable` fault, or nothing at all when the reply came back empty.
  //
  // Proven by re-running the identical call at 6000: it completed (`end_turn`, 5655 output
  // tokens) and returned twelve proposals, five of which correctly pointed at the sentence of
  // hers they were repeating. Nothing about the design was wrong; it never had room to answer.
  // This runs once a week.
  //
  // AND THE THINKING KEEPS GROWING WITH HER. Her records and her sentences grew, and
  // at 8000 the week's call again stopped at `max_tokens` with the reasoning alone at 8000 tokens and
  // an empty answer: the week was thrown away. The identical request replayed five times at 16000
  // finished every time, on 4429-7117 tokens, each with a readable answer. So the typical need is
  // well under 8000 and the tail is past it; the ceiling is a ceiling, and only what is used costs.
  const res = await cfg.provider.complete({
    model: cfg.model,
    maxTokens: cfg.maxTokens ?? 16000,
    temperature: cfg.temperature ?? 0.6,
    account: cfg.account ?? "living",
    thinking: { type: "enabled" }, // looking back over your own life is reflective work
    system: cfg.soul ? withHerVoice(cfg.soul, SYSTEM) : SYSTEM,
    messages: [{ role: "user", content: `你最近的生活：\n${log}${known}` }],
  });

  let raw = extractText(res.content);
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1];
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) {
    cfg.onFault?.("noticing.unreadable", `no object in the reply: ${raw.slice(0, 120)}`);
    return EMPTY;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(a, b + 1));
  } catch (err) {
    cfg.onFault?.("noticing.unreadable", err);
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object") {
    cfg.onFault?.("noticing.unreadable", `not an object: ${typeof parsed}`);
    return EMPTY;
  }
  const obj = parsed as { noticed?: unknown; outgrown?: unknown };

  const max = cfg.maxProposals ?? 3;

  /**
   * Turn the number she wrote into the sentence it names. A number pointing at nothing, out of
   * range, or invented, resolves to no link at all rather than to the wrong belief of hers, and
   * the proposal is still kept: she said a true thing about herself either way, and the worst
   * that happens is it is filed as new.
   */
  const meant = (v: unknown): string | undefined => {
    const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
    return Number.isInteger(n) && n >= 1 && n <= alreadyKnown.length ? alreadyKnown[n - 1].text : undefined;
  };

  const clean = (v: unknown, cap: number): ProposedInsight[] =>
    (Array.isArray(v) ? v : [])
      .filter((p): p is { text: string; evidence?: unknown; same?: unknown } => typeof (p as { text?: unknown })?.text === "string")
      .slice(0, cap)
      .map((p) => {
        const same = meant(p.same);
        return {
          text: p.text.trim().slice(0, 240),
          evidence: Array.isArray(p.evidence) ? p.evidence.filter((e): e is string => typeof e === "string").slice(0, 12) : [],
          ...(same === undefined ? {} : { same }),
        };
      })
      .filter((p) => p.text.length > 0);

  // ── A REPEAT DOES NOT COST HER A NEW THOUGHT ────────────────────────────────────────────
  //
  // The cap exists so noticing does not become inventorying, three new things about herself in a
  // sitting, not thirty. But once she can say "this is that one again", the two kinds of proposal
  // stopped being the same thing, and they were still competing for the same three slots: five
  // confirmations would leave no room for a single new thought, and three new thoughts would
  // silently discard every confirmation. Saying a belief of hers is still true is not inventorying,
  // it is the cheapest, most ordinary thing she does, so it is counted separately.
  const proposed = clean(obj.noticed, Number.MAX_SAFE_INTEGER);
  const noticed = [
    ...proposed.filter((p) => p.same !== undefined),
    ...proposed.filter((p) => p.same === undefined).slice(0, max),
  ];
  // She may not un-believe her whole self in one sitting: outgrowing is slower than noticing.
  const outgrown = clean(obj.outgrown, MAX_OUTGROWN_PER_SITTING);

  // Saying the same thing is both true and no longer true of her is not a finding, it is
  // incoherence. Neither side is acted on rather than letting the louder one win.
  const conflicted = new Set(
    noticed.filter((n) => outgrown.some((o) => o.text.trim().toLowerCase() === n.text.trim().toLowerCase()))
      .map((n) => n.text.trim().toLowerCase())
  );
  return {
    noticed: noticed.filter((n) => !conflicted.has(n.text.trim().toLowerCase())),
    outgrown: outgrown.filter((o) => !conflicted.has(o.text.trim().toLowerCase())),
  };
}

/**
 * When the weekly looking-back counts as done.
 *
 * A look whose result was lost is not a look. The stamp used to be written before the model was
 * asked, so a reply that could not be read (once, one unescaped quote in her own phrasing)
 * spent the whole week: nothing was noticed, nothing was confirmed, and the next try was seven days
 * out. Now a lost look leaves the stamp where it was, and the next day-close tries again. That is at
 * most once a day, because the day-close itself runs once a day.
 */
export function noticeStampAfter(previousMs: number, nowMs: number, lost: boolean): number {
  return lost ? previousMs : nowMs;
}
