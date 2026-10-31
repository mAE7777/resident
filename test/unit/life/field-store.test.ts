import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createFieldStore } from "../../../src/life/field-store.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { addNode, createGraph, link, neighbours, RETICENCE_BASE } from "../../../src/life/field.js";
import { createFaultLog } from "../../../src/life/faults.js";
import type { PAD } from "../../../src/life/emotion.js";

// Persistence. If her associations do not survive a restart she wakes every morning with no past,
// and the whole layer is theatre. The tests that matter here are the round trip, the fact that
// warmth (what she was half-thinking about) survives too, and that a corrupt row is REPORTED rather
// than crashing her boot or being silently dropped.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const pad = (p: number, a: number): PAD => ({ pleasure: p, arousal: a, dominance: 0 });

let root: string;
let db: DatabaseWrapper;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "field-store-test-"));
  db = createDatabase(join(root, "test.db")).result;
});

afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(root, { recursive: true, force: true });
});

describe("she wakes up with her past intact", () => {
  it("round-trips everything: what she has, how it is related, and how it felt", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    const a = addNode(g, { kind: "moment", text: "the night it went wrong", bornMs: T0, charge: 0.8, valence: -0.7, source: "ops:1", key: "m1" });
    const b = addNode(g, { kind: "insight", text: "I brace before I know why", bornMs: T0, charge: 0.5, tension: 0.3, source: "sk", key: "i1" });
    link(g, a.id, b.id, "evidence_for", 0.6, T0);
    a.warmth = 0.42;
    a.recalls = 3;
    store.save(g, [{ a: a.id, b: b.id, count: 2, sumStrength: 0.4, lastMs: T0 }], T0, 0.5, [], []);

    const loaded = createFieldStore(db).load()!;
    expect(loaded.graph.nodes.size).toBe(2);
    const ra = loaded.graph.nodes.get(a.id)!;
    expect(ra.text).toBe("the night it went wrong");
    expect(ra.charge).toBeCloseTo(0.8, 5);
    expect(ra.valence).toBeCloseTo(-0.7, 5);
    expect(ra.recalls).toBe(3);
    expect(ra.source).toBe("ops:1");
    expect(ra.key).toBe("m1");
    expect(loaded.graph.nodes.get(b.id)!.tension).toBeCloseTo(0.3, 5);
    expect(loaded.lastTickMs).toBe(T0);
    expect(loaded.resonance).toHaveLength(1);
  });

  it("keeps what she was half-thinking about; a restart is not an event in her life", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    const n = addNode(g, { kind: "moment", text: "on the edge of surfacing", bornMs: T0 });
    n.warmth = 0.37;
    store.save(g, [], T0, 0.5, [], []);
    expect(createFieldStore(db).load()!.graph.nodes.get(n.id)!.warmth).toBeCloseTo(0.37, 5);
  });

  it("rebuilds how strongly things are related, not just that they are", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    const a = addNode(g, { kind: "moment", text: "a", bornMs: T0 });
    const b = addNode(g, { kind: "moment", text: "b", bornMs: T0 });
    link(g, a.id, b.id, "co_occurred", 0.4, T0);
    link(g, a.id, b.id, "tension_with", 0.5, T0);
    const before = neighbours(g, a.id).get(b.id)!;
    store.save(g, [], T0, 0.5, [], []);
    const loaded = createFieldStore(db).load()!;
    expect(neighbours(loaded.graph, a.id).get(b.id)).toBeCloseTo(before, 5);
  });

  it("keeps her key index, so a moment cannot be lived twice after a restart", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    addNode(g, { kind: "moment", text: "tuesday", bornMs: T0, key: "d1" });
    store.save(g, [], T0, 0.5, [], []);
    const loaded = createFieldStore(db).load()!;
    expect(loaded.graph.byKey.get("d1")).toBeDefined();
    // And new nodes do not collide with the ids she already used.
    const fresh = addNode(loaded.graph, { kind: "moment", text: "wednesday", bornMs: T0 });
    expect(loaded.graph.nodes.size).toBe(2);
    expect(fresh.id).toBeGreaterThan(1);
  });

  it("a whole life goes out and comes back the same", async () => {
    const store = createFieldStore(db);
    const one = createLivingField({ store });
    for (let i = 0; i < 30; i++) {
      const ms = T0 + i * DAY;
      one.tick(ms);
      one.encodeMoment({
        key: `d${i}`, nowMs: ms, source: `ops:${i}`, withOther: i % 5 === 0,
        text: i % 7 === 0 ? `week ${i}: the thing that keeps going wrong` : `an ordinary day (${i})`,
        pad: i % 7 === 0 ? pad(-0.8, 0.85) : pad(0.15, 0),
      });
      one.onHerMind(ms + 3600_000);
    }
    one.persist();
    const before = one.stats();
    const mindBefore = one.onHerMind(T0 + 31 * DAY);

    // A restart.
    const two = createLivingField({ store: createFieldStore(db) });
    const after = two.stats();
    expect(after.nodes).toBe(before.nodes);
    expect(after.edges).toBe(before.edges);
    expect(after.byKind.moment).toBe(before.byKind.moment);

    // And re-living a day she already lived does not fork her history.
    two.encodeMoment({ key: "d3", text: "an ordinary day (3)", nowMs: T0 + 3 * DAY, pad: pad(0.15, 0), source: "ops:3" });
    expect(two.stats().nodes).toBe(before.nodes);
    console.log(`\n  ${before.nodes} things survived a restart intact`);
    console.log(`  what was on her mind before:\n${mindBefore || "    (nothing)"}`);
  });

  it("keeps where things came from, what she believes, and what she has learned to trust", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    const lived = addNode(g, { kind: "moment", text: "I was there", bornMs: T0, origin: "lived", credence: 0.8 });
    const told = addNode(g, { kind: "memory", text: "someone said otherwise", bornMs: T0, origin: "told", credence: 0.35 });
    const unsure = addNode(g, { kind: "memory", text: "two sources disagreed", bornMs: T0, origin: "read", credence: null });
    store.save(g, [], T0, 0.42, [], []);

    const loaded = createFieldStore(db).load()!;
    expect(loaded.graph.nodes.get(lived.id)!.origin).toBe("lived");
    expect(loaded.graph.nodes.get(told.id)!.origin).toBe("told");
    expect(loaded.graph.nodes.get(told.id)!.credence).toBeCloseTo(0.35, 5);
    // The one that matters most: "no view formed" is a real position and must not come back as 0.
    expect(loaded.graph.nodes.get(unsure.id)!.credence, "not knowing survives the round trip").toBeNull();
    expect(loaded.trustTold, "trust is learned, so it has to be remembered").toBeCloseTo(0.42, 5);
  });

  it("keeps how hard each thing feels to say, which is a climate she paid weeks for", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    const easy = addNode(g, { kind: "memory", text: "a page said something", bornMs: T0, reticence: 0.08 });
    const hard = addNode(g, { kind: "question", text: "why the evenings", bornMs: T0, reticence: 0.71 });
    store.save(g, [], T0, 0.5, [], []);

    const loaded = createFieldStore(db).load()!;
    expect(loaded.graph.nodes.get(easy.id)!.reticence).toBeCloseTo(0.08, 5);
    expect(loaded.graph.nodes.get(hard.id)!.reticence).toBeCloseTo(0.71, 5);
  });

  it("keeps what she EXPECTED of him, which is what her calibration is built from", () => {
    // Without this her read comes back believing itself again after every restart, however wrong it
    // has been: confidence would be a count of exchanges rather than a record of being right.
    const store = createFieldStore(db);
    const predictions = [
      { expected: 0.9, answered: false },
      { expected: 0.2, answered: true },
    ];
    store.save(createGraph(), [], T0, 0.5, [], predictions);
    expect(createFieldStore(db).load()!.expectations).toEqual(predictions);
  });

  it("keeps her record of the exchanges, or the read of him restarts from nothing every boot", () => {
    // A known failure class, exactly: a learned thing with no persistence path looks identical to a
    // learned thing that never learns, and only shows up as "she never seems to notice anything".
    const store = createFieldStore(db);
    const log = [
      { ms: T0, repliedAfterMs: 900_000 },
      { ms: T0 + DAY, unprompted: true },
      { ms: T0 + 2 * DAY, unanswered: true },
    ];
    store.save(createGraph(), [], T0, 0.5, log, []);
    expect(createFieldStore(db).load()!.exchanges).toEqual(log);
  });

  it("treats a mangled exchange log as no history rather than as a reason not to boot", () => {
    const faults = createFaultLog();
    const store = createFieldStore(db, faults);
    store.save(createGraph(), [], T0, 0.5, [{ ms: T0, unprompted: true }], []);
    db.db.prepare(`UPDATE field_meta SET value = ? WHERE key = ?`).run("{not json", "exchanges");

    const loaded = createFieldStore(db, faults).load()!;
    expect(loaded.exchanges, "she loses the read of him, which is recoverable").toEqual([]);
    expect(loaded.lastTickMs, "and keeps the field, which is not").toBe(T0);
    expect(faults.all().some((f) => f.where === "field.store.exchanges"), "and it is never silent").toBe(true);
  });

  it("MIGRATES a field written before any of this existed, rather than failing on first write", () => {
    // The shape a deployment already has on disk. CREATE TABLE IF NOT EXISTS will not widen it, so
    // without a migration the first save after an upgrade fails on a column count that no longer
    // matches, and her whole memory silently stops being written.
    db.db.exec(`
      CREATE TABLE field_nodes (
        id INTEGER PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, born_ms INTEGER NOT NULL,
        charge REAL NOT NULL, valence REAL NOT NULL, strength REAL NOT NULL, recalls INTEGER NOT NULL,
        last_recall_ms INTEGER NOT NULL, tension REAL NOT NULL, source TEXT NOT NULL,
        warmth REAL NOT NULL, node_key TEXT
      );
    `);
    db.db.prepare(`INSERT INTO field_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(1, "moment", "something from before the upgrade", T0, 0.5, 0.1, 0.7, 2, T0, 0, "ops:1", 0, "old");

    const store = createFieldStore(db); // runs the migration
    const loaded = store.load()!;
    const old = loaded.graph.nodes.get(1)!;
    expect(old.text).toBe("something from before the upgrade");
    // An old memory is something she lived and mostly believes, which is what it always was.
    expect(old.origin).toBe("lived");
    expect(old.credence).toBeNull();

    // A row written before reticence existed reads as the ordinary starting point, and a database
    // that never had an exchange log reads as no history rather than as anything at all.
    expect(old.reticence).toBeCloseTo(RETICENCE_BASE, 5);
    expect(loaded.exchanges).toEqual([]);

    // And writing works afterwards, which is the thing that would actually have broken.
    old.credence = 0.8;
    old.reticence = 0.62;
    store.save(loaded.graph, [], T0, 0.5, [{ ms: T0, unprompted: true }], []);
    const after = createFieldStore(db).load()!;
    expect(after.graph.nodes.get(1)!.credence).toBeCloseTo(0.8, 5);
    expect(after.graph.nodes.get(1)!.reticence).toBeCloseTo(0.62, 5);
    expect(after.exchanges).toEqual([{ ms: T0, unprompted: true }]);
  });

  it("what happened in her is dated and readable back", () => {
    const store = createFieldStore(db);
    store.recordEvent({ ms: T0, kind: "theme", text: "the evenings after a hard day became one thing" });
    store.recordEvent({ ms: T0 + DAY, kind: "fusion", text: "I brace before I know why", detail: "from two things" });
    const events = store.events();
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("theme");
    expect(events[1].detail).toBe("from two things");
    expect(store.eventsSince(T0 + DAY)).toHaveLength(1);
  });
});

describe("nothing fails quietly", () => {
  it("REPORTS a corrupt row rather than dropping it or crashing her boot", () => {
    const faults = createFaultLog();
    const store = createFieldStore(db, faults);
    const g = createGraph();
    addNode(g, { kind: "moment", text: "a real one", bornMs: T0 });
    store.save(g, [], T0, 0.5, [], []);
    db.db.prepare(`INSERT INTO field_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(999, "gibberish", "corrupt", T0, 0, 0, 0.5, 0, T0, 0, "", 0, null, "lived", 0.5, 0.15, null);

    const loaded = createFieldStore(db, faults).load()!;
    expect(loaded.graph.nodes.size, "the good row still loaded").toBe(1);
    expect(faults.all().some((f) => f.where === "field.store.load"), "and the bad one was reported").toBe(true);
    console.log(`\n  reported: ${faults.all()[0].detail}`);
  });

  it("REPORTS a write that could not happen", () => {
    const faults = createFaultLog();
    const store = createFieldStore(db, faults);
    db.close();
    store.save(createGraph(), [], T0, 0.5, [], []);
    expect(faults.all().some((f) => f.where === "field.store.save" && f.severity === "critical")).toBe(true);
  });

  it("drops a relation whose other end is gone rather than writing a dangling one", () => {
    const store = createFieldStore(db);
    const g = createGraph();
    const a = addNode(g, { kind: "moment", text: "a", bornMs: T0 });
    const b = addNode(g, { kind: "moment", text: "b", bornMs: T0 });
    link(g, a.id, b.id, "co_occurred", 0.5, T0);
    g.nodes.delete(b.id); // as if something removed it without tidying up
    store.save(g, [], T0, 0.5, [], []);
    const loaded = createFieldStore(db).load()!;
    expect(loaded.graph.edges.size).toBe(0);
    expect(loaded.graph.nodes.size).toBe(1);
  });

  it("an empty database is an empty life, not an error", () => {
    expect(createFieldStore(db).load()).toBeNull();
    const f = createLivingField({ store: createFieldStore(db) });
    expect(f.stats().nodes).toBe(0);
    expect(f.onHerMind(T0)).toBe("");
  });

  it("a field with no store at all still works, and still remembers what changed in her", async () => {
    const f = createLivingField();
    f.encodeInsight({ key: "i:a", text: "I would rather be left alone", nowMs: T0, evidenceKeys: [], source: "sk" });
    f.encodeInsight({ key: "i:b", text: "talking with him settles me", nowMs: T0, evidenceKeys: [], source: "sk" });
    for (let i = 0; i < 5; i++) f.contradict("i:a", "i:b", T0 + i * DAY, 0.2);
    const rest = await f.rest(T0 + 5 * DAY, { replay: { walks: 0 } });
    expect(rest.ruptures.length).toBeGreaterThan(0);
    expect(f.events().some((e) => e.kind === "rupture"), "her history is hers, not the database's").toBe(true);
  });
});

// ── Her record of her associative life is bounded ───────────────────────
describe("field events are bounded, because nothing else was going to bound them", () => {
  it("keeps the most recent window and drops only what is far past it", () => {
    // One or two rows per rest is harmless at any horizon worth planning for, which is exactly
    // why it would have grown untouched for her whole life. The window is generous on purpose:
    // this is HER RECORD, not a log, and `since()` reads it for the day summary.
    const store = createFieldStore(db);
    const N = 20_600;
    for (let i = 0; i < N; i++) {
      store.recordEvent({ ms: 1_000 + i, kind: "fusion", text: `e${i}` });
    }
    const all = store.events(30_000);
    expect(all.length, "the table grew without any bound at all").toBeLessThanOrEqual(20_000);
    expect(all.length, "trimming ate into the window it is supposed to keep").toBeGreaterThan(19_000);
    // The NEWEST survive: her recent life is what the day summary and /field read.
    expect(all[all.length - 1]!.text).toBe(`e${N - 1}`);
  });
});
