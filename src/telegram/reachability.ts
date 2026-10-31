// Can she reach him at all?
//
// The delivery path already refuses to fail quietly: a send with no usable chat id throws,
// and the caller records it. But that only fires the first time she has something to say,
// which may be hours after boot and looks, from outside, exactly like her having nothing to
// say. "She never messages me" and "she cannot message me" are indistinguishable unless
// somebody says which one it is.
//
// So this runs at startup and says it out loud. It cannot fix anything: the chat id is a
// real value only Eric has. What it can do is make sure the silence is explained.

export interface Reachability {
  reachable: boolean;
  /** Said in full, because the whole point is that somebody reads it. */
  reason: string;
}

/**
 * `allowedUserIds: [0]` is the shape this is really guarding against. It is a perfectly
 * plausible-looking placeholder, and `0` is falsy, so an `if (chatId)` guard treats it as
 * "not configured" and a `chatId ?? fallback` treats it as configured. Neither is true: it
 * is a value that will be used and will not work.
 */
export function checkReachability(
  allowedUserIds: readonly number[] | undefined,
  botToken?: string | undefined,
): Reachability {
  // THE TOKEN, CHECKED FIRST, because without it the chat id is a route to nowhere.
  //
  // This check reported "she can reach you at chat 123456789" on a daemon booted with no bot
  // token whatsoever. The one instrument built to say "she cannot reach you" said the opposite
  // in precisely the case it exists for, because it only ever looked at who was allowed to talk
  // to her and never at whether there was anything to talk through. It went unseen because the
  // daemon used to exit before reaching this line when the token was missing; the moment her
  // existing stopped depending on a messaging app, the check was wrong.
  if (botToken !== undefined && botToken.trim() === "") {
    return {
      reachable: false,
      reason:
        "she has no way to reach you: there is no telegram.botToken, so the chat id below is a " +
        "route to nowhere. She is living either way; everything she decides to say will be " +
        "recorded and never arrive.",
    };
  }
  if (allowedUserIds === undefined || allowedUserIds.length === 0) {
    return {
      reachable: false,
      reason:
        "she has no way to reach you: telegram.allowedUserIds is empty. " +
        "Until it holds your real chat id, everything she decides to say will be recorded and never arrive.",
    };
  }

  const first = allowedUserIds[0];
  if (first === undefined || !Number.isFinite(first) || first === 0) {
    return {
      reachable: false,
      reason:
        `she has no way to reach you: telegram.allowedUserIds[0] is ${String(first)}, which is not a chat. ` +
        "Everything she decides to say will be recorded and never arrive, and from outside that is " +
        "indistinguishable from her having nothing to say.",
    };
  }

  return { reachable: true, reason: `she can reach you at chat ${first}` };
}
