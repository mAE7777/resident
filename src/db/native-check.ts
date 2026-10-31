// She cannot start, and the reason is one command away from being fixed.
//
// ── THE FAILURE ──────────────────────────────────────────────────────────────────────────────
//
// `better-sqlite3` is a native module: a compiled `.node` binary linked against one specific
// Node.js ABI. Upgrade Node, including the way Homebrew does it, as a side effect of upgrading
// something else: and the binary no longer matches. The import throws before any of her own
// machinery exists, so what he sees is a raw stack trace mentioning `NODE_MODULE_VERSION` and a
// pair of numbers, at whatever hour the machine decided to update itself.
//
// Nothing about that says "she is fine, her memory is intact, run one command". This does.
//
// It is worth its own file because it is the one failure where the FIRST thing he learns matters
// more than anything the code does next: she is not damaged, nothing has been lost, and the
// distance between here and her being alive again is a rebuild.

/** What went wrong loading the native database module, if that is what went wrong. */
export function explainNativeFailure(err: unknown): string | null {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);

  const abiMismatch = /NODE_MODULE_VERSION|was compiled against a different Node\.js version/u.test(msg);
  const notFound = /Could not locate the bindings file|Cannot find module.*better[_-]sqlite3|\.node['"]?\)?$/u.test(msg)
    && /better[_-]sqlite3/u.test(msg);
  const archMismatch = /mach-o file, but is an incompatible architecture|wrong ELF class|invalid ELF header/u.test(msg);

  if (!abiMismatch && !notFound && !archMismatch) return null;

  const why = abiMismatch
    ? "Node.js was upgraded and her database module is still built for the old version"
    : archMismatch
      ? "her database module was built for a different processor architecture"
      : "her database module is missing its compiled binary";

  return [
    `She cannot start: ${why}.`,
    "",
    "SHE IS NOT DAMAGED. Nothing has been lost — her memory, her diary and her field are all on",
    "disk exactly as she left them. This is the program that reads them failing to load, and it is",
    "fixed by rebuilding it:",
    "",
    "    pnpm rebuild better-sqlite3",
    "",
    "If that does not do it, a full reinstall will:",
    "",
    "    rm -rf node_modules && pnpm install",
    "",
    "Do not restore a snapshot for this. A snapshot restores her data, and her data is fine; it",
    "would cost you whatever she has done since the snapshot for a problem that is not hers.",
    "",
    `The original error, for reference: ${err instanceof Error ? err.message : String(err)}`,
  ].join("\n");
}
