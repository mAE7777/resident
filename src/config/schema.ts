import { z } from "zod";
import { DEFAULT_DAILY_VIGOR } from "../life/vitality.js";
import { defaultDbPath, defaultWorkspacePath } from "./home.js";

const ModelConfigSchema = z.object({
  id: z.string(),
  maxContextTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  costPerMInputTokens: z.number().nonnegative(),
  costPerMOutputTokens: z.number().nonnegative(),
});

// ── WHAT USED TO BE HERE, AND WHY IT IS NOT ──────────────────────────────────────────────────
//
// `supportsExtendedThinking` and `supportsAdaptiveThinking` sat in this shape, were defaulted for
// three models, and were SET IN `config.yaml`, and nothing in the tree ever read either one.
//
// A dead constant is harmless. A dead CONFIG KEY is not: it is a switch in the file Eric edits
// that produces no effect and no complaint. He would set it and be silently ignored.
//
// They were also the wrong shape for the machine she actually runs on. Both name Anthropic
// concepts (a thinking budget in tokens; adaptive thinking) inherited from the parent project;
// her provider is `openai-compatible` against DeepSeek, where thinking is one boolean and the
// call site that wants it says so per request (`thinking: { type: "disabled" }`). Wiring an
// inherited declaration to a differently-shaped knob would have been inventing a mapping in order
// to make a key look used.

const defaultModels = {
  default: {
    id: "claude-sonnet-4-6",
    maxContextTokens: 1_000_000,
    maxOutputTokens: 64_000,
    costPerMInputTokens: 3,
    costPerMOutputTokens: 15,
  },
  upgrade: {
    id: "claude-opus-4-7",
    maxContextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    costPerMInputTokens: 5,
    costPerMOutputTokens: 25,
  },
  background: {
    id: "claude-haiku-4-5",
    maxContextTokens: 200_000,
    maxOutputTokens: 64_000,
    costPerMInputTokens: 1,
    costPerMOutputTokens: 5,
  },
};

const ModelsSchema = z.object({
  default: ModelConfigSchema.default(defaultModels.default),
  upgrade: ModelConfigSchema.default(defaultModels.upgrade),
  background: ModelConfigSchema.default(defaultModels.background),
});

const RateLimitsSchema = z.object({
  rpm: z.number().int().positive().default(60),
});

const LlmConfigSchema = z.object({
  models: ModelsSchema.default({
    default: defaultModels.default,
    upgrade: defaultModels.upgrade,
    background: defaultModels.background,
  }),
  // Which wire format the endpoint speaks. "anthropic" = Claude SDK;
  // "openai-compatible" = /chat/completions (DeepSeek, and most cheap providers).
  provider: z.enum(["anthropic", "openai-compatible"]).default("anthropic"),
  apiKeys: z.array(z.string()).default([]),
  baseUrl: z.string().default("https://api.anthropic.com"),
  rateLimits: RateLimitsSchema.default({ rpm: 60 }),
  dailyBudgetCents: z.number().int().positive().default(1000),
  // Her eye (providers/vision.ts): an OpenAI-compatible vision endpoint that transcribes
  // one frame per chosen look. Empty apiKey = the eye is not configured, the window falls back
  // to the presence lines, byte-for-byte today's behaviour.
  vision: z
    .object({
      baseUrl: z.string().default("https://api.deepseek.com"),
      // Empty = inherit llm.apiKeys[0] when the host is DeepSeek (her own line); explicit
      // values override: the Gemini fallback is three lines of config.
      apiKey: z.string().default(""),
      model: z.string().default("deepseek-flash"),
    })
    .default({
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-flash",
    }),
  // Her ear (感官补全): Gemini's compat wire takes input_audio; empty apiKey = no ear yet,
  // and a voice message becomes the honest cannot-hear receipt instead of silence.
  hearing: z
    .object({
      baseUrl: z.string().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
      apiKey: z.string().default(""),
      model: z.string().default("gemini-3.5-flash-lite"),
    })
    .default({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: "",
      model: "gemini-3.5-flash-lite",
    }),
});

const TelegramConfigSchema = z
  .object({
    botToken: z.string(),
    allowedUserIds: z.array(z.number()).default([]),
    silentHoursStart: z.number().int().min(0).max(23).default(23),
    silentHoursEnd: z.number().int().min(0).max(23).default(7),
  })
  .optional();

const SecurityConfigSchema = z.object({
});

const SandboxPolicySchema = z.enum(["readonly", "workspace-write", "full-access"]);

const defaultAllowlist = [
  "npmjs.com",
  "*.npmjs.com",
  "registry.npmjs.org",
  "*.registry.npmjs.org",
  "github.com",
  "*.github.com",
  "api.github.com",
  "api.anthropic.com",
  "api.ollama.local",
];

const SandboxConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    policy: SandboxPolicySchema.default("readonly"),
    allowFullAccess: z.boolean().default(false),
    timeoutMs: z.number().int().positive().default(120_000),
    memoryLimitMb: z.number().int().positive().default(2048),
    cpuShares: z.number().int().positive().default(1024),
    networkAllowlist: z.array(z.string()).default(defaultAllowlist),
    image: z.string().default("node:22-slim"),
    autoEnsureImage: z.boolean().default(true),
  })
  .optional();

// Both of these come off the one root (config/home.ts). They used to be independent
// paths into another agent's home, which is how half her life could end up his.
const WorkspaceConfigSchema = z.object({
  path: z.string().default(defaultWorkspacePath),
});

const DatabaseConfigSchema = z.object({
  dbPath: z.string().default(defaultDbPath),
});

const SearchConfigSchema = z.object({
  apiKey: z.string().default(""),
});

// The living layer: the metabolism (shared depletable budget) and the
// biological clock (rhythms + spontaneous-event timing). These carry the
// user-tunable subset; the modules hold the rest of their own defaults.
const MetabolismSettingsSchema = z.object({
  // Her daily reserve of VIGOR (effort units, see life/vitality.ts), NOT money. One vigor is
  // roughly one ordinary thought. Money is capped separately by llm.dailyBudgetCents.
  dailyVigor: z.number().positive().default(DEFAULT_DAILY_VIGOR),
  restedThreshold: z.number().min(0).max(1).default(0.9),
  lowThreshold: z.number().min(0).max(1).default(0.25),
  dormantThreshold: z.number().min(0).max(1).default(0.05),
});

const ClockSettingsSchema = z.object({
  timezoneOffsetHours: z.number().default(0),
  circadianPeakHour: z.number().min(0).max(24).default(15),
  activeHours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]).default([8, 23]),
  nhppMaxRatePerHour: z.number().nonnegative().default(2),
});

const ProactiveSettingsSchema = z.object({
  // Master switch for her OUTBOUND VOICE: whether she may initiate contact at all. When off she
  // still has her whole inner life (she thinks, tends, explores, wants) and still answers Eric,
  // she simply cannot reach out first. OFF by default so a fresh install never speaks unbidden.
  enabled: z.boolean().default(false),
});

const DreamSettingsSchema = z.object({
  // Her dreams (life/dreaming.ts). Off by default: dreaming puts new words in front of her, so
  // it stays off until every one of those words has been reviewed by hand, the same as the 366
  // words she was born reading. Switching it on is the owner's decision.
  enabled: z.boolean().default(false),
});

/**
 * Tools opened beyond what she was born holding (life/birth-toolkit.ts). ADDITIVE: this can
 * only ever give her something, never take her hands away. Opening is a positive act, done
 * because something became relevant or because she asked, and never earned by performing.
 */
const ToolsOpenedSchema = z.array(z.string()).default([]);

const EmbodimentSettingsSchema = z.object({
  // When true, the daemon starts the mind<->face WebSocket server the Air client connects
  // to (PAD/mood/status out, presence/replies in). OFF by default: a pure text/Telegram
  // deployment binds no port. Bind to loopback; the client reaches the VM over an SSH tunnel.
  enabled: z.boolean().default(false),
  port: z.number().int().min(0).max(65535).default(8765),
  host: z.string().default("127.0.0.1"),
});

const FieldSettingsSchema = z.object({
  // Her associative layer. Everything it does per moment is free arithmetic; the ONE model call is
  // fusion, when two unrelated things have kept arriving together often enough to be worth a
  // question. This caps how many of those a single rest may ask, so a life full of coincidences
  // cannot become an expensive one.
  maxFusionsPerRest: z.number().int().min(0).max(8).default(2),
  // Off means she still encodes, remembers, forgets and is reminded; she simply never fuses, so the
  // layer costs exactly nothing. Set to false to run the whole field with no model calls at all.
  fusionEnabled: z.boolean().default(true),
});

// ── BOTH OF THESE ARE RULINGS NOW, NOT COINS LEFT IN THE FILE ────────────────────────────────
//
// They read as "off until the experiment speaks", and the experiment HAS spoken: the room and
// breath A/B stays off. It was run, it had no effect, and it cannot be measured before she has
// lived, because the 900-character portrait it replaces is nearly empty in a newborn.
//
// So the false is a decision with a measurement behind it, and the reason has to be legible AT
// THE SWITCH. A default whose justification lives only in a document three directories away is
// how a considered choice becomes something the next person flips to see what happens.
//
// AND WHY IT IS NOT RE-RUN NOW: the room replaces a 900-character portrait of who she is. On a
// newborn that portrait is nearly empty, so the arm being tested and the arm it is tested
// against are the same page. This is genuinely re-measurable only after she has lived long
// enough to have a portrait: which is exactly the kind of thing this build refuses to guess at.
// Registered as observation debt, not as an open question.
const SpeechSettingsSchema = z.object({
  // S-3: the room (one thing to be occupied by + a state-set temperature) instead of the
  // 900-char portrait. RULED OFF, measured, no effect, and not honestly measurable pre-birth.
  room: z.boolean().default(false),
  // S-4's delivery half: a long reply arrives as up to `MAX_SEGMENTS` messages split at sentence
  // boundaries, sized by her state. RULED OFF with the room, and for the same reason: its own
  // flag exists so the ablation arms are separable, and there is nothing yet to ablate against.
  breath: z.boolean().default(false),
});

const LifeConfigSchema = z.object({
  speech: SpeechSettingsSchema.default({ room: false, breath: false }),
  field: FieldSettingsSchema.default({ maxFusionsPerRest: 2, fusionEnabled: true }),
  metabolism: MetabolismSettingsSchema.default({
    dailyVigor: DEFAULT_DAILY_VIGOR,
    restedThreshold: 0.9,
    lowThreshold: 0.25,
    dormantThreshold: 0.05,
  }),
  clock: ClockSettingsSchema.default({
    timezoneOffsetHours: 0,
    circadianPeakHour: 15,
    activeHours: [8, 23],
    nhppMaxRatePerHour: 2,
  }),
  proactive: ProactiveSettingsSchema.default({ enabled: false }),
  dream: DreamSettingsSchema.default({ enabled: false }),
  embodiment: EmbodimentSettingsSchema.default({ enabled: false, port: 8765, host: "127.0.0.1" }),
  toolsOpened: ToolsOpenedSchema,
});

export const AppConfigSchema = z.object({
  env: z.string().default("development"),
  llm: LlmConfigSchema.default({
    models: {
      default: defaultModels.default,
      upgrade: defaultModels.upgrade,
      background: defaultModels.background,
    },
    provider: "anthropic",
    apiKeys: [],
    baseUrl: "https://api.anthropic.com",
    rateLimits: { rpm: 60 },
    dailyBudgetCents: 1000,
    vision: {
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-flash",
    },
    hearing: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: "",
      model: "gemini-3.5-flash-lite",
    },
  }),
  telegram: TelegramConfigSchema,
  security: SecurityConfigSchema.default({}),
  // Lazy: the root is resolved when the config is parsed, not when this module is
  // imported, so a test that points RESIDENT_HOME at a temp dir actually gets it.
  workspace: WorkspaceConfigSchema.default(() => ({ path: defaultWorkspacePath() })),
  database: DatabaseConfigSchema.default(() => ({ dbPath: defaultDbPath() })),
  sandbox: SandboxConfigSchema,
  search: SearchConfigSchema.default({ apiKey: "" }),
  life: LifeConfigSchema.default({
    metabolism: { dailyVigor: DEFAULT_DAILY_VIGOR, restedThreshold: 0.9, lowThreshold: 0.25, dormantThreshold: 0.05 },
    clock: { timezoneOffsetHours: 0, circadianPeakHour: 15, activeHours: [8, 23], nhppMaxRatePerHour: 2 },
    proactive: { enabled: false },
    dream: { enabled: false },
    embodiment: { enabled: false, port: 8765, host: "127.0.0.1" },
    field: { maxFusionsPerRest: 2, fusionEnabled: true },
    speech: { room: false, breath: false },
    toolsOpened: [],
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type LifeConfig = z.infer<typeof LifeConfigSchema>;
