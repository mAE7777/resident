import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createNotifier,
  HER_VOICE,
  SYSTEM_MARK,
  type Notification,
  type NotificationCategory,
  type NotifierConfig,
} from "../../../src/autonomy/notifier.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<NotifierConfig>): {
  sendMessage: ReturnType<typeof vi.fn>;
  config: NotifierConfig;
} {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const config: NotifierConfig = {
    sendMessage,
    ...overrides,
  };
  return { sendMessage, config };
}

/** Pin the current hour for deterministic tests. */
function fakeHour(hour: number): () => void {
  const original = Date;
  const fakeDate = new Proxy(Date, {
    construct(_target, args) {
      if (args.length === 0) {
        const d = new original();
        // override getHours
        Object.defineProperty(d, "getHours", { value: () => hour });
        return d;
      }
      return new original(...(args as [string]));
    },
  });
  vi.stubGlobal("Date", fakeDate);
  return () => vi.unstubAllGlobals();
}

// ── isInSilentHours ───────────────────────────────────────────────────────────

describe("isInSilentHours", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns true at 23:00 (default silent start)", () => {
    const restore = fakeHour(23);
    const notifier = createNotifier(makeConfig().config);
    expect(notifier.isInSilentHours()).toBe(true);
    restore();
  });

  it("returns true at midnight (0:00) during silent hours", () => {
    const restore = fakeHour(0);
    const notifier = createNotifier(makeConfig().config);
    expect(notifier.isInSilentHours()).toBe(true);
    restore();
  });

  it("returns true at 6:00 (one hour before silent end)", () => {
    const restore = fakeHour(6);
    const notifier = createNotifier(makeConfig().config);
    expect(notifier.isInSilentHours()).toBe(true);
    restore();
  });

  it("returns false at 7:00 (silent end, exclusive boundary)", () => {
    const restore = fakeHour(7);
    const notifier = createNotifier(makeConfig().config);
    expect(notifier.isInSilentHours()).toBe(false);
    restore();
  });

  it("returns false at 12:00 (midday, well outside silent hours)", () => {
    const restore = fakeHour(12);
    const notifier = createNotifier(makeConfig().config);
    expect(notifier.isInSilentHours()).toBe(false);
    restore();
  });

  it("wrap-around: 23-7 — hour 23 is in silent hours", () => {
    const restore = fakeHour(23);
    const notifier = createNotifier({
      ...makeConfig().config,
      silentHoursStart: 23,
      silentHoursEnd: 7,
    });
    expect(notifier.isInSilentHours()).toBe(true);
    restore();
  });

  it("non-wrap-around: 8-17 (e.g. work hours) — hour 12 is in range", () => {
    const restore = fakeHour(12);
    const notifier = createNotifier({
      ...makeConfig().config,
      silentHoursStart: 8,
      silentHoursEnd: 17,
    });
    expect(notifier.isInSilentHours()).toBe(true);
    restore();
  });

  it("non-wrap-around: 8-17 — hour 18 is outside range", () => {
    const restore = fakeHour(18);
    const notifier = createNotifier({
      ...makeConfig().config,
      silentHoursStart: 8,
      silentHoursEnd: 17,
    });
    expect(notifier.isInSilentHours()).toBe(false);
    restore();
  });
});

// ── push: disable_notification logic ─────────────────────────────────────────

describe("push — disable_notification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normal priority during silent hours → disable_notification: true", async () => {
    const restore = fakeHour(2); // 2am: silent
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    const notification: Notification = {
      priority: "normal",
      category: "heartbeat",
      message: "memory usage is high",
    };
    await notifier.push(notification);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toEqual({ disable_notification: true });
    restore();
  });

  it("urgent priority during silent hours → disable_notification: false (bypasses)", async () => {
    const restore = fakeHour(2); // 2am: silent
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    const notification: Notification = {
      priority: "urgent",
      category: "error",
      message: "critical failure",
    };
    await notifier.push(notification);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toEqual({ disable_notification: false });
    restore();
  });

  it("normal priority outside silent hours → disable_notification: false", async () => {
    const restore = fakeHour(14); // 2pm: active
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    const notification: Notification = {
      priority: "normal",
      category: "cron",
      message: "daily report ready",
    };
    await notifier.push(notification);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toEqual({ disable_notification: false });
    restore();
  });

  it("urgent priority outside silent hours → disable_notification: false", async () => {
    const restore = fakeHour(10); // 10am
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    const notification: Notification = {
      priority: "urgent",
      category: "error",
      message: "disk full",
    };
    await notifier.push(notification);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toEqual({ disable_notification: false });
    restore();
  });
});

// ── push: message formatting ──────────────────────────────────────────────────

describe("push — message formatting", () => {
  afterEach(() => vi.unstubAllGlobals());

  const categories = ["cron", "heartbeat", "dream", "error", "skill"] as const;

  for (const category of categories) {
    it(`marks [${category}] as the SYSTEM, not as her`, async () => {
      const restore = fakeHour(10); // outside silent hours
      const { sendMessage, config } = makeConfig();
      const notifier = createNotifier(config);

      await notifier.push({ priority: "normal", category, message: "test body" });

      const text = sendMessage.mock.calls[0][0] as string;
      expect(text).toBe(`[system \u00b7 ${category}] test body`);
      restore();
    });
  }

  // WHO IS SPEAKING.
  //
  // The old labels named the SUBSYSTEM, which is a different question. A heartbeat finding written
  // in the first person went out as `[heartbeat] I noticed...` and read as her wondering something,
  // when the heartbeat's triggers are file mtimes and cron rows and have nothing to do with her.
  // She reaches him through the expression gate; a background process reaches him through none of
  // it, and the two must not look alike.
  it("her own words go out as her own words", async () => {
    const restore = fakeHour(10);
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    await notifier.push({ priority: "normal", category: HER_VOICE, message: "I kept thinking about the tide tables." });

    const text = sendMessage.mock.calls[0][0] as string;
    expect(text, "a tag on her own sentence is odd, and she is the one speaking")
      .toBe("I kept thinking about the tide tables.");
    expect(text).not.toContain(SYSTEM_MARK);
    restore();
  });

  it("and nothing else can arrive looking like her", async () => {
    const restore = fakeHour(10);
    const every: NotificationCategory[] =
      ["cron", "heartbeat", "dream", "error", "skill", "self-improvement", "vitals", "proactive"];
    for (const category of every) {
      const { sendMessage, config } = makeConfig();
      await createNotifier(config).push({ priority: "normal", category, message: "I have been thinking." });
      const text = sendMessage.mock.calls[0][0] as string;
      if (category === HER_VOICE) continue;
      expect(text.startsWith(SYSTEM_MARK), `${category} must announce itself as the system`).toBe(true);
    }
    restore();
  });

  it("label uses plain text, not emoji", async () => {
    const restore = fakeHour(10);
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    await notifier.push({ priority: "normal", category: "dream", message: "dream processed" });

    const text = sendMessage.mock.calls[0][0] as string;
    // Must start with [dream], no emoji characters
    expect(text).toMatch(/^\[system \u00b7 dream\]/);
    // No emoji: basic check: no chars in emoji range \u{1F000}-\u{1FFFF}
    expect(/[\u{1F000}-\u{1FFFF}]/u.test(text)).toBe(false);
    restore();
  });
});

// ── AC: security / dream / cron scenarios ────────────────────────────────────

describe("acceptance criteria scenarios", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dream completion during silent hours → disable_notification: true", async () => {
    const restore = fakeHour(1); // 1am: silent
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    await notifier.push({ priority: "normal", category: "dream", message: "dream cycle complete" });

    expect(sendMessage.mock.calls[0][1]).toEqual({ disable_notification: true });
    restore();
  });

  it("error alert during silent hours with urgent priority → disable_notification: false", async () => {
    const restore = fakeHour(3); // 3am: silent
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    await notifier.push({ priority: "urgent", category: "error", message: "OOM killed" });

    expect(sendMessage.mock.calls[0][1]).toEqual({ disable_notification: false });
    restore();
  });

  it("security alert at any hour with urgent priority → disable_notification: false", async () => {
    for (const hour of [0, 3, 7, 12, 23]) {
      const restore = fakeHour(hour);
      const { sendMessage, config } = makeConfig();
      const notifier = createNotifier(config);

      await notifier.push({ priority: "urgent", category: "error", message: "injection attempt" });

      expect(sendMessage.mock.calls[0][1], `expected urgent at hour ${hour} to not be silent`)
        .toEqual({ disable_notification: false });
      restore();
    }
  });

  it("cron job result notification reaches user with message text", async () => {
    const restore = fakeHour(10);
    const { sendMessage, config } = makeConfig();
    const notifier = createNotifier(config);

    await notifier.push({ priority: "normal", category: "cron", message: "backup finished: 42 files" });

    const [text] = sendMessage.mock.calls[0] as [string, unknown];
    expect(text).toContain("[system \u00b7 cron]");
    expect(text).toContain("backup finished: 42 files");
    restore();
  });
});
