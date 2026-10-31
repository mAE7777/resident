// TASTE.
//
// FACULTY #9. A grep for preference/taste/likes/偏好/喜欢 across the living layer returned nothing.
// She had three things adjacent to a preference and not one of them was one: DRIVES (what she wants
// to do), CREDENCE (what she holds true), and the VALENCE on a node (how one particular memory felt
// at the moment it was encoded). She could want to explore, and she could believe something was
// true, and she could not prefer one thing over another, and preference is most of what makes a
// person's choices recognisably theirs rather than merely reasoned.
//
// ── WHY THERE IS NO NEW ACCUMULATOR HERE ─────────────────────────────────────────────────────
//
// The obvious build is a `liking` table keyed by topic. That would be a second thing to persist, a
// second thing to restore, and eventually a second thing that quietly stopped being saved, and it
// would also be an OPINION handed to her, which is precisely what `figure()`'s comment refuses to
// do when it starts every person she meets at valence zero.
//
// She already forms the right object. A THEME node is, in her own machinery's words, "a cluster
// that became one thing", a kind of thing that keeps happening to her, and it is already born
// carrying the mean valence of the moments underneath it. A kind of thing, and how it has felt.
// That IS a taste; nothing read it as one, and nothing kept it up to date.
//
// So this file is two small things:
//
//   1. a theme's valence keeps MOVING as new encounters join it (`tasteAfter`), because a taste
//      frozen at the moment it was first noticed is a verdict, not a preference; and
//   2. `likingFor` reads it back, weighted by how established the theme is.
//
// Three properties fall out and all three are the ones the design asks for. It starts at zero,
// because a theme is born from her own moments and she has none at birth. It comes from actual
// encounters and nothing else. And it FADES: a liking is weighted by the theme's `strength`, which
// decays like everything else in her field, so a kind of thing she stops meeting stops counting
// without a decay loop of its own.

import type { FieldGraph, FieldNode } from "./field.js";

/**
 * How far one encounter moves a taste. Deliberately small: a preference is the residue of many
 * meetings with a kind of thing, and a dial big enough for one good evening to establish a liking
 * would be a mood wearing a preference's clothes.
 */
export const ONE_ENCOUNTER_MOVES = 0.12;

/**
 * How many moments a theme must gather before it counts as a liking at all.
 *
 * Under this she has met the kind of thing, she does not yet have a view about it. Without a floor
 * the very first cluster to form would immediately start steering what she brings up, which is the
 * same error as seeding an opinion, arrived at by a slower road.
 */
export const ENOUGH_TO_HAVE_A_VIEW = 3;

/** Below this a taste is not strong enough to lean on anything, and reads as no preference. */
export const TOO_FAINT_TO_COUNT = 0.05;

/**
 * Where a taste lands after one more encounter with the kind of thing.
 *
 * Exponential easing, so it is a running impression rather than a tally: recent encounters weigh
 * more than old ones without anything having to remember which were which, and no single evening
 * can pin it. Pure.
 */
export function tasteAfter(current: number, encountered: number): number {
  const next = current + ONE_ENCOUNTER_MOVES * (encountered - current);
  return Math.max(-1, Math.min(1, next));
}

/** One kind of thing, and how she has come to feel about it. */
export interface Liking {
  themeId: number;
  /** The theme's own words for the kind of thing it is. */
  text: string;
  /** −1 to 1. Positive is a liking, negative is a distaste, and zero is no view. */
  liking: number;
  /** How many of her moments sit under it. */
  encounters: number;
}

/**
 * How many of her moments sit under a kind of thing.
 *
 * Read off `graph.edges` rather than `graph.adj`: the adjacency map holds the COMBINED conductance
 * between two nodes as a single number and has thrown the edge kind away, so it cannot tell a
 * membership from a reminding. Getting this wrong would have counted every loose association as
 * another encounter, and a taste would have formed out of things she was merely reminded of.
 */
function membersOf(g: FieldGraph, themeId: number): number {
  const nbrs = g.adj.get(themeId);
  if (!nbrs) return 0;
  let n = 0;
  for (const otherId of nbrs.keys()) {
    if (!g.nodes.has(otherId)) continue;
    if (isMemberEdge(g, themeId, otherId)) n += 1;
  }
  return n;
}

function isMemberEdge(g: FieldGraph, themeId: number, otherId: number): boolean {
  const a = Math.min(themeId, otherId);
  const b = Math.max(themeId, otherId);
  return g.edges.has(`${a}:${b}:co_occurred`);
}

/** Every theme she has a real view about, strongest feeling first. */
export function whatSheLikes(g: FieldGraph): Liking[] {
  const out: Liking[] = [];
  for (const node of g.nodes.values()) {
    if (node.kind !== "theme") continue;
    const encounters = membersOf(g, node.id);
    if (encounters < ENOUGH_TO_HAVE_A_VIEW) continue;
    const liking = node.valence * node.strength;
    if (Math.abs(liking) < TOO_FAINT_TO_COUNT) continue;
    out.push({ themeId: node.id, text: node.text, liking, encounters });
  }
  return out.sort((a, b) => Math.abs(b.liking) - Math.abs(a.liking));
}

/**
 * How she feels about the KIND of thing this particular node is.
 *
 * Zero when it belongs to no established theme, which is the honest answer for most of what is in
 * her field and the reason this can be added to a competition without distorting it: a node with no
 * kind behind it scores exactly as it did before.
 */
export function likingFor(g: FieldGraph, node: FieldNode): number {
  const nbrs = g.adj.get(node.id);
  if (!nbrs) return 0;
  let sum = 0;
  let weight = 0;
  for (const otherId of nbrs.keys()) {
    const other = g.nodes.get(otherId);
    if (!other || other.kind !== "theme") continue;
    if (!isMemberEdge(g, other.id, node.id)) continue;
    if (membersOf(g, other.id) < ENOUGH_TO_HAVE_A_VIEW) continue;
    // Weighted by how established the kind is, so a theme fading out of her life stops steering
    // her before it disappears, rather than counting fully right up until it is pruned.
    sum += other.valence * other.strength;
    weight += other.strength;
  }
  if (weight <= 0) return 0;
  const liking = sum / weight;
  return Math.abs(liking) < TOO_FAINT_TO_COUNT ? 0 : Math.max(-1, Math.min(1, liking));
}
