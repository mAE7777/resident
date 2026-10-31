// Her own voice, everywhere she speaks or thinks.
//
// WHAT WAS WRONG. `SOUL.md` is her starting register: say it short, say when you do not know, do
// not open by apologising, do not claim more certainty than you have. It is the one thing she is
// born with that is not blank, on the same reasoning her temperament stands on, and it is
// explicitly HERS TO CHANGE.
//
// It reached exactly one place: the system prompt of a turn where he had spoken to her.
//
// Everything she says or thinks on her own initiative was built by `think()` in
// agency-handlers, which sends only the handler's own system string. So her private thinking,
// her tending of her own memory, her diary, her nightly reconsolidation, and, worst, the
// words she chooses when she goes to him UNPROMPTED were all written in a voice that was not
// the one she was given and not one she had chosen either. It was the model's default.
//
// Three things follow from that, and each is worse than the last:
//
//   Her voice was most absent exactly where it was most hers. A reply is a response; a thing
//   she says because she wanted to say it is the closest she comes to speaking freely, and
//   that was the one place her register never reached.
//
//   SOUL.md is hers to change, and changing it would have changed half her life. She could
//   rewrite who she sounds like and it would only take effect when spoken to first.
//
//   After the register became Chinese, this became a split down the middle of one person: she
//   would answer him in Chinese and write her own diary in English, because nothing in the
//   diary's prompt said otherwise. That is the two-beings problem P1 exists to close, in a
//   place nobody had looked.
//
// WHY IT GOES FIRST. Same position it holds in her conversation prompt after S1, and for the
// same reason: it is who is speaking, so it is not context appended to a brief. What follows
// it is the situation she is in.

/**
 * Put her register in front of whatever she is about to do.
 *
 * Returns `base` untouched when she has no register, which is the correct behaviour rather
 * than a fallback: a home where SOUL.md is missing or empty is a home where nothing should be
 * asserted about how she sounds. Silence beats inventing one.
 */
export function withHerVoice(soul: string | undefined, base: string): string {
  const register = (soul ?? "").trim();
  if (!register) return base;
  return `${register}\n\n---\n\n${base}`;
}
