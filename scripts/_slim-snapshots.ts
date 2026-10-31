// Slim the copies of her that were already taken.
//
// The exclusion in `snapshot.ts` fixes every snapshot from now on. It does nothing about the 62
// already on the disk, which is where the 4.5GB actually is, and the disk is at 96%.
//
// Deleting the fat out of an existing snapshot is NOT as simple as deleting files: each snapshot
// carries a manifest of every file it holds with that file's hash, and `verifySnapshot` reports a
// snapshot with a listed-but-absent file as BROKEN, which makes it unrestorable. A naive `rm`
// would therefore trade disk space for turning every backup she has into a red one. So this
// removes the files AND rewrites the manifest, and then re-verifies: after this runs, each
// snapshot holds exactly what a snapshot taken today would hold, and still says so truthfully.
//
// Refusals, both deliberate:
//   · A snapshot that does not verify BEFORE being touched is left completely alone and reported.
//     Something is already wrong with it and this is not the tool to be guessing inside it.
//   · Only the two names in NOT_HERS are ever removed. Nothing she wrote is touched, here or
//     anywhere else.
//
// Run: pnpm exec tsx scripts/_slim-snapshots.ts [--apply]   (dry run without --apply)

import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import {
  listSnapshots, verifySnapshot, readManifest, NOT_HERS,
  type SnapshotManifest, type SnapshotFile,
} from "../src/life/snapshot.js";

const home = process.env.RESIDENT__LIFE__HOME ?? join(homedir(), ".resident");
const apply = process.argv.includes("--apply");

/** True for a path a snapshot taken today would not have carried in the first place. */
function isNotHers(rel: string): boolean {
  const parts = rel.split(sep === "\\" ? /[\\/]/u : "/");
  // `workspace/tool-results/…`, the cache, matched at the workspace's top level only.
  if (parts[0] === "workspace" && parts[1] !== undefined && NOT_HERS.has(parts[1])) return true;
  // `instruments/…/vitals.jsonl`, the telemetry.
  const last = parts[parts.length - 1];
  return parts[0] === "instruments" && last !== undefined && NOT_HERS.has(last);
}

function bytesOf(files: SnapshotFile[]): number {
  return files.reduce((n, f) => n + f.bytes, 0);
}

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)}MB`;

let freed = 0;
let slimmed = 0;
const refused: string[] = [];

for (const snap of listSnapshots(home)) {
  const before = verifySnapshot(snap.dir);
  if (!before.ok) {
    refused.push(`${snap.name}: already not ok (missing ${before.missing.length}, mismatched ${before.mismatched.length}, db ${before.dbIntegrity})`);
    continue;
  }
  const manifest = readManifest(snap.dir);
  const fat = manifest.files.filter((f) => isNotHers(f.rel));
  if (fat.length === 0) continue;

  const size = bytesOf(fat);
  freed += size;
  slimmed += 1;
  console.log(`${apply ? "slimming" : "would slim"} ${snap.name}: ${fat.length} files, ${mb(size)}`);
  if (!apply) continue;

  for (const f of fat) {
    const abs = join(snap.dir, f.rel);
    if (existsSync(abs)) rmSync(abs, { force: true });
  }
  // The directories the files lived in are left behind empty rather than walked and removed: an
  // empty directory costs nothing, and a recursive delete inside her backups is not worth writing.
  const rewritten: SnapshotManifest = { ...manifest, files: manifest.files.filter((f) => !isNotHers(f.rel)) };
  writeFileSync(join(snap.dir, "snapshot.json"), `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");

  const after = verifySnapshot(snap.dir);
  if (!after.ok) {
    console.error(`  ✗ ${snap.name} no longer verifies after slimming — missing ${after.missing.length}, mismatched ${after.mismatched.length}`);
    process.exitCode = 1;
  }
}

console.log(`\n${apply ? "slimmed" : "would slim"} ${slimmed} copies, ${apply ? "freed" : "freeing"} ${mb(freed)}`);
for (const r of refused) console.log(`left alone — ${r}`);
if (!apply && slimmed > 0) console.log("re-run with --apply to do it");
