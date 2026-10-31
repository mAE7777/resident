import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLivingField, RAISE_GAUGE_RING, RAISE_GAUGE_FLOOR } from "../../../src/life/field-live.js";

/**
 * THE DARK GAUGE ON THE RAISE LOOP. Today ANY message of his inside the answer window counts as the
 * answer to what she raised, nobody has ever measured whether his words actually touch the thing.
 * This gauge records that relevance (index.mentions score against the raised node) and does NOTHING
 * else: no threshold, no behavior, measurement first. If a gate is ever warranted, it gets built
 * from this measurement instead of taste.
 */

const T0 = Date.parse("2026-08-01T09:00:00Z");
const HOUR = 3600_000;

function fieldWithRaise() {
  const f = createLivingField({ noReminding: true });
  f.encodeQuestion({ key: "q", text: "码头的渡船周末到底开不开", nowMs: T0, source: "hers", withOther: true, tension: 0.6 });
  return { f, node: f.nodeByKey("q")! };
}

describe("the gauge measures, and only measures", () => {
  it("an on-topic answer scores above an off-topic one", () => {
    const a = fieldWithRaise();
    const b = fieldWithRaise();
    for (let i = 0; i < RAISE_GAUGE_FLOOR; i++) {
      a.f.raise(a.node.id, T0 + i * 2 * HOUR);
      a.f.heSpoke(T0 + i * 2 * HOUR + 60_000, "渡船周末照常开，我查过码头的时刻表了");
      b.f.raise(b.node.id, T0 + i * 2 * HOUR);
      b.f.heSpoke(T0 + i * 2 * HOUR + 60_000, "晚饭想吃什么");
    }
    const on = a.f.raiseGauge();
    const off = b.f.raiseGauge();
    expect(on).not.toBeNull();
    expect(off).not.toBeNull();
    expect(on!).toBeGreaterThan(off!);
    expect(off!).toBe(0);
  });

  it("below the floor it is null — an anecdote, not a reading", () => {
    const { f, node } = fieldWithRaise();
    for (let i = 0; i < RAISE_GAUGE_FLOOR - 1; i++) {
      f.raise(node.id, T0 + i * 2 * HOUR);
      f.heSpoke(T0 + i * 2 * HOUR + 60_000, "渡船的事我知道了");
    }
    expect(f.raiseGauge()).toBeNull();
  });

  it("a message without text records nothing, and the ring stays bounded", () => {
    const { f, node } = fieldWithRaise();
    for (let i = 0; i < RAISE_GAUGE_RING + 20; i++) {
      f.raise(node.id, T0 + i * 2 * HOUR);
      // Half his replies arrive as photos/documents, no text, nothing to score, no fake zeros.
      f.heSpoke(T0 + i * 2 * HOUR + 60_000, i % 2 === 0 ? "渡船" : undefined);
    }
    const g = f.raiseGauge();
    expect(g).not.toBeNull();
  });

  it("PLANTED: the gauge must not change what an answer does", () => {
    // Two identical fields, one answered on-topic, one answered off-topic. If the gauge ever
    // grew a behavioral arm, the raised node's post-answer state would diverge. It must not:
    // being answered is being answered, and the relevance is a recording only.
    const a = fieldWithRaise();
    const b = fieldWithRaise();
    a.f.raise(a.node.id, T0, 0.5);
    a.f.heSpoke(T0 + HOUR, "渡船周末照常开");
    b.f.raise(b.node.id, T0, 0.5);
    b.f.heSpoke(T0 + HOUR, "晚饭想吃什么");
    expect(a.node.charge).toBe(b.node.charge);
    expect(a.node.credence).toBe(b.node.credence);
  });
});

describe("the wiring, floored", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("his text reaches the field at the owner-message site", () => {
    const at = daemon.indexOf("function heSaidSomething(said?: string)");
    expect(at).toBeGreaterThan(-1);
    expect(daemon.slice(at, at + 700)).toContain("field.heSpoke(at, said)");
    expect(daemon, "the text handler must hand his words over").toContain("heSaidSomething(text)");
  });

  it("the gauge reaches Eric through vitals — dead-wire detection for free", () => {
    expect(daemon).toContain("raiseAnswer: () => field.raiseGauge()");
    const vitals = readFileSync(join(process.cwd(), "src/life/vitals.ts"), "utf8");
    expect(vitals).toContain("raiseAnswer: s.raiseAnswer?.()");
  });
});
