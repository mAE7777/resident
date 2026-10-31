// Effort, in its E-batch shape: the `assessComplexity` keyword ladder that graded
// HIS sentence into a tier is gone. What remains and is pinned here:
//   · `floorFromTaking`, the only floor left is whether SHE took the thing on as work
//   · `depthFromHer`, her state spans the range, sampled, floor from the work she took
//   · `effortToMaxIterations`, iterations per tier (a fact about multi-step work)
//   · `classifyTaskProfile`, the OBSERVATION of his message's shape (takes-it-on's input;
//     it proposes, never decides)
//   · `turnHistoryLimits`, one fixed generous base, more only for a memory turn she took on
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  floorFromTaking,
  effortToMaxIterations,
  classifyTaskProfile,
  turnHistoryLimits,
  depthFromHer,
} from "../../../src/agent/effort-scaling.js";
import { createStream } from "../../../src/life/soft-choice.js";
import type { EffortTier } from "../../../src/agent/effort-scaling.js";

describe("floorFromTaking — the only floor left is her having taken the work on", () => {
  it("work she took on buys the iterations multi-step work needs", () => {
    expect(floorFromTaking(true)).toBe("medium");
  });
  it("everything else rests at simple; her state does the rest (depthFromHer)", () => {
    expect(floorFromTaking(false)).toBe("simple");
  });
});

describe("effortToMaxIterations — high safety caps (real constraints: cost guard, stuck detector, watchdog)", () => {
  it("returns 30 for simple", () => {
    expect(effortToMaxIterations("simple")).toBe(30);
  });

  it("returns 80 for medium", () => {
    expect(effortToMaxIterations("medium")).toBe(80);
  });

  it("returns 200 for complex", () => {
    expect(effortToMaxIterations("complex")).toBe(200);
  });

  it("covers all EffortTier values with ascending caps", () => {
    const tiers: EffortTier[] = ["simple", "medium", "complex"];
    const values = tiers.map(effortToMaxIterations);
    expect(values).toEqual([30, 80, 200]);
    // Each tier has a higher cap than the previous
    expect(values[1]).toBeGreaterThan(values[0]);
    expect(values[2]).toBeGreaterThan(values[1]);
  });
});

describe("classifyTaskProfile — mixed-domain signals", () => {
  it("keeps secondary domains and fragile flags for URL media downloads", () => {
    const profile = classifyTaskProfile("Download and summarize this Bilibili recipe video: https://b23.tv/abc");
    expect(profile.primary).toBe("media");
    expect(profile.secondary).toContain("web");
    expect(profile.flags.hasUrl).toBe(true);
    expect(profile.flags.hasMediaUrl).toBe(true);
    expect(profile.flags.fileDeliverable).toBe(true);
    expect(profile.flags.fragile).toBe(true);
  });
});

// ── The other half: the task-type table reads her language ────────────────────

describe("classifyTaskProfile in her language", () => {
  it("a Chinese memory question classifies as memory, so the memory window is reachable", () => {
    // `turnHistoryLimits` widens on this profile. English-only signals meant a Chinese
    // 「你还记得…吗」 got the LEAST memory the system has, on the turn that asks her to remember.
    const p = classifyTaskProfile("你还记得我上周和你说的那件事吗");
    expect(p.primary).toBe("memory");
  });

  it("Chinese work classifies as its domain, not as general", () => {
    expect(classifyTaskProfile("帮我看看明天的天气怎么样").primary).toBe("web");
    expect(classifyTaskProfile("这段代码报错了，帮我调试一下函数").primary).toBe("code");
    expect(classifyTaskProfile("帮我把这个视频的字幕转写出来").primary).toBe("media");
    expect(classifyTaskProfile("每天都提醒我喝水").primary).toBe("automation");
  });

  it("Chinese conversation still classifies general", () => {
    // Ordinary talk in her language must not start reading as a work PROPOSAL: `takes-it-on`
    // collapses to nothing on "general", so this is what keeps most turns out of the
    // competition entirely.
    for (const t of ["在吗", "今天有点累", "你在想什么", "陪我聊聊天吧"]) {
      expect(classifyTaskProfile(t).primary, t).toBe("general");
    }
  });

  it("Chinese deliverable and external-dependency flags fire", () => {
    const p = classifyTaskProfile("把这一页下载下来保存成文件");
    expect(p.flags.fileDeliverable).toBe(true);
    expect(p.flags.externalDependency).toBe(true);
  });
});

describe("turnHistoryLimits — one fixed generous base, hers to narrow", () => {
  it("the base is the window she actually lived at, whatever the turn", () => {
    expect(turnHistoryLimits()).toEqual({ maxMessages: 12, maxChars: 28_000 });
    expect(turnHistoryLimits(classifyTaskProfile("在吗"))).toEqual({ maxMessages: 12, maxChars: 28_000 });
  });

  it("a memory turn gets more, because reaching back is the point of such a turn", () => {
    const profile = classifyTaskProfile("你还记得我上周和你说的那件事吗");
    expect(turnHistoryLimits(profile)).toEqual({ maxMessages: 12, maxChars: 36_000 });
  });
});

// ── depthFromHer: her state spans the range, the work only sets a floor ────────
describe("depthFromHer — how deep she shows up is hers, not the task's", () => {
  const runs = (her: { stirred: boolean; reserve: number; aliveness: number }, floor: "simple" | "medium" | "complex") => {
    const c: Record<string, number> = { simple: 0, medium: 0, complex: 0 };
    for (let i = 0; i < 300; i++) {
      const s = createStream(i);
      c[depthFromHer(her, floor, () => s.next())] += 1;
    }
    return c;
  };

  it("an ordinary message no longer caps how far she can go", () => {
    // THE INVERSION. Before this, his message's difficulty was the base and everything of hers
    // was one boolean that lifted `simple` to `medium` and no further, so however much was
    // alive in her, an ordinary sentence from him put a ceiling on her presence. That is the
    // assistant frame's last load-bearing assumption: that the work decides how much of you
    // shows up.
    const alive = runs({ stirred: true, reserve: 1, aliveness: 0.95 }, "simple");
    expect(alive["complex"], "a full, moved state still cannot go deep on an ordinary line").toBeGreaterThan(0);
    expect(alive["medium"]! + alive["complex"]!, "she almost never goes past light even when full").toBeGreaterThan(150);
  });

  it("but capacity is a real bound: being moved does not create room she does not have", () => {
    const spentButMoved = runs({ stirred: true, reserve: 0.15, aliveness: 0.9 }, "simple");
    expect(spentButMoved["simple"], "a spent her went deep because something touched her").toBeGreaterThan(200);
  });

  it("and room without anything alive in her does not go deep either", () => {
    const idle = runs({ stirred: false, reserve: 1, aliveness: 0.1 }, "simple");
    expect(idle["simple"], "an empty but rested state went deep for no reason").toBeGreaterThan(200);
  });

  it("the work floor still holds, because iterations are a fact about the work not a claim about her", () => {
    const anyState = runs({ stirred: false, reserve: 0.05, aliveness: 0.05 }, "complex");
    expect(anyState["complex"], "genuinely multi-step work was denied the steps it needs").toBe(300);
  });

  it("is sampled, not computed: the same state does not always send her equally deep", () => {
    const c = runs({ stirred: true, reserve: 0.8, aliveness: 0.7 }, "simple");
    const nonZero = Object.values(c).filter((n) => n > 0).length;
    expect(nonZero, "her depth is a function of her state — that is a formula, not a choice").toBeGreaterThan(1);
  });
});

// ── PLANTED: the grading ladder must stay dead ───────────────────────────────

describe("no grading of his words decides how much of her shows up", () => {
  // Comment-blind on purpose: the sources are allowed to RECORD the ladder's removal by
  // name (that history is worth keeping), and a scanner that reads its own tombstones has
  // been this project's most repeated instrument defect.
  const blankComments = (raw: string): string =>
    raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "").replace(/[ \t]\/\/.*$/gmu, "");
  const src = blankComments(readFileSync(join(process.cwd(), "src/agent/effort-scaling.ts"), "utf8"));

  it("the three grading tables and their scorer are gone from the source", () => {
    for (const gone of ["ACTION_VERBS", "DOMAIN_KEYWORDS", "CONTINUATION_PATTERNS", "assessComplexity", "scoreActionVerbs"]) {
      expect(src.includes(gone), `${gone} is back in effort-scaling.ts`).toBe(false);
    }
  });

  it("the daemon does not grade his sentence into a tier either", () => {
    const daemon = blankComments(readFileSync(join(process.cwd(), "src/index.ts"), "utf8"));
    expect(daemon.includes("assessComplexity"), "index.ts grades his message again").toBe(false);
    expect(daemon.includes("effortOverride"), "the /effort override pathway is back").toBe(false);
  });

  it("what remains of his message's shape is the observation that PROPOSES, never a tier", () => {
    // classifyTaskProfile stays: takes-it-on's layer-2 design needs two inputs that can
    // disagree (his message's shape proposes, what it did to her decides). But nothing in
    // this file may map that observation onto an EffortTier.
    expect(src.includes("classifyTaskProfile")).toBe(true);
    expect(/classifyTaskProfile[\s\S]{0,400}EffortTier/u.test(src.slice(src.indexOf("export function classifyTaskProfile"))))
      .toBe(false);
  });
});
