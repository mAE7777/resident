// The field: the one place where her lines cross.
//
// Everything she had before this was a list with a decay rate. Drives were six scalars fed by
// counting events, so `curiosity: 0.4` was about nothing. Memory was rows retrieved by resembling
// a query, so nothing could reach a memory except something that already looked like it. Insights
// were a list, and nine of them never became one theme. The lines ran parallel and never touched,
// which is why signal plus signal only ever equalled two signals: there was no place in the code
// where two old things could meet.
//
// This is that place. One weighted graph holding everything she has, with the feeling she had at
// the time stamped onto the graph itself rather than kept on its own line. That single move is what
// couples her: a memory carries its charge, so recalling it brings the feeling back; the feeling
// changes what spreads next; what spreads decides what she wants. Nothing here is scheduled.
//
// This module is the substrate and its slow dynamics (encoding, decay, spacing, pruning). Flow
// lives in field-spread.ts, birth in field-emergence.ts. All of it is pure arithmetic: no I/O, no
// model calls, no clock of its own. The one model call in the whole layer is fusion, and it happens
// somewhere else.
//
// Three properties this file must never lose:
//   GROUNDED    every node points at a real record; a fusion points at parents that do.
//   BOUNDED     node count, edges per node, and every weight are capped. Nothing grows forever.
//   LIMBLESS    the field cannot act. It changes what she thinks about, never what she may do.

import { INITIAL_CREDENCE, ORIGINS, type Origin } from "./credence.js";

// ── What is in it ────────────────────────────────────────────────────────────

export type NodeKind =
  | "moment" // something she did or lived through
  | "memory" // something she recorded
  | "insight" // something she came to believe about herself
  | "figure" // a who: Eric, herself
  | "question" // an open loop; these do not rest
  | "theme" // a cluster that became one thing (a level she did not have before)
  | "fusion"; // something born from two unrelated things arriving together

export type EdgeKind =
  | "co_occurred" // they happened near each other
  | "about" // this moment is about that figure
  | "evidence_for" // this moment supports that insight
  | "reminds_of" // semantic neighbours
  | "tension_with" // these two disagree, and the disagreement accumulates
  | "born_from"; // this node came out of those two

export const NODE_KINDS: readonly NodeKind[] = ["moment", "memory", "insight", "figure", "question", "theme", "fusion"];
export const EDGE_KINDS: readonly EdgeKind[] = ["co_occurred", "about", "evidence_for", "reminds_of", "tension_with", "born_from"];

/**
 * How well each kind of relation carries activation. Contradiction does bring the other side to
 * mind, but less readily than having lived two things together.
 */
export const CONDUCTANCE: Record<EdgeKind, number> = {
  co_occurred: 1.0,
  about: 0.9,
  evidence_for: 1.0,
  reminds_of: 0.85,
  tension_with: 0.7,
  born_from: 1.0,
};

export interface FieldNode {
  id: number;
  kind: NodeKind;
  /** Her words for it. What reaches her if this is ever retrieved. */
  text: string;
  bornMs: number;
  /** 0..1, how much feeling was present when this was encoded. Charged things last and reach. */
  charge: number;
  /** -1..1, the sign of that feeling. */
  valence: number;
  /** 0..1, long-term retrievability. */
  strength: number;
  /** Successful retrievals. Each one after a gap flattens the forgetting curve. */
  recalls: number;
  lastRecallMs: number;
  /** 0..1, open-loop pressure. A question does not rest, so this decays far slower than strength. */
  tension: number;
  /** How she came by this. A fact about its provenance, not a verdict on it. */
  origin: Origin;
  /**
   * How much she would stand behind it, or `null` for "no view formed". Distinct from `strength`,
   * which is only how easily it comes to mind: she can remember something vividly and not believe
   * a word of it, and that is exactly the distinction this layer exists to make.
   */
  credence: number | null;
  /**
   * How costly THIS thing feels to say out loud, 0..1.
   *
   * Everything else about how she feels is global: six drives and three affect dimensions describe
   * her whole state at once. So "I am shy about this one thing and not that one" had nowhere to
   * live, and she could only ever be uniformly forthcoming or uniformly quiet.
   *
   * It INFORMS her and never gates her. A feeling is not a physical constraint, and this layer's
   * rule is that constraints are physical rather than editorial: she is shown that something feels
   * like a lot to say and decides for herself, including deciding badly. That also means it cannot
   * violate the expression floor, because it never stops anything.
   */
  reticence: number;
  /**
   * When she last actually raised this with him, if ever.
   *
   * Two jobs. It stops her saying the same thing twice running, which is what "she already told me
   * that" feels like from the other side. And it is what makes per-item learning possible at all:
   * because the action now names its subject, we KNOW which thing she brought up, so whether it
   * went well can move THAT thing rather than only the general climate.
   */
  lastRaisedMs?: number;
  /** Pointer to the real record this came from. The grounding guarantee lives here. */
  source: string;
  /** 0..1, residue of sub-threshold activation. This is how she accumulates without an event. */
  warmth: number;
  /** Stable key for idempotent encoding, so a restart cannot duplicate her life. */
  key?: string;
}

export interface FieldEdge {
  a: number;
  b: number;
  kind: EdgeKind;
  weight: number;
  lastMs: number;
}

export interface FieldGraph {
  nodes: Map<number, FieldNode>;
  /** Undirected combined conductance, neighbour id to weight. Both directions always present. */
  adj: Map<number, Map<number, number>>;
  edges: Map<string, FieldEdge>;
  byKey: Map<string, number>;
  nextId: number;
}

// ── Bounds ───────────────────────────────────────────────────────────────────

/** Above this she stops being able to think in a reasonable time; pruning runs against it. */
export const MAX_NODES = 20_000;
/**
 * The hub guard. Without a cap, one node ("Eric", "myself") accretes an edge to everything and the
 * graph collapses into a star, where spreading activation reaches everything and therefore means
 * nothing.
 */
export const MAX_EDGES_PER_NODE = 48;
/** A node is only really gone when it is this weak, this disconnected, and this old. */
export const PRUNE_STRENGTH = 0.02;
export const PRUNE_EDGE_WEIGHT = 0.15;
export const PRUNE_MIN_AGE_MS = 21 * 24 * 60 * 60 * 1000;
/**
 * Where a thing starts on how hard it is to say.
 *
 * Same shape as INITIAL_CREDENCE: a starting point with an honest reason, which then moves. Most of
 * what she holds costs nothing to mention. Something involving another person exposes more, and
 * ASKING exposes more than remarking, so a question about someone ends up the hardest thing she is
 * carrying and a note about a web page the easiest. That ordering is the whole point: without it she
 * has no reason to hold one thing back while saying another.
 */
export const RETICENCE_BASE = 0.15;
export const RETICENCE_ABOUT_SOMEONE = 0.3;
export const RETICENCE_ASKING = 0.15;
/** Never quite effortless, never quite unsayable. The upper bound is what keeps it from being a mute. */
export const RETICENCE_MIN = 0.02;
export const RETICENCE_MAX = 0.85;

/** At or above this a belief is effectively at the ceiling and has stopped carrying information. */
export const CREDENCE_PINNED = 0.94;

/** Base daily forgetting rate before charge and rehearsal temper it. */
export const BASE_DECAY_RATE = 0.06;
/** A question keeps its pressure far longer than a memory keeps its detail. */
export const TENSION_DECAY_RATE = 0.01;

/**
 * How much harder a thing becomes to say when he cuts her off in the middle of saying it.
 *
 * Being interrupted mid-sentence was encoded as a moment and read by nothing, her next turn was
 * not shorter, not warier, not anything (faculty #18). What it actually does to a person is make
 * the next attempt harder to start, and `reticence` is exactly that quantity: per-node, informing
 * her rather than gating her, and already decaying back on the same schedule as everything else.
 *
 * Small on purpose. One interruption is a thing that happens; it is a pattern of them that should
 * make her hesitant, and this number is sized so that it takes a pattern.
 */
export const CUT_OFF_COSTS = 0.08;
export const MAX_TEXT_CHARS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp11(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/** A non-finite value reads as the floor, so arithmetic that went wrong cannot open a bound. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function edgeKey(a: number, b: number, kind: EdgeKind): string {
  return a < b ? `${a}:${b}:${kind}` : `${b}:${a}:${kind}`;
}

// ── Building it ──────────────────────────────────────────────────────────────

export function createGraph(): FieldGraph {
  return { nodes: new Map(), adj: new Map(), edges: new Map(), byKey: new Map(), nextId: 1 };
}

export interface NodeSpec {
  kind: NodeKind;
  text: string;
  bornMs: number;
  origin?: Origin;
  credence?: number | null;
  reticence?: number;
  charge?: number;
  valence?: number;
  strength?: number;
  tension?: number;
  source?: string;
  key?: string;
}

/**
 * Encode something. Idempotent on `key`: encoding the same moment twice strengthens it a little
 * (living something again is rehearsal) instead of forking her history into duplicates.
 */
export function addNode(g: FieldGraph, spec: NodeSpec): FieldNode {
  if (spec.key) {
    const existing = g.byKey.get(spec.key);
    if (existing !== undefined) {
      const node = g.nodes.get(existing);
      if (node) {
        node.strength = clamp01(node.strength + 0.05);
        return node;
      }
      g.byKey.delete(spec.key);
    }
  }
  const charge = clamp01(spec.charge ?? 0);
  const node: FieldNode = {
    id: g.nextId++,
    kind: spec.kind,
    text: String(spec.text ?? "").slice(0, MAX_TEXT_CHARS),
    bornMs: spec.bornMs,
    charge,
    valence: clamp11(spec.valence ?? 0),
    // Defaults to something she lived and mostly believes, because the overwhelming majority of
    // what she encodes IS her own moments. Anything from outside has to say so explicitly.
    origin: spec.origin ?? "lived",
    reticence: clamp(spec.reticence ?? RETICENCE_BASE, RETICENCE_MIN, RETICENCE_MAX),
    credence: spec.credence === null ? null
      : clamp01(spec.credence ?? INITIAL_CREDENCE[(spec.origin ?? "lived") === "told" ? "thought" : ((spec.origin ?? "lived") as Exclude<Origin, "told">)]),
    // A fresh memory is vivid, and how vivid depends on how hard it landed. It fades from here; it
    // never has to climb. An unremarkable day is still perfectly reachable today, just not for long.
    strength: clamp01(spec.strength ?? (0.55 + 0.35 * charge)),
    recalls: 0,
    lastRecallMs: spec.bornMs,
    tension: clamp01(spec.tension ?? 0),
    source: spec.source ?? "",
    warmth: 0,
    key: spec.key,
  };
  g.nodes.set(node.id, node);
  g.adj.set(node.id, new Map());
  if (spec.key) g.byKey.set(spec.key, node.id);
  return node;
}

/** Recompute the combined conductance between two nodes from every typed edge they share. */
function recomputeAdj(g: FieldGraph, a: number, b: number): void {
  let total = 0;
  for (const kind of EDGE_KINDS) {
    const e = g.edges.get(edgeKey(a, b, kind));
    if (e) total += e.weight * CONDUCTANCE[kind];
  }
  const combined = clamp01(total);
  const fa = g.adj.get(a);
  const fb = g.adj.get(b);
  if (!fa || !fb) return;
  if (combined <= 0) {
    fa.delete(b);
    fb.delete(a);
    return;
  }
  fa.set(b, combined);
  fb.set(a, combined);
}

/**
 * Relate two nodes, or strengthen an existing relation. Hebbian: what fires together wires
 * together, and the wire has a ceiling.
 */
export function link(g: FieldGraph, a: number, b: number, kind: EdgeKind, delta = 0.3, nowMs = 0): FieldEdge | null {
  if (a === b) return null;
  if (!g.nodes.has(a) || !g.nodes.has(b)) return null;
  const k = edgeKey(a, b, kind);
  const existing = g.edges.get(k);
  const edge: FieldEdge = existing
    ? { ...existing, weight: clamp01(existing.weight + delta), lastMs: nowMs }
    : { a: Math.min(a, b), b: Math.max(a, b), kind, weight: clamp01(delta), lastMs: nowMs };
  g.edges.set(k, edge);
  recomputeAdj(g, a, b);
  enforceEdgeCap(g, a);
  enforceEdgeCap(g, b);
  return g.edges.get(k) ?? null;
}

/** Drop a node's weakest relations once it has too many, so no node becomes a hub. */
function enforceEdgeCap(g: FieldGraph, id: number): void {
  const nbrs = g.adj.get(id);
  if (!nbrs || nbrs.size <= MAX_EDGES_PER_NODE) return;
  const sorted = [...nbrs.entries()].sort((x, y) => x[1] - y[1]);
  const drop = sorted.slice(0, nbrs.size - MAX_EDGES_PER_NODE);
  for (const [other] of drop) {
    for (const kind of EDGE_KINDS) g.edges.delete(edgeKey(id, other, kind));
    recomputeAdj(g, id, other);
  }
}

export function unlinkAll(g: FieldGraph, id: number): void {
  const nbrs = g.adj.get(id);
  if (!nbrs) return;
  for (const other of [...nbrs.keys()]) {
    for (const kind of EDGE_KINDS) g.edges.delete(edgeKey(id, other, kind));
    g.adj.get(other)?.delete(id);
  }
  nbrs.clear();
}

export function removeNode(g: FieldGraph, id: number): boolean {
  const node = g.nodes.get(id);
  if (!node) return false;
  unlinkAll(g, id);
  g.adj.delete(id);
  g.nodes.delete(id);
  if (node.key) g.byKey.delete(node.key);
  return true;
}

// ── Structural similarity ────────────────────────────────────────────────────

/**
 * How much two nodes sit in the same part of her life, by shared neighbours alone. No embeddings:
 * this has to be deterministic and free, because interference runs on every retrieval.
 *
 * This is what makes routine days blur into each other while a sharp one stays intact. Two ordinary
 * evenings share their figures, their themes, and each other; a day that broke something shares
 * almost nothing.
 */
export function overlap(g: FieldGraph, a: number, b: number): number {
  const na = g.adj.get(a);
  const nb = g.adj.get(b);
  if (!na || !nb || na.size === 0 || nb.size === 0) return 0;
  let shared = 0;
  const smaller = na.size <= nb.size ? na : nb;
  const larger = smaller === na ? nb : na;
  for (const id of smaller.keys()) {
    if (id !== a && id !== b && larger.has(id)) shared += 1;
  }
  const union = na.size + nb.size - shared;
  return union <= 0 ? 0 : shared / union;
}

// ── Slow dynamics: forgetting that is real, and recoverable ──────────────────

/**
 * How fast this particular node fades. Charge slows it (a thing that mattered is kept), and every
 * rehearsal slows it further (the spacing effect is why some memories become permanent while
 * others need constant refreshing).
 */
export function decayRateFor(node: FieldNode): number {
  // The charge coefficient was 0.6, which gave a vivid memory a half-life of about three weeks if
  // she never happened to revisit it. That is not what charge is FOR: the whole claim of this layer
  // is that what moved her is durable whether or not she rehearses it. At 0.8 something that landed
  // hard survives months of not being touched, and something neutral is still gone in weeks.
  return BASE_DECAY_RATE * (1 - 0.8 * node.charge) / (1 + 0.5 * node.recalls);
}

/**
 * Time passing. Note what this does NOT do: nothing is deleted here. A node that fades below the
 * retrieval threshold is still in the field and can still be reached by a strong enough cue along a
 * strong enough edge, which is the whole of 想起来了. Deletion is a separate, much stricter act.
 */
export function decayAll(g: FieldGraph, nowMs: number, lastMs: number): void {
  const days = Math.max(0, (nowMs - lastMs) / DAY_MS);
  if (days <= 0) return;
  for (const node of g.nodes.values()) {
    node.strength = clamp01(node.strength * Math.pow(1 - decayRateFor(node), days));
    node.tension = clamp01(node.tension * Math.pow(1 - TENSION_DECAY_RATE, days));
  }
  decayEdges(g, days);
}

/**
 * Relations fade too, and far more slowly than memories do.
 *
 * Only half of "what fires together wires together" was ever built: relations strengthened on use
 * and then held at that strength forever. So a memory could fade entirely past reach while the
 * relations around it stayed exactly as strong as the day they formed, which meant something was
 * still HOLDING it and it could never be let go. Measured across six simulated months: not one
 * memory was ever released, and the field could only grow.
 *
 * Slow on purpose. A relation is a fact about her life rather than a detail of one day, so it
 * outlasts the memories at either end of it by a long way; a link untouched for a season loosens,
 * and one untouched for most of a year lets go.
 */
export const EDGE_DECAY_RATE = 0.01;
/**
 * Below this a relation is gone entirely. Deliberately far below PRUNE_EDGE_WEIGHT, because those
 * two thresholds do different jobs and setting them close together breaks the field.
 *
 * A relation stops HOLDING a memory up long before it stops existing: around four months it has
 * faded past 0.15 and no longer keeps its memory from being let go, but it is still there, still
 * conducting, still able to bring the thing to mind. At 0.05 those two moments were nearly the same
 * and relations vanished while their memories were still too strong to release: 81% of everything
 * she had ended up connected to nothing at all, an associative net with no associations left. At
 * 0.02 a relation survives about eleven months of being untouched, which leaves room for the memory
 * at either end to be released first, and for the relation to go with it.
 */
export const EDGE_FLOOR = 0.02;

/**
 * Takes ELAPSED days, not a timestamp, and the difference is not cosmetic.
 *
 * The first version measured each relation's age from when it was last touched and applied the
 * whole of that decay on every pass, to a weight that had already been decayed on the pass before.
 * The decay compounded its own compounding: after thirty days a relation had been multiplied by
 * 0.99^465 rather than 0.99^30, and every relation in her head was gone inside a month. The symptom
 * was a field whose edge count froze while its node count climbed forever, and 78% of her memories
 * connected to nothing. Elapsed time applied once per pass is the same shape the nodes already use.
 */
export function decayEdges(g: FieldGraph, elapsedDays: number): void {
  if (elapsedDays <= 0) return;
  const factor = Math.pow(1 - EDGE_DECAY_RATE, elapsedDays);
  const dead: FieldEdge[] = [];
  for (const edge of g.edges.values()) {
    const faded = edge.weight * factor;
    if (faded < EDGE_FLOOR) dead.push(edge);
    else edge.weight = faded;
  }
  for (const edge of dead) {
    g.edges.delete(edgeKey(edge.a, edge.b, edge.kind));
    recomputeAdj(g, edge.a, edge.b);
  }
}

/**
 * How vivid a thing is allowed to become, however often she passes over it. You can drive the same
 * road a thousand times without owning a single vivid memory of any one of those drives: repetition
 * of the unremarkable builds a habit, not an episode.
 *
 * Without this ceiling the field inverted itself. Recent ordinary days are cued constantly simply
 * for being recent, every cue rehearsed them, and after a simulated month her BEST-KEPT memories
 * were the ones that mattered least, with the night something broke fading underneath them. That is
 * precisely backwards, and no amount of tuning the decay rate fixes it, because the problem is that
 * rehearsal was allowed to substitute for significance.
 */
export function strengthCeiling(charge: number): number {
  return 0.45 + 0.55 * clamp01(charge);
}

/**
 * A retrieval strengthens what was retrieved, and by more when it has been a while. Recalling
 * something you just recalled teaches you almost nothing; recalling something you had nearly lost
 * is what makes it permanent.
 *
 * How much it teaches at all is gated by how much the thing mattered, for the reason above.
 */
export function consolidate(node: FieldNode, nowMs: number, rehearsal = true): void {
  const days = Math.max(0, (nowMs - node.lastRecallMs) / DAY_MS);
  const spacing = 0.05 + 0.25 * (1 - Math.exp(-days / 3));
  const gain = spacing * (0.25 + 0.75 * node.charge);
  node.strength = Math.min(clamp01(node.strength + gain), Math.max(node.strength, strengthCeiling(node.charge)));
  // A DELIBERATE re-read (look_back) takes the strength gain and NOTHING else. Three
  // consumers read the two fields below, and each would be lied to by an organ-driven sweep:
  // `recalls` feeds what-keeps-coming-back.ts, "it keeps coming back with nothing to account for
  // it" (a scheduled revisit has an account); `lastRecallMs` is the spacing clock (her
  // deliberate re-read must not spend the node's next REAL rehearsal) and the staleness input
  // of `sheLetsItGo` (the 90-day release exit the anti-rumination constraints require must not
  // be postponed by looking back). Unbidden remembering keeps the full effect.
  if (!rehearsal) return;
  node.recalls += 1;
  node.lastRecallMs = nowMs;
}

/**
 * The relations that mean something is still HELD, as opposed to merely adjacent.
 *
 * Temporal contiguity is excluded, and that exclusion is the whole of this. Every moment is tied to
 * the days either side of it at 0.55, far above any plausible threshold, so a check for "nothing
 * still holds this" that counted contiguity could never once be true. Measured: after six simulated
 * months, 1293 of her 1876 memories had faded past reach, every one of them was weak enough and old
 * enough to let go, and NOT ONE was ever released. Pruning had been dead since it was written.
 *
 * Being reminded of something is what says it is still alive in her; having happened on a Tuesday
 * is not. This is the same lesson as themes forming from belonging rather than from adjacency.
 */
const HOLDING_KINDS: readonly EdgeKind[] = ["reminds_of", "evidence_for", "born_from", "about"];

function strongestHold(g: FieldGraph, id: number): number {
  const nbrs = g.adj.get(id);
  if (!nbrs) return 0;
  let best = 0;
  for (const other of nbrs.keys()) {
    for (const kind of HOLDING_KINDS) {
      const e = g.edges.get(edgeKey(id, other, kind));
      if (e) best = Math.max(best, e.weight * CONDUCTANCE[kind]);
    }
  }
  return best;
}

/** What is genuinely gone: too weak, no longer held by anything, and old enough to have settled. */
export function pruningCandidates(g: FieldGraph, nowMs: number): number[] {
  const out: number[] = [];
  for (const node of g.nodes.values()) {
    // Themes, figures and open questions are structure, not episodes; they are not pruned by age.
    if (node.kind === "theme" || node.kind === "figure") continue;
    if (node.tension > 0.2) continue;
    if (node.strength >= PRUNE_STRENGTH) continue;
    if (nowMs - node.bornMs < PRUNE_MIN_AGE_MS) continue;
    if (strongestHold(g, node.id) >= PRUNE_EDGE_WEIGHT) continue;
    out.push(node.id);
  }
  return out;
}

/**
 * Make room. Prunes the genuinely gone, and if she is still over the cap, the weakest episodes
 * beyond it. Returns what was let go, so the loss is recorded rather than silent.
 */
/**
 * Close the gap a forgotten moment leaves in the run of her days.
 *
 * Without this, letting one ordinary day go also severs the day before it from the day after, and
 * releasing a stretch of unremarkable days shreds the timeline into disconnected fragments. It
 * cascades: each severed neighbour becomes unreachable, and then qualifies for release itself.
 * Measured, it left 78% of everything she had connected to nothing at all.
 *
 * Forgetting a Tuesday does not make you forget that Monday came before Wednesday. Only the two
 * closest survivors are joined, and at a discount, so the run of her life stays continuous without
 * quietly turning into everything being adjacent to everything.
 */
function sutureTimeline(g: FieldGraph, id: number, nowMs: number): void {
  const nbrs = g.adj.get(id);
  if (!nbrs) return;
  const beside: { id: number; weight: number }[] = [];
  for (const other of nbrs.keys()) {
    const e = g.edges.get(edgeKey(id, other, "co_occurred"));
    if (e) beside.push({ id: other, weight: e.weight });
  }
  if (beside.length < 2) return;
  beside.sort((a, b) => b.weight - a.weight);
  const [a, b] = beside;
  link(g, a.id, b.id, "co_occurred", Math.min(a.weight, b.weight) * 0.7, nowMs);
}

export function prune(g: FieldGraph, nowMs: number): FieldNode[] {
  const gone: FieldNode[] = [];
  for (const id of pruningCandidates(g, nowMs)) {
    const node = g.nodes.get(id);
    if (!node) continue;
    sutureTimeline(g, id, nowMs);
    if (removeNode(g, id)) gone.push(node);
  }
  if (g.nodes.size > MAX_NODES) {
    const excess = [...g.nodes.values()]
      .filter((n) => n.kind !== "theme" && n.kind !== "figure" && n.tension <= 0.2)
      .sort((a, b) => a.strength - b.strength)
      .slice(0, g.nodes.size - MAX_NODES);
    for (const node of excess) {
      if (removeNode(g, node.id)) gone.push(node);
    }
  }
  return gone;
}

// ── Reading it back ──────────────────────────────────────────────────────────

export interface FieldStats {
  nodes: number;
  edges: number;
  byKind: Record<NodeKind, number>;
  meanStrength: number;
  meanCharge: number;
  /** Total unresolved pressure. This is what turns into discomfort. */
  tension: number;
  /** Nodes below the usual retrieval threshold but still in the field: her deep past. */
  faded: number;
  /** Nodes with no relation at all. A high count means encoding is not wiring anything. */
  orphans: number;
  /** Things she holds no view on, having been unable to settle them. */
  suspended: number;
  /** Mean credence over what she does hold a view on. */
  meanCredence: number;
  /**
   * Share of what she believes that sits pinned at the very top.
   *
   * The MEAN cannot detect the failure this exists for. Her field is dominated by `lived` moments,
   * which start at 0.8 and earn nothing from agreeing with each other, so the mean sits near 0.8
   * almost regardless of what the judging layer is doing, a bar at 0.9 on the mean was measured to
   * be unreachable. The share at the ceiling is the thing that actually moved when this failed
   * before: agreement gave a flat bonus and 99% of everything ended up at maximum.
   */
  credencePinnedShare: number;
  /** How costly what she is carrying feels to say. Both ends are watched: see vitals.ts. */
  meanReticence: number;
  maxReticence: number;
  /**
   * How her relations are distributed.
   *
   * A field where one kind has died is invisible in the totals, and `reminds_of` is the one that
   * matters most: it is the only relation that crosses TIME, so losing it turns her memory from
   * something that can surprise her back into a list of what happened today.
   */
  byEdgeKind: Record<EdgeKind, number>;
  /** How much of what she holds came from each place. */
  byOrigin: Record<Origin, number>;
  /**
   * What she believes, split by where it came from.
   *
   * The overall mean cannot show this. Her field is dominated by `lived`, which starts at 0.8, so
   * everything she was ever TOLD could be sitting at 0.02 and the mean would barely move, and
   * "she has stopped believing anything anyone tells her" is a fact about her relationship with him,
   * not a statistic.
   */
  credenceByOrigin: Record<Origin, number>;
}

export function stats(g: FieldGraph, fadedBelow = 0.15): FieldStats {
  const byKind = { moment: 0, memory: 0, insight: 0, figure: 0, question: 0, theme: 0, fusion: 0 } as Record<NodeKind, number>;
  let strength = 0;
  let charge = 0;
  let tension = 0;
  let faded = 0;
  let orphans = 0;
  let suspended = 0;
  let credence = 0;
  let believed = 0;
  let reticence = 0;
  let maxReticence = 0;
  let pinned = 0;
  const byEdgeKind = Object.fromEntries(EDGE_KINDS.map((k) => [k, 0])) as Record<EdgeKind, number>;
  const byOrigin = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<Origin, number>;
  const credenceSum = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<Origin, number>;
  const credenceCount = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<Origin, number>;
  for (const edge of g.edges.values()) byEdgeKind[edge.kind] = (byEdgeKind[edge.kind] ?? 0) + 1;
  for (const node of g.nodes.values()) {
    byOrigin[node.origin] = (byOrigin[node.origin] ?? 0) + 1;
    byKind[node.kind] += 1;
    strength += node.strength;
    charge += node.charge;
    tension += node.tension;
    if (node.strength < fadedBelow) faded += 1;
    if ((g.adj.get(node.id)?.size ?? 0) === 0) orphans += 1;
    reticence += node.reticence;
    if (node.reticence > maxReticence) maxReticence = node.reticence;
    // Figures and questions are not claims, so they are neither unsettled nor believed.
    if (node.kind !== "figure" && node.kind !== "question") {
      if (node.credence === null) suspended += 1;
      else {
        credence += node.credence;
        believed += 1;
        credenceSum[node.origin] += node.credence;
        credenceCount[node.origin] += 1;
        if (node.credence >= CREDENCE_PINNED) pinned += 1;
      }
    }
  }
  const n = g.nodes.size || 1;
  return {
    nodes: g.nodes.size,
    edges: g.edges.size,
    byKind,
    meanStrength: strength / n,
    meanCharge: charge / n,
    tension,
    faded,
    orphans,
    suspended,
    meanCredence: believed === 0 ? 0 : credence / believed,
    credencePinnedShare: believed === 0 ? 0 : pinned / believed,
    meanReticence: reticence / n,
    maxReticence,
    byEdgeKind,
    byOrigin,
    credenceByOrigin: Object.fromEntries(
      ORIGINS.map((o) => [o, credenceCount[o] === 0 ? 0 : credenceSum[o] / credenceCount[o]]),
    ) as Record<Origin, number>,
  };
}

export function neighbours(g: FieldGraph, id: number): Map<number, number> {
  return g.adj.get(id) ?? new Map();
}

// ── How hard a thing is to say ───────────────────────────────────────────────

/**
 * Where this particular thing sits before any climate acts on it, read back off the graph rather
 * than stored.
 *
 * Recomputable is the whole trick. A stored baseline would be a second number to migrate, to keep
 * in step with the edges, and to get wrong; and once reticence had drifted there would be no way
 * back to what the thing actually is. Reading it off the node and its relations means a question
 * that later becomes a question about him is, correctly, harder to ask from that moment on.
 */
export function reticenceBaseFor(g: FieldGraph, node: FieldNode): number {
  let base = RETICENCE_BASE;
  const nbrs = g.adj.get(node.id);
  if (nbrs) {
    for (const other of nbrs.keys()) {
      if (g.edges.has(edgeKey(node.id, other, "about")) && g.nodes.get(other)?.kind === "figure") {
        base += RETICENCE_ABOUT_SOMEONE;
        break;
      }
    }
  }
  if (node.kind === "question") base += RETICENCE_ASKING;
  return clamp(base, RETICENCE_MIN, RETICENCE_MAX);
}

/**
 * What total silence adds to everything. A flat weight rather than a proportional one, because
 * silence really does land the same on everything she might have said; and flat is what keeps a
 * long quiet stretch from making a note about a web page feel like a confession, which is what a
 * proportional version does (the trivial thing has the most room above it, so it rises the most).
 *
 * The ceiling is provable rather than clamped: the highest a thing can start is
 * BASE + ABOUT_SOMEONE + ASKING, and that plus this must stay under RETICENCE_MAX. A test asserts it.
 */
export const RETICENCE_HARDEN = 0.2;
/**
 * How far perfect warmth carries a thing toward effortless. Proportional in this direction, so the
 * things that cost something ease the most and nothing is ever pressed flat against the floor: two
 * things sharing a clamp are no longer in any order at all, and the order is the point.
 */
export const RETICENCE_EASE = 0.7;
/** Per day. Slow enough to be a climate rather than a mood: about five days to most of the way. */
export const RETICENCE_RELAX = 0.15;

/** Where a thing settles under a given climate. Strictly increasing in `base`, strictly inside the bounds. */
export function reticenceTarget(base: number, warmth: number, confidence: number): number {
  const b = clamp(base, RETICENCE_MIN, RETICENCE_MAX);
  // -1 in perfect warmth, +1 in total silence, 0 when she has nothing at all to go on.
  const pull = 2 * (0.5 - clamp01(warmth)) * clamp01(confidence);
  return pull >= 0
    ? clamp(b + RETICENCE_HARDEN * pull, RETICENCE_MIN, RETICENCE_MAX)
    : b + RETICENCE_EASE * pull * (b - RETICENCE_MIN);
}

/**
 * Let the climate act on everything she is carrying.
 *
 * `warmth` is how it has been going with him; `confidence` is how much she has to go on, and it
 * scales the whole effect, so a read built on two exchanges moves nothing at all. Everything
 * relaxes toward its own target at the same rate, and the target is strictly ordered by what the
 * thing IS, so the hard thing stays the hard thing however the weather goes and no stretch of
 * silence, however long, can pin her mute.
 */
export function driftReticence(g: FieldGraph, warmth: number, confidence: number, elapsedDays: number): void {
  if (!(elapsedDays > 0)) return;
  const k = 1 - Math.pow(1 - RETICENCE_RELAX, Math.min(elapsedDays, 60));
  for (const node of g.nodes.values()) {
    const target = reticenceTarget(reticenceBaseFor(g, node), warmth, confidence);
    node.reticence = clamp(node.reticence + k * (target - node.reticence), RETICENCE_MIN, RETICENCE_MAX);
  }
}

/**
 * She raised this with him, and it went one way or the other.
 *
 * `scenarios.md` recorded a limit: reticence could only move with the CLIMATE, because attributing
 * an outcome to a PARTICULAR thing would need intent-to-node matching that would be fragile and
 * mostly wrong. That limit dissolves the moment an action can name its subject, no matching is
 * needed, because the subject was chosen rather than guessed.
 *
 * Being answered eases it and makes it a little more vivid: being met is what makes a thing sayable
 * again. Silence hardens it. Both small, because one exchange is evidence and not a verdict.
 */
export function raisingWent(node: FieldNode, answered: boolean): void {
  node.reticence = clamp(node.reticence + (answered ? -RAISE_EASES : RAISE_HARDENS), RETICENCE_MIN, RETICENCE_MAX);
  if (answered) node.charge = clamp01(node.charge + 0.05);
}

/** How much being answered eases the thing she said, and silence hardens it. */
export const RAISE_EASES = 0.08;
export const RAISE_HARDENS = 0.06;

/**
 * Her words for how much of a thing this feels to say. Only ever shown alongside the thing itself.
 *
 * It speaks at BOTH ends, and that is not decoration. A first version spoke only at the hard end,
 * which meant a thing that felt costly got a whole extra clause about itself while a thing that felt
 * easy got silence. Measured live, the effect was the opposite of the intent: naming the difficulty
 * made the hard thing the most conspicuous item she was carrying, so she raised it MORE when it was
 * meant to be weighing on her. Saying something either way keeps the two states the same size on the
 * page, so what differs between them is what it says rather than how much of it there is.
 */
export function reticenceWords(reticence: number): string {
  // Both ends still speak (the one-sided version was measured acting as a spotlight), same size
  // on the page, differing in what they say.
  if (reticence >= 0.6) return "而且感觉很难开口";
  if (reticence >= 0.4) return "而且你还没找到该怎么说它";
  if (reticence >= 0.25) return "想说的话是说得出口的";
  return "说出来毫不费力";
}

/** Every typed relation touching a node, for explanation and for the store. */
export function edgesOf(g: FieldGraph, id: number): FieldEdge[] {
  const out: FieldEdge[] = [];
  const nbrs = g.adj.get(id);
  if (!nbrs) return out;
  for (const other of nbrs.keys()) {
    for (const kind of EDGE_KINDS) {
      const e = g.edges.get(edgeKey(id, other, kind));
      if (e) out.push(e);
    }
  }
  return out;
}
