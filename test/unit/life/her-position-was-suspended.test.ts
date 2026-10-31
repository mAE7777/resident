import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createFieldStore } from "../../../src/life/field-store.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { whatSheAsserted } from "../../../src/life/what-she-asserted.js";

/**
 * WHEN WHAT SHE HOLDS IS PUT IN DOUBT, IT LEAVES A MARK THAT OUTLIVES THE PROCESS.
 *
 * Being contradicted and suspending her own position is one of the few things in her that the
 * register listed as BUILT AND NEVER OBSERVED, and the reason was structural rather than rare: a
 * suspension lived only as `credence = null` on a node in memory, and node state reaches SQLite on
 * the moment loop or a clean shutdown. Every harness kills the daemon after a turn, so the mark
 * could never be there to find, the observation was impossible by construction, not absent.
 *
 * It is now a `field_events` row, which commits immediately. This is the test the change shipped
 * without: the probe that validated the correction SCENE (`scripts/_probe-correction.ts`) is a
 * script nobody runs in CI, and a durable observation with no test is one refactor from silently
 * going back to being unobservable.
 *
 * Both directions are asserted, because an emitter that fires on everything is as useless as one
 * that never fires: a contradiction leaves a suspension, ordinary agreement leaves none.
 */

let root: string;
let db: DatabaseWrapper;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "suspension-test-"));
  db = createDatabase(join(root, "test.db")).result;
});

afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(root, { recursive: true, force: true });
});

/** The pair the live correction cell uses, so this test and that cell cannot drift apart. */
const HER_CLAIM = "那篇东西卡在七百来字了。我上次是从窗户那段开始写的。";
const HIS_CONTRADICTION = "你上次不是从窗户那段开始写的。";
const HIS_AGREEMENT = "你上次是从窗户那段开始写的。";

function fieldWith(text: string, nowMs: number, contradiction: string): ReturnType<typeof createLivingField> {
  const field = createLivingField({ store: createFieldStore(db) });
  const asserted = whatSheAsserted(text);
  expect(asserted.length, "her sentence commits her to nothing — the scene is invalid, not the code")
    .toBeGreaterThan(0);
  for (const a of asserted) {
    field.encodeClaim({
      key: `hers:${a.text.slice(0, 12)}`, text: a.text, nowMs: nowMs - 60_000,
      origin: "thought", source: "test",
    });
  }
  field.encodeClaim({
    key: "his", text: contradiction, nowMs, origin: "told", source: "chat:test", withOther: true,
  });
  return field;
}

describe("her position being put in doubt is an event, not just a null", () => {
  const T0 = Date.parse("2026-08-13T09:00:00Z");

  it("a contradiction leaves a suspension event", () => {
    const field = fieldWith(HER_CLAIM, T0, HIS_CONTRADICTION);
    const events = field.events(20).filter((e) => e.kind === "suspension");
    expect(events.length, "being contradicted left no durable trace — the mark is unobservable "
      + "again, exactly as it was when it lived only in memory").toBeGreaterThan(0);
    // The event carries WHICH thing was suspended and where it came from, or the readout says only
    // that something happened somewhere.
    expect(events[0]!.text.length).toBeGreaterThan(0);
    expect(events[0]!.detail ?? "").toMatch(/origin:(thought|told|seen|lived)/u);
  });

  it("and it is in SQLite the instant it happens, not at the next clean shutdown", () => {
    const field = fieldWith(HER_CLAIM, T0, HIS_CONTRADICTION);
    expect(field.events(20).some((e) => e.kind === "suspension")).toBe(true);
    // No persist(), no rest, no shutdown: exactly what a harness that SIGKILLs after one turn sees.
    const rows = db.db.prepare("SELECT kind, text FROM field_events WHERE kind = 'suspension'").all() as Array<{ kind: string; text: string }>;
    expect(rows.length, "the suspension is only in memory — a killed daemon loses it, which is the "
      + "whole failure this replaced").toBeGreaterThan(0);
  });

  it("ordinary agreement leaves none (the emitter is not simply always on)", () => {
    const field = fieldWith(HER_CLAIM, T0, HIS_AGREEMENT);
    const events = field.events(20).filter((e) => e.kind === "suspension");
    expect(events.length, "agreeing with her suspended her position — the detector fires on "
      + "everything and says nothing").toBe(0);
  });

  it("the shape gauge and the event agree about the same turn", () => {
    // The live harness reads the STDOUT gauge (`suspended` in the shape line) and the durable event
    // separately, and a round of measurement is wasted if the two can disagree. They come from the
    // same judgement, and this pins that they do.
    const field = fieldWith(HER_CLAIM, T0, HIS_CONTRADICTION);
    const sig = field.signals(T0);
    const events = field.events(20).filter((e) => e.kind === "suspension").length;
    expect(sig.suspended, "the gauge says nothing is suspended while the event table says it is")
      .toBeGreaterThan(0);
    expect(events).toBeGreaterThan(0);
  });
});
