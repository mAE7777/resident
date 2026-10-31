import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramBot } from "../../../src/telegram/bot.js";
import type { TelegramBotConfig } from "../../../src/telegram/bot.js";

// ── Mock grammY Bot ───────────────────────────────────────────────────────────
// We mock the Bot class so tests don't hit the Telegram network.

const mockOn = vi.fn();
const mockUse = vi.fn();
const mockCatch = vi.fn();
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
const mockBotConstructor = vi.fn();

vi.mock("grammy", () => {
  class MockBot {
    api = { sendMessage: mockSendMessage };
    on = mockOn;
    use = mockUse;
    catch = mockCatch;
    start = mockStart;
    stop = mockStop;
    constructor(...args: unknown[]) {
      mockBotConstructor(...args);
    }
  }
  return { Bot: MockBot };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<TelegramBotConfig>): TelegramBotConfig {
  return {
    botToken: "test-token",
    allowedUserIds: [123],
    onMessage: vi.fn().mockResolvedValue(undefined),
    onPhoto: vi.fn().mockResolvedValue(undefined),
    onDocument: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createTelegramBot — bot creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bot, start, stop, and sendMessage", () => {
    const result = createTelegramBot(makeConfig());
    expect(result).toHaveProperty("bot");
    expect(result).toHaveProperty("start");
    expect(result).toHaveProperty("stop");
    expect(result).toHaveProperty("sendMessage");
  });

  it("installs access middleware via bot.use()", () => {
    createTelegramBot(makeConfig());
    expect(mockUse).toHaveBeenCalledOnce();
    // The argument is a function (the access middleware)
    expect(typeof mockUse.mock.calls[0][0]).toBe("function");
  });

  it("registers a text message handler via bot.on()", () => {
    createTelegramBot(makeConfig());
    const textCall = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:text"
    );
    expect(textCall).toBeDefined();
  });

  it("registers a photo message handler via bot.on()", () => {
    createTelegramBot(makeConfig());
    const photoCall = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:photo"
    );
    expect(photoCall).toBeDefined();
  });

  it("registers a document message handler via bot.on()", () => {
    createTelegramBot(makeConfig());
    const docCall = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:document"
    );
    expect(docCall).toBeDefined();
  });

  it("installs a catch error handler via bot.catch()", () => {
    createTelegramBot(makeConfig());
    expect(mockCatch).toHaveBeenCalledOnce();
    expect(typeof mockCatch.mock.calls[0][0]).toBe("function");
  });

  it("passes an HTTP proxy agent into grammY when proxyUrl is configured", () => {
    createTelegramBot(makeConfig({ proxyUrl: "http://127.0.0.1:8080" }));

    expect(mockBotConstructor).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({
        client: expect.objectContaining({
          baseFetchConfig: expect.objectContaining({
            agent: expect.any(Object),
          }),
        }),
      }),
    );
  });
});

describe("createTelegramBot — message handler callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text handler calls onMessage callback", async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    createTelegramBot(makeConfig({ onMessage }));

    const textHandler = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:text"
    )?.[1] as (ctx: unknown) => Promise<void>;

    const fakeCtx = { from: { id: 123 }, message: { text: "hello" } };
    await textHandler(fakeCtx);

    expect(onMessage).toHaveBeenCalledWith(fakeCtx);
  });

  it("photo handler calls onPhoto callback", async () => {
    const onPhoto = vi.fn().mockResolvedValue(undefined);
    createTelegramBot(makeConfig({ onPhoto }));

    const photoHandler = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:photo"
    )?.[1] as (ctx: unknown) => Promise<void>;

    const fakeCtx = { from: { id: 123 }, message: { photo: [] } };
    await photoHandler(fakeCtx);

    expect(onPhoto).toHaveBeenCalledWith(fakeCtx);
  });

  it("document handler calls onDocument callback", async () => {
    const onDocument = vi.fn().mockResolvedValue(undefined);
    createTelegramBot(makeConfig({ onDocument }));

    const docHandler = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:document"
    )?.[1] as (ctx: unknown) => Promise<void>;

    const fakeCtx = { from: { id: 123 }, message: { document: {} } };
    await docHandler(fakeCtx);

    expect(onDocument).toHaveBeenCalledWith(fakeCtx);
  });

  it("handler errors are caught and do not propagate", async () => {
    const onMessage = vi.fn().mockRejectedValue(new Error("boom"));
    createTelegramBot(makeConfig({ onMessage }));

    const textHandler = mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "message:text"
    )?.[1] as (ctx: unknown) => Promise<void>;

    // Should not throw even though onMessage rejects
    await expect(textHandler({ from: { id: 123 } })).resolves.toBeUndefined();
  });
});

describe("createTelegramBot — lifecycle and sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("start() calls bot.start()", async () => {
    const tb = createTelegramBot(makeConfig());
    await tb.start();
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("stop() calls bot.stop()", async () => {
    const tb = createTelegramBot(makeConfig());
    await tb.stop();
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it("sendMessage() calls bot.api.sendMessage with chatId and text", async () => {
    const tb = createTelegramBot(makeConfig());
    await tb.sendMessage(42, "Hello world");
    expect(mockSendMessage).toHaveBeenCalledWith(42, "Hello world", undefined);
  });

  it("sendMessage() forwards options when provided", async () => {
    const tb = createTelegramBot(makeConfig());
    await tb.sendMessage(42, "Hello", { parse_mode: "HTML" });
    expect(mockSendMessage).toHaveBeenCalledWith(42, "Hello", {
      parse_mode: "HTML",
    });
  });
});

describe("createTelegramBot — access control integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("access middleware is the first thing installed (before handlers)", () => {
    createTelegramBot(makeConfig({ allowedUserIds: [42] }));

    // use() is called before on(), the access middleware is first
    const firstUseCallOrder = mockUse.mock.invocationCallOrder[0];
    const firstOnCallOrder = mockOn.mock.invocationCallOrder[0];

    expect(firstUseCallOrder).toBeLessThan(firstOnCallOrder);
  });

  it("unauthorized users are silently ignored by access middleware", async () => {
    createTelegramBot(makeConfig({ allowedUserIds: [42] }));

    const accessMw = mockUse.mock.calls[0][0] as (
      ctx: unknown,
      next: () => Promise<void>
    ) => Promise<void>;

    const next = vi.fn();
    // User 99 is not in allowedUserIds [42]
    await accessMw({ from: { id: 99 } }, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("authorized users pass through access middleware", async () => {
    createTelegramBot(makeConfig({ allowedUserIds: [42] }));

    const accessMw = mockUse.mock.calls[0][0] as (
      ctx: unknown,
      next: () => Promise<void>
    ) => Promise<void>;

    const next = vi.fn().mockResolvedValue(undefined);
    await accessMw({ from: { id: 42 } }, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("empty allowedUserIds denies all via access middleware", async () => {
    createTelegramBot(makeConfig({ allowedUserIds: [] }));

    const accessMw = mockUse.mock.calls[0][0] as (
      ctx: unknown,
      next: () => Promise<void>
    ) => Promise<void>;

    const next = vi.fn();
    await accessMw({ from: { id: 123456 } }, next);

    expect(next).not.toHaveBeenCalled();
  });
});
