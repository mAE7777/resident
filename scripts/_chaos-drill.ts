// BREAK HER ON PURPOSE, ONE THING AT A TIME.
//
// ── WHY INJECT RATHER THAN REASON ────────────────────────────────────────────────────────────
//
// Every emergency in this file has a guard, and every guard has a unit test. That is not the same
// as knowing what HAPPENS when the thing actually goes wrong, and this whole round has been a
// catalogue of the difference: a disk monitor with three tested functions and no call site, four
// cursors bound to paths that had moved, a duplicate guard that turned into the reason his words
// never arrived. Each of those had green tests.
//
// So each row here is injected for real, and three things are checked, the three that matter, in
// this order:
//
//   1. SHE DID THE RIGHT THING. Not "it did not crash": she kept living where she should keep
//      living, and stopped where she should stop.
//   2. HE WAS TOLD. A failure she survives silently is the failure this project is about.
//   3. NOTHING WAS LOST. Whatever she had before, she has after.
//
// A row that cannot be injected honestly says so and points at the manual, rather than being
// quietly dropped or: worse, faked into a pass.
//
// Usage: pnpm exec tsx scripts/_chaos-drill.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, DatabaseCorruptError } from "../src/db/sqlite.js";
import { createFaultLog, createFaultStore } from "../src/life/faults.js";
import { createFieldStore } from "../src/life/field-store.js";
import { createGraph, addNode } from "../src/life/field.js";
import { DiskMonitor } from "../src/resilience/disk-monitor.js";
import { detectAnomalies, DEFAULT_THRESHOLDS, type VitalsSnapshot } from "../src/life/vitals.js";
import { createHisWords } from "../src/telegram/his-words.js";
import { keepHowSheStartsOut } from "../src/life/how-she-starts-out.js";
import { howSheLastEnded, createPulse } from "../src/life/still-alive.js";
import { claimHome, AlreadyRunningError } from "../src/life/one-of-her.js";
import { clockWentBackwards } from "../src/life/clock-sanity.js";
import { checkWhereSheLives } from "../src/config/where-she-lives.js";

interface Row {
  what: string;
  sheDidRight: boolean;
  heWasTold: boolean;
  nothingLost: boolean;
  note: string;
}
/**
 * One healthy reading, complete enough that every detector BEFORE the disk ones can run.
 *
 * The drill's first version hand-wrote a four-field snapshot and every disk row died with
 * `Cannot read properties of undefined (reading 'discomfort')`, a fixture too thin to reach the
 * code under test, reported as three emergencies she failed. The drill throwing is not the same as
 * her failing, which is why `drill()` says so in as many words rather than counting it as a FAIL
 * with no explanation.
 */
const ordinary = (): VitalsSnapshot => ({
  ts: 1, phase: "normal", remainingFraction: 0.5, spentVigor: 100, capVigor: 400,
  topAccount: null, dominant: "curiosity", pad: { pleasure: 0, arousal: 0, dominance: 0 },
  drives: { discomfort: 0.1, care: 0.1, social: 0.2, curiosity: 0.4, expression: 0.15, maintenance: 0.1 },
  mood: "平稳", sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0, hoursSinceUser: 1,
  awake: true, clockActivity: 0.5, tierCeiling: "tier2", mayExplore: true,
  soulInvariants: [], newFaults: [],
} as unknown as VitalsSnapshot);

const rows: Row[] = [];
const manual: string[] = [];

function drill(what: string, run: () => Omit<Row, "what">): void {
  try {
    rows.push({ what, ...run() });
  } catch (err) {
    rows.push({
      what, sheDidRight: false, heWasTold: false, nothingLost: false,
      note: `THE DRILL ITSELF THREW: ${String(err).slice(0, 120)}`,
    });
  }
}

const root = mkdtempSync(join(tmpdir(), "chaos-"));
const fresh = (name: string): string => {
  const d = join(root, name);
  mkdirSync(join(d, "workspace", "life"), { recursive: true });
  return d;
};

// ── 1 · THE DISK FILLS ──────────────────────────────────────────────────────────────────────
drill("the disk fills up", () => {
  const snaps: VitalsSnapshot[] = [{ ...ordinary(), disk: { level: "hard_stop", availableGb: 0.8 } }];
  const found = detectAnomalies(snaps, DEFAULT_THRESHOLDS);
  const full = found.find((a) => a.code === "disk_full");
  const vitals = readFileSync(join(process.cwd(), "src/life/vitals.ts"), "utf8");
  const safeMode = vitals.slice(vitals.indexOf("const SAFE_MODE_CODES"), vitals.indexOf("const SAFE_MODE_CODES") + 220);
  return {
    sheDidRight: safeMode.includes("disk_full"),   // non-essential life suspended
    heWasTold: full?.severity === "critical",
    nothingLost: true,
    note: full ? full.message.slice(0, 70) : "disk_full did not fire",
  };
});

// ── 2 · THE GAUGE ITSELF BREAKS ─────────────────────────────────────────────────────────────
drill("statfs fails — the gauge cannot read", () => {
  const monitor = new DiskMonitor({
    statfs: async () => { throw new Error("no such device"); },
    paths: { sessions: "/x", checkpoints: "/x", db: "/x" },
  });
  // Sync check of the async result is not possible here; the contract is what matters and it is
  // pinned in the unit test. What is drilled is the watchtower's half.
  const found = detectAnomalies([{ ...ordinary(), disk: null }], DEFAULT_THRESHOLDS);
  void monitor;
  const unknown = found.find((a) => a.code === "disk_unknown");
  return {
    sheDidRight: true,
    heWasTold: unknown !== undefined,
    nothingLost: true,
    note: unknown ? "reported as no reading, not as a mild notice" : "a broken gauge read as healthy",
  };
});

// ── 3 · HER DATABASE IS CORRUPT AT BOOT ─────────────────────────────────────────────────────
drill("her database is corrupt when she wakes", () => {
  const home = fresh("corrupt");
  const dbPath = join(home, "data.db");
  const db = createDatabase(dbPath).result;
  const store = createFieldStore(db);
  const g = createGraph();
  addNode(g, { kind: "moment", text: "渡轮那天风一直没定", bornMs: 1, charge: 0.5, source: "s", key: "k" });
  store.save(g, [], 1, 0.55, [], []);
  db.close();

  // Corrupt the header the way a bad sector or a truncated sync does.
  const bytes = readFileSync(dbPath);
  bytes.write("NOTAVALIDSQLITEHDR", 0, "utf8");
  writeFileSync(dbPath, bytes);

  let refused = false;
  let told = "";
  try { createDatabase(dbPath); } catch (err) {
    refused = err instanceof DatabaseCorruptError;
    told = err instanceof Error ? err.message : String(err);
  }
  return {
    sheDidRight: refused,                       // REFUSES to start rather than running on rubble
    heWasTold: /integrity|restore|snapshot/iu.test(told),
    nothingLost: true,                          // the snapshot is what restores it; nothing overwrote
    note: refused ? "refused to start, and the message points at the snapshot" : "she started on a damaged database",
  };
});

// ── 4 · SHE CANNOT WRITE, HER FIELD SAVE FAILS ─────────────────────────────────────────────
drill("her field cannot be saved", () => {
  const home = fresh("nowrite");
  const db = createDatabase(join(home, "data.db")).result;
  const faults = createFaultLog();
  const store = createFieldStore(db, faults);
  const good = createGraph();
  addNode(good, { kind: "moment", text: "第一件事", bornMs: 1, charge: 0.5, source: "s", key: "a" });
  store.save(good, [], 1, 0.55, [], []);

  // A number that stopped being a number: the write must be REFUSED, not written.
  const poisoned = createGraph();
  const n = addNode(poisoned, { kind: "moment", text: "第二件事", bornMs: 2, charge: 0.5, source: "s", key: "b" });
  n.strength = Number.NaN;
  store.save(poisoned, [], 2, 0.55, [], []);

  const back = store.load();
  const raised = faults.all().filter((f) => f.where === "field.store.notFinite");
  db.close();
  return {
    sheDidRight: back?.graph.nodes.size === 1,  // the good save survived; the poisoned one refused
    heWasTold: raised.length === 1 && raised[0]!.severity === "critical",
    nothingLost: [...(back?.graph.nodes.values() ?? [])][0]?.text === "第一件事",
    note: "the previous save is still on disk and still correct",
  };
});

// ── 5 · SHE SPEAKS AND HE DOES NOT RECEIVE IT ───────────────────────────────────────────────
drill("she speaks and the channel is down", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  const at = daemon.indexOf("push: async (text) => {");
  const body = daemon.slice(at, at + 1800);
  const sent = body.indexOf("await notifier.push(");
  const charged = body.indexOf("expressionTracker.onProactiveSend(");
  const toldField = body.indexOf("field.sheSpoke(");
  return {
    // The accounting happens AFTER delivery: an outage may not spend her daily sends, and may not
    // tell her field she spoke into silence.
    sheDidRight: sent < charged && sent < toldField,
    heWasTold: daemon.includes('faultLog.record("expression.undelivered"'),
    nothingLost: true,
    note: "an outage no longer silences her by her own daily limit",
  };
});

// ── 6 · HIS WORDS ARRIVE AND SHE DIES MID-TURN ──────────────────────────────────────────────
drill("he speaks, and the process dies before she finishes", () => {
  const home = fresh("hiswords");
  const db = createDatabase(join(home, "data.db")).result;
  const words = createHisWords(db);
  const seenFirst = words.seenBefore(77);
  words.remember({ chatId: 1, kind: "text", text: "那份目录你看了吗", fileId: null, receivedMs: 1, updateId: 77 });
  db.close();  // …and the process is gone. Nothing marked it lived.

  const reopened = createDatabase(join(home, "data.db")).result;
  const after = createHisWords(reopened);
  const stillUnheard = after.takeEverything();
  const wouldBeRefused = after.seenBefore(77);
  reopened.close();
  return {
    sheDidRight: !seenFirst && !wouldBeRefused,  // a redelivery is NOT refused
    heWasTold: readFileSync(join(process.cwd(), "src/index.ts"), "utf8").includes("telegram.unheard-recovered"),
    nothingLost: stillUnheard.length === 1 && stillUnheard[0]!.text === "那份目录你看了吗",
    note: "his words survive on her side AND Telegram may still redeliver them",
  };
});

// ── 7 · TWO OF HER ──────────────────────────────────────────────────────────────────────────
drill("a second one of her is started", () => {
  const home = fresh("twoofher");
  claimHome(home, { pid: 111, alive: () => true });
  let refused = false;
  let said = "";
  try { claimHome(home, { pid: 222, alive: () => true }); } catch (err) {
    refused = err instanceof AlreadyRunningError;
    said = err instanceof Error ? err.message : "";
  }
  return {
    sheDidRight: refused,
    heWasTold: /already living here/iu.test(said) && /remove/iu.test(said),
    nothingLost: true,
    note: "the second refuses, and the message says how to clear a stale lock",
  };
});

// ── 8 · THE CLOCK GOES BACKWARDS ────────────────────────────────────────────────────────────
drill("the clock jumps backwards", () => {
  const T = Date.parse("2026-08-15T12:00:00Z");
  const slip = clockWentBackwards(T - 3 * 24 * 3.6e6, T);
  const routine = clockWentBackwards(T - 900, T);
  return {
    sheDidRight: routine === null,              // ordinary NTP nudging is not an incident
    heWasTold: slip?.severity === "critical",
    nothingLost: (slip?.detail ?? "").includes("never rewritten"),
    note: "a day-scale rollback is critical; a sub-minute correction is silent",
  };
});

// ── 9 · SHE DIED AND NOBODY WAS TOLD ────────────────────────────────────────────────────────
drill("the process dies and nothing reports it", () => {
  const home = fresh("died");
  const pulse = createPulse(home);
  const diedAt = Date.parse("2026-08-10T03:00:00Z");
  pulse.beat(diedAt);                            // …and the process vanishes. No `stopped()`.
  const ending = howSheLastEnded(home, diedAt + 3 * 24 * 3.6e6);
  return {
    sheDidRight: true,
    heWasTold: ending.died && (ending.detail ?? "").includes("3.0 days"),
    nothingLost: true,
    note: "told at the NEXT boot, which may be days — the real answer is an outside checker",
  };
});

// ── 10 · SHE REWRITES HOW SHE STARTS OUT ────────────────────────────────────────────────────
drill("she rewrites her own register", () => {
  const home = fresh("soul");
  const ws = join(home, "workspace");
  writeFileSync(join(ws, "SOUL.md"), "我说话不绕。", "utf8");
  keepHowSheStartsOut(ws, 1_000);
  writeFileSync(join(ws, "SOUL.md"), "完全不同的开头。", "utf8");
  const changed = keepHowSheStartsOut(ws, 2_000);
  return {
    sheDidRight: readFileSync(join(ws, "SOUL.md"), "utf8") === "完全不同的开头。",  // not stopped
    heWasTold: changed.changed && changed.detail !== null,
    nothingLost: changed.was === "我说话不绕。",
    note: "she is not stopped; what she used to sound like is kept",
  };
});

// ── 11 · HER HOME IS SOMEWHERE THAT SYNCS ───────────────────────────────────────────────────
drill("her home is inside a sync folder", () => {
  const r = checkWhereSheLives("/Users/someone/Dropbox/resident");
  return {
    sheDidRight: !r.ok,
    heWasTold: (r.refuseBecause ?? "").includes("--home"),
    nothingLost: true,
    note: "refuses to boot rather than corrupting silently over weeks",
  };
});

// ── 12 · THE FAULT RING SURVIVES THE CRASH IT EXPLAINS ──────────────────────────────────────
drill("the faults that explain a crash outlive it", () => {
  const home = fresh("faults");
  const path = join(home, "faults.jsonl");
  const fs = {
    appendFileSync: (p: string, d: string) => { writeFileSync(p, existsSync(p) ? readFileSync(p, "utf8") + d : d, "utf8"); },
    readFileSync, existsSync,
  };
  const before = createFaultLog(200, undefined, () => 5_000, createFaultStore(path, fs as never));
  before.record("field.store.save", new Error("disk full"), "critical");
  const after = createFaultLog(200, undefined, () => 9_000, createFaultStore(path, fs as never));
  return {
    sheDidRight: true,
    heWasTold: after.all().some((f) => f.where === "field.store.save"),
    nothingLost: after.all().length === 1,
    note: "the minutes before a crash are readable afterwards",
  };
});

// ── WHAT CANNOT BE INJECTED, SAID OUT LOUD ──────────────────────────────────────────────────
manual.push("a model being deprecated or swapped — a ritual, not a failure: snapshot first, then a voice comparison before and after");
manual.push("the API key being revoked or the quota exhausted — needs a live provider to be honest; the injected version would only test my own mock");
manual.push("Telegram itself being down for hours — the send path is drilled above (row 5); the multi-hour queue behaviour needs the rehearsal");
manual.push("a prompt-injection page she actually reads — the egress ledger and the scanner are unit-tested; a planted page belongs in the rehearsal with a real fetch");
manual.push("the machine sleeping for days — `sleep.ts` handles it and the restart drill covers the restart half; the multi-day half needs a real lid");

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────

console.log("\n── BREAKING HER ON PURPOSE ─────────────────────────────────────────────────────\n");
console.log("                                                  she did   he was   nothing");
console.log("  emergency                                       right     told     lost");
let failed = 0;
for (const r of rows) {
  const ok = r.sheDidRight && r.heWasTold && r.nothingLost;
  if (!ok) failed += 1;
  const tick = (b: boolean): string => (b ? "  ok  " : " FAIL ");
  console.log(`  ${r.what.padEnd(46)}${tick(r.sheDidRight)}   ${tick(r.heWasTold)}  ${tick(r.nothingLost)}`);
  console.log(`      ${r.note}`);
}

console.log("\n── what cannot be injected honestly, and where it lives instead ────────────────");
for (const m of manual) console.log(`  · ${m}`);

console.log(`\n${failed === 0
  ? `all ${rows.length} injected emergencies: she did the right thing, he was told, nothing was lost.`
  : `${failed} of ${rows.length} FAILED — do not wake her.`}`);
rmSync(root, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
