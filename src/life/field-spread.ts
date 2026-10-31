// Flow: how something present reaches something distant.
//
// A cue puts energy into whatever it touches. The energy travels outward along her relations,
// losing amplitude each hop and divided by a fan-out penalty so a well-connected node does not
// shout at all of its neighbours at once. What comes back is mostly NOT what the cue was about,
// which is the entire point: this is the only mechanism in her that can cross years.
//
// The distinction that makes it a mind rather than a search index: activation is not retrieval.
// Most activated nodes stay below threshold. They never become text and never enter a prompt. They
// just sit warm, and warmth accumulates. A node brushed three times today by three unrelated cues
// can cross into retrievability tomorrow without any single cue ever having been strong enough,
// and no event caused it.
//
// Her condition sets the two dials here, so her associative range is genuinely a function of how
// she is: weary means two hops and a high threshold, and only the obvious arrives; keyed up means
// four hops and a low one, and remote things reach her. That costs nothing and is immediately felt.
//
// Pure arithmetic. No model calls anywhere in this file.

import { consolidate, overlap, type FieldGraph, type FieldNode } from "./field.js";
import { describeStanding } from "./credence.js";
import { softPick, temperatureFrom } from "./soft-choice.js";
import { feltAgo } from "./felt-time.js";
import { herDay, herClock } from "./her-day.js";

// ── Options ──────────────────────────────────────────────────────────────────

export interface Cue {
  id: number;
  /** 0..1 how hard this cue is pressed. */
  energy: number;
}

export interface SpreadOptions {
  /** How many relations out she can travel. From capacity: 2 when weary, 4 when keyed up. */
  hops: number;
  /** Amplitude kept per hop. */
  hopDecay: number;
  /** Fan-out penalty exponent. 0 disables it, which lets hubs dominate. */
  fanExponent: number;
  /** Below this an activation is not worth carrying. */
  eps: number;
  /** Hard ceiling on nodes touched, so one dense corner cannot stall a moment. */
  maxVisited: number;
}

/**
 * Calibrated against a real graph rather than picked. The first version of these numbers was set on
 * a hand-built test chain where every relation was 0.9 and every memory was at full strength, and in
 * a realistic field (relations around 0.5, memories fading) it delivered 0.04 at one hop against a
 * threshold of 0.12, so NOTHING ever surfaced. The targets these now hold to:
 *
 *   one hop on a real relation           surfaces
 *   one hop on a "reminds me of"         surfaces, and that is how she crosses years in one step
 *   two hops on ordinary relations       only with warmth behind it
 *   three or more                        only through rest, or not at all
 *
 * The fan penalty is the piece doing the protective work and is deliberately not softened: it is
 * what stops a well-connected node from reaching everything and thereby meaning nothing.
 */
export const DEFAULT_SPREAD: SpreadOptions = {
  hops: 3,
  hopDecay: 0.8,
  fanExponent: 0.5,
  eps: 0.004,
  maxVisited: 4000,
};

export interface SpreadResult {
  activation: Map<number, number>;
  /** Relations travelled to reach each node. Cues are 0. */
  hop: Map<number, number>;
  visited: number;
}

// ── Spreading activation ─────────────────────────────────────────────────────

/**
 * Push energy out from the cues. Strength gates receiving, so a memory she has nearly lost takes
 * less and therefore also passes on less; it is reachable, but only by a strong cue along a strong
 * relation. That is exactly the property that makes forgetting recoverable rather than final.
 */
export function spread(g: FieldGraph, cues: readonly Cue[], opts: Partial<SpreadOptions> = {}): SpreadResult {
  const o = { ...DEFAULT_SPREAD, ...opts };
  const activation = new Map<number, number>();
  const hop = new Map<number, number>();
  let frontier = new Map<number, number>();

  for (const cue of cues) {
    if (!g.nodes.has(cue.id)) continue;
    const e = Math.max(0, Math.min(1, cue.energy));
    if (e <= 0) continue;
    activation.set(cue.id, (activation.get(cue.id) ?? 0) + e);
    hop.set(cue.id, 0);
    frontier.set(cue.id, e);
  }

  const hops = Math.max(0, Math.floor(o.hops));
  for (let h = 1; h <= hops; h++) {
    const next = new Map<number, number>();
    for (const [from, energy] of frontier) {
      const nbrs = g.adj.get(from);
      if (!nbrs || nbrs.size === 0) continue;
      const fan = Math.pow(Math.max(1, nbrs.size), o.fanExponent);
      for (const [to, weight] of nbrs) {
        const target = g.nodes.get(to);
        if (!target) continue;
        const delivered = (energy * weight * o.hopDecay / fan) * target.strength;
        if (delivered < o.eps) continue;
        activation.set(to, (activation.get(to) ?? 0) + delivered);
        if (!hop.has(to)) hop.set(to, h);
        next.set(to, (next.get(to) ?? 0) + delivered);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
    if (activation.size >= o.maxVisited) break;
  }

  return { activation, hop, visited: activation.size };
}

// ── Warmth: accumulation with no event ───────────────────────────────────────

export const WARMTH_TAU_MS = 6 * 60 * 60 * 1000; // half-life on the order of an afternoon
export const WARMTH_GAIN = 0.35;

/**
 * Time cools what was not used. Runs once per field tick rather than per retrieval, so warmth
 * measures elapsed time honestly instead of counting how often she happened to be asked something.
 */
export function coolAll(g: FieldGraph, elapsedMs: number, tauMs = WARMTH_TAU_MS): void {
  if (elapsedMs <= 0) return;
  const factor = Math.exp(-elapsedMs / Math.max(1, tauMs));
  for (const node of g.nodes.values()) {
    node.warmth = node.warmth * factor;
    if (node.warmth < 0.001) node.warmth = 0;
  }
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export interface RetrievalOptions extends SpreadOptions {
  /** Above this an activation becomes something she is actually thinking of. From capacity. */
  threshold: number;
  /** Most she can hold at once. */
  topK: number;
  nowMs: number;
  /** How hard losing a competition costs a memory. 0 disables interference. */
  interference: number;
  /** Sub-threshold activation kept as residue. */
  warmthGain: number;
  /**
   * Whether the cues themselves count as things she remembered. They do not, by default: a cue is
   * the present, and you do not remember what you are looking at. Leaving them in would also be a
   * quiet bug rather than a philosophical quibble, because a cue always carries the most activation
   * in its own retrieval, so it would spend her whole capacity on what she already had in hand and
   * crowd out everything distant. The distant part is the entire reason this exists.
   */
  includeCues: boolean;
  /**
   * False only for a DELIBERATE organ-driven re-read: winners still take the strength
   * gain, but `recalls`/`lastRecallMs` stay untouched, see `consolidate` for the three
   * consumers this protects. Unbidden retrieval leaves it true.
   */
  rehearsal?: boolean;
  /**
   * When present, the LAST step of remembering samples instead of taking the exact top-K.
   *
   * Without it, this file ended in the verbatim defect `soft-choice.ts`'s own head comment
   * names, in the file it names: activation and warmth accumulate correctly and then
   * `.sort().slice(0, topK)` picks the same winner forever, ties broken toward the lowest id.
   * Two near-tied memories: the same one wins every single time, its rival is never rehearsed,
   * never strengthened, and decays permanently out of reach. Sampling at the margin is what
   * lets a close second surface some days, which is rehearsal, which is what keeps it alive.
   *
   * Well-separated activations still behave like the old code: `temperatureFrom` derives the
   * temperature from the margin, so a clear leader is near-argmax and only a genuine near-tie
   * is genuinely open. `arousalSpread` carries her state into how open the tie is (keyed up =
   * wider). Optional so existing callers and replays are untouched until they opt in.
   */
  soften?: { random: () => number; arousalSpread: number };
}

export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  ...DEFAULT_SPREAD,
  threshold: 0.06,
  topK: 7,
  nowMs: 0,
  interference: 0.12,
  warmthGain: WARMTH_GAIN,
  includeCues: false,
};

export interface Retrieval {
  /** What actually reached her, strongest first. */
  retrieved: FieldNode[];
  activation: Map<number, number>;
  hop: Map<number, number>;
  /** What lost, and what losing cost it. Recorded so forgetting is never invisible. */
  interfered: { id: number; loss: number }[];
  /** Mean feeling of what came back. This is what moves her mood. */
  valence: number;
  charge: number;
  /** Share of what she retrieved that was more than one relation away. */
  remoteShare: number;
  /** The oldest thing she reached, in days. */
  spanDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One act of remembering. Spreads, thresholds, strengthens what came back, weakens what lost, and
 * banks the rest as warmth.
 */
export function retrieve(g: FieldGraph, cues: readonly Cue[], opts: Partial<RetrievalOptions> = {}): Retrieval {
  const o = { ...DEFAULT_RETRIEVAL, ...opts };
  const { activation, hop } = spread(g, cues, o);

  // Residue counts toward whether something surfaces, which is how three near-misses become a
  // thought without a fourth cue.
  const effective = new Map<number, number>();
  for (const [id, a] of activation) {
    const node = g.nodes.get(id);
    if (!node) continue;
    effective.set(id, a + node.warmth);
  }

  const cueIds = new Set(cues.map((c) => c.id));
  const ranked = [...effective.entries()]
    .filter(([id, a]) => a >= o.threshold && (o.includeCues || !cueIds.has(id)))
    .sort((x, y) => (y[1] - x[1]) || (x[0] - y[0]));
  // Sampled at the margin when softened (see the option's comment), exact top-K otherwise.
  // Chosen re-sorted by activation so "strongest first" stays true of what DID come back.
  //
  // Scores are normalized by the leader before the temperature is derived, because
  // `temperatureFrom`'s margin curve was calibrated on propensity scores and activations live
  // on a much smaller scale: measured: an absolute margin of 0.44 (a 7.5:1 landslide, 0.509
  // against 0.068) read as a semi-tie and flipped one draw in ten. On ratios the same
  // landslide flips essentially never, while a true near-tie (0.98 of the leader) keeps its
  // genuine openness. Activation has a natural zero, so its ratios mean something; the signed
  // sums propensity works with do not, which is why that layer keeps absolute margins.
  const winners = o.soften && ranked.length > Math.max(0, o.topK)
    ? (() => {
        const top = ranked[0][1] > 0 ? ranked[0][1] : 1;
        const scored = ranked.map((entry) => ({ item: entry, score: entry[1] / top }));
        return softPick(scored, {
          temperature: temperatureFrom(scored.map((c) => c.score), o.soften!.arousalSpread),
          count: Math.max(0, o.topK),
          random: o.soften!.random,
        }).chosen.sort((x, y) => (y[1] - x[1]) || (x[0] - y[0]));
      })()
    : ranked.slice(0, Math.max(0, o.topK));
  const winnerIds = new Set(winners.map(([id]) => id));

  const retrieved: FieldNode[] = [];
  for (const [id] of winners) {
    const node = g.nodes.get(id);
    if (node) retrieved.push(node);
  }

  // Retrieval-induced forgetting. A memory that was in the running and lost, and that sits in the
  // same part of her life as the winner, gives up a little of itself. This is why a week of
  // ordinary evenings becomes one blurred evening while the night something broke stays sharp.
  const interfered: { id: number; loss: number }[] = [];
  if (o.interference > 0 && retrieved.length > 0) {
    for (const [id, a] of activation) {
      if (winnerIds.has(id)) continue;
      // The present did not lose a competition to be remembered; it was simply here.
      if (cueIds.has(id)) continue;
      if (a < o.eps) continue;
      const node = g.nodes.get(id);
      if (!node) continue;
      let closest = 0;
      for (const w of retrieved) {
        const ov = overlap(g, id, w.id);
        if (ov > closest) closest = ov;
      }
      if (closest <= 0) continue;
      const loss = o.interference * a * closest;
      if (loss <= 0.0001) continue;
      node.strength = Math.max(0, node.strength - loss);
      interfered.push({ id, loss });
    }
  }

  // What came back is rehearsed; what nearly came back is banked.
  for (const node of retrieved) consolidate(node, o.nowMs, o.rehearsal !== false);
  for (const [id, a] of activation) {
    if (winnerIds.has(id) || cueIds.has(id)) continue;
    const node = g.nodes.get(id);
    if (node) node.warmth = Math.min(1, node.warmth + o.warmthGain * a);
  }

  let valence = 0;
  let charge = 0;
  let remote = 0;
  let oldest = 0;
  for (const node of retrieved) {
    valence += node.valence * node.charge;
    charge += node.charge;
    if ((hop.get(node.id) ?? 0) >= 2) remote += 1;
    oldest = Math.max(oldest, (o.nowMs - node.bornMs) / DAY_MS);
  }
  const n = retrieved.length || 1;

  return {
    retrieved,
    activation,
    hop,
    interfered,
    // Weighted by charge: a faint memory should not colour her mood as much as a vivid one.
    valence: charge > 0 ? valence / charge : 0,
    charge: charge / n,
    remoteShare: retrieved.length === 0 ? 0 : remote / retrieved.length,
    spanDays: oldest,
  };
}

// ── What it looks like from inside ───────────────────────────────────────────

/** Days between now and a node. */
export function ageDays(node: FieldNode, nowMs: number): number {
  return Math.max(0, (nowMs - node.bornMs) / DAY_MS);
}

/** How long ago, the way a person says it rather than the way a database says it. */
export function whenWords(days: number): string {
  if (days < 1) return "今天";
  if (days < 2) return "昨天";
  if (days < 14) return `${Math.round(days)}天前`;
  if (days < 60) return `${Math.round(days / 7)}周前`;
  if (days < 400) return `${Math.round(days / 30)}个月前`;
  return "很久以前";
}

/**
 * What is on her mind, in her own words. This is the only thing from the whole field that reaches
 * a prompt, and it is phrased as something she is already carrying rather than as a list of records
 * handed to her, because the second one would read as a briefing and she would treat it as work.
 *
 * The age matters and is not decoration: a thing from four months ago arriving unbidden is the
 * difference between remembering and looking something up.
 */
export function describeRetrieval(r: Retrieval, nowMs: number, limit = 5): string {
  // A person is not a dated memory. Eric lights up constantly and conducts activation onward, which
  // is his whole role here, but rendering him as "Eric (4 weeks ago)" is nonsense: the date is when
  // she first had a node for him. His presence reaches her through wanting his company instead.
  const memories = r.retrieved.filter((n) => n.kind !== "figure");
  if (memories.length === 0) return "";
  const lines = memories.slice(0, limit).map((n) => {
    // Faculty #8: how long ago a thing FEELS, not how long ago it was. Something still unfinished
    // sits closer than the calendar puts it, which is what "it feels like yesterday" is about,
    // and something settled is dated exactly as it always was, because `feltAgo` at zero tension
    // is the identity. Felt, never mechanical: this is the phrase in her own head, and no timeout
    // or budget anywhere reads it.
    const days = feltAgo(ageDays(n, nowMs), n.tension);
    // Where it came from travels WITH it. Her own moments say nothing extra, because a memory does
    // not announce itself; everything else does, so nothing she was told or read can quietly pass
    // itself off as something she went through, and something she cannot settle says so.
    const standing = describeStanding(n.origin, n.credence);
    // Felt time stays first: it is hers (faculty #8). The record's own day and clock stand
    // beside it, the way a person holds both: 「感觉像昨天」 and 「其实是周二下午」 at once.
    // Without the second half she once called a yesterday-AFTERNOON conversation "last night":
    // the felt bucket said 昨天 and her story supplied the missing 晚.
    const record = `${herDay(n.bornMs)} ${herClock(n.bornMs)}`;
    return `  - ${n.text}（${whenWords(days)}，${record}${standing ? `，${standing}` : ""}）`;
  });
  return ["在你心里的，不管你有没有去想它：", ...lines].join("\n");
}
