import { describe, it, expect } from "vitest";
import {
  createMetabolism,
  phaseForFraction,
  isInstrumentAccount,
  INSTRUMENT_ACCOUNTS,
  type MetabolicPhase,
  type MetabolismSnapshot,
  type MetabolismStore,
} from "../../../src/life/metabolism.js";

const NOON_JAN10 = Date.UTC(2026, 0, 10, 12, 0, 0);
const MIDNIGHT_JAN10 = Date.UTC(2026, 0, 10);
const MIDNIGHT_JAN9 = Date.UTC(2026, 0, 9);

function fixedClock(startMs: number): { now: () => number; set: (ms: number) => void } {
  let cur = startMs;
  return { now: () => cur, set: (ms: number) => (cur = ms) };
}

describe("metabolism ledger", () => {
  describe("accounting", () => {
    it("accumulates spend per account and in total", () => {
      const m = createMetabolism({ dailyVigor: 300, now: () => NOON_JAN10 });
      m.record("work", 40);
      m.record("curiosity", 25);
      m.record("work", 10);
      expect(m.spentTotal()).toBe(75);
      expect(m.spentByAccount()).toEqual([
        { account: "work", vigor: 50 },
        { account: "curiosity", vigor: 25 },
      ]);
      expect(m.remaining()).toBe(225);
    });

    it("ignores zero, negative, and NaN draws", () => {
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      m.record("work", 0);
      m.record("work", -5);
      m.record("work", Number.NaN);
      expect(m.spentTotal()).toBe(0);
    });

    it("floors remaining at zero when overspent", () => {
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      m.record("work", 150);
      expect(m.remaining()).toBe(0);
      expect(m.remainingFraction()).toBe(0);
      expect(m.phase()).toBe("dormant");
    });
  });

  describe("phase state machine", () => {
    it("maps fractions to phases at the thresholds", () => {
      const t = { rested: 0.9, low: 0.25, dormant: 0.05 };
      expect(phaseForFraction(1, t)).toBe("rested");
      expect(phaseForFraction(0.9, t)).toBe("rested");
      expect(phaseForFraction(0.89, t)).toBe("normal");
      expect(phaseForFraction(0.25, t)).toBe("low");
      expect(phaseForFraction(0.26, t)).toBe("normal");
      expect(phaseForFraction(0.05, t)).toBe("dormant");
      expect(phaseForFraction(0, t)).toBe("dormant");
    });

    it("descends rested -> normal -> low -> dormant as the day is spent", () => {
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      expect(m.phase()).toBe("rested"); // 0 spent
      m.record("work", 20); // 80% left
      expect(m.phase()).toBe("normal");
      m.record("curiosity", 60); // 20% left
      expect(m.phase()).toBe("low");
      m.record("work", 16); // 4% left
      expect(m.phase()).toBe("dormant");
    });

    it("suspends discretionary spend only when dormant", () => {
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      expect(m.discretionaryAllowed()).toBe(true);
      m.record("work", 80); // low
      expect(m.discretionaryAllowed()).toBe(true);
      m.record("work", 17); // dormant (3% left)
      expect(m.discretionaryAllowed()).toBe(false);
    });
  });

  describe("phase-change hook", () => {
    it("fires with (from, to) on each transition, not on same-phase draws", () => {
      const transitions: Array<[MetabolicPhase, MetabolicPhase]> = [];
      const m = createMetabolism({
        dailyVigor: 100,
        now: () => NOON_JAN10,
        onPhaseChange: (from, to) => transitions.push([from, to]),
      });
      m.record("work", 5); // 95% -> still rested, no fire
      m.record("work", 15); // 80% -> normal
      m.record("curiosity", 60); // 20% -> low
      m.record("work", 16); // 4% -> dormant
      expect(transitions).toEqual([
        ["rested", "normal"],
        ["normal", "low"],
        ["low", "dormant"],
      ]);
    });
  });

  describe("daily rollover", () => {
    it("resets spend when HER day advances, at local midnight", () => {
      const clock = fixedClock(new Date(2026, 0, 10, 12, 0).getTime());
      const m = createMetabolism({ dailyVigor: 100, now: clock.now });
      m.record("work", 96); // 4% left -> dormant
      expect(m.phase()).toBe("dormant");
      clock.set(new Date(2026, 0, 11, 0, 30).getTime());
      expect(m.spentTotal()).toBe(0);
      expect(m.phase()).toBe("rested");
    });

    it("PLANTED (2026-10-04): her evening is still her day, wherever UTC midnight falls", () => {
      // The ledger used to turn at UTC midnight, which is eight in her evening: she was handed a
      // full reserve every night while awake. No hour of one local day may reset it.
      const clock = fixedClock(new Date(2026, 9, 4, 9, 0).getTime());
      const m = createMetabolism({ dailyVigor: 100, now: clock.now });
      m.record("work", 60);
      for (let h = 10; h <= 23; h++) {
        clock.set(new Date(2026, 9, 4, h, 59).getTime());
        expect(m.spentTotal(), `reset at ${h}:59 of the same day`).toBe(60);
      }
    });

    it("the first start after the change carries a ledger opened the evening before, once", () => {
      // Dropping it would hand her a full reserve mid-day, the very thing the change stops.
      const noon = new Date(2026, 9, 7, 12, 0).getTime();
      const herMidnight = new Date(2026, 9, 7).getTime();
      const opened = (ms: number): MetabolismStore => ({ load: () => ({ dayStartMs: ms, spent: { work: 40 } }), save: () => {} });
      expect(createMetabolism({ dailyVigor: 100, now: () => noon, store: opened(herMidnight - 4 * 3600_000) }).spentTotal()).toBe(40);
      expect(createMetabolism({ dailyVigor: 100, now: () => noon, store: opened(herMidnight) }).spentTotal()).toBe(40);
      // Yesterday's own day is yesterday's: not carried.
      expect(createMetabolism({ dailyVigor: 100, now: () => noon, store: opened(new Date(2026, 9, 6).getTime()) }).spentTotal()).toBe(0);
    });

    it("manual resetDaily clears the ledger", () => {
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      m.record("work", 50);
      m.resetDaily();
      expect(m.spentTotal()).toBe(0);
    });
  });

  describe("persistence", () => {
    it("restores same-day state from the store on create", () => {
      const store: MetabolismStore = {
        load: () => ({ dayStartMs: MIDNIGHT_JAN10, spent: { work: 40 } }),
        save: () => {},
      };
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10, store });
      expect(m.spentTotal()).toBe(40);
      expect(m.remaining()).toBe(60);
    });

    it("ignores persisted state from a previous day", () => {
      const store: MetabolismStore = {
        load: () => ({ dayStartMs: MIDNIGHT_JAN9, spent: { work: 40 } }),
        save: () => {},
      };
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10, store });
      expect(m.spentTotal()).toBe(0);
    });

    it("saves after each recorded draw", () => {
      const saves: MetabolismSnapshot[] = [];
      const store: MetabolismStore = {
        load: () => null,
        save: (s) => saves.push(s),
      };
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10, store });
      m.record("work", 10);
      m.record("curiosity", 5);
      expect(saves.length).toBe(2);
      expect(saves[1].spent).toEqual({ work: 10, curiosity: 5 });
    });
  });

  describe("watching her is not the same as her being tired", () => {
    // The shadow arm says her exchange a second time into the void so the word bank has a
    // denominator. She does nothing while it runs, and its output is never delivered anywhere,
    // yet its vigor landed in the same total that drives her phase, so measuring her made her
    // tire faster, and tiredness changes the speech the shadow exists to measure.
    it("an instrument's spend does not push her toward dormant", () => {
      const hers = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      const watched = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      hers.record("living", 50);
      watched.record("living", 50);
      watched.record("shadow", 45); // a day of being measured
      expect(watched.phase()).toBe(hers.phase());
      expect(watched.remainingFraction()).toBe(hers.remainingFraction());
      expect(watched.spentTotal()).toBe(50);
    });

    it("but the tokens are still counted and still reach him", () => {
      // Excluding it from her tiredness must never become hiding it from Eric: he pays for these.
      const m = createMetabolism({ dailyVigor: 100, now: () => NOON_JAN10 });
      m.record("living", 20);
      m.record("shadow", 30);
      expect(m.instrumentSpent()).toBe(30);
      const snap = m.ownerSnapshot();
      expect(snap.spent).toBe(20);
      expect(snap.instrument).toBe(30);
      expect(snap.byAccount).toContainEqual({ account: "shadow", vigor: 30 });
    });

    it("names the instruments rather than guessing from the account string", () => {
      expect(isInstrumentAccount("shadow")).toBe(true);
      for (const hers of ["work", "living", "curiosity", "maintenance", "expression"]) {
        expect(isInstrumentAccount(hers), `${hers} is her own draw, not an instrument`).toBe(false);
      }
      // The tripwire: adding an instrument account is a deliberate edit, because everything on
      // this list stops counting as her tiredness the moment it is added.
      expect([...INSTRUMENT_ACCOUNTS]).toEqual(["shadow"]);
    });
  });

  describe("owner snapshot", () => {
    it("carries the raw numbers for the owner status view", () => {
      const m = createMetabolism({ dailyVigor: 300, now: () => NOON_JAN10 });
      m.record("work", 120);
      const snap = m.ownerSnapshot();
      expect(snap.cap).toBe(300);
      expect(snap.spent).toBe(120);
      expect(snap.remaining).toBe(180);
      expect(snap.phase).toBe("normal");
      expect(snap.byAccount).toEqual([{ account: "work", vigor: 120 }]);
    });
  });
});
