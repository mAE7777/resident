import { describe, it, expect, vi } from "vitest";
import { createHookRegistry } from "../../../src/agent/hooks.js";
import type { HookContext } from "../../../src/agent/hooks.js";

// ── AC5: hook errors are logged but main flow continues ───────────────────────

describe("HookRegistry — AC5: fail-open execution", () => {
  it("continues executing after a hook throws", async () => {
    const logger = { error: vi.fn() };
    const registry = createHookRegistry(logger);

    let secondRan = false;

    registry.register("before_tool", async (_ctx) => {
      throw new Error("boom");
    });

    registry.register("before_tool", async (ctx) => {
      secondRan = true;
      return ctx;
    });

    const result = await registry.execute("before_tool", { tool: "read" });

    expect(secondRan).toBe(true);
    expect(logger.error).toHaveBeenCalled();
    expect(result).toEqual({ tool: "read" });
  });

  it("logs error with hook point name", async () => {
    const logger = { error: vi.fn() };
    const registry = createHookRegistry(logger);

    registry.register("after_tool", async () => {
      throw new Error("handler error");
    });

    await registry.execute("after_tool", {});
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("after_tool"),
      expect.any(Error)
    );
  });

  it("returns original context when handler throws", async () => {
    const registry = createHookRegistry({ error: () => {} });

    registry.register("before_llm", async () => {
      throw new Error("fail");
    });

    const ctx: HookContext = { model: "claude-3" };
    const result = await registry.execute("before_llm", ctx);
    expect(result).toEqual({ model: "claude-3" });
  });
});

// ── AC9: before_tool hook can modify arguments ────────────────────────────────

describe("HookRegistry — AC9: before_tool hook modifies arguments", () => {
  it("modified context from first handler is passed to second handler", async () => {
    const registry = createHookRegistry();
    const received: HookContext[] = [];

    registry.register("before_tool", async (ctx) => {
      return { ...ctx, args: { ...((ctx.args as Record<string, unknown>) ?? {}), injected: true } };
    });

    registry.register("before_tool", async (ctx) => {
      received.push(ctx);
      return ctx;
    });

    await registry.execute("before_tool", { args: { input: "hello" } });

    expect(received[0]).toMatchObject({
      args: { input: "hello", injected: true },
    });
  });

  it("final execute result reflects all handler modifications", async () => {
    const registry = createHookRegistry();

    registry.register("before_tool", async (ctx) => {
      return { ...ctx, step: 1 };
    });

    registry.register("before_tool", async (ctx) => {
      return { ...ctx, step: 2 };
    });

    const result = await registry.execute("before_tool", { step: 0 });
    expect(result.step).toBe(2);
  });

  it("unsubscribe removes the handler", async () => {
    const registry = createHookRegistry();
    let ran = false;

    const unsubscribe = registry.register("before_tool", async (ctx) => {
      ran = true;
      return ctx;
    });

    unsubscribe();
    await registry.execute("before_tool", {});
    expect(ran).toBe(false);
  });

  it("handlers run in registration order", async () => {
    const registry = createHookRegistry();
    const order: number[] = [];

    registry.register("before_tool", async (ctx) => { order.push(1); return ctx; });
    registry.register("before_tool", async (ctx) => { order.push(2); return ctx; });
    registry.register("before_tool", async (ctx) => { order.push(3); return ctx; });

    await registry.execute("before_tool", {});
    expect(order).toEqual([1, 2, 3]);
  });
});
