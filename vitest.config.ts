import { defineConfig, coverageConfigDefaults } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // The thresholds sit at the measured floor, not at an aspiration. An earlier `lines: 80`
      // was declared here and never evaluated by any command that ran. When coverage first
      // actually ran, lines stood at 73.18%. A threshold above reality fails every run and gets
      // ignored. A threshold at reality runs, blocks regressions, and goes up when coverage does.
      // Raise these when a run reports durably higher numbers. Run with `pnpm run test:coverage`.
      //
      // ── WHY SOME PATHS ARE EXCLUDED ─────────────────────────────────────────────────────
      //
      // The line ratio slid 73.18, 73.15, 73.03, 72.99 over four measurements, each drop small
      // enough to wave through. Chasing the number found the real defect: the ratio was not
      // measuring what it claimed to. About 7,000 lines in the denominator are never executed by
      // the unit suite, by design, so every honest addition to them pushed the ratio down
      // without adding any untested logic:
      //
      //   src/index.ts        the daemon: wiring, not logic. It cannot be unit-tested. It is
      //                       checked instead by 32 test files that read it as source and assert
      //                       on its structure (wiring-integration, every-path-is-hers,
      //                       her-words, no-dead-parts, state-decides, and others). Line
      //                       coverage cannot see that method.
      //   scripts/**          drills and measurement harnesses (voice-baseline, body-smoke,
      //                       judge tallies). They run by hand against the live model and never
      //                       run in the unit suite.
      //   client/**, face.js  browser-side code. Node cannot execute it. The body-smoke
      //                       Playwright harness exercises it.
      //   **/types.ts         type-only modules with no executable statements.
      //
      // Excluding these makes the threshold stricter, not looser: it removes lines that were
      // absorbing real regressions and lets the threshold sit high enough to catch them. The
      // cost is that logic placed in an excluded path is invisible here, so new logic belongs in
      // a module under src/, never in index.ts.
      //
      // With the denominator honest, a drop has no innocent explanation. Do not lower the
      // thresholds. Write the tests, or move the logic out of the excluded path.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/index.ts",
        "scripts/**",
        "client/**",
        "**/embodiment/client/**",
        "**/types.ts",
        "src/types/**",
      ],
      // Measured on this denominator: 83.59 / 80.24 / 92.88, each set slightly lower to absorb
      // run-to-run jitter.
      thresholds: {
        lines: 83.5,
        branches: 80.2,
        functions: 92.8,
      },
    },
  },
});
