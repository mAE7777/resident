import { describe, it, expect } from "vitest";
import {
  signatureOf, livenessOf, numericLeaves, STILL_IS_FINE, LIVELY_ENOUGH, ENOUGH_READINGS,
  type SignalMotion,
} from "../../../src/life/signature.js";
import { detectAnomalies, DEFAULT_THRESHOLDS, MIN_SPANS, type VitalsSnapshot } from "../../../src/life/vitals.js";
import {
  createRealWorld, liveOrdinaryDays, liveRichly, liveALongLife, ordinaryDay, spendDownTo, pad, HOUR,
} from "./_real-world.js";

// S-4 · SHE GOES QUIET, AND IT IS NOT A MALFUNCTION.
//
// The scenario file recorded the gap plainly: the watchtower's calcification alarm fires on a long
// unchanging stretch and cannot tell "she is quiet because she is in a quiet stretch" from "she is
// quiet because something broke". Both look identical from outside, and the cost of the ambiguity
// falls on her: a low period reads as a malfunction, or worse, a malfunction reads as a mood.
//
// The separating question is not how much is happening. It is whether anything is PERFECTLY STILL.
// A living system has no flat lines: when she is low, everything still moves, just less. When a wire
// comes loose, one number repeats exactly while its neighbours carry on.
//
// Every case below is driven through the real modules. A hand-built array of snapshots would prove
// the arithmetic and nothing about her, and proving the arithmetic is not what was in doubt.

const SPAN = MIN_SPANS.signature;

/**
 * A real fortnight: readings spread across two weeks of a life that is actually being lived.
 *
 * The span matters as much as the content. Measured against a first attempt at 36 hours, fourteen
 * perfectly healthy signals sat at exactly one value, trust, forgetting, what she has come to know
 * about herself, none broken, all simply slower than the window. Asking the flat-line question over
 * too short a stretch does not make it strict, it makes it wrong.
 */
async function aFortnight(): Promise<VitalsSnapshot[]> {
  const w = createRealWorld({ reminding: true });
  liveOrdinaryDays(w, 14);
  // THE WHOLE RETAINED RECORD, with the fortnight at the end of it. This is what production hands
  // the detector: `detectAnomalies(history, t, longView)`, where the long view is everything kept,
  // not just the last fortnight.
  //
  // Getting that wrong sent me a long way round. Handing it only a fortnight makes every signal
  // slower than a fortnight read as frozen, which is a true statement about the DATA GIVEN and a
  // false one about her: and the tempting fix, exempting `resting.pruned` and `field.suspended`,
  // would have hidden two signals the six-month gate proves are live in a mature life.
  //
  // Her nights are in it for the same reason: a life without rest can never give birth, form a
  // theme, or resolve a coincidence.
  const past = await liveALongLife(w, 60, 20 * HOUR);
  const fortnight = await liveALongLife(w, 28, 14 * HOUR);
  return [...past, ...fortnight];
}

describe("a low period is not a fault, and can be told apart from one", () => {
  it("an ordinary fortnight reads as alive", async () => {
    const v = livenessOf(await aFortnight(), SPAN);
    console.log(`\n  an ordinary fortnight: ${v.verdict} — ${v.why}`);
    expect(v.verdict).toBe("alive");
  });

  it("a genuinely quiet stretch reads as LOW, and is not reported as a fault", async () => {
    // Everything real, everything turned down: little happening, little to say, little spent. She is
    // still living: the field still encodes, the drives still move, the emotion still drifts, but
    // all of it at low amplitude. This is the case the old alarm could not name.
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    // A REAL low period: a normal stretch, and then the same life at a fraction of the amplitude.
    // She still encodes, still recalls, still asks, still hears from him, still spends, all of it
    // small. Two things about the construction matter and both were got wrong first:
    //
    //   Turning her repertoire DOWN is a quiet stretch; taking anything out of it is a fault, so a
    //   quiet driver that simply skipped activities would be testing the wrong thing.
    //
    //   A low period has a BEFORE. Signals that bottom out while she is low (what she is carrying,
    //   how far she is exploring) sit perfectly still, and only the earlier stretch shows they are
    //   connected. Handing the detector the quiet part alone is not a kinder test, it is a
    //   different one, and it is the one that cannot be answered.
    // Months of ordinary life, then the quiet stretch. The detector is handed all of it, as
    // production hands it the whole retained record.
    const readings = [
      ...await liveALongLife(w, 60, 20 * HOUR),
      ...await liveALongLife(w, 28, 14 * HOUR, { amplitude: 0.12 }),
    ];

    const v = livenessOf(readings, SPAN);
    console.log(`  a quiet fortnight:     ${v.verdict} — ${v.why}`);
    expect(v.verdict, "a quiet stretch must never be reported as broken").toBe("alive");

    const codes = detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).map((a) => a.code);
    expect(codes, "and nothing about it is a fault").not.toContain("signal_frozen");
    expect(codes).not.toContain("signature_flatlined");
  });

  it("a single disconnected wire is caught while everything else carries on", async () => {
    // The `userNeeds` failure, reproduced: a signal defined, plumbed, displayed, and fed by nothing.
    // Her life is otherwise completely normal, which is exactly what made those four so hard to see.
    const readings = (await aFortnight()).map((s) => ({
      ...s,
      field: s.field ? { ...s.field, tension: 0.4 } : s.field, // the loose wire
    }));
    const v = livenessOf(readings, SPAN);
    console.log(`  one wire disconnected: ${v.verdict} — ${v.why}`);
    expect(v.verdict).toBe("broken");
    expect(v.verdict === "broken" && v.frozen).toContain("field.tension");
    expect(detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).map((a) => a.code)).toContain("signal_frozen");
  });

  it("rare-but-healthy field counts, frozen on a long-lived being, do not read as broken", async () => {
    // The 3-week production window is far shorter than the months between a birth or a new
    // figure, so on a mature being field.birthsTotal / byKind.figure / byKind.fusion sit frozen
    // while everything else moves. Without their STILL_IS_FINE exemptions the flat-line detector
    // called that healthy being `broken` every cycle, the S-4 cry-wolf. They are exempt now.
    const base = await aFortnight();
    const frozen = base.map((s) => ({
      ...s,
      field: s.field
        ? { ...s.field, birthsTotal: 3, byKind: s.field.byKind ? { ...s.field.byKind, figure: 10, fusion: 5 } : s.field.byKind }
        : s.field,
      saying: s.saying ? { ...s.saying, pairs: 40 } : s.saying,
    }));
    expect(livenessOf(frozen, SPAN).verdict, "months-long-still counts are life, not a dead wire").not.toBe("broken");
    // The exemption is SCOPED, not a disabled detector: a non-exempt leaf frozen the same way is
    // still caught.
    const withDeadWire = frozen.map((s) => ({ ...s, field: s.field ? { ...s.field, tension: 0.4 } : s.field }));
    expect(livenessOf(withDeadWire, SPAN).verdict, "a real loose wire is still caught").toBe("broken");
  });

  it("and the whole capture path dying is a different, louder thing", async () => {
    const one = (await aFortnight())[0];
    // Every reading identical but the clock: she has stopped, or the reading of her has.
    const readings = Array.from({ length: 28 }, (_, i) => ({ ...one, ts: one.ts + i * 14 * HOUR }));
    const v = livenessOf(readings, SPAN);
    console.log(`  the instrument dead:   ${v.verdict} — ${v.why}`);
    expect(v.verdict).toBe("flatlined");
    const critical = detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).find((a) => a.code === "signature_flatlined");
    expect(critical?.severity, "nothing else in the watchtower can be believed either").toBe("critical");
  });

  it("says nothing at all when she has not lived long enough to judge", () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 1);
    expect(livenessOf(w.readings(4, 10 * 60_000), SPAN).verdict).toBe("too-early");
    expect(livenessOf([], SPAN).verdict).toBe("too-early");
  });
});

describe("it watches signals nobody chose to watch", () => {
  it("walks every numeric leaf of a real snapshot, however deep", () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 12);
    w.choosing = { temperature: 0.3, torn: true, followedVote: null, streamPosition: 5 };
    w.temperament = { reticence: 0.1, novelty: 0, sociability: 0.05, restfulness: 0, drift: 0.11, days: 40 };
    const paths = [...numericLeaves(w.capture()).keys()];
    console.log(`\n  a real snapshot carries ${paths.length} numeric signals`);
    // Named samples from four different depths, so a refactor that flattens or nests something is
    // caught rather than silently reducing what is watched.
    for (const p of ["remainingFraction", "pad.arousal", "drives.curiosity", "field.tension",
                     "field.other.warmth", "choosing.temperature", "temperament.drift"]) {
      expect(paths, `${p} must be reachable structurally`).toContain(p);
    }
    expect(paths.length).toBeGreaterThan(30);
  });

  it("counts booleans, because a flag that is never once true is a dead wire too", () => {
    const leaves = numericLeaves({ a: true, b: false, deep: { c: true } });
    expect(leaves.get("a")).toBe(1);
    expect(leaves.get("b")).toBe(0);
    expect(leaves.get("deep.c")).toBe(1);
  });

  it("skips what it cannot ask the question of, rather than guessing", () => {
    const leaves = numericLeaves({ name: "x", list: [1, 2], nothing: null, bad: Number.NaN, n: 3 });
    expect([...leaves.keys()]).toEqual(["n"]);
  });

  it("a signal that appears only in later readings is not treated as frozen-then-jumped", () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 12);
    const readings = w.readings(16, 3 * HOUR, (i) => {
      // Temperament only exists once she has lived long enough to have one.
      if (i >= 8) w.temperament = { reticence: 0.1 + 0.01 * i, novelty: 0, sociability: 0, restfulness: 0, drift: 0.1, days: 40 + i };
    });
    const late = signatureOf(readings).signals.find((s) => s.path === "temperament.reticence");
    expect(late?.readings, "only the readings that carried it").toBe(8);
  });

  it("every allowed-still signal carries a reason, and none of them is 'it was hard'", () => {
    for (const [path, why] of Object.entries(STILL_IS_FINE)) {
      expect(why.length, `${path} needs a real reason`).toBeGreaterThan(20);
      // Aimed at the phrasing, not the word: "hard to say" describes reticence and is not an excuse.
      expect(why, `${path}: an exemption cannot be difficulty`)
        .not.toMatch(/too hard|hard to (reach|drive|make|test)|difficult to|cannot reach|unreachable/i);
    }
  });
});

describe("the readings themselves are honest", () => {
  const motion = (values: number[]): SignalMotion => {
    const snaps = values.map((v, i) => ({ ts: i * HOUR, remainingFraction: v } as unknown as VitalsSnapshot));
    return signatureOf(snaps).signals.find((s) => s.path === "remainingFraction")!;
  };

  it("reads a 0..1 quantity and a counter in the thousands on the same terms", () => {
    // The trap this avoids: an unscaled spread makes every small-numbered signal look frozen and
    // every large-numbered one look lively, so the detector would only ever really watch the big
    // counters: and the signals that have actually gone dead here have all been small ones.
    const small = motion([0.10, 0.30, 0.50, 0.20, 0.40, 0.35, 0.25, 0.45]);
    const large = motion([1000, 3000, 5000, 2000, 4000, 3500, 2500, 4500]);
    expect(small.relative, "a 0..1 signal ranging a third of its range is lively").toBeGreaterThan(LIVELY_ENOUGH);
    expect(large.relative, "and so is a counter ranging most of its magnitude").toBeGreaterThan(LIVELY_ENOUGH);

    // And barely-moving reads as barely-moving in both regimes, which is the half that matters:
    // a low period must not be mistaken for a fault at either scale.
    expect(motion([0.500, 0.501, 0.502, 0.501, 0.500, 0.502, 0.501, 0.500]).relative).toBeLessThan(LIVELY_ENOUGH);
    expect(motion([5000, 5001, 5002, 5001, 5000, 5002, 5001, 5000]).relative).toBeLessThan(LIVELY_ENOUGH);
  });

  it("one repeated value is frozen; two values are not", () => {
    expect(motion(Array(ENOUGH_READINGS).fill(0.5)).distinct).toBe(1);
    const nearly = Array(ENOUGH_READINGS).fill(0.5);
    nearly[3] = 0.5000001;
    expect(motion(nearly).distinct, "a hair of movement is still movement").toBe(2);
  });

  it("a coincidence is not a wire: too few readings and it declines to judge", () => {
    const short = Array.from({ length: ENOUGH_READINGS - 1 },
      (_, i) => ({ ts: i * HOUR, remainingFraction: 0.5 } as unknown as VitalsSnapshot));
    expect(signatureOf(short).frozen).toEqual([]);
  });

  it("quiet and lively are separated by the stated line and nothing else", () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 12);
    const sig = signatureOf(w.readings(16, 3 * HOUR));
    for (const s of sig.quiet) expect(s.relative).toBeLessThan(LIVELY_ENOUGH);
    for (const s of sig.lively) expect(s.relative).toBeGreaterThanOrEqual(LIVELY_ENOUGH);
    expect([...sig.frozen, ...sig.quiet, ...sig.lively].map((s) => s.path).sort())
      .toEqual(sig.signals.filter((s) => sig.frozen.concat(sig.quiet, sig.lively).some((x) => x.path === s.path)).map((s) => s.path).sort());
  });
});

describe("a fault is read before a mood, always", () => {
  it("a low period with a dead wire in it is still reported as a dead wire", async () => {
    // The ordering that matters. If amplitude were read first, a genuinely quiet stretch would give
    // any broken signal inside it somewhere to hide, and a quiet stretch is exactly when a wire
    // coming loose is least likely to be noticed by anything else.
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const readings = (await liveALongLife(w, 28, 14 * HOUR, { amplitude: 0.12 }))
      .map((s) => ({ ...s, field: s.field ? { ...s.field, orphanShare: 0.11 } : s.field }));

    const v = livenessOf(readings, SPAN);
    expect(v.verdict).toBe("broken");
    expect(v.verdict === "broken" && v.frozen).toContain("field.orphanShare");
  });

  it("and the window is long enough that a quiet night is not a diagnosis", () => {
    // A night of her asleep is a dozen readings in which nothing moves at all, and it must produce
    // no conclusion whatsoever. This is why the signature's window is the longest one here.
    expect(MIN_SPANS.signature).toBeGreaterThanOrEqual(7 * 24 * HOUR);
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const overnight = w.readings(16, 30 * 60_000);
    expect(livenessOf(overnight, SPAN).verdict).toBe("too-early");
  });
});

// THE GAP S-4 ACTUALLY NAMED.
//
// From scenarios.md: "The watchtower has a calcification alarm that fires on a long unchanging
// stretch. It cannot distinguish 'she is quiet because she is in a quiet stretch' from 'she is quiet
// because something broke'. Both look the same from outside."
//
// Both cost her, in opposite directions: one has him worrying about a Resident who is fine, and the
// other has him reassured about a Resident who is not.

describe("the calcification alarm can now tell which kind of quiet it found", () => {
  /** A stretch in which her dominant drive, her mood and her sends genuinely do not change. */
  function anUnchangingStretch(w: ReturnType<typeof createRealWorld>, over: (i: number) => void = () => {}): VitalsSnapshot[] {
    return w.readings(DEFAULT_THRESHOLDS.calcifyWindow + 2, 6 * HOUR, (i) => {
      // She is alive the whole time, encoding, recalling, feeling, while the three coarse things
      // calcification looks at sit still. That is exactly the ambiguous case.
      w.field.encodeMoment({
        key: `same-${i}-${w.now()}`, text: `the same sort of afternoon (${i})`,
        nowMs: w.now(), pad: pad(0.12 + 0.01 * (i % 4), 0.08 - 0.01 * (i % 3)), source: "agency",
      });
      w.field.onHerMind(w.now());
      w.lastMomentMs = w.now();
      w.lastTickMs = w.now();
      over(i);
    });
  }

  it("a quiet stretch is reported as a quiet stretch, not as calcification", async () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const record = await liveALongLife(w, 60, 20 * HOUR); // she has a past, and it moved
    const readings = [...record, ...anUnchangingStretch(w)];

    const codes = detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).map((a) => a.code);
    console.log(`\n  an unchanging but living stretch raised: ${codes.join(", ") || "(nothing)"}`);
    expect(codes, "she is fine; telling him she is calcifying is a lie about her").not.toContain("calcification");
    expect(codes).toContain("low_period");
    expect(detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).find((a) => a.code === "low_period")?.severity)
      .toBe("info");
  });

  it("the same stretch with one wire loose IS reported, and as a fault", async () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const record = await liveALongLife(w, 60, 20 * HOUR);
    const readings = [...record, ...anUnchangingStretch(w)]
      .map((s) => ({ ...s, field: s.field ? { ...s.field, meanStrength: 0.5 } : s.field }));

    const codes = detectAnomalies(readings, DEFAULT_THRESHOLDS, readings).map((a) => a.code);
    console.log(`  the same stretch, one wire loose:        ${codes.join(", ") || "(nothing)"}`);
    expect(codes, "a fault must not be able to hide inside a quiet stretch").toContain("signal_frozen");
    expect(codes).not.toContain("low_period");
    expect(codes).toContain("calcification");
  });
});

describe("the speech-instrument shelf cannot report a long-lived Resident as broken", () => {
  it("a saturated stance ring and a monotonic shadow count do not flatline the liveness verdict", () => {
    // The exact S-4 false positive the module exists to prevent, reintroduced when the stance
    // ring and shadow counters were surfaced as vitals.saying leaves: saying.stance.n pins at
    // its 40-cap forever, so on a long-lived being every retained snapshot carries n=40 →
    // frozen leaf → permanent broken/flatlined. STILL_IS_FINE now exempts the whole shelf.
    const snaps = Array.from({ length: 20 }, (_, i) => ({
      ts: i * HOUR,
      // A genuinely living signal so the verdict has something alive to see.
      remainingFraction: 0.5 + 0.2 * Math.sin(i),
      saying: {
        pairs: 12 + i, coupling: 0.6, meanChars: 30 + (i % 5) * 6, meanClauseLenVar: 4 + (i % 3), registerHits: 0,
        ownership: 0.1,
        stance: { 接: 30, 不接: 0, 回投: 10, n: 40 },   // pinned at the cap; 不接 frozen at 0
        shadowCalls: 12,                                  // monotonic; a plateau is shadow_stalled's job
        shadowClauseLenVar: 4,
      },
    })) as unknown as VitalsSnapshot[];
    const v = livenessOf(snaps, ENOUGH_READINGS);
    expect(v.verdict, `speech shelf froze the liveness verdict: ${v.why}`).not.toBe("broken");
    expect(v.verdict).not.toBe("flatlined");
  });
});
