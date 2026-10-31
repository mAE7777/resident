import { describe, it, expect, vi } from "vitest";
import {
  createAccessControl,
  createAccessMiddleware,
} from "../../../src/telegram/access.js";
import type { Context } from "grammy";

// ── createAccessControl ───────────────────────────────────────────────────────

describe("createAccessControl — core allow-list logic", () => {
  it("denies all users when allowedUserIds is empty (secure by default)", () => {
    const ac = createAccessControl([]);
    expect(ac.isAllowed(123456)).toBe(false);
    expect(ac.isAllowed(0)).toBe(false);
    expect(ac.isAllowed(1)).toBe(false);
  });

  it("allows all users when the list contains the wildcard sentinel 0", () => {
    const ac = createAccessControl([0]);
    expect(ac.isAllowed(123456)).toBe(true);
    expect(ac.isAllowed(999999999)).toBe(true);
    expect(ac.isAllowed(1)).toBe(true);
  });

  it("allows all when wildcard 0 is mixed with other IDs", () => {
    const ac = createAccessControl([0, 111, 222]);
    expect(ac.isAllowed(999)).toBe(true);
  });

  it("allows specific IDs in the whitelist", () => {
    const ac = createAccessControl([111, 222, 333]);
    expect(ac.isAllowed(111)).toBe(true);
    expect(ac.isAllowed(222)).toBe(true);
    expect(ac.isAllowed(333)).toBe(true);
  });

  it("denies IDs not in the whitelist", () => {
    const ac = createAccessControl([111, 222]);
    expect(ac.isAllowed(333)).toBe(false);
    expect(ac.isAllowed(444)).toBe(false);
  });

  // Negative-case verification (HIGH sensitivity)

  it("denies userId=0 when 0 is NOT in allowedUserIds", () => {
    // 0 is only a wildcard when it is IN the array
    const ac = createAccessControl([111, 222]);
    expect(ac.isAllowed(0)).toBe(false);
  });

  it("denies negative userIds", () => {
    const ac = createAccessControl([111]);
    expect(ac.isAllowed(-1)).toBe(false);
    expect(ac.isAllowed(-999999)).toBe(false);
  });

  it("allows very large (valid) userIds when in list", () => {
    const largeId = 9_999_999_999;
    const ac = createAccessControl([largeId]);
    expect(ac.isAllowed(largeId)).toBe(true);
    expect(ac.isAllowed(largeId - 1)).toBe(false);
  });
});

// ── createAccessMiddleware ────────────────────────────────────────────────────

function makeCtx(userId: number | undefined): Context {
  return {
    from: userId !== undefined ? { id: userId } : undefined,
  } as unknown as Context;
}

describe("createAccessMiddleware — grammY middleware integration", () => {
  it("calls next() for an allowed user", async () => {
    const ac = createAccessControl([42]);
    const mw = createAccessMiddleware(ac);
    const next = vi.fn().mockResolvedValue(undefined);

    await mw(makeCtx(42), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("does NOT call next() for a denied user (silent ignore)", async () => {
    const ac = createAccessControl([42]);
    const mw = createAccessMiddleware(ac);
    const next = vi.fn();

    await mw(makeCtx(99), next);

    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT call next() when allowedUserIds is empty", async () => {
    const ac = createAccessControl([]);
    const mw = createAccessMiddleware(ac);
    const next = vi.fn();

    await mw(makeCtx(123), next);

    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT call next() when ctx.from is undefined", async () => {
    const ac = createAccessControl([0]); // wildcard: would allow any real user
    const mw = createAccessMiddleware(ac);
    const next = vi.fn();

    await mw(makeCtx(undefined), next);

    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for wildcard list (0 sentinel)", async () => {
    const ac = createAccessControl([0]);
    const mw = createAccessMiddleware(ac);
    const next = vi.fn().mockResolvedValue(undefined);

    await mw(makeCtx(777), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("unauthorized users receive absolutely no response — next not called, no side effects", async () => {
    const ac = createAccessControl([100]);
    const mw = createAccessMiddleware(ac);
    const next = vi.fn();
    const ctx = makeCtx(999);

    const result = await mw(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
