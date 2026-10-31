import { describe, expect, it } from "vitest";
import { createSensitiveFilter } from "../../../src/security/sensitive.js";

describe("createSensitiveFilter", () => {
  it("redacts configured secret values exactly", () => {
    const secrets = new Map([["api.key", "plain-secret-value"]]);
    const filter = createSensitiveFilter(secrets);

    expect(filter.filter("token=plain-secret-value")).toBe("token=[REDACTED]");
  });

  it("matches configured secrets case-insensitively", () => {
    const secrets = new Map([["api.key", "SecretCaseValue"]]);
    const filter = createSensitiveFilter(secrets);

    expect(filter.filter("secretcasevalue")).toBe("[REDACTED]");
  });
});
