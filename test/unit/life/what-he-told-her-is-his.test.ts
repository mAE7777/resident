import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * WHAT HE TELLS HER HAS AN AUTHOR.
 *
 * `encodeMoment` and `encodeQuestion` both took `withOther` and both drew an `about` edge to the
 * figure node, so a moment she LIVED with him was connected to him. `encodeClaim`, the one used
 * for everything he actually SAYS to her, did not take the parameter at all. The result was that
 * she could hold a hundred things he had told her and have nothing in her field saying he was the
 * one who said them.
 *
 * That is not a missing detail, it is the reason she could never form an impression of him from
 * what he says. An impression is built out of specific things a person did, bound to that person
 * (Todorov & Uleman 2002: a trait inferred from a single behaviour attaches to the actor,
 * unintentionally, at encoding). With no edge there was nothing for an impression to accumulate
 * ON, which is why "how long have we known each other" and "what is he like" had nowhere to live
 * except a 40-item sliding window of reply timings.
 */

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);
const HIM = "figure:the one i exchange messages with";

function told(text: string, withOther: boolean) {
  const f = createLivingField();
  const node = f.encodeClaim({
    key: `told:${T0}`, text, nowMs: T0, origin: "told", source: "chat:1", charge: 0.3, withOther,
  });
  return { f, node };
}

/** Every node the claim points at through an `about` edge. */
function whatItIsAbout(f: ReturnType<typeof createLivingField>, id: number): string[] {
  const g = f.graph();
  const out: string[] = [];
  for (const e of g.edges.values()) {
    if (e.kind !== "about") continue;
    if (e.a !== id && e.b !== id) continue;
    const other = g.nodes.get(e.a === id ? e.b : e.a);
    if (other?.key !== undefined) out.push(other.key);
  }
  return out;
}

describe("something he told her is bound to him", () => {
  it("draws an edge to him when he is the one who said it", () => {
    const { f, node } = told("渡轮的时刻表改了", true);
    expect(node, "the claim did not encode at all").not.toBeNull();
    expect(whatItIsAbout(f, node!.id)).toContain(HIM);
  });

  it("and does not when the claim did not come from him", () => {
    // Read from her shelf, found on a page: the same encode, no author. The edge has to be a
    // fact about provenance, not something every claim gets for free, otherwise "about him"
    // stops discriminating and the impression accumulates on everything she has ever read.
    const { f, node } = told("这本书里说渡轮改点了", false);
    expect(whatItIsAbout(f, node!.id)).not.toContain(HIM);
  });

  it("puts him in her field the first time he says anything, and not before", () => {
    // The figure node is created lazily. Before he has said a word there is no him, which is
    // what makes `born_ms` on that node an honest first-contact timestamp rather than a boot
    // artifact, and what makes a newborn's read of him empty rather than neutral-by-default.
    const fresh = createLivingField();
    expect(fresh.graph().byKey.get(HIM), "he exists before he has spoken").toBeUndefined();

    const { f } = told("我回来了", true);
    const g = f.graph();
    // `byKey` maps to the node ID, not the node. Resolving it is the point: `bornMs` on this one
    // node is the only durable first-contact timestamp in the system, and it survives because
    // figure nodes are exempt from both pruning and the over-cap eviction.
    const himId = g.byKey.get(HIM);
    expect(himId, "he still does not exist after telling her something").toBeDefined();
    const him = g.nodes.get(himId!);
    expect(him?.kind).toBe("figure");
    expect(him?.bornMs, "his first-contact timestamp is not the moment he first spoke").toBe(T0);
  });

  it("accumulates on him rather than replacing: many things told, one him, many edges", () => {
    // The shape the impression needs. Fifty things he said must be fifty things ABOUT one person,
    // not fifty people and not one thing overwritten forty-nine times.
    const f = createLivingField();
    for (let i = 0; i < 5; i++) {
      f.encodeClaim({
        key: `told:${T0 + i}`, text: `他说的第${i}件事`, nowMs: T0 + i,
        origin: "told", source: "chat:1", charge: 0.3, withOther: true,
      });
    }
    const g = f.graph();
    const figures = [...g.nodes.values()].filter((n) => n.kind === "figure");
    expect(figures.length, "each thing he said invented a new person").toBe(1);
    const aboutHim = [...g.edges.values()].filter((e) => {
      if (e.kind !== "about") return false;
      return g.nodes.get(e.a)?.key === HIM || g.nodes.get(e.b)?.key === HIM;
    });
    expect(aboutHim.length, "the edges did not accumulate").toBe(5);
  });
});

// ── AND THE DAEMON ACTUALLY PASSES IT ─────────────────────────────────────────
//
// The four tests above all pass with the daemon's call site unwired, because they build their own
// field and pass `withOther` by hand. Proven: removing `withOther: true` from `encodeWhatHeTold`
// left every one of them green. A mechanism that works and is never called correctly is the single
// most repeated defect in this project, so the wiring gets its own assertion against the source.
describe("and it is the daemon that says so, not only this test", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the told-claim encode on the conversation path carries withOther", () => {
    const start = daemon.indexOf("const encodeWhatHeTold");
    expect(start, "encodeWhatHeTold is gone").toBeGreaterThan(-1);
    const end = daemon.indexOf("\n      };", start);
    const body = daemon.slice(start, end === -1 ? start + 3000 : end);
    expect(body, "what he tells her is encoded with no author again").toContain("withOther: true");
    // Positional, so the flag cannot drift onto some other call that happens to live in the same
    // function: it must be inside the encodeClaim argument object.
    const encode = body.indexOf("field.encodeClaim({");
    const flag = body.indexOf("withOther: true", encode);
    const close = body.indexOf("});", encode);
    expect(encode, "the claim encode moved out of this function").toBeGreaterThan(-1);
    expect(flag, "withOther is not on the encodeClaim call").toBeGreaterThan(encode);
    expect(flag, "withOther landed after the encodeClaim call closed").toBeLessThan(close);
  });
});
