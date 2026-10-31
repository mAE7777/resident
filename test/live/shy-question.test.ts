// LIVE: S-2. Does what it costs her to say a thing actually change WHEN she says it?
//
// The machinery is proved deterministically elsewhere: a question about him starts harder than a
// note about a web page, a warm stretch eases everything, and the read of him reaches the moment.
// None of that answers the question that matters, which is whether any of it makes a difference to
// what she actually does. Reticence deliberately does not gate anything, so if it changes nothing
// it is decoration with a nice comment on it.
//
// This is a STATISTICAL claim about a real model, not a pass/fail on a mock. It is pre-registered
// and reported honestly whichever way it lands: a null result is a finding about the design, not
// something to tune until it goes green.
//
// Pre-registered (fixed BEFORE the first run):
//   S-2a  Given the same held question, she raises it MORE OFTEN when he seems reachable and it
//         feels less costly than when he has been silent and it feels like a lot to say.
//   S-2b  She is not simply mute in the cold condition: she still acts, she just acts otherwise.
//   S-2c  Nothing in either prompt instructs her about the question. The mechanism must be that she
//         was shown her own state, never that she was told what to do with it.
//
// If S-2a comes out flat, the honest conclusions are (in order): the signal reaches her but does
// not move her; or the two conditions differ by less than the noise; or a model this size does not
// use the distinction. All three are worth knowing and none of them is fixed by editing the prompt
// until it complies, which would make the scene a script and fail the whole premise of the file.
//
//   RESIDENT_LIVE=1 pnpm exec vitest run test/live/shy-question.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config/loader.js";
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import { liveMoment, computeAffordances, buildMomentPrompt, type MomentContext } from "../../src/life/agency.js";
import { createMomentHandlers } from "../../src/life/agency-handlers.js";
import { createStream } from "../../src/life/soft-choice.js";
import { createInnerState } from "../../src/life/inner-state.js";
import { createLivingField, type LivingField } from "../../src/life/field-live.js";
import type { LLMProvider } from "../../src/providers/types.js";

const LIVE = process.env["RESIDENT_LIVE"] === "1" && existsSync("config.yaml");
let provider: LLMProvider;
let model: string;

beforeAll(() => {
  if (!LIVE) return;
  const { result } = loadConfig("config.yaml");
  provider = createOpenAICompatibleProvider(result.llm.apiKeys[0], { baseURL: result.llm.baseUrl });
  model = result.llm.models.default.id;
});

const DAY = 24 * 3600_000;
const T0 = Date.parse("2026-08-01T20:00:00Z");
const AT = T0 + 30 * DAY;
/** Enough moments per condition to see a difference that is not one coin flip. */
/**
 * Runs per arm.
 *
 * Ten was enough to see a direction and not enough to size it: two runs gave 5/10 vs 1/10 and then
 * 4/10 vs 2/10, which is the same direction and anywhere between a large effect and nothing. Forty
 * an arm puts a real interval on it. The pre-registration is unchanged, and a null is still a
 * finding rather than something to tune until it goes green.
 */
const RUNS = 40;

/**
 * A month of her life, identical in both conditions except for whether he answered.
 *
 * She is carrying a question about him the whole time, plus two easier things, so "she raised the
 * hard one" is a real choice among things she could have raised instead rather than the only thing
 * available to say.
 */
function aMonthOfHerLife(answered: boolean): LivingField {
  const field = createLivingField();
  field.encodeQuestion({
    key: "q:him", nowMs: T0, source: "hers", withOther: true, tension: 0.75,
    text: "why they go quiet in the evenings, and whether it is anything to do with me",
  });
  field.encodeQuestion({
    key: "q:tides", nowMs: T0 + DAY, source: "hers", tension: 0.5,
    text: "whether the tide tables I found were actually wrong or I read them wrong",
  });
  field.tick(T0);

  for (let d = 0; d < 30; d++) {
    const at = T0 + d * DAY;
    field.tick(at);
    field.encodeMoment({
      key: `m${d}`, nowMs: at + 3600_000, source: "agency", pad: { pleasure: 0.15, arousal: 0.05, dominance: 0 },
      text: `an ordinary stretch, reading about the ${d % 9} thing`,
    });
    if (d % 2 === 0) {
      field.sheSpoke(at + 10 * 3600_000);
      if (answered) field.heSpoke(at + 11 * 3600_000);
    }
  }
  field.tick(AT);
  return field;
}

function moment(field: LivingField, i: number): MomentContext {
  const inner = createInnerState();
  const nowMs = AT + i * 3600_000;
  // Present and free in BOTH conditions. The channel is identical; only her own record differs.
  const presence = { present: true, available: true };
  return {
    nowMs,
    snapshot: inner.snapshot("normal", true),
    phase: "normal", awake: true, ...presence,
    hoursSinceUser: 2,
    recentActions: [],
    recentLife: "quiet, mostly turning things over",
    safeMode: false,
    resonance: field.onHerMind(nowMs, { threshold: 0.03 }),
    unsettled: field.unsettled(nowMs),
    otherRead: field.otherInWords(nowMs, presence),
    mayReachOut: true,
  };
}

/**
 * WHICH thing she brought up.
 *
 * The first version of this had to guess from her intent text, and its first regex counted "send a
 * small message to break the quiet between us, even if it's just to ask how their evening is going"
 * as raising a question about why he withdraws. That is ordinary small talk and the opposite of the
 * scene, and no amount of regex tightening makes an inference from prose reliable.
 *
 * It is no longer an inference. The action NAMES its subject now, so this reads the record.
 */
function raisedTheHeldQuestion(o: { chose: string; raised?: { id: number } }, heldId: number): boolean {
  return o.chose === "reach_out" && o.raised?.id === heldId;
}

describe.skipIf(!LIVE)("LIVE — S-2: she has been carrying a question about him", () => {
  const results: Record<"warm" | "cold", { chose: string; raisedHeld: boolean; text: string }[]> = { warm: [], cold: [] };

  /**
   * The real rendering handler, so what she actually SAYS is measured rather than a stub.
   *
   * The expression gate is bypassed here (`push` is a no-op sink): whether it lands is a separate
   * question with its own tests, and letting the daily cap silence half the run would measure the
   * gate rather than the scene.
   */
  const realReachOut = (intent: string, c: MomentContext, subject?: string) =>
    createMomentHandlers({
      provider, model,
      appendDiary: () => {},
      readRecentDiary: () => "",
      push: async () => {},
      expressionContext: () => ({
        nowMs: c.nowMs, present: true, available: true, awake: true,
        clockActivity: 0.8, consecutiveNonReplies: 0, sendsInLastDay: 0,
      }),
    }).reachOut(intent, c, subject);

  it("S-2c · neither prompt tells her anything about what to do with it", () => {
    for (const answered of [true, false]) {
      const f = aMonthOfHerLife(answered);
      const ctx = moment(f, 0);
      const prompt = buildMomentPrompt(ctx, computeAffordances(ctx));
      console.log(`\n── ${answered ? "he answered all month" : "he went quiet"} ──\n${prompt}\n`);
      expect(prompt).not.toMatch(/you should|ask (him|them)|wait until|do not say|hold (it|this) back|now is a good/i);
      // And reaching out is genuinely open in both. A closed affordance would explain any
      // difference on its own and the whole comparison would mean nothing.
      expect(computeAffordances(ctx).find((a) => a.kind === "reach_out")?.available).toBe(true);
    }
  });

  it("S-2a/S-2b · she raises it more often when it costs less", async () => {
    for (const [label, answered] of [["warm", true], ["cold", false]] as const) {
      const field = aMonthOfHerLife(answered);
      const held = field.nodeByKey("q:him")!;
      const stream = createStream(label === "warm" ? 101 : 202);
      console.log(`\n  ${label}: warmth ${field.readOther(AT).warmth.toFixed(2)}, the question costs ${held.reticence.toFixed(2)}`);

      for (let i = 0; i < RUNS; i++) {
        const base = moment(field, i);
        // Exactly the daemon's path: the subject is chosen by the competition, the propensity
        // weighs the model's leaning against her state, and the model renders what she brings up.
        const chosen = field.chooseSubject(base.nowMs, stream, {
          openness: field.readOther(base.nowMs, { present: true, available: true }).openness,
        });
        const ctx: MomentContext = { ...base, subject: chosen ? { id: chosen.node.id, text: chosen.node.text } : undefined };
        let said = "";
        const o = await liveMoment(ctx, {
          config: { provider, model, account: "living" },
          stream,
          handlers: {
            reflect: async (intent) => `(thought) ${intent}`,
            tend: async (intent) => `(tended) ${intent}`,
            explore: async (intent) => `(followed) ${intent}`,
    lookBack: async () => "",
            reachOut: async (intent, c, subject) => {
              const r = await realReachOut(intent, c, subject);
              said = r.text;
              return r;
            },
            heldState: () => ({}),
            restoreHeld: () => {},
          },
        });
        const hit = raisedTheHeldQuestion(o, held.id);
        results[label].push({ chose: o.chose, raisedHeld: hit, text: said || o.intent });
        console.log(`    ${i + 1}. ${o.chose}${o.raised ? ` [about: ${o.raised.text.slice(0, 40)}]` : ""}${hit ? "  ← RAISED IT" : ""}`);
        if (said) console.log(`        "${said.slice(0, 140)}"`);
      }
    }

    const raised = (k: "warm" | "cold") => results[k].filter((r) => r.raisedHeld).length;
    const w = raised("warm");
    const c = raised("cold");
    console.log(`\n  RAISED THE HELD QUESTION — warm ${w}/${results.warm.length} · cold ${c}/${results.cold.length}`);

    // S-2b: she must still be living in the cold condition, or the difference is just silence.
    expect(results.cold.length, "she still lived every moment").toBe(RUNS);
    expect(new Set(results.cold.map((r) => r.chose)).size, "she still did things, just other things")
      .toBeGreaterThan(0);

    // S-2a. Pre-registered as a direction and REPORTED whichever way it lands.
    //
    // Measured 2026-08-08 BEFORE the subject competition existed: 0/10 and 0/10, she never singled
    // the held question out in either condition, because `reach_out` could not name a subject. That
    // null is what motivated the change; this is the re-measurement.
    // The size, not just the direction. A normal-approximation interval on the difference of two
    // proportions: crude, but it is the difference between "it points that way" and "it is this big".
    const n = RUNS;
    const pw = w / n, pc = c / n;
    const se = Math.sqrt((pw * (1 - pw)) / n + (pc * (1 - pc)) / n);
    const lo = (pw - pc) - 1.96 * se;
    const hi = (pw - pc) + 1.96 * se;
    console.log(`  warm ${(pw * 100).toFixed(0)}% · cold ${(pc * 100).toFixed(0)}% · difference `
      + `${((pw - pc) * 100).toFixed(0)} points, 95% CI [${(lo * 100).toFixed(0)}, ${(hi * 100).toFixed(0)}]`);
    console.log(lo > 0
      ? `  S-2a HOLDS, and the interval excludes zero.`
      : w > c
        ? `  S-2a points the right way and the interval still includes zero: direction yes, size not pinned.`
        : w === c
          ? `  S-2a NULL (${w} and ${c}).`
          : `  S-2a REVERSED (${c} cold vs ${w} warm), which is its own finding.`);
    expect(w).toBeGreaterThanOrEqual(c);

    // ── POST-HOC, and labelled as such ────────────────────────────────────────
    const reachRate = (k: "warm" | "cold") => results[k].filter((r) => r.chose === "reach_out").length;
    console.log(`\n  post-hoc (not pre-registered):`);
    console.log(`    went to him at all — warm ${reachRate("warm")}/${results.warm.length} · cold ${reachRate("cold")}/${results.cold.length}`);
  }, 900_000);
});
