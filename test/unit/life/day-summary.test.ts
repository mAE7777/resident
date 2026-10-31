import { describe, it, expect } from "vitest";
import { daySummaryFromEvents } from "../../../src/life/day-summary.js";
import type { OpsEvent } from "../../../src/utils/ops-log.js";

const evs: OpsEvent[] = [
  { event: "session_end", ts: "2026-05-01T14:00:00.000Z", pid: 1, chatId: 1, model: "m", finishReason: "stop", iterations: 1, inputTokens: 1, outputTokens: 1, durationMs: 1 },
  { event: "agent_error", ts: "2026-05-01T14:05:00.000Z", pid: 1, errorMessage: "boom" },
  { event: "tool_call", ts: "2026-05-01T14:06:00.000Z", pid: 1, toolName: "web_fetch", success: false, durationMs: 1 },
  { event: "stuck_detection", ts: "2026-05-01T14:07:00.000Z", pid: 1, pattern: "repeat_error", interventionCount: 2, noveltyFallbackInjected: false, triggerSource: "tool_stuck" },
  { event: "skill_extracted", ts: "2026-05-01T14:08:00.000Z", pid: 1, skillName: "s", version: 1, hash: "h", fromTask: "t", toolCount: 1 },
  { event: "capability_gap", ts: "2026-05-01T14:09:00.000Z", pid: 1, reason: "gap", toolSequence: ["a"] },
  { event: "session_start", ts: "2026-05-01T23:30:00.000Z", pid: 1, chatId: 1, model: "m", effortTier: "s", taskType: "web", messagePreview: "x" },
];

describe("daySummaryFromEvents", () => {
  it("counts outcomes, errors, stuck, skills, and novelty from real events", () => {
    const s = daySummaryFromEvents(evs, { hoursSinceUser: 5, timezoneOffsetHours: 0 });
    expect(s.successes).toBe(1); // session_end
    expect(s.failures).toBe(2); // agent_error + failed tool_call
    expect(s.stuck).toBe(1);
    expect(s.skills).toBe(1);
    expect(s.anomalies).toBe(1); // agent_error
    expect(s.novelty).toBeGreaterThan(0); // capability_gap
    expect(s.hoursSinceUser).toBe(5);
  });

  it("flags late-night activity by local hour", () => {
    // 23:30 UTC is late even at tz 0; at tz -1 it becomes 22:30 (not late).
    expect(daySummaryFromEvents([evs[6]], { timezoneOffsetHours: 0 }).lateNight).toBe(true);
    expect(daySummaryFromEvents([evs[0]], { timezoneOffsetHours: 0 }).lateNight).toBe(false); // 14:00
  });

  it("marks a sparse day restful", () => {
    expect(daySummaryFromEvents([evs[0]]).restful).toBe(true);
    expect(daySummaryFromEvents(evs).restful).toBe(false); // 6 meaningful events
  });
});
