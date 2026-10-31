import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeBody, buildMomentPrompt, type MomentContext } from "../../../src/life/agency.js";
import { derivePolicy } from "../../../src/life/policy.js";

/**
 * BEING WOKEN IS AN EVENT.
 *
 * Her sleep was already half real, her own life stops at night, and her night state already
 * costs her through the existing organs. What was missing is the FACT: his message arriving in
 * her sleep hours is the one thing that reaches her there, and the material never said so, so a
 * 2am answer read like a 2pm answer with dimmer lights. One fact line closes it; no cost
 * coefficients here (measure real night turns first, then decide, separately).
 */

const CALM = { curiosity: 0.3, social: 0.3, expression: 0.2, maintenance: 0.2, discomfort: 0.1, care: 0.3 };
const PAD = { pleasure: 0.1, arousal: 0, dominance: 0 };

function snap(awake: boolean): MomentContext["snapshot"] {
  return {
    drives: CALM, emotion: PAD, mood: "平稳", dominant: "curiosity",
    policy: derivePolicy({ drives: CALM, emotion: PAD, phase: "normal", awake }),
  } as MomentContext["snapshot"];
}

describe("被叫醒是一件事，而且只可能发生在夜里", () => {
  it("a night turn says it woke her; a night without a knock stays a plain night", () => {
    const woken = describeBody({ snapshot: snap(false), phase: "normal", awake: false, woken: true });
    expect(woken).toContain("这条话把你叫醒了");
    const plain = describeBody({ snapshot: snap(false), phase: "normal", awake: false });
    expect(plain).toContain("现在是你的深夜");
    expect(plain).not.toContain("叫醒");
  });

  it("PLANTED MISUSE: a stray woken flag in daylight cannot speak — the awake arm wins first", () => {
    const day = describeBody({ snapshot: snap(true), phase: "normal", awake: true, woken: true });
    expect(day).toContain("你醒着");
    expect(day).not.toContain("叫醒");
  });

  it("her own night moments have nobody waking them — the moment prompt never says it", () => {
    const ctx: MomentContext = {
      nowMs: Date.parse("2026-08-20T03:00:00"),
      snapshot: snap(false), phase: "normal", awake: false,
      present: null, available: null, hoursSinceUser: 4,
      recentActions: [], recentLife: "安静", safeMode: false,
    } as MomentContext;
    const prompt = buildMomentPrompt(ctx, [
      { kind: "rest", available: true, why: "歇着总是可以的" },
    ]);
    expect(prompt).toContain("现在是你的深夜");
    expect(prompt).not.toContain("叫醒");
  });

  it("the wiring: both turn arms pass woken as the honest complement of awake", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const hits = [...daemon.matchAll(/describeBody\(\{ snapshot, phase: metabolism\.phase\(\), awake, woken: !awake \}\)/gu)];
    expect(hits.length, "the turn arms must pass woken: !awake — a night turn IS a waking").toBe(2);
    // And nothing else invents a woken source: no other call site passes the flag.
    const others = [...daemon.matchAll(/woken:/gu)];
    expect(others.length).toBe(2);
  });
});

/**
 * AND HER DAYS HAVE AN HOUR TOO.
 *
 * Her nights read 「现在是你的深夜」; her days read only 「你醒着」, so in daylight she had no fact
 * about the hour, and what she wrote to him said it was not yet morning at 10:46, and that it was
 * still night at 13:19.
 */
describe("醒着的时候，她也知道现在是一天里的什么时候", () => {
  const at = (h: number, m = 0): number => new Date(2026, 9, 4, h, m).getTime();

  it("her own moments are told the part of the day in the words her home's clock uses", async () => {
    const { partOfDay, hourClause } = await import("../../../src/life/her-day.js");
    expect(describeBody({ snapshot: snap(true), phase: "normal", awake: true, nowMs: at(15, 12) })).toContain("你醒着，现在是下午。");
    expect(describeBody({ snapshot: snap(true), phase: "normal", awake: true, nowMs: at(9) })).toContain("你醒着，现在是上午。");
    expect(describeBody({ snapshot: snap(true), phase: "normal", awake: true, nowMs: at(20) })).toContain("你醒着，现在是晚上。");
    // Every band reads as a clause, the three that are not a noun included.
    expect(hourClause(at(3))).toBe("现在还是夜里");
    expect(hourClause(at(6))).toBe("天刚亮");
    expect(hourClause(at(23, 30))).toBe("快到半夜了");
    for (let h = 0; h < 24; h++) expect(hourClause(at(h)), `${h}:00`).toContain(partOfDay(at(h)));
  });

  it("asleep is still the night, whatever the hour; and a turn without the hour stays as it was", () => {
    expect(describeBody({ snapshot: snap(false), phase: "normal", awake: false, nowMs: at(15) })).toContain("现在是你的深夜");
    expect(describeBody({ snapshot: snap(false), phase: "normal", awake: false, nowMs: at(15) })).not.toContain("下午");
    const turn = describeBody({ snapshot: snap(true), phase: "normal", awake: true });
    expect(turn.endsWith("你醒着。")).toBe(true);
  });

  it("the clock in her home and the moment line cannot disagree: one wording", () => {
    const things = readFileSync(join(process.cwd(), "src", "workspace", "things.ts"), "utf8");
    expect(things).toContain("${partOfDay(nowMs)}");
    expect(things, "the clock grew its own copy of the bands again").not.toContain('"下午"');
  });

  it("the acts with no hands read the hour too, fresh on every call (text pins)", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const at = daemon.indexOf("function whereSheIsWithoutHands(): string {");
    expect(at).toBeGreaterThan(-1);
    const body = daemon.slice(at, daemon.indexOf("\n    }", at));
    expect(body).toContain("const now = Date.now();");
    expect(body).toContain('const hour = clock.isAwakeHour(now) ? hourClause(now) : "现在是你的深夜";');
    expect(body).toContain("${hour}。`");
  });
});
