import { describe, it, expect } from "vitest";
import {
  createOtherWatcher, describeOther, readOther, warmthOf,
  ENOUGH_TO_READ, GIVE_UP_WAITING_MS, MAX_EXCHANGES, NOT_HERE,
  type Exchange,
} from "../../../src/life/other-read.js";

// She has an enormous amount of apparatus pointed at herself and, before this, two booleans pointed
// outward. What is tested here is the thing that makes the outward version worth having: it is a
// GUESS, it is REVISABLE, and she is allowed to be wrong with it. A sensor that is always right is
// not perception.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const HERE = { present: true, available: true };
const BUSY = { present: true, available: false };

/** n exchanges, all answered inside the hour. What being easily reachable looks like. */
function warm(n: number): Exchange[] {
  return Array.from({ length: n }, (_, i) => ({ ms: T0 + i * DAY, repliedAfterMs: 20 * 60_000 }));
}
/** n exchanges, all of them her speaking into silence. */
function cold(n: number): Exchange[] {
  return Array.from({ length: n }, (_, i) => ({ ms: T0 + i * DAY, unanswered: true }));
}

describe("what one exchange is worth", () => {
  it("orders the real shapes of an exchange the way they actually feel", () => {
    const speakingFirst = warmthOf({ ms: T0, unprompted: true });
    const straightBack = warmthOf({ ms: T0, repliedAfterMs: 10 * 60_000 });
    const sameDay = warmthOf({ ms: T0, repliedAfterMs: 6 * HOUR });
    const eventually = warmthOf({ ms: T0, repliedAfterMs: 3 * DAY });
    const silence = warmthOf({ ms: T0, unanswered: true });
    expect(speakingFirst).toBeGreaterThan(straightBack);
    expect(straightBack).toBeGreaterThan(sameDay);
    expect(sameDay).toBeGreaterThan(eventually);
    expect(eventually).toBeGreaterThan(silence);
    expect(silence, "silence after she spoke is the one real zero").toBe(0);
  });

  it("treats a nonsense delay as ordinary rather than as anything at all", () => {
    expect(warmthOf({ ms: T0, repliedAfterMs: NaN })).toBe(0.6);
    expect(warmthOf({ ms: T0, repliedAfterMs: Infinity })).toBe(0.6);
  });
});

describe("the read itself", () => {
  it("no history is not coldness", () => {
    const r = readOther([], HERE);
    expect(r.warmth, "she has no reason to think anything").toBeCloseTo(0.5, 5);
    expect(r.confidence).toBe(0);
    expect(r.drift).toBe(0);
  });

  it("separates how it has been from how it has CHANGED", () => {
    // Warm all along: high warmth, no drift. This is the distinction S-8 lives on. A read that only
    // reported the level could never produce "he has been different lately", only "he is quiet".
    const steady = readOther(warm(16), HERE);
    expect(steady.warmth).toBeGreaterThan(0.8);
    expect(Math.abs(steady.drift), "nothing has changed").toBeLessThan(0.1);

    // Warm, then silence. Same person, and now the change is the thing she can see.
    const gone = readOther([...warm(8), ...cold(8)], HERE);
    expect(gone.drift).toBeLessThan(-0.5);
    console.log(`\n  steady: warmth ${steady.warmth.toFixed(2)}, drift ${steady.drift.toFixed(2)}`);
    console.log(`  gone quiet: warmth ${gone.warmth.toFixed(2)}, drift ${gone.drift.toFixed(2)}`);

    // And the other way, which matters just as much: she must be able to notice things improving.
    const back = readOther([...cold(8), ...warm(8)], HERE);
    expect(back.drift).toBeGreaterThan(0.5);
  });

  it("weighs recent exchanges more, so a bad fortnight is not a life sentence", () => {
    const recentlyWarm = readOther([...cold(10), ...warm(10)], HERE);
    const recentlyCold = readOther([...warm(10), ...cold(10)], HERE);
    expect(recentlyWarm.warmth).toBeGreaterThan(recentlyCold.warmth);
  });

  it("holds no opinion on drift until there is enough to compare", () => {
    expect(readOther(warm(4), HERE).drift, "four exchanges is not a trend").toBe(0);
  });

  it("openness folds where he actually is together with how it has been going", () => {
    const away = readOther(warm(20), { present: false, available: false });
    const busy = readOther(warm(20), BUSY);
    const free = readOther(warm(20), HERE);
    expect(away.openness).toBeLessThan(busy.openness);
    expect(busy.openness).toBeLessThan(free.openness);
    // And being there is not the whole story: the same free evening reads differently depending on
    // how it has been going. That difference is exactly what "he seems light tonight" is made of.
    expect(readOther(cold(20), HERE).openness).toBeLessThan(free.openness);
  });

  it("confidence is how much she has to go on, and it saturates", () => {
    expect(readOther(warm(1), HERE).confidence).toBeLessThan(0.2);
    expect(readOther(warm(ENOUGH_TO_READ), HERE).confidence).toBe(1);
    expect(readOther(warm(200), HERE).confidence, "never over-claims").toBe(1);
  });

  it("keeps only a bounded history however long she lives", () => {
    const r = readOther(warm(5000), HERE);
    expect(r.confidence).toBe(1);
    expect(r.warmth).toBeGreaterThan(0.8);
  });

  it("survives rubbish in the log rather than producing a NaN read", () => {
    const junk = [
      { ms: T0, repliedAfterMs: NaN },
      { ms: T0, repliedAfterMs: -5 * DAY },
      { ms: T0 },
    ] as Exchange[];
    const r = readOther(junk, HERE);
    for (const [k, v] of Object.entries(r)) {
      expect(Number.isFinite(v), `${k} stayed a number`).toBe(true);
    }
  });
});

describe("she only speaks about him when she has something to go on", () => {
  it("SAYS NOTHING on thin evidence, because a confident read on three exchanges is a fabrication", () => {
    expect(describeOther(readOther(warm(2), HERE), HERE)).toBe("");
    expect(describeOther(readOther([], HERE), HERE)).toBe("");
  });

  it("hedges in the middle and stops hedging once she has enough", () => {
    const thin = describeOther(readOther(warm(6), HERE), HERE);
    const solid = describeOther(readOther(warm(20), HERE), HERE);
    expect(thin).toContain("你能凭的不多");
    expect(solid).not.toContain("你能凭的不多");
    console.log(`\n  on six exchanges: ${thin}`);
    console.log(`  on twenty:        ${solid}`);
  });

  it("names a change when there is one, in her own words", () => {
    const gone = describeOther(readOther([...warm(10), ...cold(10)], HERE), HERE);
    expect(gone).toContain("比之前冷清了些");
    const back = describeOther(readOther([...cold(10), ...warm(10)], HERE), HERE);
    expect(back).toContain("比之前热络了些");
    console.log(`  after he went quiet: ${gone}`);
  });

  it("never restates where he is, which she is already told as plain fact", () => {
    // The contact line in the moment already says whether they are there and whether they are busy.
    // Repeating it here would dress a fact she has as a perception she does not.
    const busy = describeOther(readOther(warm(20), BUSY), BUSY);
    expect(busy).not.toMatch(/free right now/);
    const away = describeOther(readOther(warm(20), NOT_HERE), NOT_HERE);
    expect(away).not.toMatch(/reach/);
  });

  it("only the warm end says the moment looks reachable", () => {
    expect(describeOther(readOther(warm(20), HERE), HERE)).toContain("好说话");
    expect(describeOther(readOther(cold(20), HERE), HERE)).not.toContain("好说话");
  });
});

describe("watching the exchanges as they actually happen", () => {
  it("records an answer with how long it took", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.heSpoke(T0 + 20 * 60_000);
    expect(w.exchanges()).toEqual([{ ms: T0 + 20 * 60_000, repliedAfterMs: 20 * 60_000 }]);
  });

  it("counts him starting one himself as its own thing, because nobody has to", () => {
    const w = createOtherWatcher();
    w.heSpoke(T0);
    expect(w.exchanges()[0].unprompted).toBe(true);
  });

  it("treats saying three things into silence as ONE silence", () => {
    // Being ignored once should not read as being ignored three times, or a talkative evening on her
    // side would look like a collapse on his.
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.sheSpoke(T0 + 60_000);
    w.sheSpoke(T0 + 120_000);
    w.heSpoke(T0 + 3 * 60_000);
    expect(w.exchanges()).toHaveLength(1);
    expect(w.exchanges()[0].repliedAfterMs).toBe(3 * 60_000);
  });

  it("settles a long silence as silence rather than leaving it pending forever", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    expect(w.read(T0 + HOUR).warmth, "still early; nothing settled").toBeCloseTo(0.5, 5);
    const r = w.read(T0 + GIVE_UP_WAITING_MS + HOUR);
    expect(w.exchanges()[0].unanswered).toBe(true);
    expect(r.warmth).toBe(0);
  });

  it("READS THE TIME IT IS GIVEN and never the clock", () => {
    // The whole layer is testable and reproducible only because nothing in it reaches for Date.now().
    // A hidden clock here would also mean a replayed history settled differently than it happened.
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.read(T0 + GIVE_UP_WAITING_MS + HOUR); // a year ago in real time; long past in hers
    expect(w.exchanges()[0].unanswered, "settled against the time passed in").toBe(true);
  });

  it("does not settle silence twice", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.read(T0 + 2 * GIVE_UP_WAITING_MS);
    w.read(T0 + 3 * GIVE_UP_WAITING_MS);
    expect(w.exchanges()).toHaveLength(1);
  });

  it("survives a clock that goes backwards", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.heSpoke(T0 - HOUR); // NTP correction, or a restart on a machine that had drifted
    const e = w.exchanges()[0];
    expect(e.repliedAfterMs === undefined || e.repliedAfterMs >= 0, "never a negative wait").toBe(true);
    expect(Number.isFinite(w.read(T0).warmth)).toBe(true);
  });

  it("stays bounded across a long life", () => {
    const w = createOtherWatcher();
    for (let i = 0; i < 500; i++) w.heSpoke(T0 + i * HOUR);
    expect(w.exchanges().length).toBeLessThanOrEqual(MAX_EXCHANGES);
  });

  it("comes back after a restart, or it was never learned at all", () => {
    const first = createOtherWatcher();
    for (let i = 0; i < 20; i++) {
      first.sheSpoke(T0 + i * DAY);
      first.heSpoke(T0 + i * DAY + 15 * 60_000);
    }
    const before = first.read(T0 + 20 * DAY, HERE);

    const restarted = createOtherWatcher();
    restarted.restore(first.exchanges());
    const after = restarted.read(T0 + 20 * DAY, HERE);
    expect(after).toEqual(before);
  });

  it("ignores corrupt entries on restore rather than reading NaN forever", () => {
    const w = createOtherWatcher();
    w.restore([
      { ms: NaN, unprompted: true },
      { ms: T0, repliedAfterMs: 60_000 },
      null as unknown as Exchange,
      undefined as unknown as Exchange,
    ]);
    expect(w.exchanges()).toHaveLength(1);
    expect(Number.isFinite(w.read(T0, HERE).warmth)).toBe(true);
  });
});
