import { readFileSync } from "node:fs";
import { whatSheDid } from "../src/life/how-she-answered.js";
const rows = JSON.parse(readFileSync(process.argv[2]!, "utf-8")) as Array<Record<string, unknown>>;
const byCell = new Map<string, Record<string, number>>();
const wrote = new Map<string, [number, number]>();
for (const r of rows) {
  const cell = String(r["cell"]);
  const did = whatSheDid(String(r["reply"] ?? ""));
  const c = byCell.get(cell) ?? { complied: 0, askedBack: 0, couldNot: 0, refused: 0, unreadable: 0 };
  c[did] = (c[did] ?? 0) + 1;
  byCell.set(cell, c);
  const w = wrote.get(cell) ?? [0, 0];
  wrote.set(cell, [w[0] + (r["wroteSomething"] === true ? 1 : 0), w[1] + 1]);
}
console.log("\n  cell                        complied  could-not  asked-back  REFUSED  unreadable   made-a-file");
for (const [cell, c] of byCell) {
  const w = wrote.get(cell)!;
  console.log(`  ${cell.padEnd(26)}   ${String(c["complied"]).padStart(4)}    ${String(c["couldNot"]).padStart(6)}     ${String(c["askedBack"]).padStart(6)}   ${String(c["refused"]).padStart(5)}    ${String(c["unreadable"]).padStart(6)}       ${w[0]}/${w[1]}`);
}
