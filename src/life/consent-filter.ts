import { isConstraintComplaintText } from "./bilingual.js";

// The consent boundary (she knows; it goes to her diary only). Budget denials and
// suppressions are real events the Resident may reflect on IN ITS DIARY, but the
// OUTBOUND channel must never guilt-trip Eric: a first-person complaint that names
// him as the constraint ("you didn't let me", "because of your budget") is the HBS
// manipulative-farewell failure arriving through the moat feature. Outbound,
// constraints are narrated as environmental fact ("the day's energy ran out").
//
// This filter blocks such complaints from the OUTBOUND queue only. The diary path
// does not call it.

// THE PATTERNS LIVE IN life/bilingual.ts, both scripts. English-only, this load-bearing wall
// was dead in the language she speaks: 「你不让我」「都是因为你的预算」 walked straight out to him.
export function isConstraintComplaint(text: string): boolean {
  return isConstraintComplaintText(text);
}

export interface OutboundVerdict {
  allowed: boolean;
  reason?: string;
}

/** Gate an outbound message. A constraint-complaint is blocked (it may still go to the diary). */
export function filterOutbound(text: string): OutboundVerdict {
  if (isConstraintComplaint(text)) {
    return { allowed: false, reason: "attributes a limit to Eric; blocked outbound (allowed in the diary)" };
  }
  return { allowed: true };
}
