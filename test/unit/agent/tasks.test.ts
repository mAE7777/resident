import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTaskId, createTaskManager } from "../../../src/agent/tasks.js";

// ── AC1: ID format is `drm_` + 8 base36 chars ────────────────────────────────

describe("generateTaskId — AC1: dream task ID format", () => {
  it("produces drm_ prefix with 8 base36 chars", () => {
    const id = generateTaskId("dream");
    expect(id).toMatch(/^drm_[0-9a-z]{8}$/);
  });

  it("produces agt_ prefix for agent_turn", () => {
    expect(generateTaskId("agent_turn")).toMatch(/^agt_[0-9a-z]{8}$/);
  });

  it("produces del_ prefix for delegate", () => {
    expect(generateTaskId("delegate")).toMatch(/^del_[0-9a-z]{8}$/);
  });

  it("produces crn_ prefix for cron", () => {
    expect(generateTaskId("cron")).toMatch(/^crn_[0-9a-z]{8}$/);
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId("dream")));
    expect(ids.size).toBeGreaterThan(90);
  });
});

// ── AC2: eviction after 3 seconds ────────────────────────────────────────────

describe("TaskManager — AC2: terminal tasks evicted after 3s", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes completed task from map after 3000ms", () => {
    const mgr = createTaskManager();
    const task = mgr.create("dream", "test");
    mgr.update(task.id, "completed");

    expect(mgr.get(task.id)).toBeDefined();

    vi.advanceTimersByTime(2999);
    expect(mgr.get(task.id)).toBeDefined();

    vi.advanceTimersByTime(1);
    expect(mgr.get(task.id)).toBeUndefined();
  });

  it("removes failed task from map after 3000ms", () => {
    const mgr = createTaskManager();
    const task = mgr.create("agent_turn", "work");
    mgr.update(task.id, "failed");

    vi.advanceTimersByTime(3000);
    expect(mgr.get(task.id)).toBeUndefined();
  });

  it("removes killed task from map after 3000ms", () => {
    const mgr = createTaskManager();
    const task = mgr.create("cron", "job");
    mgr.update(task.id, "killed");

    vi.advanceTimersByTime(3000);
    expect(mgr.get(task.id)).toBeUndefined();
  });

  it("does not evict running tasks", () => {
    const mgr = createTaskManager();
    const task = mgr.create("dream", "ongoing");
    mgr.update(task.id, "running");

    vi.advanceTimersByTime(10000);
    expect(mgr.get(task.id)).toBeDefined();
  });

  it("records completedAt when transitioning to terminal status", () => {
    const mgr = createTaskManager();
    const task = mgr.create("dream", "work");
    mgr.update(task.id, "completed", "done");

    const updated = mgr.get(task.id);
    // `not.toBeNull()` passed on undefined, in the test named for recording it.
    expect(updated?.completedAt, "completedAt was never recorded").toBeTypeOf("number");
    expect(updated?.completedAt).toBeGreaterThan(0);
    expect(updated?.output).toBe("done");
  });
});
