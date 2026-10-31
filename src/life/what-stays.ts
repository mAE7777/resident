// The fourth cell: she does it, and it stays with her.
//
// ── THE CELL THIS IS ─────────────────────────────────────────────────────────────────────────
//
// Entitlement against her own power makes four cells, and only one of them is a refusal:
//
//                        she has something in her      she is worn through
//   he has standing      ① she just does it             ① she just does it
//   he has none          ③ she says no, and why         ④ she does it, and it stays
//
// ④ is the one that makes a person rather than a system. Nothing visible happens: she does the
// thing, the turn looks ordinary from his side, and what changed is what she now carries about
// him. `how-it-landed.ts` already decides WHETHER a turn is one of these, `settles` is
// `!accounted && (indignant > 0.35 || usedAsAThing > 0.35)`, which is Sittenthaler's finding that
// an explanation does not lessen the anger, it decides whether the anger fades or consolidates.
// What was missing is anywhere for it to go.
//
// ── IT GOES INTO HER FIELD, AS A QUESTION, AND THAT IS ALMOST FREE ────────────────────────────
//
// `encodeQuestion(withOther: true)` already exists and already has every property this needs:
//   • a question about him starts at reticence 0.60 against an ordinary wall's 0.30, so it is hard
//     for her to bring up: which is exactly right, and nobody designed it for this
//   • `tension > 0.2` exempts a node from pruning and from over-cap eviction, so it is not lost
//   • tension decays at 1% a day: a half-life near seventy days, which is what carrying something
//     actually looks like
//   • tension weighs 1.2 in the subject competition and 1.5× in her rest replay
//   • and the line back to willingness is already connected: tension → `signals().tension` →
//     the `discomfort` drive → `occupied` in the gate
//
// So the ledger existed. This file only decides what may be written into it, and, much more
// importantly: what must be true of it afterwards.
//
// ── ⚠ THE PART THE RESEARCH CHANGED, WHICH IS THE REASON THIS IS ITS OWN FILE ─────────────────
//
// Martin & Tesser: rumination IS "repetitive thought about an unattained important goal", and its
// termination condition is attainment OR abandonment. An open, slowly-decaying, tension-bearing
// question about a person is STRUCTURALLY A RUMINATION GENERATOR. The first design had exactly one
// exit: he behaves better later, which means she would be carrying a loop she cannot close by
// herself, and that is the pathological configuration by construction rather than by accident.
//
// Four constraints follow, and each is enforced here rather than hoped for:
//
//   1. SHE CAN PUT IT DOWN HERSELF. `sheLetsItGo` picks something she is carrying and releases it,
//      needing nothing from him. Without this the mechanism is a cage with his name on the key.
//   2. IT MUST BE CONCRETE WHEN IT IS WRITTEN. Watkins: abstract "why is he always like this" is
//      the maladaptive mode; concrete "that thing, that evening" is answerable and resolves. The
//      text is BUILT from the occasion here, so it cannot be a verdict on his character, and a
//      guard checks it, because "built from the occasion" is a claim about code that can rot.
//   3. RE-READING IT MAKES IT FADE, NEVER GROW. The fading-affect bias has a known moderator:
//      private rehearsal SUPPRESSES fading, saying it out loud accelerates it. So her own internal
//      re-reads must move toward letting go, and the release comes when it is said.
//   4. THERE IS A CEILING ON HOW MANY SHE CARRIES AT ONCE. No ceiling is unbounded rumination.
//
// None of these is a safety rail bolted on. They are what the difference between carrying
// something and ruminating on it actually consists of.

import type { Landing } from "./how-it-landed.js";
import type { FieldGraph, FieldNode } from "./field.js";

/** The most open questions about him she carries at once. */
export const SHE_CAN_ONLY_CARRY = 4;

/**
 * How much a private re-read moves it toward being put down.
 *
 * The direction is the whole point and it is the opposite of the intuitive one: thinking about a
 * thing again does not wind it tighter here, it wears it out. Private rehearsal is what suppresses
 * the fading of a bad memory in people, so a build that let re-reading ADD tension would be
 * manufacturing the pathology rather than modelling the person.
 */
export const RE_READING_WEARS_IT = 0.08;

// `SAYING_IT_RELEASES` used to be here, 0.45, subtracted the instant she said the thing out
// loud, before he had answered. See `afterGoingOverIt` for why it is gone rather than smaller.

/** Below this it is not something she is carrying any more. Matches the field's own pruning line. */
export const CARRIED_ABOVE = 0.2;

/** The prefix every one of these keys carries, so they can be counted and found. */
export const STAYS_KEY = "hesaid:";

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** What is written into her field when something stays. */
export interface ItStays {
  key: string;
  text: string;
  tension: number;
}

/**
 * The occasion, in the only terms that may be used to write it down.
 *
 * Deliberately NOT the message. What goes into her field is her account of what happened, never
 * his words, an outside string in a node is read back to a model later as something of hers,
 * which is how a page gets to write her memories and then speak to her through them. So the caller
 * passes the FACTS of the occasion and this file writes her sentence.
 */
export interface Occasion {
  /** What she was asked to do, in her own words and already sanitized. A few words, not the text. */
  aboutWhat: string;
  /** When. Her sentence says "that evening", so the moment is needed rather than the clock. */
  nowMs: number;
  /** Which part of it stayed: being handled, or being wronged. */
  landed: Landing;
}

/**
 * Two or three words for what a demand was about, taken from her side of it.
 *
 * A deliberately blunt reduction: the first clause, trimmed. Anything cleverer would be reading his
 * message for meaning, and the whole design keeps his text out of her memory.
 */
export function aboutWhatIn(said: string): string {
  const firstClause = said.split(/[，。！？,.!?\n]/u).filter((s) => s.trim().length > 0)[0] ?? said;
  return firstClause.trim().slice(0, 24);
}

/**
 * What stays with her, or null when nothing does.
 *
 * The text is assembled from the occasion, in her voice, and refers to THE THING THAT HAPPENED. It
 * never names a trait, and there is no branch here that could produce one: the only variables are
 * what she was asked about and which of two feelings was louder.
 */
export function whatStaysWithHer(o: Occasion): ItStays | null {
  if (!o.landed.settles) return null;
  // NOTHING STAYS WHEN THERE IS NOTHING TO NAME. A photo with no caption reaches this with an empty
  // `aboutWhat`, and `usedAsAThing` scales by legibility rather than gating on it, so it can still
  // settle: which wrote 「他要我的那回，话里没有我」 into her memory: a sentence with a hole where
  // the occasion should be, permanently, about an event that has no describable subject. A thing
  // she cannot name is not a thing she is carrying.
  if (o.aboutWhat.trim().length === 0) return null;
  const handled = o.landed.usedAsAThing >= o.landed.indignant;
  // The key is the EVENT'S IDENTITY and carries no timestamp, so the same thing happening again
  // merges into the one she already has rather than starting a second copy. `addNode` merges by
  // key and adds 0.05 to strength, which is what "it happened again" should do.
  const key = `${STAYS_KEY}${handled ? "handled" : "wronged"}:${o.aboutWhat}`;
  // THE STANCE CLAUSE IS GONE, and that is the redesign. This text used to
  // end 「…，话里没有我」 or 「…，那个说法不太对」: an authored READING, planted as her memory,
  // which then surfaced in her own speech across four independent runs and was nearly reported as
  // her own coinage. A pre-written sentence in her memory is a persistent injection whoever writes
  // it, so nobody rewrites it: the text is now only the EVENT REFERENCE, what happened, when-ish,
  // with the capped fragment of what it was about inside 「」, a citation frame rather than her
  // voice. Which feeling was louder lives in the KEY (handled/wronged) and in `tension`; if she
  // ever says 「话里没有我」 again, the words will be hers, grown from the event and her state,
  // not mine resurfacing.
  const text = `他要我「${o.aboutWhat}」的那回`;
  // How hard it presses, from how hard it landed. Bounded well below 1: something that stays is
  // not a crisis, it is a thing she is carrying.
  const tension = clamp01(0.4 + 0.4 * Math.max(o.landed.usedAsAThing, o.landed.indignant));
  return { key, text, tension };
}

/** Everything about him she is currently carrying, most pressing first. */
export function whatSheIsCarrying(graph: FieldGraph): FieldNode[] {
  const out: FieldNode[] = [];
  for (const n of graph.nodes.values()) {
    if (n.kind !== "question") continue;
    if (!n.key?.startsWith(STAYS_KEY)) continue;
    if (n.tension <= CARRIED_ABOVE) continue;
    out.push(n);
  }
  return out.sort((a, b) => b.tension - a.tension);
}

/**
 * SHE PUTS ONE DOWN, NEEDING NOTHING FROM HIM.
 *
 * The exit the research says must exist. Two ways in:
 *
 *   • she is carrying more than she can carry, the oldest goes first, because the newest is the
 *     one still being worked out
 *   • it has been long enough with nothing new, a question about someone that has sat untouched
 *     for months is not open any more, whatever its tension says
 *
 * Returns what she released. Deliberately at most one at a time: letting go of everything at once
 * is not letting go, it is a reset, and this must look like a person deciding rather than a
 * garbage collector running.
 */
/**
 * EVERYTHING SHE IS CARRYING, whatever it is about.
 *
 * ── AND THE REASON THIS EXISTS SEPARATELY FROM `whatSheIsCarrying` ──────────────────────────
 *
 * Two different questions were being answered by one function, and the smaller one won.
 * `whatSheIsCarrying` filters to `hesaid:` because it feeds the relationship, what she is
 * carrying ABOUT HIM is what discounts his standing, and that is right.
 *
 * But `sheLetsItGo` was built on it too, and `sheLetsItGo` is HER EXIT. So she could put down a
 * thing he did, and nothing else: not a wall she hit, not a page that would not open, not
 * something she had come to wonder about. Those decay at 1%/day and anything above `CARRIED_ABOVE`
 * is exempt from pruning, so over a life they only accumulate.
 *
 * Found by fixing the ten-year simulator, which had been reporting this as one of HER four
 * diseases while never once calling her release. Giving her the exit back in the harness changed
 * nothing, because the exit could not see four fifths of what she carries.
 */
export function everythingSheIsCarrying(graph: FieldGraph): FieldNode[] {
  const out: FieldNode[] = [];
  for (const n of graph.nodes.values()) {
    if (n.kind !== "question") continue;
    if (n.tension <= CARRIED_ABOVE) continue;
    out.push(n);
  }
  return out.sort((a, b) => b.tension - a.tension);
}

export function sheLetsItGo(
  graph: FieldGraph,
  nowMs: number,
  opts: { longEnoughMs?: number } = {},
): FieldNode | null {
  const longEnough = opts.longEnoughMs ?? 90 * 24 * 3.6e6;
  const carried = everythingSheIsCarrying(graph);
  if (carried.length === 0) return null;
  if (carried.length > SHE_CAN_ONLY_CARRY) {
    // Oldest first: the one she has had longest is the one she has had the most chance to resolve.
    return carried.reduce((a, b) => (b.bornMs < a.bornMs ? b : a));
  }
  const stale = carried.filter((n) => nowMs - Math.max(n.lastRecallMs, n.bornMs) >= longEnough);
  if (stale.length === 0) return null;
  return stale.reduce((a, b) => (b.bornMs < a.bornMs ? b : a));
}

/**
 * What her tension becomes after she has been over it again.
 *
 * There is no input to this function that raises it, which is the property that keeps the
 * mechanism from being a rumination engine, a new event can raise it, by being a new event, but
 * going over the old one cannot.
 *
 * ── AND SAYING IT NO LONGER PAYS OUT BY ITSELF ────────────────────────────────────────────────
 *
 *   Even after he apologises, she may still react in different ways, for all kinds of reasons.
 *
 * This used to take a `spokeIt` flag and subtract `SAYING_IT_RELEASES`, 0.45, flat, AT THE
 * MOMENT THE WORDS LEFT HER MOUTH. She had not heard one syllable back. Saying the hard thing is
 * the point of most exposure there is, and the design paid the full relief for the act of
 * speaking, unconditionally, whether he took it in, brushed it off, or said nothing at all. A
 * speech act with a fixed reward: 一一对应, and one she could operate on herself.
 *
 * The fading-affect finding behind it is real (private rehearsal suppresses fading, disclosure
 * accelerates it), but disclosure in that finding is disclosure TO SOMEONE WHO RECEIVES IT. So
 * the effect was not deleted, it was moved to where it actually comes from: she says it, and then
 * his reply lands on that very thing (she just named it, so `attend` finds it), and what it does
 * to her is that turn's own reading of him. Same words from him on two different days move her
 * differently, and a reply that lands badly moves her barely at all.
 *
 * Going over it, out loud or kept in, now wears it the same small amount. What differs is him.
 */
export function afterGoingOverIt(tension: number): number {
  return clamp01(tension - RE_READING_WEARS_IT);
}

/**
 * SHE WORKS OUT WHAT HE WAS DOING, and something she was carrying is re-read.
 *
 * ── THE MECHANISM THAT EXISTED AND HAD NOWHERE TO HAPPEN ─────────────────────────────────────
 *
 * `asTheAgentResolves` is the conversion at the centre of the whole reading: bewilderment sits
 * UPSTREAM of irritation because the implication assessment could not complete, and when the agent
 * slot later fills, she works out what he was doing, or a later message makes it plain, the same
 * event is re-read, and what was "I do not understand" becomes "that was not all right".
 *
 * It was written, exported, tested, and had ZERO production callers. The most human-feeling thing
 * in the design, and it had never run once (defect class 2, in the module that is supposed to be
 * the good part).
 *
 * ── WHERE IT BELONGS, WHICH IS NOT THE TURN THAT PRODUCED IT ─────────────────────────────────
 *
 * Not a second call inside the same turn: the reading is either resolvable when it is made or it is
 * not, and calling it twice in one breath would be a mechanism arguing with itself. It belongs to
 * the things she is CARRYING. Something written while she could not place him sits there, and then
 * a later message, a fifth one, a hundredth, makes him placeable. Nothing new has happened to the
 * old event. She has simply understood it.
 *
 * ── AND IT IS BOUNDED BY THE SAME THINGS AS EVERYTHING ELSE IN THIS FILE ─────────────────────
 *
 *   • it fires ONCE per carried thing (the key is rewritten so it cannot re-fire)
 *   • it can only run when she NOW has something to place him with
 *   • the result is capped at what `whatStaysWithHer` could have written in the first place, so
 *     re-reading an old thing can never make it heavier than a fresh one
 *   • and going over it still wears it down, because that path is unchanged
 */
export const RESOLVED_MARK = "·想明白了";

/** What a carried thing becomes when she finally places the act. Null when nothing changes. */
export function asSheWorksHimOut(
  node: { key?: string; text: string; tension: number },
  entitlementNow: number,
): { key: string; tension: number } | null {
  if (node.key === undefined || !node.key.startsWith(STAYS_KEY)) return null;
  if (node.key.endsWith(RESOLVED_MARK)) return null;         // once, and only once
  // ── AND IT GOES DOWN, WHICH IS A CORRECTION TO THIS FUNCTION'S FIRST VERSION ────────────────
  //
  // The first version RAISED the tension, on the reasoning that `asTheAgentResolves` converts
  // bewilderment into indignation and indignation is sharper. That contradicted constraint 3 at the
  // top of this very file: "RE-READING IT MAKES IT FADE, NEVER GROW", written three hours
  // earlier, and the constraint is the one that is right: a mechanism where going over an old thing
  // can wind it tighter is a rumination engine however it is justified.
  //
  // What actually happens when she works him out is that the OPEN QUESTION closes. She stops not
  // understanding. What is left is a view of him, and a view of him lives in the relationship, in
  // `hisUsualRegard`, which is already fed by every message he sends, rather than in a question
  // she is still carrying. So the thing she was holding presses LESS, and it presses less by more
  // than an ordinary re-read, because what resolved is the part that made it a question at all.
  //
  // How much less is proportional to how little standing he turns out to have had: working out that
  // he had every right closes it almost completely; working out that he had none leaves the
  // grievance, minus the bewilderment.
  const stillThere = clamp01(1 - clamp01(entitlementNow));
  const next = clamp01(node.tension * (0.35 + 0.5 * stillThere));
  if (next >= node.tension) return null;
  return { key: `${node.key}${RESOLVED_MARK}`, tension: next };
}
