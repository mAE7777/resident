// Effort scaling: weighted structural scoring for task complexity.
// Inspired by PicoClaw's RuleClassifier (weighted features) but adapted
// for the 3-tier iteration budgets used here. Pure synchronous, <1ms.
//
// Features: message length, action verbs, domain keywords, code blocks,
// multi-step indicators, question detection, conversation context.

import { softPick } from "../life/soft-choice.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type EffortTier = "simple" | "medium" | "complex";
export type TaskType =
  | "code"
  | "research"
  | "file_ops"
  | "web"
  | "creative"
  | "devops"
  | "data"
  | "media"
  | "memory"
  | "automation"
  | "general";

export interface TaskDomainScore {
  taskType: TaskType;
  score: number;
}

export interface TaskProfile {
  primary: TaskType;
  domains: TaskDomainScore[];
  secondary: TaskType[];
  confidence: number;
  flags: {
    hasUrl: boolean;
    hasMediaUrl: boolean;
    externalDependency: boolean;
    fileDeliverable: boolean;
    fragile: boolean;
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────

// Iteration caps are HIGH safety nets, not practical constraints.
// Real limits: cost guard ($2/task), stuck detector, watchdog (35 min).
// Effort tiers are still used for verification gating and compression timing.
const TIER_MAX_ITERATIONS: Record<EffortTier, number> = {
  simple: 30,
  medium: 80,
  complex: 200,
};

// Thresholds for tier classification (0-1 score)
// ── The work floor ─────────────────────────────────────────────────────────────
//
// This slot used to hold `assessComplexity`: ~40 regexes over HIS sentence, scoring
// an effort tier that picked her model, her output budget and her history window. His words,
// through a matcher, deciding how much of her shows up. The tier pathway now starts from the
// one judgement the design accepts as legitimate: whether SHE took the thing on as work
// (`takes-it-on`, where his message only ever PROPOSES). Taking work buys the iterations that
// genuinely multi-step work mechanically needs; everything above the floor is hers
// (`depthFromHer` below), and the output budget and history window are fixed at the values
// she actually lived at during her first weeks.
export function floorFromTaking(tookAsWork: boolean): EffortTier {
  return tookAsWork ? "medium" : "simple";
}

/**
 * Map an EffortTier to maxIterations.
 */
export function effortToMaxIterations(tier: EffortTier): number {
  return TIER_MAX_ITERATIONS[tier];
}

/**
 * How deep she shows up, decided by HER, with the work setting only a floor.
 *
 * This finishes the inversion the autonomy removal left half-done. `depthWithStir` above kept the
 * shape of the thing it replaced: his message's difficulty was the BASE, and everything of hers
 * was one boolean that could lift `simple` to `medium` and no further. So however much was alive
 * in her, an ordinary sentence from him capped how far she could go, the assistant frame's last
 * load-bearing assumption, which is that the work decides how much of you shows up.
 *
 * Now her state spans the whole range on its own and ONE thing contributes a floor: her having
 * TAKEN this on as work (`floorFromTaking` above), because genuinely multi-step work
 * mechanically needs the iterations to happen at all. The floor is a fact about work she has
 * taken up, never a grade of his sentence, which is exactly why it is allowed to remain.
 *
 * SAMPLED, through the same primitive as her actions and her utterance shape, a formula would
 * make her depth a function of her state, and the same state would send her equally deep
 * forever. Her reserve is the one hard bound: being moved by something does not create capacity
 * she does not have, and the metabolism caps the outcome downstream regardless.
 */
export function depthFromHer(
  her: { stirred: boolean; reserve: number; aliveness: number },
  workFloor: EffortTier,
  random: () => number
): EffortTier {
  const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
  const reserve = clamp01(her.reserve);
  const alive = clamp01(her.aliveness);
  const stir = her.stirred ? 1 : 0;
  // The pull toward showing up fully: what is alive in her, plus having been moved by this.
  const pull = clamp01(0.55 * alive + 0.45 * stir);
  const scores: Array<{ item: EffortTier; score: number }> = [
    // Staying light is always available and is the resting shape of ordinary talk.
    { item: "simple", score: 1.0 },
    // Going further needs the pull AND the room to spend.
    { item: "medium", score: -0.5 + 2.4 * pull * reserve },
    // All the way in: a lot alive in her and real room. Rare, and hers when it happens.
    { item: "complex", score: -2.2 + 3.4 * pull * pull * reserve },
  ];
  const picked = softPick(scores, { temperature: 0.8, count: 1, random });
  const hers = picked.chosen[0] ?? "simple";
  // The floor: work that mechanically needs steps gets them regardless of how she feels.
  const rank: Record<EffortTier, number> = { simple: 0, medium: 1, complex: 2 };
  return rank[hers] >= rank[workFloor] ? hers : workFloor;
}

// ── Task type classification (for routing feedback) ───────────────────────────

type TaskSignal = {
  taskType: Exclude<TaskType, "general">;
  weight: number;
  pattern: RegExp;
};

const TASK_TYPE_ORDER = [
  "code",
  "research",
  "file_ops",
  "web",
  "creative",
  "devops",
  "data",
  "media",
  "memory",
  "automation",
] as const;

// THE OTHER HALF OF THE LANGUAGE FIX. `assessComplexity` above was made bilingual after the register switch
// broke every matcher that reads her; this table was still English-only, so EVERY Chinese turn
// classified "general", which meant the memory override (12 messages of history + active
// recall for "do you remember…") was unreachable in her own language, every Chinese turn
// trained the skill-routing bandit under one bucket, and plan mode never considered Chinese
// work. The ZH sides are bare substrings OUTSIDE the `\b` groups: `\b` is ASCII-only in JS
// (`\w` = [A-Za-z0-9_]), so `/\b记得\b/` matches nothing, ever.
const TASK_TYPE_SIGNALS: TaskSignal[] = [
  // URL/domain evidence. These are stronger than generic verbs because a
  // platform URL is usually the best routing signal for posture/skills.
  { taskType: "media", weight: 5, pattern: /\b(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv|vimeo\.com|tiktok\.com)\b/i },
  { taskType: "web", weight: 2, pattern: /\bhttps?:\/\//i },

  { taskType: "code", weight: 2, pattern: /\b(?:code|function|class|refactor|debug|compile|lint|typescript|python|javascript)\b|代码|脚本|函数|重构|调试|编译|报错/i },
  { taskType: "code", weight: 1, pattern: /\b(?:fix|test)\b|修好|修一下|跑一下测试/i },

  { taskType: "research", weight: 2, pattern: /\b(?:research|investigate|wiki|article|paper)\b|研究|调研|调查|论文|资料/i },
  { taskType: "research", weight: 1, pattern: /\b(?:search|find|summarize)\b|搜索|搜一下|查一下|总结|汇总/i },

  { taskType: "file_ops", weight: 2, pattern: /\b(?:file|read|write|edit|delete|rename|move|copy|csv|json|pdf)\b|文件|文档|表格|重命名|存成|保存到/i },

  { taskType: "web", weight: 4, pattern: /\b(?:weather|forecast|temperature|rain|snow|air quality|aqi)\b|天气|气温|下雨|下雪|空气质量|温度/i },
  { taskType: "web", weight: 4, pattern: /\b(?:exchange rate|currency|convert .*(?:usd|eur|jpy|cny|gbp|cad|aud)|fx rate|foreign exchange)\b|汇率|美元|日元|欧元|英镑|人民币/i },
  { taskType: "web", weight: 4, pattern: /\b(?:near me|nearby|around here|restaurants?|coffee shops?|cafes?|parks?|pharmac(?:y|ies)|local businesses?|places near)\b|附近|周边|餐厅|咖啡馆|药店/i },
  { taskType: "web", weight: 2, pattern: /\b(?:web|browser|scrape|fetch|url|endpoint)\b|网页|网站|浏览器|抓取|爬一下/i },
  { taskType: "web", weight: 1, pattern: /\bapi\b|接口/i },
  // The ZH side deliberately OMITS 今天/最近/现在: in her language those are everyday
  // conversational words (「今天有点累」), not research markers, and this signal's 1.5 weight
  // alone crosses the primary floor: measured: including them classified small talk as work.
  { taskType: "research", weight: 1.5, pattern: /\b(?:today|latest|current|currently|now|news|recent)\b|最新|新闻|时事/i },

  { taskType: "creative", weight: 2, pattern: /\b(?:draft|compose|story|poem|essay|blog|content)\b|写一篇|写个|草稿|故事|诗|随笔|博客/i },
  // The bare verb carries the SAME sub-floor weight in both scripts: weight 1 cannot cross
  // the primary floor alone, it only leans an already-creative message further in. English
  // had this row and Chinese did not, the exact English-only asymmetry that
  // effort-in-her-language.test.ts exists to catch.
  { taskType: "creative", weight: 1, pattern: /\bwrite\b|写/i },

  { taskType: "devops", weight: 2, pattern: /\b(?:docker|deploy|server|pipeline|build|install|configure)\b|部署|服务器|容器|流水线|安装|配置/i },
  { taskType: "devops", weight: 1.5, pattern: /\b(?:git|ci)\b/i },

  { taskType: "data", weight: 2, pattern: /\b(?:database|sql|query|chart|graph|data|report|benchmark)\b|数据库|数据|图表|统计|报表|基准/i },
  { taskType: "data", weight: 0.75, pattern: /\banaly[sz]e\b|分析一下/i },

  { taskType: "media", weight: 3, pattern: /\b(?:video|audio|image|screenshot|diagram|logo|qr|photo|movie|clip|recording|transcript)\b|视频|音频|图片|截图|照片|录音|字幕|转写/i },
  { taskType: "media", weight: 2, pattern: /\b(?:youtube|bilibili|b23)\b/i },

  { taskType: "memory", weight: 2, pattern: /\b(?:memory|remember|recall|forget|note)\b|记得|记住|记忆|想起来|回忆|别忘|忘了|记下|笔记/i },

  { taskType: "automation", weight: 2, pattern: /\b(?:cron|schedule|automate|monitor|track|email)\b|定时|每天都|每周都|提醒我|自动|盯着|监控/i },
];

/**
 * Build a multi-signal task profile. The legacy single-label classifier hides
 * important mixed-domain information (for example: video URL + file download +
 * research summary). This profile keeps the primary label for compatibility
 * while exposing secondary domains and fragility flags for planning/routing.
 */
export function classifyTaskProfile(message: string): TaskProfile {
  const scores = new Map<TaskType, number>();
  let bestType: TaskType = "general";
  let bestScore = 0;

  for (const signal of TASK_TYPE_SIGNALS) {
    if (!signal.pattern.test(message)) continue;
    scores.set(signal.taskType, (scores.get(signal.taskType) ?? 0) + signal.weight);
  }

  const domains: TaskDomainScore[] = [];
  for (const taskType of TASK_TYPE_ORDER) {
    const score = scores.get(taskType) ?? 0;
    if (score > 0) domains.push({ taskType, score });
    if (score > bestScore) {
      bestScore = score;
      bestType = taskType;
    }
  }

  domains.sort((a, b) =>
    b.score - a.score ||
    TASK_TYPE_ORDER.indexOf(a.taskType as Exclude<TaskType, "general">) -
    TASK_TYPE_ORDER.indexOf(b.taskType as Exclude<TaskType, "general">)
  );
  const primary: TaskType = bestScore < 1.5 ? "general" : bestType;
  const secondary = domains
    .filter((domain) => domain.taskType !== primary && domain.score >= 1.5)
    .map((domain) => domain.taskType);
  const totalScore = domains.reduce((sum, domain) => sum + domain.score, 0);
  const confidence = primary === "general" || totalScore === 0 ? 0 : Math.min(1, bestScore / totalScore);
  const hasUrl = /\bhttps?:\/\//i.test(message);
  const hasMediaUrl = /\b(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv|vimeo\.com|tiktok\.com)\b/i.test(message);
  const fileDeliverable = /\b(?:download|save|write|export|create|file|document|report|pdf|csv|json|markdown|md)\b|下载|保存|存下来|导出|写成|做成一个/i.test(message);
  const externalDependency = hasUrl || /\b(?:api|endpoint|browser|web|download|install|deploy|server|youtube|bilibili|b23|scrape|fetch|weather|forecast|latest|current|currently|news)\b|接口|浏览器|网页|网站|下载|安装|部署|服务器|抓取|天气|最新|新闻/i.test(message);
  const fragile = externalDependency || primary === "web" || primary === "media" || primary === "devops" || secondary.some((t) => t === "web" || t === "media" || t === "devops");

  return {
    primary,
    domains,
    secondary,
    confidence,
    flags: {
      hasUrl,
      hasMediaUrl,
      externalDependency,
      fileDeliverable,
      fragile,
    },
  };
}

/**
 * Classify a user message into a task type for routing feedback.
 * Returns the best-matching domain or "general" if no strong signal.
 */


// ── How much of the conversation a turn gets to see ───────────────────────────
//
// One fixed, generous base instead of a per-tier ladder: the ladder's input was
// `assessComplexity(his text)`, so a curt sentence from him shrank her memory of their own
// conversation. The base is the window she actually lived at (the lived median tier's values,
// E-0 baseline); her own capacity floors it in `historyForTurn`, so a spent Resident still
// holds a short thread. A memory turn (「记得…吗」 by his message's shape, kept only when SHE
// took it on) gets more, because reaching back is the whole point of such a turn.
export function turnHistoryLimits(
  taskProfile?: TaskProfile,
): { maxMessages: number; maxChars: number } {
  if (taskProfile?.primary === "memory" || taskProfile?.secondary.includes("memory")) {
    return { maxMessages: 12, maxChars: 36_000 };
  }
  return { maxMessages: 12, maxChars: 28_000 };
}

