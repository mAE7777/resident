import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { digestEvents, groupByDay, summarizeEvent } from "../../../src/life/autobiography.js";
import { diaryDayEvents, diaryDayJsonl } from "../../../scripts/_diary-fixture.js";

/**
 * THE DIARY CELL'S FIXTURE CAN ACTUALLY PRODUCE A DIARY.
 *
 * The live cell plants a day in `ops.jsonl` and waits for her to close it before he speaks. Its
 * first version planted `{ts, type, note}`, a shape nobody writes and nobody reads. Every reader
 * on the path switches on `e.event`, so the planted day digested to nothing, the entry came back
 * empty, and the run recorded `diary 0/1`: not a finding about her, a fixture that could not have
 * worked, discovered by spending a live boot and a model call on it.
 *
 * This is the offline gate that makes that impossible to repeat, and it checks the three conditions
 * `writeClosedDay` actually imposes, the shape digests, the day has at least three events, and
 * every summary says something, rather than checking that the file parses as JSON.
 */
describe("the day the diary cell plants is a day she could write about", () => {
  const DAY = "2026-08-12";
  const events = diaryDayEvents(DAY);

  it("digests to real summaries, not to blanks", () => {
    const digest = digestEvents(events as never);
    expect(digest.length, "the planted events were dropped by the noise/instrument filters")
      .toBeGreaterThanOrEqual(3);
    for (const d of digest) {
      expect(d.summary.trim().length, `${d.id} digests to nothing — the model would be shown a blank`)
        .toBeGreaterThan(1);
      // A summary that is just the raw event name is `summarizeEvent`'s default branch, which is
      // exactly what an unrecognised shape produces. That is the failure this file exists for.
      expect(["agent_start", "session_start", "tool_call", "undefined"],
        `${d.id} fell through to the default branch — the event shape is not one production writes`)
        .not.toContain(d.summary.trim());
    }
  });

  it("meets writeClosedDay's own bar: one day, at least three events", () => {
    const byDay = groupByDay(events as never);
    expect([...byDay.keys()]).toEqual([DAY]);
    expect(byDay.get(DAY)!.length, "too thin a day to be worth authoring — writeClosedDay skips it")
      .toBeGreaterThanOrEqual(3);
  });

  it("every planted event is one summarizeEvent knows by name", () => {
    for (const e of events) {
      const s = summarizeEvent(e as never);
      expect(s, `${String(e["event"])} is not a case in summarizeEvent`).not.toBe(e["event"]);
    }
  });

  it("and the harness plants exactly this, from this file", () => {
    // One definition. A second copy in the harness is how the shapes drifted apart in the first
    // place, and it drifted silently because only a live run could see it.
    const harness = readFileSync(join(process.cwd(), "scripts/four-cells-live.ts"), "utf8");
    expect(harness).toMatch(/diaryDayJsonl\(day\)/u);
    expect(harness, "the harness is building its own ops lines again").not.toMatch(/type: "observation"/u);
    expect(diaryDayJsonl(DAY).trim().split("\n").length).toBe(events.length);
  });
});
