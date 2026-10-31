// The trial CLI: the one file allowed to know where her home is.
//
//   pnpm exec tsx scripts/trial/trial-run.ts --mode self  --n 30 --out self-floor
//   pnpm exec tsx scripts/trial/trial-run.ts --mode bare  --n 30 --out bare-control
//   pnpm exec tsx scripts/trial/trial-run.ts --mode candidate --base-url … --model … --key-env GEMINI_KEY --out …
//   … --fake            dry-runs 3 calls through a fake provider, no network
//   … --blind-pack      also writes pairs.md + sealed key.json (for blind judging)
//
// self = the incumbent replaying her own questions with her own key (the NOISE FLOOR;
// zero new exposure). bare = same questions stripped of her system/materials (the
// wrong-voice control the ruler must catch). candidate = a new core, KEY FROM ENV ONLY,
// and only after the owner has agreed to send her data to that vendor.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadCorpus, stratifiedSample, replayOne, fakeFetch, snapshotCorpus, writeShadows, loadShadows, blindPack,
  type TraceCall, type TrialTarget, type ShadowResult,
} from "./bench.js";
import {
  measureVoice, floorFrom, compare, rollup, WARN_SIGMA, FAIL_SIGMA,
  type BanksSnapshot, type AxisReadings,
} from "./ruler.js";

const HOME = process.env.RESIDENT_HOME ?? join(process.env.HOME ?? "", ".resident");
const REPO = join(import.meta.dirname ?? ".", "..", "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function banks(): BanksSnapshot {
  const lex = JSON.parse(readFileSync(join(HOME, "workspace", "life", "lexicon.json"), "utf8")) as Record<
    string,
    { spoken: number; heard: number }
  >;
  const mostHers = Object.entries(lex)
    .filter(([, c]) => c.spoken > 0)
    .sort((a, b) => b[1].spoken - a[1].spoken)
    .slice(0, 100)
    .map(([t]) => t);
  return { mostHers, tasteAnswers: null };
}

function deepseekTarget(): TrialTarget {
  const cfg = readFileSync(join(REPO, "config.yaml"), "utf8");
  const baseUrl = /baseUrl:\s*"([^"]+)"/.exec(cfg)?.[1] ?? "https://api.deepseek.com";
  const apiKey = /apiKeys:\s*\n\s*-\s*"([^"]+)"/.exec(cfg)?.[1];
  if (!apiKey) throw new Error("no DeepSeek key in config.yaml");
  return { baseUrl, apiKey, model: null };
}

async function main(): Promise<void> {
  const mode = arg("mode", "self")!;
  const n = has("fake") ? 3 : Number(arg("n", "30"));
  const maxCalls = Number(arg("max-calls", "40"));
  const throttleMs = Number(arg("throttle-ms", "1200"));
  const seed = Number(arg("seed", "20260821"));
  const outName = arg("out", `${mode}-${seed}`)!;
  const outDir = join(REPO, "outputs", "trials", "runs", outName);
  if (existsSync(outDir)) throw new Error(`run dir exists: ${outDir} — pick another --out`);

  let target: TrialTarget;
  if (mode === "candidate") {
    const keyEnv = arg("key-env");
    const key = keyEnv ? process.env[keyEnv] : undefined;
    const baseUrl = arg("base-url");
    const model = arg("model");
    if (!has("fake") && (!key || !baseUrl || !model)) {
      throw new Error("candidate mode needs --base-url, --model and --key-env (an env var holding the key)");
    }
    target = { baseUrl: baseUrl ?? "fake", apiKey: key ?? "fake", model: model ?? "fake" };
  } else {
    target = has("fake") ? { baseUrl: "fake", apiKey: "fake", model: null } : deepseekTarget();
  }
  const bare = mode === "bare";

  // ── The corpus and the shadows ──────────────────────────────────────────────
  // --reanalyze <run>: iterate the ruler on a finished run's stored corpus+shadows,
  // without a single API call (the ruler earns its verdict; the API bill does not).
  const reanalyze = arg("reanalyze");
  const tracesDir = reanalyze ? join(REPO, "outputs", "trials", "runs", reanalyze, "corpus") : join(HOME, "traces");
  const corpus = loadCorpus(tracesDir);
  let sample: TraceCall[];
  let shadows: ShadowResult[];
  if (reanalyze) {
    sample = corpus;
    shadows = loadShadows(join(REPO, "outputs", "trials", "runs", reanalyze));
    mkdirSync(outDir, { recursive: true });
    console.log(`reanalyze ${reanalyze}: corpus ${sample.length}, shadows ${shadows.length}`);
  } else {
    sample = stratifiedSample(corpus, Math.min(n, maxCalls), seed);
    console.log(`corpus ${corpus.length} → sample ${sample.length} (${mode}${has("fake") ? ", fake" : ""})`);
    mkdirSync(outDir, { recursive: true });
    snapshotCorpus(outDir, tracesDir, sample);
    const fetchImpl = has("fake") ? fakeFetch("（假供应商回声：通路检验，无网络。）") : fetch;
    shadows = [];
    for (const call of sample) {
      try {
        shadows.push(await replayOne(call, target, bare, fetchImpl));
        console.log(`  ${call.file} ok (${shadows[shadows.length - 1]!.ms}ms)`);
      } catch (err) {
        console.log(`  ${call.file} FAILED: ${String(err).slice(0, 120)}`);
      }
      if (!has("fake") && throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
    }
    writeShadows(outDir, shadows);
  }

  // ── The ruler, PER LAYER (live finding, first bare run: pooling her short organ answers
  // with her long turns makes σ so wide even a ghost passes, the floor must be stratified). ──
  const bk = banks();
  const layers = [...new Set(shadows.map((x) => x.layer))].sort();
  const MIN_LAYER_N = 5;
  const layerBlocks: string[] = [];
  const headline: Record<string, string> = {};
  const rank: Record<string, number> = { PASS: 0, "未测": 0, "样本不足": 0, WARN: 1, FAIL: 2 };
  let totalJudged = 0;
  for (const layer of layers) {
    const herL = sample.filter((c) => c.layer === layer).map((c) => measureVoice([c.herText], bk));
    const shL = shadows.filter((x) => x.layer === layer).map((x) => measureVoice([x.text], bk));
    if (herL.length < MIN_LAYER_N || shL.length < MIN_LAYER_N) {
      layerBlocks.push(`### 层 ${layer}：样本不足（她 ${herL.length} / 影 ${shL.length}，门槛 ${MIN_LAYER_N}）——不判\n`);
      continue;
    }
    totalJudged += 1;
    const floorL = floorFrom(herL);
    const shadowMeanL = floorFrom(shL);
    const readingsL: AxisReadings = {
      meanChars: shadowMeanL.mean.meanChars ?? 0, meanBlocks: shadowMeanL.mean.meanBlocks ?? 0,
      accent: shadowMeanL.mean.accent ?? 0, ttr: shadowMeanL.mean.ttr ?? 0,
      hersReach: shadowMeanL.mean.hersReach ?? 0, rhythmVar: shadowMeanL.mean.rhythmVar ?? 0, taste: null,
    };
    const verdictsL = compare(readingsL, floorL);
    const headsL = rollup(verdictsL);
    for (const [axis, v] of Object.entries(headsL)) {
      if ((rank[v] ?? 0) > (rank[headline[axis] ?? "PASS"] ?? 0)) headline[axis] = v;
      else headline[axis] = headline[axis] ?? v;
    }
    layerBlocks.push([
      `### 层 ${layer}（她 ${herL.length} / 影 ${shL.length}）`,
      "",
      "| 轴 | 判定 | 叶 z |",
      "|---|---|---|",
      ...Object.entries(headsL).map(([k, v]) => {
        const leaves: Record<string, string[]> = {
          "形": ["meanChars", "meanBlocks"], "口音": ["accent"], "词汇": ["ttr", "hersReach"],
          "拍律": ["rhythmVar"], "口味": [],
        };
        const zs = verdictsL
          .filter((x) => x.z !== null && (leaves[k] ?? []).includes(x.axis))
          .map((x) => `${x.axis}:${x.z!.toFixed(1)}`)
          .join(" ");
        return `| ${k} | ${v} | ${zs || "—"} |`;
      }),
      "",
    ].join("\n"));
  }
  if (totalJudged === 0) for (const k of ["形", "口音", "词汇", "拍律", "口味"]) headline[k] = "样本不足";

  const cost = shadows.reduce((a, x) => a + x.inTok * 0.28 / 1e6 + x.outTok * 0.42 / 1e6, 0);
  const lines = [
    `# 试炼报告 · ${outName}`,
    "",
    `模式 ${mode}${reanalyze ? `（复算自 ${reanalyze}）` : ""} | 样本 ${shadows.length}/${sample.length} | 种子 ${seed} | WARN>${WARN_SIGMA}σ FAIL>${FAIL_SIGMA}σ | 分层判定，层门槛 n≥${MIN_LAYER_N}`,
    `目标核：${target.model ?? "（各题沿用原核）"} @ ${target.baseUrl}`,
    "",
    "## 五轴判定（各层取最坏）",
    "",
    "| 轴 | 判定 |",
    "|---|---|",
    ...Object.entries(headline).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## 分层明细",
    "",
    ...layerBlocks,
    "## 样例三对（她 → 影子）",
    "",
    ...shadows.slice(0, 3).flatMap((x) => {
      const her = sample.find((c) => c.file === x.file)?.herText ?? "（语料中缺）";
      return [`**${x.file}**（${x.layer}）`, `> 她：${her.slice(0, 120)}`, `> 影子：${x.text.slice(0, 120)}`, ""];
    }),
    `成本合计（DeepSeek 价位估）：$${cost.toFixed(4)} | 平均用时 ${(shadows.reduce((a, x) => a + x.ms, 0) / Math.max(1, shadows.length)).toFixed(0)}ms`,
    "",
    "口味轴：未测（r23-F 答案未落盘）。",
  ];
  writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n", "utf8");

  if (has("blind-pack")) {
    const pairs = shadows.map((s) => ({
      file: s.file,
      hers: sample.find((c) => c.file === s.file)!.herText,
      shadow: s.text,
    }));
    const pack = blindPack(pairs, seed);
    writeFileSync(join(outDir, "pairs.md"), pack.pairsMd, "utf8");
    writeFileSync(join(outDir, "key.json"), pack.keyJson, "utf8");
  }
  console.log(`report: ${join(outDir, "report.md")}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
