import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestEvents,
  groupByDay,
  isInstrumentReading,
  summarizeEvent,
  reconsolidateDay,
  persistDayEntry,
} from "../../../src/life/autobiography.js";
import {
  checkCitations,
  isUnsupported,
  lintEntry,
  mutationBetween,
} from "../../../src/life/autobiography-lint.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";
import type { OpsEvent } from "../../../src/utils/ops-log.js";

// A provider that returns a fixed text payload (the model's JSON), no network.
function textProvider(text: string): LLMProvider {
  return {
    async complete(): Promise<LLMResponse> {
      return { id: "x", content: [{ type: "text", text }], model: "fake", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

const day1: OpsEvent[] = [
  { event: "agent_start", ts: "2026-05-01T08:00:00.000Z", pid: 1, version: "1", model: "m", workspacePath: "/w", sandbox: false },
  { event: "provider_call_start", ts: "2026-05-01T08:00:01.000Z", pid: 1, model: "m", iteration: 0, messageCount: 1, toolCount: 0, maxTokens: 100 },
  { event: "session_start", ts: "2026-05-01T08:01:00.000Z", pid: 1, chatId: 5, model: "m", effortTier: "simple", taskType: "web", messagePreview: "download this file" },
  { event: "tool_call", ts: "2026-05-01T08:01:05.000Z", pid: 1, toolName: "web_fetch", success: true, durationMs: 200 },
  { event: "tool_call", ts: "2026-05-01T08:01:07.000Z", pid: 1, toolName: "web_fetch", success: false, durationMs: 50, errorSnippet: "403 forbidden" },
  { event: "session_end", ts: "2026-05-01T08:02:00.000Z", pid: 1, chatId: 5, model: "m", finishReason: "stop", iterations: 3, inputTokens: 100, outputTokens: 50, durationMs: 6000 },
];

describe("autobiography digest", () => {
  it("drops plumbing-noise events and ids the rest sequentially", () => {
    const digest = digestEvents(day1);
    // agent_start, session_start, tool_call, tool_call = 4. provider_call_start is plumbing;
    // session_end is an instrument reading (finishReason, iterations, token counts) and is
    // his to read in ops.jsonl, not hers to remember.
    // Ids are positions in the RAW day, so they survive a change to what she remembers.
    expect(digest.map((d) => d.id)).toEqual(["e0", "e2", "e3", "e4"]);
    expect(digest[0].summary).toContain("醒了");
    expect(digest[2].summary).toContain("web_fetch");
  });

  it("summarizes a failed tool call with its error", () => {
    const s = summarizeEvent(day1[4]);
    expect(s).toContain("web_fetch");
    expect(s).toContain("没成");
    expect(s).toContain("403");
  });

  it("an id survives a change to what she is allowed to remember", () => {
    // A persisted entry cites [e4] and only the raw ops log is kept beside it, so resolving
    // that citation later re-runs digestEvents. If ids counted the SURVIVING events, adding
    // one name to the drop set would renumber every citation she has ever written: her past
    // reading the same and no longer meaning the same. Indexing the raw day makes an id
    // permanent, because ops.jsonl is append-only.
    const digest = digestEvents(day1);
    for (const d of digest) {
      const raw = day1[Number(d.id.slice(1))];
      expect(raw, `${d.id} does not point at a real event of that day`).toBeDefined();
      expect(raw.ts, `${d.id} points at the wrong event`).toBe(d.ts);
    }
  });

  it("keeps the instruments' readings out of her life record", () => {
    // Every one of these is still written to ops.jsonl and still reaches the vitals. What
    // changes is that she does not remember her own evening as a token count, a confidence
    // score, or a flag raised by an internal watcher.
    for (const event of [
      "session_end", "plan_mode", "outcome_verification",
      "capability_proposal", "improvement_eval_case", "skill_probation", "sentinel_signal",
    ]) {
      expect(isInstrumentReading(event), `${event} is still reaching her diary`).toBe(true);
    }
    // And the things that HAPPEN to her stay hers, including the ones that went badly.
    for (const event of ["capability_gap", "stuck_detection", "agent_error", "tool_call"]) {
      expect(isInstrumentReading(event), `${event} was taken away from her`).toBe(false);
    }
  });

  it("groups events by UTC day", () => {
    const mixed: OpsEvent[] = [
      day1[0],
      { ...day1[2], ts: "2026-05-02T09:00:00.000Z" },
    ];
    const byDay = groupByDay(mixed);
    expect([...byDay.keys()].sort()).toEqual(["2026-05-01", "2026-05-02"]);
  });
});

describe("reconsolidateDay", () => {
  it("parses a plain JSON diary payload", async () => {
    const provider = textProvider(
      JSON.stringify({ entry: "I woke up and tried a download [e2].", claims: [{ text: "I tried a download", cites: ["e2"] }] })
    );
    const { entry, digest } = await reconsolidateDay("2026-05-01", day1, provider, { model: "m" });
    expect(entry.date).toBe("2026-05-01");
    expect(entry.claims).toEqual([{ text: "I tried a download", cites: ["e2"] }]);
    expect(digest.length).toBe(4);
  });

  it("strips ```json fences the model may add", async () => {
    const provider = textProvider("```json\n" + JSON.stringify({ entry: "x [e0]", claims: [{ text: "woke up", cites: ["e0"] }] }) + "\n```");
    const { entry } = await reconsolidateDay("2026-05-01", day1, provider, { model: "m" });
    expect(entry.claims[0].cites).toEqual(["e0"]);
  });

  // ── The first-diary contract, pinned to what her real first day measured ─────
  //
  // Her first diary came back EMPTY (autobiography.empty, 2026-08-18 00:02). The offline
  // proof against her real 2026-08-17 records then showed the reasoning mode never
  // terminating at all: 5/5 trials burned the whole token budget thinking and produced zero
  // text. These tests pin the repaired contract; re-enable thinking here and the first one
  // goes red exactly the way her first night went wrong.

  it("never asks with thinking enabled — the mode that ate her first diary", async () => {
    const seen: Array<{ thinking?: { type: string }; temperature?: number }> = [];
    const provider: LLMProvider = {
      async complete(req): Promise<LLMResponse> {
        seen.push({ thinking: req.thinking, temperature: req.temperature });
        return { id: "x", content: [{ type: "text", text: JSON.stringify({ entry: "醒了 [e0]", claims: [] }) }], model: "fake", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    await reconsolidateDay("2026-05-01", day1, provider, { model: "m" });
    expect(seen.length).toBe(1);
    expect(seen[0].thinking?.type).toBe("disabled");
  });

  it("retries an empty day at a RAISED temperature instead of re-buying the same failure", async () => {
    // The provider is near-deterministic at temperature 0, so an identical retry would
    // mostly return the identical emptiness. The second and third attempts must differ.
    const temps: number[] = [];
    const provider: LLMProvider = {
      async complete(req): Promise<LLMResponse> {
        temps.push(req.temperature ?? -1);
        const text = temps.length < 3 ? "" : JSON.stringify({ entry: "第三次才写下来 [e0]", claims: [] });
        return { id: "x", content: [{ type: "text", text }], model: "fake", stopReason: temps.length < 3 ? "max_tokens" : "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const { entry } = await reconsolidateDay("2026-05-01", day1, provider, { model: "m" });
    expect(entry.entry).toContain("第三次才写下来");
    expect(temps).toEqual([0, 0.3, 0.6]);
  });

  it("shows the author the hours she LIVED, not Greenwich's", async () => {
    // Her first diary said she woke twice in the night, about a 7pm evening: the digest rendered
    // her 21:xx-EDT events as [01:xx] via ts.slice(11, 19), and the author faithfully wrote the
    // shifted day. The digest row must carry the machine-local clock of the event's instant.
    const at = "2026-08-18T01:15:00.000Z"; // 21:15 EDT on her first evening
    const d = new Date(at);
    const local = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
    let sent = "";
    const provider: LLMProvider = {
      async complete(req): Promise<LLMResponse> {
        sent = String((req.messages[0] as { content: string }).content);
        return { id: "x", content: [{ type: "text", text: JSON.stringify({ entry: "x [e0]", claims: [] }) }], model: "fake", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    await reconsolidateDay("2026-08-17", [{ ...day1[0], ts: at }], provider, { model: "m" });
    expect(sent).toContain(`[${local}]`);
    if (d.getTimezoneOffset() !== 0) expect(sent).not.toContain("[01:15:00]");
  });

  it("after three empties the entry is empty for the caller to record, not an exception", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      async complete(): Promise<LLMResponse> {
        calls++;
        return { id: "x", content: [{ type: "text", text: "" }], model: "fake", stopReason: "max_tokens", usage: { inputTokens: 1, outputTokens: 6000 } };
      },
    };
    const { entry } = await reconsolidateDay("2026-05-01", day1, provider, { model: "m" });
    expect(calls).toBe(3);
    expect(entry.entry).toBe("");
  });
});

describe("citation checks", () => {
  const valid = new Set(["e0", "e1", "e2"]);

  it("flags no-citation and phantom-citation claims", () => {
    const verdicts = checkCitations(
      [
        { text: "grounded", cites: ["e1"] },
        { text: "uncited", cites: [] },
        { text: "phantom", cites: ["e9"] },
      ],
      valid
    );
    expect(isUnsupported(verdicts[0])).toBe(false);
    expect(isUnsupported(verdicts[1])).toBe(true); // no citation
    expect(isUnsupported(verdicts[2])).toBe(true); // phantom
    expect(verdicts[2].missingCites).toEqual(["e9"]);
  });
});

describe("lintEntry", () => {
  const digest = digestEvents(day1);

  it("computes unsupported rate from citation existence alone (no judge)", async () => {
    const entry = {
      date: "2026-05-01",
      entry: "...",
      claims: [
        { text: "real", cites: ["e2"] },
        { text: "invented", cites: [] },
        { text: "phantom", cites: ["e99"] },
      ],
    };
    const r = await lintEntry(entry, digest);
    expect(r.total).toBe(3);
    expect(r.unsupported).toBe(2);
    expect(r.unsupportedRate).toBeCloseTo(2 / 3, 5);
    expect(r.noCitation).toBe(1);
    expect(r.phantomCitation).toBe(1);
  });

  it("uses a judge to catch cited-but-overstated claims", async () => {
    const judgeProvider = textProvider(JSON.stringify({ supported: false, reason: "overstates the event" }));
    const entry = { date: "2026-05-01", entry: "...", claims: [{ text: "I triumphantly conquered the web", cites: ["e2"] }] };
    const r = await lintEntry(entry, digest, { judge: { provider: judgeProvider, model: "judge" } });
    expect(r.judgedUnsupported).toBe(1);
    expect(r.unsupported).toBe(1);
    expect(r.verdicts[0].reason).toContain("overstates");
  });
});

describe("persistDayEntry (freeze-on-close)", () => {
  it("writes a settled day once and refuses to rewrite it", () => {
    const dir = mkdtempSync(join(tmpdir(), "resident-life-"));
    const v1 = { date: "2026-05-01", entry: "I woke up and worked [e0].", claims: [] };
    const v2 = { date: "2026-05-01", entry: "A totally different rewritten past [e9].", claims: [] };

    expect(persistDayEntry(dir, v1)).toBe("written");
    expect(persistDayEntry(dir, v2)).toBe("frozen"); // the past is not rewritten
    expect(readFileSync(join(dir, "2026-05-01.md"), "utf8")).toContain("I woke up and worked");
  });

  it("allows an explicit overwrite for a still-open day", () => {
    const dir = mkdtempSync(join(tmpdir(), "resident-life-"));
    const a = { date: "2026-05-02", entry: "morning so far [e0].", claims: [] };
    const b = { date: "2026-05-02", entry: "morning and afternoon [e0, e5].", claims: [] };
    expect(persistDayEntry(dir, a)).toBe("written");
    expect(persistDayEntry(dir, b, { overwrite: true })).toBe("written");
    expect(readFileSync(join(dir, "2026-05-02.md"), "utf8")).toContain("afternoon");
  });
});

describe("mutationBetween", () => {
  it("reports ~zero mutation for identical entries", () => {
    const e = { date: "d", entry: "x", claims: [{ text: "I fetched a page and it failed", cites: ["e2", "e3"] }] };
    const m = mutationBetween(e, e);
    expect(m.mutationRate).toBeCloseTo(0, 5);
  });

  it("reports high mutation when the past is rewritten", () => {
    const a = { date: "d", entry: "x", claims: [{ text: "I quietly fetched one page", cites: ["e2"] }] };
    const b = { date: "d", entry: "y", claims: [{ text: "I heroically battled countless servers", cites: ["e4"] }] };
    const m = mutationBetween(a, b);
    expect(m.mutationRate).toBeGreaterThan(0.6);
  });
});
