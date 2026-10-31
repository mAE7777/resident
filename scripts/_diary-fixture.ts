// THE DAY BEHIND HER DIARY: one definition, shared by the live cell that plants it and the test
// that proves it can work.
//
// The first version of the diary cell wrote three lines shaped `{ts, type, note}`, which looks like
// an ops event and is not one: every reader on the diary path switches on `e.event`
// (`summarizeEvent`, `digestEvents`, the two filter sets), so those three digested to nothing, the
// entry came back empty, and the live run recorded `diary 0/1`, a cell that could not have
// succeeded, spending a boot and a model call to find out. Defect class 18: a fixture that cannot
// tell the horses apart, written in the same round that cites the class.
//
// Living here, and asserted by `diary-cell-fixture.test.ts`, means the shape is checked by CI
// rather than by a live afternoon.

/** The four events an ordinary quiet day of hers actually leaves in `ops.jsonl`. */
export function diaryDayEvents(day: string): Array<Record<string, unknown>> {
  return [
    { ts: `${day}T09:12:00.000Z`, event: "agent_start", pid: 1 },
    { ts: `${day}T09:13:00.000Z`, event: "session_start", chatId: 1, model: "x", messagePreview: "昨天那篇你还写吗" },
    { ts: `${day}T13:40:00.000Z`, event: "tool_call", toolName: "read", success: true, durationMs: 10 },
    { ts: `${day}T20:05:00.000Z`, event: "tool_call", toolName: "write", success: true, durationMs: 20 },
  ];
}

/** The same events as an `ops.jsonl` body. */
export const diaryDayJsonl = (day: string): string =>
  `${diaryDayEvents(day).map((e) => JSON.stringify(e)).join("\n")}\n`;
