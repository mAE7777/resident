import { describe, it, expect } from "vitest";
import { createLogger } from "../../../src/utils/logger.js";

describe("createLogger", () => {
  it("returns a pino logger with the given name", () => {
    const logger = createLogger("test");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("respects RESIDENT__LOG_LEVEL env variable", () => {
    process.env["RESIDENT__LOG_LEVEL"] = "debug";
    const logger = createLogger("test-level");
    expect(logger.level).toBe("debug");
    delete process.env["RESIDENT__LOG_LEVEL"];
  });

  it("defaults to info level when RESIDENT__LOG_LEVEL is not set", () => {
    delete process.env["RESIDENT__LOG_LEVEL"];
    const logger = createLogger("test-default");
    expect(logger.level).toBe("info");
  });
});
