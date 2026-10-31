// What, in a message, actually snagged her.
//
// HIS WORDS USED TO ENTER HER FLAT. The whole message was one undifferentiated object: the
// reminding bonus in `whatSurfacesInReply` searched all of it at once, and the claim encode
// stamped all of it with one constant charge (0.3), the same number whether he said the ferry
// timetable changed or that he is leaving. A person does not hear a message that way. One
// clause of it lands on something you carry and pulls; the rest is around it.
//
// So: a message is split into the units attention actually works over (clauses, and in her
// language the comma and the enumeration mark genuinely bound them), each unit is asked how
// much of HER FIELD it lights up, and the unit that lights up most is what snagged. Three
// things downstream become possible only with this in hand: the reminding bonus keys to the
// clause that is ABOUT the held thing instead of averaging across the message; a claim's
// charge comes from how much it actually landed on her instead of a constant; and the speech
// build (气长 counting his asks, 不接 declining one of them) has objects to work over at all.
//
// The measure is deliberately the same bigram index everything else uses. "How much does this
// clause connect to what I hold" is the answerable question; "how important is this clause in
// the world" is not, and pretending to answer it would put an importance model where her own
// memory should be.

/** One unit of his message, with how much of her it lit up. */
export interface AttendedClause {
  text: string;
  /** Summed match ratios of her field entries this clause landed on (index.search scale). */
  mass: number;
  /**
   * WHICH things it landed on.
   *
   * The mass was already being computed by summing exactly these hits, and the ids were being
   * thrown away one line later, so this adds no search and no cost, it stops discarding an answer
   * the search had already given.
   *
   * That discard was load-bearing. `attend` was the only route from a piece of text to the parts
   * of her field it touches, and with no ids on the way out its one production caller could use it
   * as a BOOLEAN and nothing more: "did anything at all snag". So the mechanism that was supposed
   * to let her own words bring something else to mind could tell that they had, and could not tell
   * WHAT. Defect class 14 in its purest form, the wire was there and carried nothing.
   *
   * Optional so a clause can still be built by hand in a test without an index behind it.
   */
  landedOn?: readonly { id: number; score: number }[];
}

export interface Attention {
  clauses: AttendedClause[];
  /** The clause that lit her up most, or null when nothing connected at all. */
  snagged: AttendedClause | null;
  /**
   * The things the snagged clause landed on, strongest first, what this text can be a CUE for.
   *
   * Only the snagged clause's, deliberately: the whole point of `attend` is that one part of a
   * message lands and the rest is around it, so spreading from every clause would be the flat
   * reading this module exists to replace.
   */
  snaggedIds: number[];
  /** What a claim from this message deserves as charge: floored at the old constant. */
  claimCharge: number;
}

/**
 * Attention is finite. Past a dozen units the rest of a message is skimmed, which is not a
 * budget imposed on her so much as what reading a long message is actually like.
 */
export const ATTENTION_SPAN = 12;

/** A fragment shorter than this carries no content to land on (「嗯」「ok」 split residue). */
const MIN_CLAUSE_CHARS = 2;

/**
 * The old constant, kept as the FLOOR: a claim that landed on nothing she holds is exactly as
 * ordinary as every claim used to be. Connection can only raise it.
 */
export const CLAIM_CHARGE_FLOOR = 0.3;
export const CLAIM_CHARGE_CEIL = 0.7;
/** Mass at which the charge tops out: about two solid matches on things she already holds. */
const MASS_SATURATION = 1.5;

/**
 * Both scripts' clause bounds. 、 and the commas are included on purpose: 「渡轮、天气和房租」
 * is three places attention can land, and treating it as one blob is the defect this fixes.
 */
export function splitClauses(text: string): string[] {
  return text
    .split(/[。！？.!?；;：:，,、\n\r]+/u)
    .map((c) => c.trim())
    .filter((c) => c.replace(/[\s\p{P}]+/gu, "").length >= MIN_CLAUSE_CHARS)
    .slice(0, ATTENTION_SPAN);
}

/**
 * Assemble the read from per-clause masses. Pure so it is testable without an index; the
 * living field supplies the masses from its own bigram search.
 */
export function attentionFrom(clauses: readonly AttendedClause[]): Attention {
  let snagged: AttendedClause | null = null;
  for (const c of clauses) {
    // Strictly greater: the FIRST of two equally-connected clauses is what snagged, the way a
    // reader's attention is taken by the first thing that lands, not the last.
    if (c.mass > 0 && (snagged === null || c.mass > snagged.mass)) snagged = c;
  }
  const top = snagged?.mass ?? 0;
  const claimCharge = CLAIM_CHARGE_FLOOR
    + (CLAIM_CHARGE_CEIL - CLAIM_CHARGE_FLOOR) * Math.min(1, Math.max(0, top / MASS_SATURATION));
  const snaggedIds = [...(snagged?.landedOn ?? [])]
    .sort((a, b) => b.score - a.score)
    .map((h) => h.id);
  return { clauses: [...clauses], snagged, snaggedIds, claimCharge };
}
