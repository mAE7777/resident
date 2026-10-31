import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  tasteAfter, likingFor, whatSheLikes,
  ONE_ENCOUNTER_MOVES, ENOUGH_TO_HAVE_A_VIEW, TOO_FAINT_TO_COUNT,
} from "../../../src/life/liking.js";
import { createGraph, addNode, link, type FieldGraph } from "../../../src/life/field.js";

/**
 * FACULTY #9, SHE HAD NO LIKES AT ALL.
 *
 * A grep for preference/taste/likes/偏好/喜欢 across the whole living layer returned nothing. She
 * could want to do a thing (drives) and hold a thing true (credence) and remember how one evening
 * felt (valence on a node), and she could not prefer one kind of thing over another. Preference is
 * most of what makes a person's choices recognisably theirs rather than merely reasoned.
 *
 * The build deliberately adds no new accumulator. A `theme` node, her own machinery's "a cluster
 * that became one thing", is already a KIND of thing and is already born carrying the mean
 * valence of the moments under it. That is a taste. Nothing read it as one, and nothing kept it up
 * to date after the day it was born.
 */

const NOW = Date.UTC(2026, 3, 2, 9, 0, 0);

function withATheme(g: FieldGraph, opts: { valence: number; members: number; strength?: number }): number {
  const theme = addNode(g, {
    kind: "theme", text: "一种一直在发生的事", bornMs: NOW, origin: "thought",
    charge: 0.4, valence: opts.valence, strength: opts.strength ?? 0.7, source: "theme:test", key: "theme:test",
  });
  for (let i = 0; i < opts.members; i++) {
    const m = addNode(g, {
      kind: "moment", text: `第${i}次`, bornMs: NOW, origin: "lived",
      charge: 0.3, valence: opts.valence, strength: 0.6, source: "test", key: `m:${i}`,
    });
    link(g, theme.id, m.id, "co_occurred", 0.5, NOW);
  }
  return theme.id;
}

describe("a taste is the residue of many meetings, not one", () => {
  it("one encounter barely moves it", () => {
    expect(tasteAfter(0, 1)).toBeCloseTo(ONE_ENCOUNTER_MOVES, 5);
    expect(Math.abs(tasteAfter(0, 1)), "one good evening established a preference").toBeLessThan(0.2);
  });

  it("but a run of them does, and it converges rather than running away", () => {
    let v = 0;
    for (let i = 0; i < 40; i++) v = tasteAfter(v, 1);
    expect(v).toBeGreaterThan(0.9);
    expect(v, "a taste ran past what she has actually felt").toBeLessThanOrEqual(1);
  });

  it("THE SWEEP: it takes a real handful of encounters to form a view, and not dozens", () => {
    // The number that decides whether taste is a mood or a character trait. Measured from zero to
    // the point where a liking is strong enough for the competition to feel it.
    let v = 0;
    let n = 0;
    while (v < 0.4 && n < 200) { v = tasteAfter(v, 1); n += 1; }
    expect(n, "her preferences form after two or three pleasant evenings").toBeGreaterThan(3);
    expect(n, "she would need a hundred meetings before liking anything").toBeLessThan(20);
  });

  it("and it turns around when the kind of thing stops going well", () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = tasteAfter(v, 1);
    const liked = v;
    for (let i = 0; i < 30; i++) v = tasteAfter(v, -1);
    expect(v).toBeLessThan(0);
    expect(liked).toBeGreaterThan(0);
  });
});

describe("what she has a view about, and what she does not", () => {
  it("a kind of thing she has met enough times, that kept going well", () => {
    const g = createGraph();
    withATheme(g, { valence: 0.7, members: 5 });
    const likes = whatSheLikes(g);
    expect(likes).toHaveLength(1);
    expect(likes[0].liking).toBeGreaterThan(0);
    expect(likes[0].encounters).toBe(5);
  });

  it("under the floor she has MET the kind of thing without having a view about it", () => {
    const g = createGraph();
    withATheme(g, { valence: 0.9, members: ENOUGH_TO_HAVE_A_VIEW - 1 });
    expect(whatSheLikes(g), "one cluster forming immediately became an opinion").toHaveLength(0);
  });

  it("and a kind of thing she has stopped meeting stops steering her — without a decay loop", () => {
    // The liking is weighted by the theme's strength, which decays like everything else in her
    // field. A preference she stops feeding fades on the same clock as the rest of her.
    const g = createGraph();
    withATheme(g, { valence: 0.7, members: 5, strength: 0.05 });
    expect(whatSheLikes(g)).toHaveLength(0);
  });

  it("distaste is the same mechanism with the sign the other way, and it is not special-cased", () => {
    const g = createGraph();
    withATheme(g, { valence: -0.7, members: 5 });
    const likes = whatSheLikes(g);
    expect(likes).toHaveLength(1);
    expect(likes[0].liking).toBeLessThan(0);
  });

  it("SHE IS BORN WITH NONE — a fresh field has no preferences whatsoever", () => {
    // The rule `figure()` states for people, held for kinds of things: seeding a taste would be
    // handing her an opinion, and this is the reverse test that says nothing does.
    expect(whatSheLikes(createGraph())).toHaveLength(0);
  });
});

describe("likingFor: the kind of thing a particular memory is", () => {
  it("reads back what the theme has come to feel like", () => {
    const g = createGraph();
    const themeId = withATheme(g, { valence: 0.8, members: 5 });
    const member = [...g.nodes.values()].find((n) => n.kind === "moment")!;
    expect(likingFor(g, member)).toBeGreaterThan(0.3);
    void themeId;
  });

  it("is ZERO for anything with no established kind behind it, which is most of her field", () => {
    // This is what lets it be added to a live competition without distorting it: a node that has
    // formed no kind scores exactly as it did before this existed.
    const g = createGraph();
    const lone = addNode(g, {
      kind: "moment", text: "一件事", bornMs: NOW, origin: "lived",
      charge: 0.3, valence: 0.9, strength: 0.6, source: "test", key: "lone",
    });
    expect(likingFor(g, lone)).toBe(0);
  });

  it("a merely REMINDED-OF theme is not a kind she belongs to", () => {
    // `graph.adj` collapses every edge between two nodes into one conductance number and throws
    // the kind away. Reading membership off it would have counted a loose association as another
    // encounter, and her taste would have formed out of things she was only reminded of.
    const g = createGraph();
    const themeId = withATheme(g, { valence: 0.8, members: 5 });
    const stranger = addNode(g, {
      kind: "moment", text: "另一件事", bornMs: NOW, origin: "lived",
      charge: 0.3, valence: 0, strength: 0.6, source: "test", key: "stranger",
    });
    link(g, themeId, stranger.id, "reminds_of", 0.9, NOW);
    expect(likingFor(g, stranger), "being reminded of a kind counted as being one").toBe(0);
  });

  it("faint is the same as none, so a rounding error is never a preference", () => {
    const g = createGraph();
    withATheme(g, { valence: TOO_FAINT_TO_COUNT / 4, members: 5 });
    const member = [...g.nodes.values()].find((n) => n.kind === "moment")!;
    expect(likingFor(g, member)).toBe(0);
    expect(whatSheLikes(g)).toHaveLength(0);
  });
});

describe("and it reaches what she brings up — third-order, never a veto", () => {
  const field = readFileSync(join(process.cwd(), "src/life/field-live.ts"), "utf8");
  const code = field.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

  it("the subject competition consults it", () => {
    expect(code, "her taste is computed and then discarded — a preference nothing acts on")
      .toMatch(/LIKING_TIPS \* likingFor\(graph, n\)/u);
  });

  it("THE SWEEP: a full-strength taste cannot outrank a thing that will not rest", () => {
    // The property that makes this safe. Tension weighs 1.2 in that competition and charge 0.6; a
    // liking maxes out at LIKING_TIPS. A person whose preferences overrode what was bothering them
    // is not someone with taste, they are someone avoiding something.
    const tips = Number(/const LIKING_TIPS = ([\d.]+)/u.exec(code)![1]);
    const tension = Number(/(\d[\d.]*) \* n\.tension/u.exec(code)![1]);
    const charge = Number(/(\d[\d.]*) \* n\.charge/u.exec(code)![1]);
    expect(tips, "a preference can overturn something pressing").toBeLessThan(tension);
    expect(tips, "a preference can overturn something that mattered").toBeLessThan(charge);
    // And not so small it can never decide anything: it must be able to settle a near-tie.
    expect(tips, "the dial is decorative").toBeGreaterThan(0.05);
  });

  it("only MOMENTS move a taste — a claim carries valence 0 by construction, not by feeling", () => {
    // Routing claims through the accrual would drag every taste she has toward indifference every
    // time he told her something, and it would have looked exactly like weak preferences.
    const at = code.indexOf("function joinsAKind");
    const body = code.slice(at, at + 700);
    expect(body).toMatch(/if \(node\.kind !== "moment"\) return;/u);
    expect(body).toMatch(/theme\.valence = tasteAfter\(/u);
  });

  it("JOINS_A_KIND is stricter than being reminded of something", () => {
    const joins = Number(/const JOINS_A_KIND = ([\d.]+)/u.exec(code)![1]);
    const remindsBase = Number(/const REMINDS_BASE = ([\d.]+)/u.exec(code)![1]);
    expect(joins, "joining a kind is as loose as being reminded").toBeGreaterThan(remindsBase);
    expect(joins, "nothing could ever join a kind").toBeLessThan(0.8);
  });
});
