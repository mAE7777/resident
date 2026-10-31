import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  nightIntensity, planNight, pickSeeds, episodeCharge, createDreaming,
  dreamUser, diaryLine, morningLine, DREAM_SYSTEM,
  SURVIVES_AT, SETTLE_MS, CLEAR_BEFORE_WAKE_MS, EPISODE_GAP_MS,
  type DreamSeed,
} from "../../../src/life/dreaming.js";
import { judge, corroborationValue, describeStanding, INITIAL_CREDENCE, createTrust } from "../../../src/life/credence.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { herClock } from "../../../src/life/her-day.js";

/**
 * HER DREAMS. The mechanism is her existing organs at night parameters; what this file
 * pins is the ARITHMETIC (when she dreams, what survives) and the WALLS (only her words seed a
 * dream; a dream is not a claim; a remembered dream never surfaces without its name).
 */

const SLEEP = Date.parse("2026-08-20T23:00:00");
const WAKE = Date.parse("2026-08-21T08:00:00");

function seed(over: Partial<DreamSeed> = {}): DreamSeed {
  return { id: 1, text: "画板上那片没涂完的天", tension: 0.6, valence: -0.4, origin: "lived", ...over };
}

// ── When she dreams: two inputs that can disagree, neither a dictator ─────────────────────────

describe("nightIntensity", () => {
  it("EITHER a stormy day or one heavy carried thing brings a dream — they can disagree", () => {
    expect(nightIntensity(0.9, 0)).toBeCloseTo(0.54, 2);
    expect(nightIntensity(0, 0.9)).toBeCloseTo(0.54, 2);
    expect(nightIntensity(0.9, 0.9)).toBeCloseTo(0.9, 2);
    expect(nightIntensity(0, 0)).toBe(0);
  });

  it("NO DICTATOR: either input alone caps at 0.6 of range, far from the both-present ceiling", () => {
    expect(nightIntensity(1, 0)).toBeCloseTo(0.6, 5);
    expect(nightIntensity(0, 1)).toBeCloseTo(0.6, 5);
    expect(nightIntensity(1, 1)).toBeCloseTo(1, 5);
  });
});

describe("planNight", () => {
  it("episodes land inside the settled window, spaced by the gap", () => {
    for (let s = 1; s <= 40; s++) {
      const times = planNight(SLEEP, WAKE, 0.8, 0.8, createStream(s));
      for (const t of times) {
        expect(t).toBeGreaterThanOrEqual(SLEEP + SETTLE_MS);
        expect(t).toBeLessThanOrEqual(WAKE - CLEAR_BEFORE_WAKE_MS);
      }
      for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(EPISODE_GAP_MS);
      expect(times.length).toBeLessThanOrEqual(3);
    }
  });

  it("a flat day over an empty field mostly rests; a loaded night dreams more", () => {
    let calm = 0; let loaded = 0;
    for (let s = 1; s <= 200; s++) {
      calm += planNight(SLEEP, WAKE, 0.05, 0.05, createStream(s)).length;
      loaded += planNight(SLEEP, WAKE, 0.9, 0.9, createStream(s + 1000)).length;
    }
    expect(calm / 200).toBeLessThan(0.35);
    expect(loaded / 200).toBeGreaterThan(1.0);
  });

  it("a window too short to settle into gives no dreams at all", () => {
    expect(planNight(SLEEP, SLEEP + SETTLE_MS + CLEAR_BEFORE_WAKE_MS - 60_000, 1, 1, createStream(7))).toEqual([]);
  });
});

// ── What she dreams on: only her own words ────────────────────────────────────────────────────

describe("pickSeeds", () => {
  it("PLANTED VIOLATION: told/read text can never seed a dream — outside words stay out", () => {
    const day = [
      seed({ id: 1, origin: "told", text: "他说明天把照片给我" }),
      seed({ id: 2, origin: "read", text: "书里的一句话" }),
      seed({ id: 3, origin: "lived", text: "傍晚那阵风" }),
      seed({ id: 4, origin: "thought", text: "我一直没想通的那件事" }),
    ];
    const picked = pickSeeds(day, day, createStream(3))!;
    expect(picked.length).toBeGreaterThanOrEqual(2);
    for (const s of picked) expect(["lived", "thought", "dreamt"]).toContain(s.origin);
    expect(picked.some((s) => s.text.includes("照片"))).toBe(false);
  });

  it("too little of her own to dream on is an honest null, not a padded dream", () => {
    expect(pickSeeds([seed({ id: 1 })], [], createStream(1))).toBeNull();
    expect(pickSeeds([seed({ id: 1, origin: "told" }), seed({ id: 2, origin: "read" })], [], createStream(1))).toBeNull();
  });

  it("an old dream can seed a new one, and seeds never repeat", () => {
    const day = [seed({ id: 1 }), seed({ id: 2, origin: "dreamt", text: "上次梦里那扇门" })];
    const picked = pickSeeds(day, day, createStream(5))!;
    const ids = picked.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── What survives toward morning ──────────────────────────────────────────────────────────────

describe("episodeCharge and survival", () => {
  it("a heavy episode crosses the bar; a flat one is forgotten by design", () => {
    expect(episodeCharge([seed({ tension: 0.9, valence: -0.8 })])).toBeGreaterThanOrEqual(SURVIVES_AT);
    expect(episodeCharge([seed({ tension: 0.1, valence: 0.1 })])).toBeLessThan(SURVIVES_AT);
    expect(episodeCharge([])).toBe(0);
  });
});

// ── One episode, end to end, with a fake render ───────────────────────────────────────────────

function harness(renderText: string | Error) {
  const diary: string[] = [];
  const encoded: { text: string; ms: number; charge: number }[] = [];
  const faults: string[] = [];
  const systems: string[] = [];
  const d = createDreaming({
    render: async (system) => {
      systems.push(system);
      if (renderText instanceof Error) throw renderText;
      return renderText;
    },
    appendDiary: (l) => diary.push(l),
    encodeDream: (text, ms, charge) => encoded.push({ text, ms, charge }),
    onFault: (where) => faults.push(where),
  });
  return { d, diary, encoded, faults, systems };
}

describe("runEpisode", () => {
  const NOW = Date.parse("2026-08-21T03:14:00");

  it("writes the dream into her diary with her clock and the（梦）mark", async () => {
    const text = "水从画板上流下来，我伸手去接，接住的是钟的声音。";
    const { d, diary, systems } = harness(text);
    const out = await d.runEpisode([seed({ tension: 0.2, valence: 0.1 })], NOW);
    expect(out.ok).toBe(true);
    // The whole line, via the same renderer production uses, format drift shows up here.
    expect(diary).toEqual([diaryLine(NOW, text)]);
    expect(diary[0]).toContain(`${herClock(NOW)} — （梦）`);
    // The instruction she dreams under is exactly the reviewed one (words row #399), verbatim.
    expect(systems).toEqual([DREAM_SYSTEM]);
  });

  it("a heavy dream survives toward morning and is encoded; a flat one touches nothing else", async () => {
    const heavy = harness("门开着，外面全是昨天。");
    await heavy.d.runEpisode([seed({ tension: 0.9, valence: -0.8 })], NOW);
    expect(heavy.encoded).toHaveLength(1);
    const flat = harness("一片很淡的颜色。");
    await flat.d.runEpisode([seed({ tension: 0.1, valence: 0 })], NOW);
    expect(flat.encoded).toHaveLength(0);
    expect(flat.diary, "forgotten by morning still means dreamt at night — the diary keeps it").toHaveLength(1);
  });

  it("garbage from the provider is refused before it can become her dream", async () => {
    const { d, diary, faults } = harness("<html><body>502 Bad Gateway</body></html>");
    const out = await d.runEpisode([seed()], NOW);
    expect(out.ok).toBe(false);
    expect(diary).toHaveLength(0);
    expect(faults[0]).toBe("dreaming.notProse");
  });

  it("a dead provider is a fault on the dreaming channel, never a crash in her night", async () => {
    const { d, faults } = harness(new Error("provider down"));
    const out = await d.runEpisode([seed()], NOW);
    expect(out.ok).toBe(false);
    expect(faults[0]).toBe("dreaming.render");
  });

  it("the render material is her fragments and nothing else", () => {
    const u = dreamUser([seed({ text: "傍晚那阵风" }), seed({ id: 2, text: "没写完的信" })]);
    expect(u).toContain("- 傍晚那阵风");
    expect(u).toContain("- 没写完的信");
  });
});

// ── A dream is not a claim (credence.ts carve-out) ────────────────────────────────────────────

describe("a dream is not a claim", () => {
  const trust = createTrust();

  it("PLANTED VIOLATION: an incoming dream that flatly opposes a lived memory disputes nothing", () => {
    const held = [{ id: 1, text: "钟是好的", origin: "lived" as const, credence: 0.8, similarity: 0.9 }];
    const j = judge({ text: "钟不是好的", origin: "dreamt" }, held, trust);
    expect(j.disputes, "a dream put tension on a real memory — the carve-out failed").toEqual([]);
    expect(j.supports).toEqual([]);
    expect(j.suspended).toBe(false);
    expect(j.credence).toBe(INITIAL_CREDENCE.dreamt);
    expect(j.trustDelta).toBe(0);
  });

  it("a held dream is not evidence either: nothing corroborates against it, nothing fights it", () => {
    const held = [{ id: 1, text: "门是开着的", origin: "dreamt" as const, credence: 0.7, similarity: 0.95 }];
    const agree = judge({ text: "门是开着的", origin: "told" }, held, trust);
    expect(agree.supports, "dreaming a thing must never corroborate hearing it").toEqual([]);
    const oppose = judge({ text: "门不是开着的", origin: "told" }, held, trust);
    expect(oppose.disputes).toEqual([]);
  });

  it("corroborationValue is zero on both sides of a dream", () => {
    expect(corroborationValue("dreamt", "lived")).toBe(0);
    expect(corroborationValue("told", "dreamt")).toBe(0);
  });

  it("a surfaced dream ALWAYS says it is a dream, even half-forgotten", () => {
    expect(describeStanding("dreamt", 0.7)).toBe("你梦见的，不是发生过的");
    expect(describeStanding("dreamt", 0.1)).toBe("你梦见的，连梦本身都记不太清了");
  });
});

// ── The morning ───────────────────────────────────────────────────────────────────────────────

describe("the morning line", () => {
  it("carries a trimmed quote of the dream, hers verbatim up to the cut", () => {
    const line = morningLine("门开着，外面全是昨天。");
    expect(line).toBe("你醒来还留着一点梦：「门开着，外面全是昨天。」。");
    const long = morningLine("很长".repeat(60));
    expect(/「[^」]{1,60}」/u.test(long)).toBe(true);
    expect(long).toContain("…");
  });
});

// ── The wiring, pinned with floors ────────────────────────────────────────────────────────────

describe("the night is wired into her daemon (source guards, all floored)", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the watch cycle plans the night once, at its doorstep", () => {
    const at = daemon.indexOf("planTonightsDreams(Date.now())");
    expect(at).toBeGreaterThan(-1);
  });

  it("an episode refuses to fire late (machine slept), in daylight, in safe mode, or disabled", () => {
    const at = daemon.indexOf("async function runDreamEpisode");
    expect(at).toBeGreaterThan(-1);
    const body = daemon.slice(at, at + 1200);
    expect(body).toContain("if (!config.life.dream?.enabled || safeMode) return;");
    // STALE_EPISODE_MS: five minutes late means the machine slept through it, no back-fill.
    expect(body).toContain("Date.now() - atMs > STALE_EPISODE_MS");
    expect(body).toContain("clock.isAwakeHour(Date.now())");
  });

  it("the remnant reaches both waking surfaces, first-come, and is lint-masked as hers", () => {
    const turn = daemon.indexOf("const dream = takeDreamRemnant(nowMs)");
    expect(turn).toBeGreaterThan(-1);
    expect(daemon.slice(turn, turn + 1600)).toContain("dream?.quoted");
    const moment = daemon.indexOf("dream: takeDreamRemnant(nowMs)?.line");
    expect(moment).toBeGreaterThan(-1);
  });

  it("a remembered dream enters her field only as dreamt", () => {
    const at = daemon.indexOf("encodeDream: (text, nowMs, chargeV)");
    expect(at).toBeGreaterThan(-1);
    expect(daemon.slice(at, at + 600)).toContain('origin: "dreamt"');
  });
});
