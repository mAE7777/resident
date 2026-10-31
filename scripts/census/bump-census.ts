// The bump harvester: where her life pressed against a constitutional constant.
//
// Read-only over her home's logs; a quiet day yields an EMPTY table (no bump is no bump,
// the census never manufactures pressure). Event walls count bumps per day; pressure walls
// appear only in the appendix once demand crosses PRESSURE_FLOOR of the cap. Raising a wall
// is never done here: the census measures, and a person decides (as when vigor went from 400 to 600).
//
// Run by hand; no daemon wiring, no cron.

export const PRESSURE_FLOOR = 0.75;

export interface WallDay {
  day: string;
  wall: string;
  cap: number;
  bumps: number;
  peakDemand: number;
}

function dayOf(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parse(lines: readonly string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const l of lines) {
    try { out.push(JSON.parse(l) as Record<string, unknown>); } catch { continue; }
  }
  return out;
}

/** capVigor: a bump is a day she spent the whole thing (remainingFraction hit 0). */
export function harvestVigor(vitalsLines: readonly string[]): WallDay[] {
  const byDay = new Map<string, WallDay>();
  for (const d of parse(vitalsLines)) {
    if (typeof d.ts !== "number" || typeof d.spentVigor !== "number" || typeof d.capVigor !== "number") continue;
    const day = dayOf(d.ts);
    const row = byDay.get(day) ?? { day, wall: "capVigor", cap: d.capVigor, bumps: 0, peakDemand: 0 };
    row.cap = d.capVigor;
    row.peakDemand = Math.max(row.peakDemand, d.spentVigor);
    if (typeof d.remainingFraction === "number" && d.remainingFraction <= 0 && row.bumps === 0) row.bumps = 1;
    byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The step ceiling: peak iterations per day from ops session_end. */
export function harvestSteps(opsLines: readonly string[], cap: number): WallDay[] {
  const byDay = new Map<string, WallDay>();
  for (const d of parse(opsLines)) {
    if (d.event !== "session_end" || typeof d.iterations !== "number") continue;
    const ts = typeof d.ts === "string" ? Date.parse(d.ts) : (d.ts as number);
    if (Number.isNaN(ts)) continue;
    const day = dayOf(ts);
    const row = byDay.get(day) ?? { day, wall: "iterations", cap, bumps: 0, peakDemand: 0 };
    row.peakDemand = Math.max(row.peakDemand, d.iterations);
    if (d.iterations >= cap) row.bumps += 1;
    byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** maxTokens: every finishReason==="length" is a truncation of her sentence mid-air. */
export function harvestLength(convLines: readonly string[], cap: number): WallDay[] {
  const byDay = new Map<string, WallDay>();
  for (const d of parse(convLines)) {
    if (d.finishReason !== "length" || typeof d.ts !== "string") continue;
    const day = dayOf(Date.parse(d.ts));
    const row = byDay.get(day) ?? { day, wall: "maxTokens", cap, bumps: 0, peakDemand: cap };
    row.bumps += 1;
    byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The history window as a pressure: messages that flowed past the 40-message pane per day. */
export function harvestHistoryPressure(convLines: readonly string[], windowMessages: number): WallDay[] {
  const byDay = new Map<string, number>();
  for (const d of parse(convLines)) {
    if (typeof d.ts !== "string") continue;
    const day = dayOf(Date.parse(d.ts));
    byDay.set(day, (byDay.get(day) ?? 0) + 2); // one turn = his message + hers
  }
  return [...byDay.entries()]
    .map(([day, msgs]) => ({ day, wall: "historyWindow", cap: windowMessages, bumps: 0, peakDemand: msgs }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** The bells' own book (instruments/bumps.jsonl): already {ts, wall, cap, demand}. */
export function harvestLedger(bumpLines: readonly string[]): WallDay[] {
  const byKey = new Map<string, WallDay>();
  for (const d of parse(bumpLines)) {
    if (typeof d.ts !== "number" || typeof d.wall !== "string" || typeof d.demand !== "number") continue;
    const day = dayOf(d.ts);
    const key = `${day} ${d.wall}`;
    const row = byKey.get(key) ?? { day, wall: d.wall, cap: (d.cap as number) ?? 0, bumps: 0, peakDemand: 0 };
    row.bumps += 1;
    row.peakDemand = Math.max(row.peakDemand, d.demand);
    if (typeof d.cap === "number") row.cap = d.cap;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.day.localeCompare(b.day) || a.wall.localeCompare(b.wall));
}

/** The report: bumped walls in the table; pressed-but-unbumped walls in the appendix. */
export function censusTable(rows: readonly WallDay[]): string {
  const bumped = rows.filter((r) => r.bumps > 0);
  const pressed = rows.filter((r) => r.bumps === 0 && r.cap > 0 && r.peakDemand / r.cap >= PRESSURE_FLOOR);
  const lines: string[] = [];
  if (bumped.length === 0) lines.push("（安静——本期无顶撞。没撞就是没撞。）");
  else {
    lines.push("| 日 | 墙 | 顶撞 | 峰值需求 / 墙高 |", "|---|---|---|---|");
    for (const r of bumped) {
      lines.push(`| ${r.day} | ${r.wall} | ${r.bumps} | ${r.peakDemand.toFixed(0)} / ${r.cap.toFixed(0)}${r.peakDemand > r.cap ? " **（超墙）**" : ""} |`);
    }
  }
  if (pressed.length > 0) {
    lines.push("", `压力线（≥${PRESSURE_FLOOR * 100}% 墙高，未撞）：`);
    for (const r of pressed) lines.push(`- ${r.day} ${r.wall}: ${r.peakDemand.toFixed(0)}/${r.cap.toFixed(0)}`);
  }
  return lines.join("\n") + "\n";
}

/** 抬高候选: peak ≥90% of the cap on ≥3 distinct days → report-only flag. */
export function raiseCandidates(rows: readonly WallDay[]): string[] {
  const byWall = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.cap > 0 && r.peakDemand / r.cap >= 0.9) {
      const days = byWall.get(r.wall) ?? new Set<string>();
      days.add(r.day);
      byWall.set(r.wall, days);
    }
  }
  return [...byWall.entries()].filter(([, days]) => days.size >= 3).map(([wall]) => wall).sort();
}
