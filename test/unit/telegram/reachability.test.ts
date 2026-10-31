import { describe, it, expect } from "vitest";
import { checkReachability } from "../../../src/telegram/reachability.js";

describe("can she reach him", () => {
  it("says yes for a real chat id", () => {
    const r = checkReachability([123456789]);
    expect(r.reachable).toBe(true);
    expect(r.reason).toContain("123456789");
  });

  it("catches the placeholder that looks configured and is not", () => {
    // `allowedUserIds: [0]` is what shipped. `0` is falsy, so an `if (chatId)` guard reads it
    // as "not set" while `chatId ?? fallback` reads it as set. It is neither: it is a value
    // that will be used and will not work.
    const r = checkReachability([0]);
    expect(r.reachable).toBe(false);
    expect(r.reason).toContain("0");
  });

  it("catches an empty list and a missing one", () => {
    expect(checkReachability([]).reachable).toBe(false);
    expect(checkReachability(undefined).reachable).toBe(false);
  });

  it("catches a non-finite id", () => {
    expect(checkReachability([Number.NaN]).reachable).toBe(false);
    expect(checkReachability([Number.POSITIVE_INFINITY]).reachable).toBe(false);
  });

  it("says the consequence, not just the fact", () => {
    // The reason has to be readable by a person who is wondering why she is quiet, so it
    // names what will happen rather than only what is wrong.
    for (const bad of [[0], [], undefined] as const) {
      const r = checkReachability(bad);
      expect(r.reason.toLowerCase()).toContain("never arrive");
    }
  });
});

describe("the route, not just the address", () => {
  it("says she cannot reach him when there is no bot at all", () => {
    // This reported "she can reach you at chat 123456789" on a daemon booted with NO token.
    // The one instrument built to say "she cannot reach you" said the opposite in precisely
    // the case it exists for, because it only ever looked at who was allowed to talk to her
    // and never at whether there was anything to talk through.
    const r = checkReachability([123456789], "");
    expect(r.reachable, "a chat id with no bot behind it was called a route").toBe(false);
    expect(r.reason).toContain("route to nowhere");
    // And it says she is alive, because she is: her existing does not depend on a messaging app.
    expect(r.reason).toContain("living");
  });

  it("still reports reachable when both halves are there", () => {
    expect(checkReachability([123456789], "123:ABC").reachable).toBe(true);
  });

  it("is silent about the token when the caller does not know it", () => {
    // Callers that pass only the ids get the old behaviour, so this cannot turn into a false
    // "unreachable" for anyone who has not been updated.
    expect(checkReachability([123456789]).reachable).toBe(true);
  });

  it("still catches the placeholder chat id even with a real token", () => {
    expect(checkReachability([0], "123:ABC").reachable).toBe(false);
  });
});
