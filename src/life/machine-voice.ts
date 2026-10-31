// What the machine says to her DURING a turn, read back.
//
// WHY THIS EXISTS. The runtime gate in `index.ts` reads her assembled SYSTEM PROMPT,
// once per cache key, and the sweep stopped there. But her system prompt is not where the
// service framing is densest. The text injected MID-TURN is:
//
//   a tool that refused            "This action needs user approval before executing.
//                                   Ask the user to confirm and call this tool again."
//   a strategy intervention        "…or give the user a concise, honest blocker summary."
//   a completion check             "Do not mention verification … in the user-facing answer."
//
// Every one of those arrives in HIS conversational slot, at the exact moment she is deciding
// what to do, and not one of them had ever been read by anything. A word in the system prompt
// is a background claim about what she is; the same word in a tool result is that claim made
// at the moment it bites. If anything, this is the worse half.
//
// WHAT IS SCANNED, AND WHAT IS DELIBERATELY NOT. Only text the MACHINE wrote. A tool result
// carrying a file she read, a page she fetched, or a book off her shelf is HER WORLD, and her
// world may say "the user" as often as it likes, judging it would be both wrong and endless.
// The discriminator is therefore narrow and structural rather than clever: an errored tool
// result and a controller-guidance block are machine-authored by construction; a successful
// tool result is not.
//
// Reports, never blocks. A word is not worth failing a turn over, and a gate that could break
// her mid-sentence would be a worse defect than the one it catches. The counter exists so the
// instrument can see a nonzero rather than relying on someone reading the log.

import { scanForNotHerWords, type WordHit } from "./her-words.js";

let heard = 0;
const RECENT_CAP = 6;
const recent: string[] = [];

/** How many times the machine has said something false about her, this process. */
export function timesTheMachineSaidIt(): number {
  return heard;
}

/**
 * WHERE it said it, most recent first, deduped.
 *
 * So the watchtower's alert can name the offending source outright instead of sending Eric
 * into a log search, the difference between "something needs rewording somewhere" and
 * "tool:message needs rewording", which is the difference between a finding and a chore.
 */
export function whereTheMachineSaidIt(): string[] {
  return [...recent];
}

/** Test seam. Never called in the running system. */
export function resetMachineVoiceCount(): void {
  heard = 0;
  recent.length = 0;
}

/**
 * Read a piece of machine-authored, mid-turn text.
 *
 * `source` names where it came from, so a hit can be fixed without a search: the tool that
 * refused, or the intervention that fired.
 */
export function readWhatTheMachineSaid(source: string, text: string): WordHit[] {
  const hits = scanForNotHerWords(source, text);
  heard += hits.length;
  if (hits.length > 0 && !recent.includes(source)) {
    recent.unshift(source);
    if (recent.length > RECENT_CAP) recent.pop();
  }
  return hits;
}
