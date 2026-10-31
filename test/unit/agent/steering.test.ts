import { describe, it, expect } from "vitest";
import { createSteeringQueue } from "../../../src/agent/steering.js";

describe("createSteeringQueue", () => {
  // AC3: 2 messages arrive while turn active, drain returns both in order
  it("AC3: drain returns multiple messages in the order they were enqueued", () => {
    const q = createSteeringQueue();
    const sessionId = "session-abc";

    q.enqueue(sessionId, { text: "first message" });
    q.enqueue(sessionId, { text: "second message" });

    const drained = q.drain(sessionId);

    expect(drained).toHaveLength(2);
    expect(drained[0]).toEqual({ text: "first message" });
    expect(drained[1]).toEqual({ text: "second message" });
  });

  it("drain clears the queue so subsequent drain returns empty", () => {
    const q = createSteeringQueue();
    q.enqueue("s1", "msg");
    q.drain("s1");
    expect(q.drain("s1")).toEqual([]);
  });

  it("hasMessages returns false for unknown session", () => {
    const q = createSteeringQueue();
    expect(q.hasMessages("unknown")).toBe(false);
  });

  it("hasMessages returns true after enqueue, false after drain", () => {
    const q = createSteeringQueue();
    q.enqueue("s2", "hello");
    expect(q.hasMessages("s2")).toBe(true);

    q.drain("s2");
    expect(q.hasMessages("s2")).toBe(false);
  });

  it("sessions are isolated — draining one does not affect another", () => {
    const q = createSteeringQueue();
    q.enqueue("A", "msg-a");
    q.enqueue("B", "msg-b1");
    q.enqueue("B", "msg-b2");

    // Drain A
    const drained = q.drain("A");
    expect(drained).toEqual(["msg-a"]);

    // B is unaffected
    expect(q.hasMessages("B")).toBe(true);
    expect(q.drain("B")).toEqual(["msg-b1", "msg-b2"]);
  });

  it("drain returns empty array when queue has no messages for session", () => {
    const q = createSteeringQueue();
    expect(q.drain("no-such-session")).toEqual([]);
  });

  it("enqueue accepts any type of message (string, object, number)", () => {
    const q = createSteeringQueue();
    q.enqueue("s", "text");
    q.enqueue("s", 42);
    q.enqueue("s", { nested: true });

    const msgs = q.drain("s");
    expect(msgs).toEqual(["text", 42, { nested: true }]);
  });
});
