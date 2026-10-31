import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../../src/config/loader.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZodError } from "zod";

// Helper to write a temp YAML file and return its path
function writeTempYaml(content: string): string {
  const p = join(tmpdir(), `god-agent-test-${Date.now()}.yaml`);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("loadConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("RESIDENT__")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore env to original state
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(originalEnv)) {
      process.env[key] = val;
    }
  });

  // AC1: env overrides YAML
  it("should override YAML dailyBudgetCents when RESIDENT__LLM__DAILY_BUDGET_CENTS is set", () => {
    const yamlPath = writeTempYaml(`
llm:
  dailyBudgetCents: 1000
telegram:
  botToken: "test-token"
`);
    process.env["RESIDENT__LLM__DAILY_BUDGET_CENTS"] = "500";

    try {
      const { result, diagnostics } = loadConfig(yamlPath);
      expect(result.llm.dailyBudgetCents).toBe(500);
      // Diagnostics should mention the override
      expect(diagnostics.some((d) => d.message.includes("RESIDENT__LLM__DAILY_BUDGET_CENTS"))).toBe(true);
    } finally {
      unlinkSync(yamlPath);
      delete process.env["RESIDENT__LLM__DAILY_BUDGET_CENTS"];
    }
  });

  // AC2: missing botToken in telegram section → ZodError
  it("should throw ZodError with telegram.botToken path when telegram section has no botToken", () => {
    const yamlPath = writeTempYaml(`
telegram: {}
`);
    try {
      expect(() => loadConfig(yamlPath)).toThrowError(ZodError);
    } finally {
      unlinkSync(yamlPath);
    }
  });

  it("should throw ZodError mentioning botToken field", () => {
    const yamlPath = writeTempYaml(`
telegram: {}
`);
    try {
      let thrown: ZodError | undefined;
      try {
        loadConfig(yamlPath);
      } catch (e) {
        if (e instanceof ZodError) thrown = e;
        else throw e;
      }
      expect(thrown).toBeDefined();
      const issue = thrown!.issues.find(
        (i) => i.path.includes("botToken") || i.path.some((p) => p === "botToken")
      );
      expect(issue).toBeDefined();
    } finally {
      unlinkSync(yamlPath);
    }
  });

  // AC3: no config file → hardcoded defaults
  it("should use hardcoded defaults when no config file exists", () => {
    const nonExistentPath = join(tmpdir(), `does-not-exist-${Date.now()}.yaml`);
    const { result, diagnostics } = loadConfig(nonExistentPath);

    expect(result.llm.dailyBudgetCents).toBe(1000);
    expect(result.llm.models.default.id).toBe("claude-sonnet-4-6");
    expect(diagnostics.some((d) => d.message.includes("not found"))).toBe(true);
  });

  // Bonus: valid telegram config works
  it("should load successfully when telegram.botToken is provided", () => {
    const yamlPath = writeTempYaml(`
telegram:
  botToken: "bot123:ABC"
  allowedUserIds: [42]
`);
    try {
      const { result } = loadConfig(yamlPath);
      expect(result.telegram?.botToken).toBe("bot123:ABC");
      expect(result.telegram?.allowedUserIds).toEqual([42]);
    } finally {
      unlinkSync(yamlPath);
    }
  });

  // Bonus: no telegram section at all → config loads fine
  it("should load successfully with no telegram section", () => {
    const yamlPath = writeTempYaml(`
llm:
  dailyBudgetCents: 500
`);
    try {
      const { result } = loadConfig(yamlPath);
      expect(result.telegram).toBeUndefined();
      expect(result.llm.dailyBudgetCents).toBe(500);
    } finally {
      unlinkSync(yamlPath);
    }
  });

  // Bonus: env overrides work at deeper nesting
  it("should override nested model id via env", () => {
    process.env["RESIDENT__LLM__MODELS__DEFAULT__ID"] = "custom-model";
    try {
      const { result } = loadConfig(join(tmpdir(), `no-file-${Date.now()}.yaml`));
      expect(result.llm.models.default.id).toBe("custom-model");
    } finally {
      delete process.env["RESIDENT__LLM__MODELS__DEFAULT__ID"];
    }
  });

  it("should parse JSON array env values", () => {
    process.env["RESIDENT__LLM__API_KEYS"] = "[\"key-a\",\"key-b\"]";
    process.env["RESIDENT__TELEGRAM__BOT_TOKEN"] = "bot123:ABC";
    process.env["RESIDENT__TELEGRAM__ALLOWED_USER_IDS"] = "[42,99]";
    try {
      const { result } = loadConfig(join(tmpdir(), `no-file-${Date.now()}.yaml`));
      expect(result.llm.apiKeys).toEqual(["key-a", "key-b"]);
      expect(result.telegram?.allowedUserIds).toEqual([42, 99]);
    } finally {
      delete process.env["RESIDENT__LLM__API_KEYS"];
      delete process.env["RESIDENT__TELEGRAM__BOT_TOKEN"];
      delete process.env["RESIDENT__TELEGRAM__ALLOWED_USER_IDS"];
    }
  });

  // Life section (metabolism + biological clock)
  it("should default the life section when omitted", () => {
    const { result } = loadConfig(join(tmpdir(), `no-file-${Date.now()}.yaml`));
    expect(result.life.metabolism.dailyVigor).toBe(400); // her daily reserve of effort, not money
    expect(result.life.metabolism.dormantThreshold).toBe(0.05);
    expect(result.life.clock.circadianPeakHour).toBe(15);
    expect(result.life.clock.activeHours).toEqual([8, 23]);
  });

  it("keeps outbound-voice and embodiment OFF by default (safety invariant)", () => {
    const { result } = loadConfig(join(tmpdir(), `no-file-${Date.now()}.yaml`));
    expect(result.life.proactive.enabled).toBe(false);
    expect(result.life.embodiment.enabled).toBe(false);
    expect(result.life.embodiment.port).toBe(8765);
    expect(result.life.embodiment.host).toBe("127.0.0.1");
  });

  it("enables embodiment only when the YAML opts in", () => {
    const yamlPath = writeTempYaml(`
telegram:
  botToken: "test-token"
life:
  embodiment:
    enabled: true
    port: 9000
`);
    try {
      const { result } = loadConfig(yamlPath);
      expect(result.life.embodiment.enabled).toBe(true);
      expect(result.life.embodiment.port).toBe(9000);
      expect(result.life.embodiment.host).toBe("127.0.0.1");
    } finally {
      unlinkSync(yamlPath);
    }
  });

  it("should apply life values from YAML", () => {
    const yamlPath = writeTempYaml(`
telegram:
  botToken: "test-token"
life:
  metabolism:
    dailyVigor: 500
  clock:
    timezoneOffsetHours: -4
    activeHours: [9, 22]
`);
    try {
      const { result } = loadConfig(yamlPath);
      expect(result.life.metabolism.dailyVigor).toBe(500);
      expect(result.life.clock.timezoneOffsetHours).toBe(-4);
      expect(result.life.clock.activeHours).toEqual([9, 22]);
    } finally {
      unlinkSync(yamlPath);
    }
  });

  it("should override the daily cap via env", () => {
    process.env["RESIDENT__LIFE__METABOLISM__DAILY_VIGOR"] = "250";
    try {
      const { result } = loadConfig(join(tmpdir(), `no-file-${Date.now()}.yaml`));
      expect(result.life.metabolism.dailyVigor).toBe(250);
    } finally {
      delete process.env["RESIDENT__LIFE__METABOLISM__DAILY_VIGOR"];
    }
  });
});
