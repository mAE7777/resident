import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerCommands,
  createSessionState,
} from "../../../src/telegram/commands.js";
import type { CommandDeps, SessionState } from "../../../src/telegram/commands.js";
import { AppConfigSchema, type AppConfig } from "../../../src/config/schema.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../../src/db/sqlite.js";
import { createLogger } from "../../../src/utils/logger.js";
import { createReviewLedger } from "../../../src/self-improvement/review-ledger.js";

// ── AppConfig fixture ─────────────────────────────────────────────────────────

// Built from the schema's OWN defaults rather than hand-written. A hand-written one has to be
// updated every time the config grows a section, and until it is, it is a shape that can never
// occur in production being fed to code that runs in production.
const testConfig: AppConfig = {
  ...AppConfigSchema.parse({}),
  env: "test",
  telegram: undefined,
  workspace: { path: "/tmp/test-workspace" },
  database: { dbPath: "/tmp/test.db" },
};

// ── Mock Bot ──────────────────────────────────────────────────────────────────

type CommandHandler = (ctx: FakeCtx) => Promise<void>;

interface FakeCtx {
  match?: string;
  chat?: { id: number };
  reply: (text: string) => Promise<void>;
}

function makeMockBot() {
  const handlers = new Map<string, CommandHandler>();

  const bot = {
    command(name: string, handler: CommandHandler) {
      handlers.set(name, handler);
    },
    _handlers: handlers,
    async invoke(name: string, match?: string, chatId?: number): Promise<string[]> {
      const replies: string[] = [];
      const ctx: FakeCtx = {
        match,
        chat: chatId === undefined ? undefined : { id: chatId },
        reply: async (text: string) => { replies.push(text); },
      };
      const h = handlers.get(name);
      if (!h) throw new Error(`No handler registered for command: ${name}`);
      await h(ctx);
      return replies;
    },
  };

  return bot;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    sessionState: createSessionState(testConfig.llm.models.default.id),
    config: testConfig,
    ...overrides,
  };
}

// ── createSessionState ────────────────────────────────────────────────────────

describe("createSessionState", () => {
  it("returns initial state with the default model", () => {
    const state = createSessionState("claude-sonnet-4-6");
    expect(state.currentModel).toBe("claude-sonnet-4-6");
  });
});

// ── /opus ─────────────────────────────────────────────────────────────────────

describe("registerCommands — /opus", () => {
  it("switches currentModel to upgrade model id", async () => {
    const bot = makeMockBot();
    const deps = makeDeps();
    registerCommands(bot as never, deps);

    await bot.invoke("opus");
    expect(deps.sessionState.currentModel).toBe("claude-opus-4-7");
  });

  it("replies with confirmation containing the model id", async () => {
    const bot = makeMockBot();
    const deps = makeDeps();
    registerCommands(bot as never, deps);

    const replies = await bot.invoke("opus");
    expect(replies[0]).toContain("claude-opus-4-7");
  });

  it("updates the issuing chat state when getSessionState is provided", async () => {
    const bot = makeMockBot();
    const chatState: SessionState = { currentModel: "claude-sonnet-4-6" };
    const onSessionStateChanged = vi.fn();
    const deps = makeDeps({ getSessionState: vi.fn(() => chatState), onSessionStateChanged });
    registerCommands(bot as never, deps);

    await bot.invoke("opus", undefined, 123);

    expect(chatState.currentModel).toBe("claude-opus-4-7");
    expect(deps.sessionState.currentModel).toBe("claude-sonnet-4-6");
    expect(onSessionStateChanged).toHaveBeenCalledWith(123, chatState);
  });
});

// ── /sonnet ───────────────────────────────────────────────────────────────────

describe("registerCommands — /sonnet", () => {
  it("switches currentModel to default model id", async () => {
    const bot = makeMockBot();
    const deps = makeDeps();
    deps.sessionState.currentModel = "claude-opus-4-7";
    registerCommands(bot as never, deps);

    await bot.invoke("sonnet");
    expect(deps.sessionState.currentModel).toBe("claude-sonnet-4-6");
  });
});

// ── /haiku ────────────────────────────────────────────────────────────────────

describe("registerCommands — /haiku", () => {
  it("switches currentModel to background model id", async () => {
    const bot = makeMockBot();
    const deps = makeDeps();
    registerCommands(bot as never, deps);

    await bot.invoke("haiku");
    expect(deps.sessionState.currentModel).toBe("claude-haiku-4-5");
  });
});

// ── /dream ────────────────────────────────────────────────────────────────────

// ── /status ───────────────────────────────────────────────────────────────────

describe("registerCommands — /status", () => {
  it("shows current model in status", async () => {
    const bot = makeMockBot();
    const deps = makeDeps();
    registerCommands(bot as never, deps);

    const replies = await bot.invoke("status");
    expect(replies[0]).toContain("claude-sonnet-4-6");
  });

  it("shows daily cost from costGuard", async () => {
    const bot = makeMockBot();
    const costGuard = { getDailySpentCents: vi.fn().mockReturnValue(1050) };
    const deps = makeDeps({ costGuard });
    registerCommands(bot as never, deps);

    const replies = await bot.invoke("status");
    expect(replies[0]).toContain("10.50");
  });

  it("shows $0.00 when no costGuard", async () => {
    const bot = makeMockBot();
    const deps = makeDeps({ costGuard: undefined });
    registerCommands(bot as never, deps);

    const replies = await bot.invoke("status");
    expect(replies[0]).toContain("0.00");
  });
});

// The /autonomy command is gone with the four-level trust ladder: a global
// number rating how much she is trusted is the inherited frame we removed. What limits her is
// the home wall + the unconditional action-danger checks, never a dial.

// ── /memory ───────────────────────────────────────────────────────────────────

describe("registerCommands — /memory", () => {
  it("replies with not found when MEMORY.md does not exist", async () => {
    const bot = makeMockBot();
    const deps = makeDeps();
    // workspace.path = /tmp/test-workspace, no MEMORY.md there
    registerCommands(bot as never, deps);

    const replies = await bot.invoke("memory");
    expect(replies[0]).toContain("not found");
  });
});

// ── /doctor capability manifests ─────────────────────────────────────────────

describe("registerCommands — /doctor capability manifests", () => {
  it("reports declared capability manifests and missing required dependencies", async () => {
    const bot = makeMockBot();
    const deps = makeDeps({
      toolRegistry: {
        visibleCount: () => 2,
        hiddenCount: () => 0,
        getCapabilityManifests: () => [{
          tool: "opencli_query",
          description: "OpenCLI wrapper",
          manifest: {
            domains: ["web"],
            aliases: ["opencli"],
            access: "typed_cli",
            outputKind: "text",
            riskZone: 2,
            dependencies: [
              { kind: "command", name: "__definitely_missing_opencli_for_test__", required: true, purpose: "test dependency" },
            ],
          },
        }],
      },
    });
    registerCommands(bot as never, deps);

    const replies = await bot.invoke("doctor");

    expect(replies[0]).toContain("Capability manifests");
    expect(replies[0]).toContain("opencli_query:__definitely_missing_opencli_for_test__");
  });
});
