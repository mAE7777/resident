// THE CROSS-SECTION: given any beat of her life, print everything that happened in it.
//
// The spine (`src/utils/beat.ts`) gives every occasion she runs one id and stamps it into every
// stream. This tool is the other half: the join. Without it the id is a promise; with it, "what
// exactly happened there" is one command.
//
//   pnpm exec tsx scripts/_beat.ts <home>                    · the last 20 beats, one line each
//   pnpm exec tsx scripts/_beat.ts <home> <beat-id>          · full cross-section of one beat
//   pnpm exec tsx scripts/_beat.ts <home> last               · full cross-section of the newest
//   pnpm exec tsx scripts/_beat.ts <home> faults             · recent beats that raised faults
//   pnpm exec tsx scripts/_beat.ts <home> <ms|ISO time>      · every beat covering that instant
//   pnpm exec tsx scripts/_beat.ts <home> coverage           · orphan records (no beat id) per stream
//
// `<home>` is the resident home directory (the one holding workspace/, ops.jsonl, beats.jsonl).
// Reads only. Streams that do not exist yet are reported absent, never invented.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const home = process.argv[2];
const query = process.argv[3];
if (!home) {
  console.error("usage: pnpm exec tsx scripts/_beat.ts <home> [beat-id|last|faults|coverage|time]");
  process.exit(1);
}

type Row = Record<string, unknown>;
const jsonl = (path: string): Row[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as Row]; } catch { return []; }
  });
};

const STREAMS: Record<string, { path: string; beatKey: string }> = {
  faults: { path: join(home, "faults.jsonl"), beatKey: "beat" },
  ops: { path: join(home, "ops.jsonl"), beatKey: "beat" },
  conversation: { path: join(home, "conversation-log.jsonl"), beatKey: "beat" },
  history: { path: join(home, "workspace", "history.jsonl"), beatKey: "beat" },
  agency: { path: join(home, "workspace", "agency.jsonl"), beatKey: "beat" },
};

const beats = jsonl(join(home, "beats.jsonl"));
if (beats.length === 0) {
  console.log(`no beats.jsonl under ${home} (daemon not yet run with the spine, or wrong home)`);
  process.exit(0);
}

const faultsByBeat = new Map<string, Row[]>();
for (const f of jsonl(STREAMS.faults!.path)) {
  const b = f.beat;
  if (typeof b !== "string") continue;
  if (!faultsByBeat.has(b)) faultsByBeat.set(b, []);
  faultsByBeat.get(b)!.push(f);
}

const mood = (s: unknown): string => {
  if (s === null || typeof s !== "object") return "·";
  const x = s as { mood?: string; pl?: number; ar?: number };
  return `${x.mood ?? "?"}(${x.pl ?? "?"},${x.ar ?? "?"})`;
};

function oneLine(b: Row): string {
  const ms = typeof b.t1 === "number" && typeof b.t0 === "number" ? b.t1 - b.t0 : 0;
  const nFaults = faultsByBeat.get(String(b.id))?.length ?? 0;
  return `${String(b.id).padEnd(28)} ${new Date(Number(b.t0)).toISOString()} ${String(ms).padStart(6)}ms `
    + `${b.ok === false ? "✗" : "·"} ${mood(b.state0)} → ${mood(b.state1)}`
    + (nFaults > 0 ? `  ⚠ ${nFaults} fault${nFaults > 1 ? "s" : ""}` : "");
}

function crossSection(b: Row): void {
  console.log(`\n══ ${String(b.id)} ══`);
  console.log(oneLine(b));
  const extras = Object.fromEntries(Object.entries(b).filter(([k]) =>
    !["id", "kind", "t0", "t1", "ok", "state0", "state1"].includes(k)));
  if (Object.keys(extras).length > 0) console.log(`  notes: ${JSON.stringify(extras)}`);

  for (const [name, s] of Object.entries(STREAMS)) {
    if (!existsSync(s.path)) { console.log(`  ${name}: (file absent)`); continue; }
    const hits = jsonl(s.path).filter((r) => r[s.beatKey] === b.id);
    if (hits.length === 0) continue;
    console.log(`  ${name} (${hits.length}):`);
    for (const h of hits.slice(0, 12)) {
      const shown = JSON.stringify(h);
      console.log(`    ${shown.length > 220 ? shown.slice(0, 220) + "…" : shown}`);
    }
    if (hits.length > 12) console.log(`    … and ${hits.length - 12} more`);
  }

  // Her field's events, by time window. EXACT, not approximate: field writes are synchronous
  // (better-sqlite3), so nothing from an interleaved beat can land inside this window.
  try {
    const dbPath = join(home, "data.db");
    if (existsSync(dbPath) && typeof b.t0 === "number" && typeof b.t1 === "number") {
      // Deferred import so the tool still works on a home with no database.
      void import("better-sqlite3").then((mod) => {
        const db = new mod.default(dbPath, { readonly: true });
        const rows = db.prepare("SELECT ms, kind, text, node_id FROM field_events WHERE ms >= ? AND ms <= ? ORDER BY ms")
          .all(b.t0, b.t1) as Array<{ ms: number; kind: string; text: string; node_id: number | null }>;
        db.close();
        if (rows.length > 0) {
          console.log(`  field (${rows.length}):`);
          for (const r of rows.slice(0, 12)) console.log(`    ${r.kind} n${r.node_id ?? "·"} ${r.text.slice(0, 80)}`);
          if (rows.length > 12) console.log(`    … and ${rows.length - 12} more`);
        }
      }).catch(() => { console.log("  field: (database unreadable)"); });
    }
  } catch { console.log("  field: (database unreadable)"); }
}

if (query === undefined) {
  console.log(`last ${Math.min(20, beats.length)} of ${beats.length} beats:`);
  for (const b of beats.slice(-20)) console.log(oneLine(b));
} else if (query === "last") {
  crossSection(beats[beats.length - 1]!);
} else if (query === "faults") {
  const withFaults = beats.filter((b) => faultsByBeat.has(String(b.id)));
  if (withFaults.length === 0) console.log("no beat has raised a fault");
  for (const b of withFaults.slice(-20)) crossSection(b);
  // Faults OUTSIDE any beat are exactly as important, boot/shutdown, or a hole in the spine.
  const orphans = jsonl(STREAMS.faults!.path).filter((f) => typeof f.beat !== "string");
  if (orphans.length > 0) {
    console.log(`\n⚠ ${orphans.length} fault(s) outside any beat (boot/shutdown are legitimate; anything else is a hole):`);
    for (const f of orphans.slice(-10)) console.log(`  ${new Date(Number(f.ts)).toISOString()} [${String(f.where)}] ${String(f.detail).slice(0, 120)}`);
  }
} else if (query === "coverage") {
  // The measurable behind "not scattered": per stream, how many records carry no beat id.
  for (const [name, s] of Object.entries(STREAMS)) {
    const rows = jsonl(s.path);
    const orphan = rows.filter((r) => typeof r[s.beatKey] !== "string").length;
    console.log(`${name.padEnd(14)} ${String(rows.length).padStart(6)} records · ${String(orphan).padStart(6)} without a beat id`);
  }
  console.log("(records from before the spine existed, and boot/shutdown, legitimately have none)");
} else if (beats.some((b) => b.id === query)) {
  crossSection(beats.find((b) => b.id === query)!);
} else {
  const t = /^\d+$/u.test(query) ? Number(query) : Date.parse(query);
  if (Number.isNaN(t)) {
    console.error(`no beat with id "${query}", and it does not parse as a time`);
    process.exit(1);
  }
  const covering = beats.filter((b) => Number(b.t0) <= t && t <= Number(b.t1));
  if (covering.length === 0) console.log(`no beat covers ${new Date(t).toISOString()} (she may have been idle)`);
  for (const b of covering) crossSection(b);
}
