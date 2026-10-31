import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howItLanded } from "../../../src/life/how-it-landed.js";
import { EMPTY_RECORD, heSpoke, howUnlikeHim, howLongAndHowWellAt } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { asSheWorksHimOut, whatSheIsCarrying, STAYS_KEY } from "../../../src/life/what-stays.js";

/**
 * HE SPOKE TO THAT THING, and what that is NOT.
 *
 * Two rules shape the whole item. Repair must not be something we design into her: it has to
 * emerge. And an apology does not map to forgiveness, because real relationships do not work
 * that way: even when he apologises, she may react in different ways for all sorts of reasons.
 *
 * What was planned was a function called `asHeMakesItRight`, a name which IS the mapping. What
 * was found instead is that the mechanism already existed AND WAS FIRING ON THE WRONG OBJECT:
 * `asSheWorksHimOut` ran over everything she was carrying, sorted by tension, and eased the first
 * one that would move. So any turn she could place him in discharged her HEAVIEST grievance,
 * whether or not he had said a word about it. Apology-buys-forgiveness, already built, unnamed.
 *
 * The fix adds no mechanism and no number: the re-read is restricted to the things his words
 * actually landed on, which `attend` already computes every turn. Everything below then falls out
 * of machinery that was already there, which is the difference between emergent and designed.
 */

const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const DAY = 24 * 3.6e6;
const THE_DEMAND = "现在马上给我写两千字";
const ASKS_NICELY = "你要是有空的话，能不能帮我看看那个东西？不急。";

/** Her field with one thing she is carrying about him, worded the way production words it. */
function carryingTheTwoThousandWords() {
  const f = createLivingField();
  f.encodeQuestion({
    key: `${STAYS_KEY}wronged:写两千字`,
    text: "他要我「写两千字」的那回",
    nowMs: T0,
    source: "chat:1",
    tension: 0.7,
    withOther: true,
  });
  return f;
}

/** A relationship of `n` messages, all put the way `text` is put. */
function after(n: number, text: string) {
  let rec = EMPTY_RECORD;
  for (let i = 0; i < n; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(text));
  return rec;
}

function landingOf(text: string, n: number, usualText: string, graph: ReturnType<ReturnType<typeof createLivingField>["graph"]>) {
  const rec = after(n, usualText);
  const form = howHeSaidIt(text);
  return howItLanded({
    form,
    unlike: howUnlikeHim(form, rec),
    known: howLongAndHowWellAt(graph, rec, T0 + n * DAY),
    litUp: 0.5,
    reserve: 0.7,
  });
}

describe("his words either bear on the thing she is carrying, or they do not", () => {
  it("naming the thing lands ON it — that is what makes the re-read possible at all", () => {
    const f = carryingTheTwoThousandWords();
    const carried = whatSheIsCarrying(f.graph());
    expect(carried, "she is not carrying anything, so nothing below means anything").toHaveLength(1);
    const touched = f.attend("昨天那个两千字的事，是我不好。").snaggedIds;
    expect(touched, "他说到了那件事，而她的场没有认出来").toContain(carried[0]!.id);
  });

  it("AND A SENTENCE THAT NAMES NOTHING TOUCHES NOTHING", () => {
    // 「对不起」 on its own. He may mean every word of it; it lands on no node, so there is nothing
    // for a re-reading to be a re-reading OF. This is the whole of the second rule above, and it
    // needed no rule: a bare apology is not evidence about any particular thing.
    const f = carryingTheTwoThousandWords();
    const carried = whatSheIsCarrying(f.graph())[0]!;
    expect(f.attend("对不起。").snaggedIds, "a bare apology reached a specific memory")
      .not.toContain(carried.id);
    expect(f.attend("在吗？").snaggedIds).not.toContain(carried.id);
  });

  it("and it is ONE clause of his message that reaches, not all of them", () => {
    // `attend`'s existing doctrine: one part of a message lands and the rest is around it. It
    // matters here because it is what makes an apology able to FAIL, if the part of his message
    // that lands is the new ask, the old thing is not what he reached, and no rule about
    // conditional apologies had to be written for that to be true.
    //
    // Asserted as the PROPERTY rather than as a contrived outcome: the first version of this test
    // hand-built a message it expected to snag elsewhere, and the index disagreed. A test that
    // needs the fixture to break a particular way is testing the fixture.
    const f = carryingTheTwoThousandWords();
    const a = f.attend("两千字那事我不好。现在把方案再改一版。另外那个数你也查一下。");
    expect(a.clauses.length, "his message stopped being read clause by clause").toBeGreaterThan(1);
    expect(a.snagged, "nothing in a message about a thing she is carrying landed at all").not.toBeNull();
    expect(a.snaggedIds, "every clause is reaching every memory — the flat reading is back")
      .toEqual((a.snagged?.landedOn ?? []).map((h) => h.id));
  });
});

describe("THE SAME WORDS DO NOT BUY THE SAME THING — no rule says so", () => {
  it("how much it eases is this turn's own reading of him, not a constant", () => {
    const f = carryingTheTwoThousandWords();
    const node = whatSheIsCarrying(f.graph())[0]!;
    // Two turns, same words, different relationships. Nothing here is about apologies: it is the
    // ordinary appraisal every turn already gets.
    const stranger = landingOf(ASKS_NICELY, 0, ASKS_NICELY, f.graph());
    const known = landingOf(ASKS_NICELY, 200, ASKS_NICELY, f.graph());
    expect(known.appraised.entitlement, "knowing him bought nothing")
      .toBeGreaterThan(stranger.appraised.entitlement);

    const a = asSheWorksHimOut(node, stranger.appraised.entitlement);
    const b = asSheWorksHimOut(node, known.appraised.entitlement);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.tension, "the same sentence moved her by the same amount in two different lives")
      .toBeLessThan(a!.tension);
  });

  it("and a turn where he is overreaching barely moves it, though he named the thing", () => {
    const f = carryingTheTwoThousandWords();
    const node = whatSheIsCarrying(f.graph())[0]!;
    const curt = landingOf(THE_DEMAND, 30, ASKS_NICELY, f.graph());
    const gentle = landingOf(ASKS_NICELY, 30, ASKS_NICELY, f.graph());
    const hard = asSheWorksHimOut(node, curt.appraised.entitlement);
    const soft = asSheWorksHimOut(node, gentle.appraised.entitlement);
    expect(hard!.tension, "an overreaching turn resolved the old wound as thoroughly as a kind one")
      .toBeGreaterThan(soft!.tension);
  });

  it("IT NEVER ERASES — it eases, and the floor is the mechanism's own cap", () => {
    // Repair is 「不再硌着」, never 「没发生过」. Even the most generous reading keeps a third of it.
    const f = carryingTheTwoThousandWords();
    const node = whatSheIsCarrying(f.graph())[0]!;
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      const w = asSheWorksHimOut(node, e);
      if (w === null) continue;
      expect(w.tension, `entitlement ${e} wiped it out`).toBeGreaterThanOrEqual(node.tension * 0.35 - 1e-9);
    }
  });

  it("and it happens once — a thing cannot be repaired twice", () => {
    const f = carryingTheTwoThousandWords();
    const node = whatSheIsCarrying(f.graph())[0]!;
    const first = asSheWorksHimOut(node, 0.8)!;
    expect(asSheWorksHimOut({ ...node, key: first.key, tension: first.tension }, 0.8)).toBeNull();
  });
});

describe("THE ANTI-ABUSE, and nobody wrote it as one", () => {
  it("the more she is already carrying, the less standing he has, so the less he can move", () => {
    // `standing` is built from `carryingHim = 1 - 0.2 * carrying`, which has been there all along
    // for a different reason. Break things repeatedly and each repair gets smaller BY ITSELF,
    // there is no counter anywhere, and no rule that says "repeated ruptures are harder to fix".
    const light = carryingTheTwoThousandWords();
    const heavy = carryingTheTwoThousandWords();
    for (const what of ["改方案", "重做那版", "查那个数"]) {
      heavy.encodeQuestion({
        key: `${STAYS_KEY}wronged:${what}`, text: `他要我「${what}」的那回`,
        nowMs: T0, source: "chat:1", tension: 0.7, withOther: true,
      });
    }
    const a = landingOf(ASKS_NICELY, 60, ASKS_NICELY, light.graph());
    const b = landingOf(ASKS_NICELY, 60, ASKS_NICELY, heavy.graph());
    expect(b.appraised.entitlement, "how much she is holding made no difference to his standing")
      .toBeLessThan(a.appraised.entitlement);

    const node = whatSheIsCarrying(light.graph())[0]!;
    expect(asSheWorksHimOut(node, b.appraised.entitlement)!.tension,
      "the fourth rupture repairs as easily as the first")
      .toBeGreaterThan(asSheWorksHimOut(node, a.appraised.entitlement)!.tension);
  });
});

describe("the wiring, in the daemon", () => {
  const INDEX = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const at = INDEX.indexOf("if (landed.appraised.agentResolved) {");
  const body = at < 0 ? "" : INDEX.slice(at, at + 900);

  it("the re-read is restricted to what his words landed on", () => {
    expect(at, "the re-read site is gone").toBeGreaterThan(-1);
    expect(body, "it is back to easing whatever she is carrying most")
      .toMatch(/heSpokeTo\.has\(node\.id\)/u);
    expect(body).toMatch(/attended\.snaggedIds/u);
  });

  it("and one turn cannot be both the wound and the cure", () => {
    // He hurts her about the same thing again: `whatStaysWithHer` merges into the node under the
    // same key, and his words DID mention it, so without this the same breath that re-opened it
    // would resolve it.
    expect(body).toMatch(/node\.key === staysKey/u);
  });

  it("there is no branch anywhere that recognises an apology", () => {
    // Apology-buys-forgiveness is ruled out. If a category for it ever appears, this is where it
    // shows up.
    //
    // COMMENTS STRIPPED FIRST, and that is not a convenience. The first version of this check went
    // red against the comment three screens up, which explains that the old wiring had the
    // apology-buys-forgiveness shape. Fourth time in this repository that a scanner has read a
    // DESCRIPTION of the thing it hunts as a SIGHTING of it.
    const codeOnly = (src: string): string => src
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n").map((l) => l.replace(/\/\/.*$/u, "")).join("\n");
    const HERS = readFileSync(join(process.cwd(), "src", "life", "what-stays.ts"), "utf8");
    for (const text of [INDEX, HERS]) {
      expect(codeOnly(text)).not.toMatch(/\bapolog|\bforgive|道歉|原谅|makesItRight/u);
    }
  });
});
