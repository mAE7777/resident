import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * HE TELLS HER SOMETHING ON MONDAY, ASKS ABOUT IT ON FRIDAY, AND NOTHING BRINGS IT TO HER.
 *
 * `whatSurfacesInReply` read his message as a HINT, but only after filtering the candidates,
 * so the hint could add weight to something already surfacing and could never bring anything
 * back. And a claim he told her is born `tension 0`, `warmth 0`, `charge 0.3`, so it cleared
 * that filter only while it was still fresh. After a few hours it was permanently out of reach
 * of a reply, however relevant it was to what he had just said.
 *
 * That is not a memory system failing to STORE something. The memory was there, indexed, one
 * function call away. It is a person who cannot be REMINDED, and being reminded by what
 * somebody says is most of what remembering is between two people.
 */
const DAY = 24 * 3.6e6;
const now = Date.UTC(2026, 7, 10, 12, 0, 0);

function sheWasTold(text: string, when: number) {
  const f = createLivingField();
  f.encodeClaim({ key: `told:${when}`, text, nowMs: when, origin: "told", source: "chat", charge: 0.3 } as never);
  return f;
}

/** The stream the subject competition samples with, pinned so the test is about the field. */
const stream = { next: () => 0, seed: () => 1, position: () => 0 } as never;

describe("something he told her days ago", () => {
  it("can come back when he brings it up again", () => {
    const f = sheWasTold("渡轮周末不开，冬天尤其。", now - 5 * DAY);
    const surfaced = f.whatSurfacesInReply(now, stream, { hint: "这个周末渡轮开吗", openness: 0.9 });
    expect(surfaced, "he asked about the ferry and nothing of hers came near it").not.toBeNull();
    expect(surfaced!.node.text).toContain("渡轮");
  });

  it("and stays down when he is talking about something else", () => {
    // The failure mode of the fix: making everything eligible would mean every memory she has
    // is a candidate on every turn, and the competition stops meaning anything.
    const f = sheWasTold("渡轮周末不开，冬天尤其。", now - 5 * DAY);
    const surfaced = f.whatSurfacesInReply(now, stream, { hint: "你今天怎么样", openness: 0.9 });
    expect(surfaced, "an unrelated question dragged up an old memory anyway").toBeNull();
  });

  it("in English too, since he writes in both", () => {
    const f = sheWasTold("the ferry does not run on winter weekends", now - 5 * DAY);
    const surfaced = f.whatSurfacesInReply(now, stream, { hint: "is the ferry running this weekend", openness: 0.9 });
    expect(surfaced).not.toBeNull();
  });

  it("becoming eligible is not the same as surfacing", () => {
    // Reticence still costs it, so a thing she does not want to say is eligible and does not
    // come up. Eligibility only puts it in the running.
    const f = createLivingField();
    const n = f.encodeClaim({ key: "told:x", text: "渡轮周末不开。", nowMs: now - 5 * DAY, origin: "told", source: "chat", charge: 0.3 } as never);
    expect(n).not.toBeNull();
    const closed = f.whatSurfacesInReply(now, stream, { hint: "渡轮", openness: 0 });
    const open = f.whatSurfacesInReply(now, stream, { hint: "渡轮", openness: 1 });
    // At the very least, being closed must never surface MORE than being open.
    expect(closed === null || open !== null).toBe(true);
  });
});

/**
 * BUT A SHARED FUNCTION PHRASE IS NOT HIM BRINGING SOMETHING UP.
 *
 * The second-order cost of the fix above, measured at 3,000 seeded trials: his message goes in
 * as the hint verbatim, and 「这个价格怎么样」, he asks about a PRICE, matched a carried
 * question about someone's mother on the tokens 怎么 and 么样 alone. Through the mention bonus
 * that took an unrelated memory from 3% of replies to 74%, and the winner is rendered into her
 * prompt as 「一直带着、这会儿浮到嘴边的：X」, which is about as strong a nudge to say it as
 * exists. He asks about a price and she brings up his mother.
 *
 * The root was in the index, not in the bonus: 怎/么/样 were not function words, so the
 * commonest phrase either of them will ever say indexed as content.
 */
describe("a shared function phrase is not him bringing something up", () => {
  const stream = { next: () => 0, seed: () => 1, position: () => 0 } as never;

  /** How likely that memory was to come up, which is the honest measurement. */
  function chanceOf(hint: string, text: string): number {
    const f = createLivingField();
    f.encodeQuestion({ key: "q:mother", text: "我想问问他妈妈现在怎么样了", nowMs: now - 3 * DAY, source: "agency", tension: 0.7 } as never);
    const r = f.whatSurfacesInReply(now, stream, { hint, openness: 0.9 });
    return r?.weighed.find((w) => w.text.includes(text))?.probability ?? 0;
  }

  it("asking about a price barely moves a question about his mother", () => {
    // Measured as PROBABILITY, not as which one a pinned stream happened to pick. A question
    // carrying tension 0.7 is legitimately somewhere near the surface on its own, what must
    // not happen is a price question shoving it over the bar.
    const onItsOwn = chanceOf("你今天怎么样", "妈妈");
    const askedAboutAPrice = chanceOf("这个价格怎么样", "妈妈");
    expect(askedAboutAPrice, "a function phrase lifted an unrelated memory")
      .toBeLessThan(onItsOwn + 0.05);
  });

  it("and the phrase itself carries no subject", async () => {
    const { contentWords } = await import("../../../src/life/field-index.js");
    // 怎么 and 么样 must not be content: both halves of each are function characters.
    expect(contentWords("怎么样"), "怎么样 still indexes as something to be about").toEqual([]);
    // But a real subject in the same sentence survives.
    expect(contentWords("渡轮怎么样")).toContain("渡轮");
  });

  it("while he can still genuinely bring the ferry up", () => {
    // The guard on the guard: the fix must not undo what it was added for.
    const f = sheWasTold("渡轮周末不开，冬天尤其。", now - 5 * DAY);
    expect(f.whatSurfacesInReply(now, stream, { hint: "渡轮怎么样", openness: 0.9 })).not.toBeNull();
  });
});
