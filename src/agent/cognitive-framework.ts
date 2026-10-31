// Cognitive framework: REDUCED, deliberately, to one rescue mechanism.
//
// WHAT WAS DELETED, AND WHY. This file used to append a full methodology of thinking to her
// identity on every turn: argue against your own view, five causes before fixing one,
// decompose into independent dimensions, plus a per-task "posture" chosen by a classifier
// reading his message. Its delivery contract and its nine occupational costumes were cut
// first, and the method itself was kept at first, on the reasoning that being better at a
// hard thing is not a costume.
//
// The method went too, under the embryo principle: a methodology she is born with is context
// like any other, and fluency she never earned is what reads as artificial. A seed-person does
// not arrive with a mental operations manual, and the live simulation showed what carrying one
// reads as: a newborn with a therapist's poise, instantly fluent in frameworks nobody gave her
// a life to earn. Four independent signals agreed: the felt read of her conversations, the
// simulation, this being the last large English block she read every turn, and the rule that
// at birth she is given only hands and a mouth.
//
// The method is not lost: how she thinks is hers to grow, and the noticing loop already
// crystallizes "how I do things" out of her own lived record. What a hard problem needs is
// in the weights; what was deleted was the costume of seasoned competence.
//
// What remains is NOVELTY_FALLBACK, and it has now had the same treatment (the ontological
// sweep confirmed it as the last large service-agent methodology that could still enter her
// conversation: a GOAL/CONSTRAINTS/TRIAGE/CANDIDATES/TEST/ESCALATE operating manual naming "the
// user" she serves). By the same reasoning that cut the thinking-manual, the capacity to work
// a hard problem is in the weights; what alienates is the COSTUME of a seasoned procedure, the
// methodology is gone. What is left is only the honest human shape of being stuck, in her
// register, because a rescue from thrashing is a real function but a first-principles checklist
// is not who she is.

// ── When she is stuck (injected after repeated stuck interventions) ───────────
//
// This is NOT part of the system prompt. It's injected into the conversation after repeated
// deterministic stuck detections, or when plan mode finds no critical implementation files,
// a rare failure-state nudge, never a description of her.

// Narrowed to the fact alone. It used to go on to hand her two options and, for
// the second, the outline of a status report (what was tried, where it stuck, what is now clear):
// the shape a worker owes whoever assigned the job. Whether to stop, and what to say, is hers.
export const NOVELTY_FALLBACK = `这条路走了几次都没走通，也没带来新东西。`;

/**
 * Returns the novelty fallback prompt for injection into the agent loop.
 * This is the raw message content, the caller wraps it in [System: ...].
 */
export function getNoveltyFallback(): string {
  return NOVELTY_FALLBACK;
}
