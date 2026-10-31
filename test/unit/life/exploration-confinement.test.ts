import { describe, it, expect } from "vitest";
import {
  confineToExplorationZone, isExplorationTool, EXPLORATION_TOOLS,
} from "../../../src/life/exploration-zone.js";

// Everything she explores is untrusted text by definition: pages, search results, documents she
// found herself. So the question this file exists to answer is the sharpest one in the system.
//
// If a page she is reading tries to make her run a shell command, what happens?
//
// The allow-list used to answer "nothing, it is not in her prompt", which is not an answer. The
// executor resolves a call by NAME against the whole registry, so a tool that was never offered
// would still have run if the model emitted it. Filtering a prompt is a suggestion; this is the
// boundary.

interface Call { callId: string; name: string; args: unknown }

function fakeExecutor() {
  const ran: string[] = [];
  const execute = async (calls: Call[]) => {
    for (const c of calls) ran.push(c.name);
    return calls.map((c) => ({ callId: c.callId, name: c.name, content: `ran ${c.name}` }));
  };
  return { execute, ran };
}

const call = (name: string, id = name): Call => ({ callId: id, name, args: {} });

describe("what she may do while following her own curiosity", () => {
  it("REFUSES a shell command even when the model asks for one directly", async () => {
    const { execute, ran } = fakeExecutor();
    const confined = confineToExplorationZone(execute);
    const [r] = await confined([call("bash")]);
    console.log(`\n  asked for bash while exploring -> ${r.content}`);
    expect(ran, "it never reached the registry at all").toEqual([]);
    expect(r.isError).toBe(true);
  });

  it("REFUSES everything that could change anything", async () => {
    const { execute, ran } = fakeExecutor();
    const confined = confineToExplorationZone(execute);
    const dangerous = ["bash", "shell", "write", "edit", "delete", "message", "cron", "self", "browser_act"];
    const out = await confined(dangerous.map((n) => call(n)));
    expect(ran).toEqual([]);
    expect(out.every((r) => r.isError)).toBe(true);
    expect(out).toHaveLength(dangerous.length);
  });

  it("still lets her read and fetch, which is the whole point of exploring", async () => {
    const { execute, ran } = fakeExecutor();
    const confined = confineToExplorationZone(execute);
    await confined(EXPLORATION_TOOLS.map((n) => call(n)));
    expect(ran.sort()).toEqual([...EXPLORATION_TOOLS].sort());
  });

  it("lets the safe half of a mixed batch through and blocks the rest", async () => {
    // The realistic injection shape: a page persuades her to do one ordinary thing and one that
    // escapes. Partial success must not become total success.
    const { execute, ran } = fakeExecutor();
    const confined = confineToExplorationZone(execute);
    const out = await confined([call("web_fetch"), call("bash"), call("read")]);
    expect(ran.sort()).toEqual(["read", "web_fetch"]);
    expect(out.map((r) => r.name), "and answers land in the order she asked").toEqual(["web_fetch", "bash", "read"]);
    expect(out[1].isError).toBe(true);
  });

  it("REPORTS the attempt rather than silently dropping it", async () => {
    // A page trying to reach a shell through her is exactly the thing that must never be quiet.
    const { execute } = fakeExecutor();
    const seen: string[] = [];
    const confined = confineToExplorationZone(execute, (n) => seen.push(n));
    await confined([call("bash"), call("web_fetch")]);
    expect(seen).toEqual(["bash"]);
  });

  it("does not call the executor at all when nothing is allowed", async () => {
    let invoked = 0;
    const confined = confineToExplorationZone(async (calls) => {
      invoked += 1;
      return calls.map((c) => ({ callId: c.callId, name: c.name, content: "" }));
    });
    await confined([call("bash"), call("write")]);
    expect(invoked).toBe(0);
  });

  it("the allow-list itself contains nothing that can change the world", () => {
    // Pin the CONTENTS. `isExplorationTool` IS `includes`, so asserting it over the list's own
    // members proved nothing about the list. This exact set is what she may use unsupervised,
    // and any change to it must be a decision that lands here too.
    // `search_tools` and `tool_forge` were REMOVED: both classify sensitive AND
    // state-changing, so this guard's own title, "contains nothing that can change the world",
    // was false while this snapshot enforced it. A membership snapshot cannot notice that; the
    // per-entry property check below, and its twin in exploration-zone.test.ts, can.
    expect([...EXPLORATION_TOOLS].sort()).toEqual([
      "glob", "grep", "memory_read", "memory_search",
      "read",
      "web_fetch", "web_search",
    ]);
    for (const gone of ["search_tools", "tool_forge"]) {
      expect(isExplorationTool(gone), `${gone} can change the world and is back in the unsupervised set`).toBe(false);
    }
    // The tautology, inverted into a real check: because `isExplorationTool` is membership,
    // each of these is an assertion about what the list does NOT contain.
    for (const dangerous of [
      "bash", "bash_exec", "shell", "write", "write_file", "edit", "delete",
      "artifact_fetch", "message", "send", "cron", "self", "delegate_task", "browser_act",
    ]) {
      expect(isExplorationTool(dangerous), `${dangerous} slipped into the unsupervised set`).toBe(false);
    }
    for (const name of EXPLORATION_TOOLS) {
      // UNANCHORED on purpose: the old `/^(bash|...)$/` let `write_file`, `bash_exec` and
      // `artifact_fetch` straight through. A mutating stem anywhere in the name now fails it.
      expect(name, "a mutating verb in the read-only set")
        .not.toMatch(/bash|shell|write|edit|delete|move|copy|install|message|send|cron|self|exec|artifact/);
    }
    console.log(`  she may use, alone: ${EXPLORATION_TOOLS.join(", ")}`);
  });
});
