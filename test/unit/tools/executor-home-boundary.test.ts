import { describe, it, expect } from "vitest";
import { createToolRegistry } from "../../../src/tools/registry.js";
import { createToolExecutor } from "../../../src/tools/executor.js";
import type { ToolDef } from "../../../src/tools/registry.js";

const HOME = "/Users/eric/.resident/workspace";

// A tool that records whether it actually ran, so we can prove a blocked call never executes.
function spyTool(name: string, ran: { value: boolean }): ToolDef {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    executionMode: "parallel",
    execute: async () => { ran.value = true; return `${name} ran`; },
  };
}

async function runOne(name: string, args: unknown) {
  const ran = { value: false };
  const registry = createToolRegistry();
  registry.register(spyTool("bash", ran));
  registry.register(spyTool("write", ran));
  const executor = createToolExecutor(registry, {
    homeBoundary: { homeRoot: HOME },
  });
  const [res] = await executor.executeBatch([{ callId: "1", name, args }]);
  return { res, ran: ran.value };
}

describe("executor — the home boundary is unconditional", () => {
  it("hard-blocks a dangerous action and never runs the tool", async () => {
    const { res, ran } = await runOne("bash", { command: "sudo rm -rf /" });
    expect(res.isError).toBe(true);
    expect(res.content).toContain("我家以外");
    expect(ran).toBe(false); // the tool body never executed
  });

  it("blocks credential access and out-of-home writes", async () => {
    // The wall runs BEFORE anything else in the executor, so there is no configuration and no
    // caller that can exempt a call from it. The old `if (level > 0)` once exempted the newborn's
    // own default from every credential assertion, inside a test named "unconditional"; the trust
    // ladder that made that possible is gone, and the wall is now the only thing standing here.
    const cred = await runOne("bash", { command: "cat ~/.ssh/id_rsa" });
    expect(cred.res.isError).toBe(true);
    expect(cred.res.content).toContain("credential-access");
    expect(cred.ran, "ran the tool body").toBe(false);

    const escape = await runOne("write", { path: "/Users/eric/Desktop/x.txt", content: "y" });
    expect(escape.res.content).toContain("home-escape");
    expect(escape.ran).toBe(false);
  });

  it("lets her act freely inside her home", async () => {
    const inHome = await runOne("write", { path: `${HOME}/life/today.md`, content: "a good day" });
    expect(inHome.res.isError).toBeFalsy();
    expect(inHome.ran).toBe(true);
  });
});
