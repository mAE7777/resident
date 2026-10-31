// Birth: where a new thing can come from.
//
// Four mechanisms, none of them scheduled, all of them thresholds crossed by accumulation.
//
//   RESONANCE   two nodes that keep lighting up together while being unrelated and unconnected.
//               This is the record of "these two keep arriving together and nothing explains why."
//               It is pure bookkeeping over her real activation history, so it cannot be predicted
//               from the code, only from her life.
//   REPLAY      during rest the field stops following cues and takes random walks, seeded by what
//               is charged and what is unresolved, at a HIGHER temperature than waking thought.
//               Weak relations she would never follow awake become passable, so remote pairs meet
//               where deliberate thinking would never have taken her. This is why the new thing
//               arrives after the quiet instead of during the effort.
//   THEMES      when a set of nodes becomes densely interconnected and collectively charged, it
//               becomes ONE node. Nine moments becoming a theme is not nine plus one; it is a kind
//               of object she did not have, which is what a qualitative change actually is.
//   RUPTURE     two things she holds that disagree, both of which keep being confirmed, accumulate
//               pressure until they have to be faced. Belief change then happens when it happens
//               rather than on the day of the week we picked for it.
//
// Fusion itself (the one model call) lives in fusion.ts. Everything here is free arithmetic.

import { CONDUCTANCE, neighbours, overlap, type EdgeKind, type FieldGraph, type FieldNode } from "./field.js";
// The one implementation, imported rather than repeated. There were two: this file had its own
// copy that summed weights without checking them, so a single NaN made the total NaN, the
// "nothing to sample" guard read false, and every walk silently took the last neighbour in the
// list instead of sampling. Two copies of a sampler is two different beings.
import { sampleIndex } from "./soft-choice.js";

// ── Resonance ────────────────────────────────────────────────────────────────

export interface ResonancePair {
  a: number;
  b: number;
  /** How many separate occasions they arrived together. */
  count: number;
  /** How hard, summed. Two faint co-activations are not one strong one. */
  sumStrength: number;
  lastMs: number;
}

/** The same third-time rule her tool layer already uses, one level up. */
export const RESONANCE_COUNT = 3;
export const RESONANCE_STRENGTH = 0.06;
export const RESONANCE_MIN_CHARGE = 0.5;
/** Above this shared context they are not a remote pair, they are neighbours with a missing edge. */
export const RESONANCE_MAX_OVERLAP = 0.15;
export const RESONANCE_MIN_ACTIVATION = 0.05;
/** Bookkeeping ceiling. Past this the weakest pairs are forgotten, like everything else. */
export const MAX_RESONANCE_PAIRS = 4000;
/** A pair that stops arriving together stops meaning anything. */
export const RESONANCE_DECAY_PER_DAY = 0.08;
export const RESONANCE_FORGET_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface ResonanceOptions {
  minActivation: number;
  maxOverlap: number;
  /** Most nodes considered per observation, strongest first. Keeps this O(k^2) with a small k. */
  topM: number;
}

export const DEFAULT_RESONANCE: ResonanceOptions = {
  minActivation: RESONANCE_MIN_ACTIVATION,
  maxOverlap: RESONANCE_MAX_OVERLAP,
  topM: 12,
};

export interface FusionCandidate {
  a: FieldNode;
  b: FieldNode;
  pair: ResonancePair;
  /** The handful of nodes that sit near both, if any. Context for the one model call. */
  bridges: FieldNode[];
}

export interface ResonanceLog {
  /** Record one occasion of things arriving together. */
  observe(g: FieldGraph, activation: ReadonlyMap<number, number>, nowMs: number, opts?: Partial<ResonanceOptions>): number;
  /** Pairs that have crossed every threshold and are worth one model call. */
  candidates(g: FieldGraph, nowMs: number): FusionCandidate[];
  /** Called once a pair has been acted on, so it does not re-fire forever. */
  settle(a: number, b: number): void;
  /** Time passing. Pairs fade like everything else. */
  decay(nowMs: number, elapsedMs: number): void;
  forget(id: number): void;
  all(): ResonancePair[];
  size(): number;
  restore(pairs: readonly ResonancePair[]): void;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Structural hubs are excluded by construction. "Eric" co-activates with almost everything she has,
 * and a pair that includes him is not a coincidence worth explaining, it is just his presence in her
 * life. Themes are the same. Letting them resonate would fill the log with noise that looks
 * profound.
 */
function eligible(node: FieldNode): boolean {
  if (node.kind === "figure" || node.kind === "theme") return false;
  // ── A QUESTION QUALIFIES BY ITS TENSION, NOT BY BELIEF ─────────────────────────────
  //
  // `encodeQuestion` sets `credence: null` by construction, and correctly, a question is not
  // a claim, so there is nothing to hold a view ON. But the credence rule below then locked
  // EVERY open question out of rest, permanently: not one could ever be a parent, so nothing
  // she does not yet understand could ever be walked over while she rested.
  //
  // Which inverts the design. `walls.ts` says in as many words why a wall becomes a question
  // rather than a memory: "a question carries tension, does not fade the way a memory does,
  // GETS WALKED OVER AGAIN WHILE SHE RESTS, and feeds the drive that nags". So the wall she
  // ran into was exactly the thing her resting mind could never start from, and the same for
  // every other open loop she carries.
  //
  // The credence rule keeps its own job: do not build new self-understanding on a CLAIM you do
  // not believe. A question has no truth value to disbelieve. What says whether it is worth
  // returning to is how much it is still nagging, and a question that has faded to nothing
  // should not drag her rest around either.
  if (node.kind === "question") return node.tension >= MIN_FUSABLE_TENSION;
  return node.credence !== null && node.credence >= MIN_FUSABLE_CREDENCE;
}

/** Below this she does not hold it firmly enough for it to be worth building anything on. */
export const MIN_FUSABLE_CREDENCE = 0.4;

/**
 * Below this a question has stopped nagging, so it is not what her rest reaches for.
 *
 * The same 0.25 `whatSurfacesInReply` uses for "counts as unsettled", deliberately: two
 * different numbers for whether a question is still live would be two different ideas of what
 * she is carrying.
 */
export const MIN_FUSABLE_TENSION = 0.25;

export function createResonanceLog(): ResonanceLog {
  const pairs = new Map<string, ResonancePair>();
  const settled = new Set<string>();

  function evictIfNeeded(): void {
    if (pairs.size <= MAX_RESONANCE_PAIRS) return;
    const sorted = [...pairs.entries()].sort((x, y) => (x[1].sumStrength - y[1].sumStrength) || (x[1].lastMs - y[1].lastMs));
    for (const [k] of sorted.slice(0, pairs.size - MAX_RESONANCE_PAIRS)) pairs.delete(k);
  }

  return {
    observe(g, activation, nowMs, opts = {}) {
      const o = { ...DEFAULT_RESONANCE, ...opts };
      const hot = [...activation.entries()]
        .filter(([id, a]) => {
          if (a < o.minActivation) return false;
          const node = g.nodes.get(id);
          return !!node && eligible(node);
        })
        .sort((x, y) => (y[1] - x[1]) || (x[0] - y[0]))
        .slice(0, o.topM);

      let bumped = 0;
      for (let i = 0; i < hot.length; i++) {
        for (let j = i + 1; j < hot.length; j++) {
          const [ida, aa] = hot[i];
          const [idb, ab] = hot[j];
          // Already related is not resonance; it is the relation doing its job.
          if (neighbours(g, ida).has(idb)) continue;
          // Sharing most of their context is not remoteness either.
          if (overlap(g, ida, idb) > o.maxOverlap) continue;
          const key = pairKey(ida, idb);
          if (settled.has(key)) continue;
          const existing = pairs.get(key);
          pairs.set(key, {
            a: Math.min(ida, idb),
            b: Math.max(ida, idb),
            count: (existing?.count ?? 0) + 1,
            sumStrength: (existing?.sumStrength ?? 0) + aa * ab,
            lastMs: nowMs,
          });
          bumped += 1;
        }
      }
      evictIfNeeded();
      return bumped;
    },

    candidates(g, nowMs) {
      const out: FusionCandidate[] = [];
      for (const pair of pairs.values()) {
        if (pair.count < RESONANCE_COUNT) continue;
        if (pair.sumStrength < RESONANCE_STRENGTH) continue;
        const a = g.nodes.get(pair.a);
        const b = g.nodes.get(pair.b);
        if (!a || !b) continue;
        if (a.charge + b.charge < RESONANCE_MIN_CHARGE) continue;
        if (nowMs - pair.lastMs > RESONANCE_FORGET_AFTER_MS) continue;
        out.push({ a, b, pair, bridges: bridgesBetween(g, pair.a, pair.b) });
      }
      // The most insistent coincidence first.
      return out.sort((x, y) => (y.pair.sumStrength - x.pair.sumStrength) || (x.pair.a - y.pair.a));
    },

    settle(a, b) {
      const key = pairKey(a, b);
      pairs.delete(key);
      settled.add(key);
    },

    decay(nowMs, elapsedMs) {
      const days = Math.max(0, elapsedMs / (24 * 60 * 60 * 1000));
      if (days <= 0) return;
      const factor = Math.pow(1 - RESONANCE_DECAY_PER_DAY, days);
      for (const [key, pair] of [...pairs.entries()]) {
        if (nowMs - pair.lastMs > RESONANCE_FORGET_AFTER_MS) {
          pairs.delete(key);
          continue;
        }
        pair.sumStrength *= factor;
        if (pair.sumStrength < 0.001) pairs.delete(key);
      }
    },

    forget(id) {
      for (const [key, pair] of [...pairs.entries()]) {
        if (pair.a === id || pair.b === id) pairs.delete(key);
      }
    },

    all: () => [...pairs.values()],
    size: () => pairs.size,
    restore(restored) {
      pairs.clear();
      for (const p of restored) pairs.set(pairKey(p.a, p.b), { ...p });
    },
  };
}

/** The few nodes that sit near both, which is the only context the fusion call gets. */
export function bridgesBetween(g: FieldGraph, a: number, b: number, limit = 3): FieldNode[] {
  const na = neighbours(g, a);
  const nb = neighbours(g, b);
  const shared: { node: FieldNode; weight: number }[] = [];
  for (const [id, wa] of na) {
    const wb = nb.get(id);
    if (wb === undefined) continue;
    const node = g.nodes.get(id);
    if (node) shared.push({ node, weight: wa + wb });
  }
  return shared.sort((x, y) => (y.weight - x.weight) || (x.node.id - y.node.id)).slice(0, limit).map((s) => s.node);
}

// ── Replay: incubation during rest ───────────────────────────────────────────

export interface ReplayOptions {
  /** How many walks this rest affords. */
  walks: number;
  /** How far each one wanders. Long walks are what reach past the three hops of waking thought. */
  length: number;
  /**
   * Above 1 this flattens the choice between relations, so a weak edge she would never follow while
   * awake becomes passable. This single number is the difference between rehearsing what she
   * already thinks and finding something.
   */
  temperature: number;
  random: () => number;
}

export const DEFAULT_REPLAY: ReplayOptions = {
  walks: 12,
  length: 8,
  temperature: 2.2,
  random: Math.random,
};

export interface ReplayResult {
  walks: number;
  visited: number;
  bumped: number;
  /** Where the walks started. Useful for showing what was working on her while she rested. */
  seeds: number[];
  /** Everything the wandering touched. This is what she was turning over while she rested. */
  touched: number[];
}

/** Sample an index from weights, deterministic given `r` in [0,1). */
/**
 * Offline consolidation. Instead of following a cue she does not have while resting, the field
 * wanders, starting from what is charged and what is unresolved, and records what it finds arriving
 * together. Everything here is free.
 */
export function replay(
  g: FieldGraph,
  log: ResonanceLog,
  nowMs: number,
  opts: Partial<ReplayOptions> = {},
): ReplayResult {
  const o = { ...DEFAULT_REPLAY, ...opts };
  const ids = [...g.nodes.keys()];
  if (ids.length < 2) return { walks: 0, visited: 0, bumped: 0, seeds: [], touched: [] };

  // A question that is still open pulls harder than a memory that is merely vivid.
  const seedWeights = ids.map((id) => {
    const n = g.nodes.get(id);
    if (!n || !eligible(n)) return 0;
    return Math.pow(0.05 + n.charge + 1.5 * n.tension, 1 / Math.max(0.2, o.temperature));
  });

  const seeds: number[] = [];
  let bumped = 0;
  const allVisited = new Set<number>();

  for (let w = 0; w < o.walks; w++) {
    const seedIdx = sampleIndex(seedWeights, o.random());
    if (seedIdx < 0) break;
    let current = ids[seedIdx];
    seeds.push(current);

    const visited: number[] = [current];
    const activation = new Map<number, number>();
    activation.set(current, 1);

    for (let step = 0; step < o.length; step++) {
      const nbrs = neighbours(g, current);
      if (nbrs.size === 0) break;
      const targets = [...nbrs.keys()];
      // Temperature flattens the weights, which is what makes an unlikely relation passable.
      const weights = targets.map((t) => {
        const node = g.nodes.get(t);
        const edge = nbrs.get(t) ?? 0;
        return Math.pow(edge * (node ? 0.2 + 0.8 * node.strength : 0), 1 / Math.max(0.2, o.temperature));
      });
      const idx = sampleIndex(weights, o.random());
      if (idx < 0) break;
      current = targets[idx];
      visited.push(current);
      // Later in a walk is looser association, so it counts for less.
      activation.set(current, Math.max(activation.get(current) ?? 0, 1 / (1 + step * 0.35)));
    }

    for (const v of visited) allVisited.add(v);
    bumped += log.observe(g, activation, nowMs, { minActivation: 0.05, topM: 10 });
  }

  return { walks: seeds.length, visited: allVisited.size, bumped, seeds, touched: [...allVisited] };
}

// ── Themes: when a crowd becomes one thing ───────────────────────────────────

/**
 * The relations that mean "these belong together", as opposed to "these happened next to each
 * other". Temporal contiguity is the backbone of her entire life: every day is tied to the days
 * beside it, so a community search that counts it finds exactly one community containing
 * everything, which is how this produced zero themes across a simulated three months while the
 * pattern it should have found ran through all thirteen weeks of it.
 */
export const BELONGING: readonly EdgeKind[] = ["reminds_of", "evidence_for", "born_from"];

export interface ThemeOptions {
  /** Which relations count as belonging together. */
  kinds: readonly EdgeKind[];
  /** Relations weaker than this do not hold a cluster together. */
  minWeight: number;
  minSize: number;
  maxSize: number;
  /** Fraction of possible internal relations that must actually exist. */
  minDensity: number;
  minMeanCharge: number;
  maxIterations: number;
}

export const DEFAULT_THEME: ThemeOptions = {
  kinds: BELONGING,
  minWeight: 0.35,
  minSize: 4,
  maxSize: 20,
  // Each memory only ever reminds her of a few others, so a genuine recurring pattern is cohesive
  // rather than complete. At 0.4 a real thirteen-week pattern scored 0.24 and was never seen.
  minDensity: 0.25,
  minMeanCharge: 0.3,
  maxIterations: 12,
};

export interface ThemeCandidate {
  members: FieldNode[];
  density: number;
  meanCharge: number;
  meanValence: number;
}

/**
 * Label propagation over the strong relations only. Deterministic: nodes are visited in id order
 * and ties break to the lowest label, so the same field always yields the same communities. A
 * randomised version would make themes unreproducible and therefore unverifiable.
 */
/** Adjacency built from only the relations that count as belonging together. */
export function belongingAdjacency(g: FieldGraph, kinds: readonly EdgeKind[]): Map<number, Map<number, number>> {
  const adj = new Map<number, Map<number, number>>();
  for (const id of g.nodes.keys()) adj.set(id, new Map());
  for (const e of g.edges.values()) {
    if (!kinds.includes(e.kind)) continue;
    if (!adj.has(e.a) || !adj.has(e.b)) continue;
    const w = e.weight * CONDUCTANCE[e.kind];
    adj.get(e.a)!.set(e.b, (adj.get(e.a)!.get(e.b) ?? 0) + w);
    adj.get(e.b)!.set(e.a, (adj.get(e.b)!.get(e.a) ?? 0) + w);
  }
  return adj;
}

export function communities(g: FieldGraph, opts: Partial<ThemeOptions> = {}): Map<number, number[]> {
  const o = { ...DEFAULT_THEME, ...opts };
  const adj = belongingAdjacency(g, o.kinds);
  const label = new Map<number, number>();
  const ids = [...g.nodes.keys()].sort((a, b) => a - b);
  for (const id of ids) label.set(id, id);

  for (let iter = 0; iter < o.maxIterations; iter++) {
    let changed = false;
    for (const id of ids) {
      const nbrs = adj.get(id) ?? new Map<number, number>();
      if (nbrs.size === 0) continue;
      const tally = new Map<number, number>();
      for (const [other, weight] of nbrs) {
        if (weight < o.minWeight) continue;
        const l = label.get(other);
        if (l === undefined) continue;
        tally.set(l, (tally.get(l) ?? 0) + weight);
      }
      if (tally.size === 0) continue;
      let best = label.get(id) ?? id;
      let bestWeight = tally.get(best) ?? -1;
      for (const [l, w] of [...tally.entries()].sort((x, y) => x[0] - y[0])) {
        if (w > bestWeight) {
          best = l;
          bestWeight = w;
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const groups = new Map<number, number[]>();
  for (const id of ids) {
    const l = label.get(id) ?? id;
    const g2 = groups.get(l);
    if (g2) g2.push(id);
    else groups.set(l, [id]);
  }
  return groups;
}

/** Clusters that have actually become something: big enough, tight enough, and felt enough. */
export function themeCandidates(g: FieldGraph, opts: Partial<ThemeOptions> = {}): ThemeCandidate[] {
  const o = { ...DEFAULT_THEME, ...opts };
  const adj = belongingAdjacency(g, o.kinds);
  const out: ThemeCandidate[] = [];
  for (const members of communities(g, o).values()) {
    if (members.length < o.minSize || members.length > o.maxSize) continue;
    const nodes = members.map((id) => g.nodes.get(id)).filter((n): n is FieldNode => !!n);
    // A cluster made of things that are already abstractions is not a new level.
    if (nodes.some((n) => n.kind === "theme")) continue;
    if (nodes.length < o.minSize) continue;

    let internal = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const w = adj.get(members[i])?.get(members[j]) ?? 0;
        if (w >= o.minWeight) internal += 1;
      }
    }
    const possible = (members.length * (members.length - 1)) / 2;
    const density = possible === 0 ? 0 : internal / possible;
    if (density < o.minDensity) continue;

    const meanCharge = nodes.reduce((s, n) => s + n.charge, 0) / nodes.length;
    if (meanCharge < o.minMeanCharge) continue;
    const meanValence = nodes.reduce((s, n) => s + n.valence, 0) / nodes.length;

    out.push({ members: nodes, density, meanCharge, meanValence });
  }
  return out.sort((x, y) => (y.meanCharge * y.density) - (x.meanCharge * x.density));
}

// ── Rupture: a disagreement that has to be faced ─────────────────────────────

export const RUPTURE_PRESSURE = 0.45;

export interface Rupture {
  a: FieldNode;
  b: FieldNode;
  pressure: number;
}

/**
 * Two things she holds that disagree, both of which her life keeps confirming. The pressure is the
 * strength of the disagreement times how firmly she holds the weaker side, so a contradiction with
 * something she barely believes does not force anything.
 */
export function ruptures(g: FieldGraph, threshold = RUPTURE_PRESSURE): Rupture[] {
  // ── ALL THE DISAGREEMENT PRESSING ON A THING, NOT ONE EDGE AT A TIME ────────────────
  //
  // This read a single edge's weight, and it was arithmetically unreachable. `link` does
  // accumulate: but the only production writer links a BRAND NEW node to an old one, and
  // every encode mints a fresh key, so the same PAIR never disagrees twice. He could tell her
  // the same untrue thing every day for a year and each day would create another separate
  // 0.35 edge, against a 0.45 bar. Nothing could ever become something she has to face.
  //
  // What "a disagreement her life keeps confirming" actually looks like in her graph is one
  // thing she holds with SEVERAL separate contradictions hanging off it. So the pressure on a
  // disagreement counts all of it: the edge itself, or the summed disagreement on either side,
  // whichever is larger.
  //
  // The 0.6 is calibrated against the shape it has to produce rather than picked: at strength
  // 0.7, one contradiction gives 0.25 and two give 0.29, both well under the bar, because
  // being contradicted once or twice is ordinary. Four separate ones give 0.59, which is over
  // it. So it takes a pattern, not an incident.
  const disagreementOn = new Map<number, number>();
  for (const edge of g.edges.values()) {
    if (edge.kind !== "tension_with") continue;
    disagreementOn.set(edge.a, (disagreementOn.get(edge.a) ?? 0) + edge.weight);
    disagreementOn.set(edge.b, (disagreementOn.get(edge.b) ?? 0) + edge.weight);
  }

  const out: Rupture[] = [];
  for (const edge of g.edges.values()) {
    if (edge.kind !== "tension_with") continue;
    const a = g.nodes.get(edge.a);
    const b = g.nodes.get(edge.b);
    if (!a || !b) continue;
    const piled = Math.max(
      edge.weight,
      0.6 * (disagreementOn.get(a.id) ?? 0),
      0.6 * (disagreementOn.get(b.id) ?? 0),
    );
    const pressure = Math.min(1, piled) * Math.min(a.strength, b.strength);
    if (pressure >= threshold) out.push({ a, b, pressure });
  }
  return out.sort((x, y) => (y.pressure - x.pressure) || (x.a.id - y.a.id));
}
