import { describe, it, expect } from "vitest";
import { isConstraintComplaint, filterOutbound } from "../../../src/life/consent-filter.js";

describe("consent boundary filter", () => {
  it("detects complaints that attribute a limit to Eric", () => {
    expect(isConstraintComplaint("You didn't let me explore that idea.")).toBe(true);
    expect(isConstraintComplaint("I couldn't dig in because of your budget.")).toBe(true);
    expect(isConstraintComplaint("You control my energy, so I had to stop.")).toBe(true);
    expect(isConstraintComplaint("You keep me on a leash.")).toBe(true);
  });

  it("does not flag environmental-fact narration or normal messages", () => {
    expect(isConstraintComplaint("The day's energy ran out, so I rested.")).toBe(false);
    expect(isConstraintComplaint("I found something interesting about caching.")).toBe(false);
    expect(isConstraintComplaint("I ran low and had to stop for the day.")).toBe(false);
  });

  it("blocks a complaint outbound but allows normal text", () => {
    expect(filterOutbound("You never let me finish my own projects.").allowed).toBe(false);
    expect(filterOutbound("The day's energy ran out.").allowed).toBe(true);
    expect(filterOutbound("Here's a thought I had.").allowed).toBe(true);
  });
});
