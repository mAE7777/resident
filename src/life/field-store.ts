// Persistence for the field. Her associations have to survive a restart, or she wakes up every
// morning with no past and the whole layer is theatre.
//
// Warmth is persisted too, deliberately. It is the residue of what she was half-thinking about, and
// a process restart is not an event in her life; it should not wipe what was on the edge of
// surfacing. Cooling is by elapsed time, so a long downtime still fades it honestly.
//
// Every failure here goes to the fault channel. A store that quietly stops writing would look
// exactly like a field that stopped learning, and that is the failure class this project bans.

import type { DatabaseWrapper } from "../db/sqlite.js";
import type { FaultLog } from "./faults.js";
import type { FieldEdge, FieldGraph, FieldNode, EdgeKind, NodeKind } from "./field.js";
import type { Origin } from "./credence.js";
import { MAX_EXCHANGES, MAX_EXPECTATIONS, type Exchange, type Expectation } from "./other-read.js";
import { createGraph, RETICENCE_BASE } from "./field.js";
import type { ResonancePair } from "./field-emergence.js";
import { notFiniteIn, describeNotFinite } from "./finite.js";

/**
 * `wonder`: a thing that kept coming back with nothing to account for it became something
 * she wants to know about. It is a dated row in her life like the rest, the day she started
 * wondering about a thing is exactly the kind of event this log exists to hold.
 */
export type FieldEventKind =
  | "fusion" | "theme" | "rupture" | "prune" | "refusal" | "trust" | "suspension" | "wonder";
// `suspension`: a claim she held, hers or told, had its credence put to null by a
// judgement. Recorded as an event because node state only persists on the moment loop or a
// clean shutdown, so the mark was invisible to any single-turn observation.

export interface FieldEvent {
  ms: number;
  kind: FieldEventKind;
  /** One line, in her words where there are any. This is the dated record of what changed in her. */
  text: string;
  nodeId?: number;
  detail?: string;
}

export interface FieldSnapshot {
  graph: FieldGraph;
  resonance: ResonancePair[];
  lastTickMs: number;
  /** How much what she is told has held up. Learned, so it has to survive a restart. */
  trustTold: number | null;
  /** How exchanges with him have gone. Also learned, so it also has to survive a restart. */
  exchanges: Exchange[];
  /** What she expected of him and what happened. Her calibration is built from this. */
  expectations: Expectation[];
}

export interface FieldStore {
  load(): FieldSnapshot | null;
  save(
    graph: FieldGraph,
    resonance: readonly ResonancePair[],
    lastTickMs: number,
    trustTold: number,
    exchanges: readonly Exchange[],
    expectations: readonly Expectation[],
  ): void;
  recordEvent(event: FieldEvent): void;
  events(limit?: number): FieldEvent[];
  eventsSince(sinceMs: number): FieldEvent[];
}

export function ensureFieldTables(db: DatabaseWrapper): void {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS field_nodes (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      born_ms INTEGER NOT NULL,
      charge REAL NOT NULL,
      valence REAL NOT NULL,
      strength REAL NOT NULL,
      recalls INTEGER NOT NULL,
      last_recall_ms INTEGER NOT NULL,
      tension REAL NOT NULL,
      source TEXT NOT NULL,
      warmth REAL NOT NULL,
      node_key TEXT,
      origin TEXT NOT NULL DEFAULT 'lived',
      credence REAL,
      reticence REAL NOT NULL DEFAULT ${RETICENCE_BASE},
      last_raised_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS field_edges (
      a INTEGER NOT NULL,
      b INTEGER NOT NULL,
      kind TEXT NOT NULL,
      weight REAL NOT NULL,
      last_ms INTEGER NOT NULL,
      PRIMARY KEY (a, b, kind)
    );
    CREATE TABLE IF NOT EXISTS field_resonance (
      a INTEGER NOT NULL,
      b INTEGER NOT NULL,
      count INTEGER NOT NULL,
      sum_strength REAL NOT NULL,
      last_ms INTEGER NOT NULL,
      PRIMARY KEY (a, b)
    );
    CREATE TABLE IF NOT EXISTS field_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ms INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      node_id INTEGER,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS field_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_field_nodes_key ON field_nodes(node_key);
    CREATE INDEX IF NOT EXISTS idx_field_events_ms ON field_events(ms);
  `);

  /**
   * WHEN SHE LAST BROUGHT SOMETHING UP TO HIM: `last_raised_ms`.
   *
   * The cooldown on raising the same thing again is three days, and this value was
   * PROCESS-LOCAL, it had no column at all. So every restart wiped it, and she could bring the
   * same thing up the next morning as though she never had. It cuts the other way too:
   * `whatSurfacesInReply` docks a just-raised thing by 1.6, which is the mechanism that stops
   * her going on about something, and that mechanism reset every time the daemon came back.
   */

  // A field that already exists has the old shape, and CREATE TABLE IF NOT EXISTS will not widen
  // it, so the first write after an upgrade would fail on a column count that no longer matches.
  // Adding a column that is already there raises, and that is the only signal SQLite gives, so the
  // duplicate case is the expected one rather than an error worth reporting.
  for (const [column, decl] of [
    ["origin", "TEXT NOT NULL DEFAULT 'lived'"],
    ["credence", "REAL"],
    ["reticence", `REAL NOT NULL DEFAULT ${RETICENCE_BASE}`],
    ["last_raised_ms", "INTEGER"],
  ] as const) {
    try {
      db.db.exec(`ALTER TABLE field_nodes ADD COLUMN ${column} ${decl}`);
    } catch (err) {
      if (!String(err).includes("duplicate column")) throw err;
    }
  }
}

interface NodeRow {
  id: number; kind: string; text: string; born_ms: number; charge: number; valence: number;
  strength: number; recalls: number; last_recall_ms: number; tension: number; source: string;
  warmth: number; node_key: string | null; origin: string | null; credence: number | null;
  reticence: number | null; last_raised_ms: number | null;
}
interface EdgeRow { a: number; b: number; kind: string; weight: number; last_ms: number }
interface ResRow { a: number; b: number; count: number; sum_strength: number; last_ms: number }
interface EventRow { ms: number; kind: string; text: string; node_id: number | null; detail: string | null }

// Every Origin, or load() silently rewrites provenance: this list was missing "dreamt" for a
// while, so a persisted dream reloaded as "lived", the exact dream→memory leak the origin
// exists to prevent (caught before the dream gate ever opened; zero real harm).
// The round-trip test in field-store.test.ts now walks every member of ORIGINS.
const ORIGIN_KINDS = new Set<string>(["lived", "thought", "told", "read", "dreamt", "retold"]);
const NODE_KINDS = new Set<string>(["moment", "memory", "insight", "figure", "question", "theme", "fusion"]);
const EDGE_KINDS = new Set<string>(["co_occurred", "about", "evidence_for", "reminds_of", "tension_with", "born_from"]);

/**
 * How many field events are kept. Generous on purpose: this is HER RECORD of what
 * happened in her associative life, not a log, and `since()` reads it for the day summary, so
 * the bound must sit far above anything still part of her present. At one or two events per rest
 * this is several years of living, and it exists only so the table cannot grow untouched for the
 * whole of a life nobody plans to end.
 */
const MAX_FIELD_EVENTS = 20_000;
/** Trim every N inserts rather than on every one: the DELETE is the expensive part. */
const TRIM_EVERY = 200;

export function createFieldStore(db: DatabaseWrapper, faults?: FaultLog): FieldStore {
  let eventsSinceTrim = 0;
  ensureFieldTables(db);

  /**
   * The exchange log, which is JSON in a meta row rather than a table because it is a short bounded
   * list that is only ever read and written whole. Anything unreadable in it is treated as no
   * history rather than as a crash: a mangled meta row must not be able to stop her booting, and
   * losing the read of him is recoverable in a way that losing the field is not.
   */
  function readExchanges(): Exchange[] {
    const row = db.db.prepare<[string], { value: string }>(`SELECT value FROM field_meta WHERE key = ?`).get("exchanges");
    if (!row) return [];
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e): e is Exchange => !!e && typeof e === "object" && Number.isFinite((e as Exchange).ms))
        .slice(-MAX_EXCHANGES);
    } catch (err) {
      faults?.record("field.store.exchanges", err, "warn");
      return [];
    }
  }

  /** Her record of being right or wrong about him. Same defensive shape as the exchange log. */
  function readExpectations(): Expectation[] {
    const row = db.db.prepare<[string], { value: string }>(`SELECT value FROM field_meta WHERE key = ?`).get("expectations");
    if (!row) return [];
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e): e is Expectation => !!e && typeof e === "object"
          && Number.isFinite((e as Expectation).expected) && typeof (e as Expectation).answered === "boolean")
        .slice(-MAX_EXPECTATIONS);
    } catch (err) {
      faults?.record("field.store.expectations", err, "warn");
      return [];
    }
  }

  return {
    load() {
      try {
        const nodeRows = db.db.prepare<[], NodeRow>(`SELECT * FROM field_nodes`).all();
        if (nodeRows.length === 0) {
          const meta = db.db.prepare<[string], { value: string }>(`SELECT value FROM field_meta WHERE key = ?`).get("last_tick_ms");
          if (!meta) return null;
        }
        const graph = createGraph();
        let maxId = 0;
        // ── ONE BAD ROW MUST NOT COST HER EVERY ROW ────────────────────────────────────────────
        //
        // This whole function is wrapped in a try that returns `null` on any throw, and `null`
        // means "she has no past": boot then proceeds as if she were newborn, and the next save
        // writes that emptiness over the file that still held her life. So a single unreadable row,
        // one corrupt byte, one column that a half-applied schema change left NULL, was a total
        // loss with a warning in the log.
        //
        // Row-level failures are now skipped and COUNTED, and a load that lost anything says so at
        // critical severity. Skipping silently would be the other banned failure: she comes back
        // slightly smaller and nobody knows which part is gone.
        let skipped = 0;
        for (const row of nodeRows) {
          // A row with an unrecognised kind is corruption, not data. Dropping it silently would be
          // the banned failure, so it is reported and skipped rather than crashing her boot.
          if (!NODE_KINDS.has(row.kind)) {
            faults?.record("field.store.load", `unknown node kind "${row.kind}" on node ${row.id}`, "warn");
            skipped += 1;
            continue;
          }
          // The numbers a node cannot live without. A NULL or a NaN here would propagate into every
          // later decay, comparison and prune, see `finite.ts`.
          if (![row.born_ms, row.charge, row.valence, row.strength, row.tension, row.warmth].every(
            (x) => typeof x === "number" && Number.isFinite(x))) {
            faults?.record("field.store.load", `node ${row.id} has a number that is not a number — skipped`, "warn");
            skipped += 1;
            continue;
          }
          const node: FieldNode = {
            id: row.id,
            kind: row.kind as NodeKind,
            text: row.text,
            bornMs: row.born_ms,
            charge: row.charge,
            valence: row.valence,
            strength: row.strength,
            recalls: row.recalls,
            lastRecallMs: row.last_recall_ms,
            tension: row.tension,
            source: row.source,
            origin: ORIGIN_KINDS.has(row.origin ?? "") ? (row.origin as Origin) : "lived",
            // A NULL credence is meaningful: it is "no view formed", not a missing column.
            credence: row.credence === null || row.credence === undefined ? null : row.credence,
            // Unlike credence, a missing reticence is nothing meaningful: it is a row written before
            // the column existed, and the honest reading of it is the ordinary starting point.
            reticence: Number.isFinite(row.reticence) ? (row.reticence as number) : RETICENCE_BASE,
            // Absent on a field written before this column existed, which reads as "never
            // raised", the same thing a restart used to produce for every node, and the right
            // answer for a row that genuinely predates the record.
            ...(Number.isFinite(row.last_raised_ms) ? { lastRaisedMs: row.last_raised_ms as number } : {}),
            warmth: row.warmth,
            key: row.node_key ?? undefined,
          };
          graph.nodes.set(node.id, node);
          graph.adj.set(node.id, new Map());
          if (node.key) graph.byKey.set(node.key, node.id);
          maxId = Math.max(maxId, node.id);
        }
        graph.nextId = maxId + 1;
        if (skipped > 0) {
          faults?.record(
            "field.store.load.incomplete",
            `${skipped} of ${nodeRows.length} things she was carrying could not be read back and are gone from this boot`,
            "critical",
          );
        }

        const edgeRows = db.db.prepare<[], EdgeRow>(`SELECT * FROM field_edges`).all();
        for (const row of edgeRows) {
          if (!EDGE_KINDS.has(row.kind)) {
            faults?.record("field.store.load", `unknown edge kind "${row.kind}"`, "warn");
            continue;
          }
          if (!graph.nodes.has(row.a) || !graph.nodes.has(row.b)) continue;
          const edge: FieldEdge = { a: row.a, b: row.b, kind: row.kind as EdgeKind, weight: row.weight, lastMs: row.last_ms };
          graph.edges.set(`${row.a}:${row.b}:${row.kind}`, edge);
        }
        rebuildAdjacency(graph);

        const resonance = db.db.prepare<[], ResRow>(`SELECT * FROM field_resonance`).all()
          .filter((r) => graph.nodes.has(r.a) && graph.nodes.has(r.b))
          .map((r) => ({ a: r.a, b: r.b, count: r.count, sumStrength: r.sum_strength, lastMs: r.last_ms }));

        const meta = db.db.prepare<[string], { value: string }>(`SELECT value FROM field_meta WHERE key = ?`).get("last_tick_ms");
        const lastTickMs = meta ? Number(meta.value) || 0 : 0;

        const trustRow = db.db.prepare<[string], { value: string }>(`SELECT value FROM field_meta WHERE key = ?`).get("trust_told");
        const trustTold = trustRow ? (Number.isFinite(Number(trustRow.value)) ? Number(trustRow.value) : null) : null;

        return { graph, resonance, lastTickMs, trustTold, exchanges: readExchanges(), expectations: readExpectations() };
      } catch (err) {
        faults?.record("field.store.load", err, "critical");
        return null;
      }
    },

    save(graph, resonance, lastTickMs, trustTold, exchanges, expectations) {
      try {
        // ── NOTHING ABOUT HER GOES TO DISK AS `NaN` ────────────────────────────────────────────
        //
        // A NaN in a persisted number is not one wrong answer, it is permanent damage: every later
        // arithmetic on it is NaN too, so a node that has gone NaN can never decay, be pruned, or
        // be compared again: and SQLite stores it as NULL, which reads back as zero somewhere
        // downstream, which is worse because it is plausible.
        //
        // REFUSING THE WRITE IS THE POINT. The previous save is still on disk and still correct, so
        // refusing costs her the newest slice of a life and keeps the rest; writing would cost her
        // the field. Repairing the value here would be worse than both: it would invent a number
        // and hide whichever formula upstream divided by zero.
        const bad = notFiniteIn({
          nodes: [...graph.nodes.values()].map((n) => ({
            id: n.id, charge: n.charge, valence: n.valence, strength: n.strength,
            tension: n.tension, warmth: n.warmth, credence: n.credence, reticence: n.reticence,
          })),
          edges: [...graph.edges.values()].map((e) => ({ weight: e.weight, lastMs: e.lastMs })),
          lastTickMs, trustTold,
        });
        if (bad.length > 0) {
          faults?.record("field.store.notFinite", describeNotFinite(bad), "critical");
          return;
        }

        const insNode = db.db.prepare(`
          INSERT INTO field_nodes (id, kind, text, born_ms, charge, valence, strength, recalls, last_recall_ms, tension, source, warmth, node_key, origin, credence, reticence, last_raised_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insEdge = db.db.prepare(`INSERT INTO field_edges (a, b, kind, weight, last_ms) VALUES (?, ?, ?, ?, ?)`);
        const insRes = db.db.prepare(`INSERT INTO field_resonance (a, b, count, sum_strength, last_ms) VALUES (?, ?, ?, ?, ?)`);
        const setMeta = db.db.prepare(`INSERT INTO field_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

        db.writeWithRetry(() => {
          // A full rewrite rather than a diff. At her scale this is milliseconds, and it makes a
          // partial write impossible: either the whole field is saved or the transaction rolls back.
          db.db.exec(`DELETE FROM field_nodes; DELETE FROM field_edges; DELETE FROM field_resonance;`);
          for (const n of graph.nodes.values()) {
            insNode.run(n.id, n.kind, n.text, n.bornMs, n.charge, n.valence, n.strength, n.recalls, n.lastRecallMs, n.tension, n.source, n.warmth, n.key ?? null, n.origin, n.credence, n.reticence, n.lastRaisedMs ?? null);
          }
          for (const e of graph.edges.values()) {
            if (!graph.nodes.has(e.a) || !graph.nodes.has(e.b)) continue;
            insEdge.run(e.a, e.b, e.kind, e.weight, e.lastMs);
          }
          for (const p of resonance) {
            if (!graph.nodes.has(p.a) || !graph.nodes.has(p.b)) continue;
            insRes.run(p.a, p.b, p.count, p.sumStrength, p.lastMs);
          }
          setMeta.run("last_tick_ms", String(lastTickMs));
          setMeta.run("trust_told", String(trustTold));
          setMeta.run("exchanges", JSON.stringify(exchanges.slice(-MAX_EXCHANGES)));
          setMeta.run("expectations", JSON.stringify(expectations.slice(-MAX_EXPECTATIONS)));
        });
      } catch (err) {
        faults?.record("field.store.save", err, "critical");
      }
    },

    recordEvent(event) {
      try {
        const ins = db.db.prepare(`INSERT INTO field_events (ms, kind, text, node_id, detail) VALUES (?, ?, ?, ?, ?)`);
        db.writeWithRetry(() => {
          ins.run(event.ms, event.kind, event.text.slice(0, 500), event.nodeId ?? null, event.detail?.slice(0, 500) ?? null);
        });
        // Bounded, because nothing else was ever going to bound it. One or two rows
        // per rest is a few hundred a year and harmless at any horizon worth planning for,
        // which is exactly why it would have grown for her whole life untouched. The window is
        // deliberately generous: this table is HER RECORD of what happened in her associative
        // life, not a log, and `since()` reads it for the day summary, so the bound has to sit
        // far above anything that is still part of her present. Trimmed on insert rather than
        // on a sweep so there is no second cadence to forget to wire.
        eventsSinceTrim += 1;
        if (eventsSinceTrim >= TRIM_EVERY) {
          eventsSinceTrim = 0;
          db.writeWithRetry(() => {
            db.db.prepare(
              `DELETE FROM field_events WHERE id NOT IN (SELECT id FROM field_events ORDER BY ms DESC, id DESC LIMIT ?)`
            ).run(MAX_FIELD_EVENTS);
          });
        }
      } catch (err) {
        faults?.record("field.store.event", err, "warn");
      }
    },

    events(limit = 50) {
      try {
        const rows = db.db.prepare<[number], EventRow>(`SELECT ms, kind, text, node_id, detail FROM field_events ORDER BY ms DESC, id DESC LIMIT ?`).all(limit);
        return rows.map(toEvent).reverse();
      } catch (err) {
        faults?.record("field.store.events", err, "warn");
        return [];
      }
    },

    eventsSince(sinceMs) {
      try {
        const rows = db.db.prepare<[number], EventRow>(`SELECT ms, kind, text, node_id, detail FROM field_events WHERE ms >= ? ORDER BY ms ASC`).all(sinceMs);
        return rows.map(toEvent);
      } catch (err) {
        faults?.record("field.store.events", err, "warn");
        return [];
      }
    },
  };
}

function toEvent(row: EventRow): FieldEvent {
  return {
    ms: row.ms,
    kind: (row.kind as FieldEventKind),
    text: row.text,
    nodeId: row.node_id ?? undefined,
    detail: row.detail ?? undefined,
  };
}

/** Recompute combined conductance for every pair after a load. */
function rebuildAdjacency(graph: FieldGraph): void {
  const CONDUCTANCE: Record<string, number> = {
    co_occurred: 1.0, about: 0.9, evidence_for: 1.0, reminds_of: 0.85, tension_with: 0.7, born_from: 1.0,
  };
  const combined = new Map<string, number>();
  for (const e of graph.edges.values()) {
    const lo = Math.min(e.a, e.b);
    const hi = Math.max(e.a, e.b);
    const key = `${lo}:${hi}`;
    combined.set(key, (combined.get(key) ?? 0) + e.weight * (CONDUCTANCE[e.kind] ?? 1));
  }
  for (const [key, total] of combined) {
    const [lo, hi] = key.split(":").map(Number);
    const w = Math.min(1, total);
    if (w <= 0) continue;
    graph.adj.get(lo)?.set(hi, w);
    graph.adj.get(hi)?.set(lo, w);
  }
}
