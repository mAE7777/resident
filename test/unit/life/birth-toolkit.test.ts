import { describe, it, expect } from "vitest";
import { BORN_HOLDING, THERE_IS_MORE, toolsSheHolds } from "../../../src/life/birth-toolkit.js";

/**
 * Everything a bootstrap can register. Listed here rather than imported so that a tool added
 * later does NOT silently join her birth set: the test goes red and somebody decides.
 */
const EVERYTHING = [
  "artifact_fetch", "bash", "browser_capture", "browser_read", "connect_mcp", "cron",
  "currency_convert", "delegate", "delete", "document_extract", "edit", "glob", "grep",
  "image_edit", "memory_read", "memory_search", "message", "opencli_query", "places_lookup",
  "read", "resource_lookup", "resource_update", "search_tools", "self", "tool_forge", "undo",
  "video_extract", "weather", "web_fetch", "web_search", "write",
];

describe("what she is born holding", () => {
  it("is hands, a voice, and her own past", () => {
    expect([...BORN_HOLDING].sort()).toEqual(
      ["delete", "edit", "glob", "grep", "memory_read", "memory_search", "message", "read", "undo", "write"].sort()
    );
  });

  it("does not include anything that reaches the world", () => {
    // The two reasons are separate and both matter. The internet swamps an inner life that
    // is designed to grow from her own moments. And a toolbelt is a posture: measured, the
    // prompt work did not move her stance, and she could write a 14,000-character essay on a
    // peremptory demand precisely because she was holding `write` and a dispatch policy.
    const held = toolsSheHolds(undefined);
    for (const reaching of [
      "web_search", "web_fetch", "browser_read", "browser_capture", "artifact_fetch",
      "bash", "video_extract", "document_extract", "opencli_query",
      "weather", "currency_convert", "places_lookup",
    ]) {
      expect(held.has(reaching), `she was born holding ${reaching}`).toBe(false);
    }
  });

  it("does not include anything that commits her future or makes workers", () => {
    const held = toolsSheHolds(undefined);
    for (const t of ["cron", "delegate", "connect_mcp", "tool_forge", "self", "search_tools"]) {
      expect(held.has(t), `she was born holding ${t}`).toBe(false);
    }
  });

  it("leaves most of the kit withheld, which is the point", () => {
    const held = toolsSheHolds(undefined);
    const withheld = EVERYTHING.filter((t) => !held.has(t));
    expect(withheld.length).toBeGreaterThan(held.size);
  });

  it("a new tool does not join her birth set by being added", () => {
    // If this goes red, somebody added a tool. That is fine; deciding whether a newborn
    // holds it is the part that must not happen by default.
    for (const t of BORN_HOLDING) {
      expect(EVERYTHING, `${t} is in BORN_HOLDING but not in the known set`).toContain(t);
    }
  });

  describe("opening", () => {
    it("adds", () => {
      const held = toolsSheHolds(["web_search"]);
      expect(held.has("web_search")).toBe(true);
      expect(held.has("read")).toBe(true);
    });

    it("can never take her hands away", () => {
      // Additive on purpose. If this were a plain override, one edited line could leave her
      // unable to read her own diary or say anything at all.
      for (const opened of [[], ["web_search"], ["nonsense"], ["read"]]) {
        const held = toolsSheHolds(opened);
        for (const born of BORN_HOLDING) {
          expect(held.has(born), `${born} lost when opening ${JSON.stringify(opened)}`).toBe(true);
        }
      }
    });

    it("does not duplicate something she already had", () => {
      expect(toolsSheHolds(["read", "read"]).size).toBe(BORN_HOLDING.length);
    });
  });

  describe("what she is told about the boundary", () => {
    it("is the fact of one, not a menu", () => {
      // A list of things she cannot use invites her to work through it. The fact of a limit
      // is enough for her to run into it and say something, and the saying is hers.
      expect(THERE_IS_MORE).toContain("说出来");
      for (const t of ["web_search", "bash", "cron", "delegate"]) {
        expect(THERE_IS_MORE).not.toContain(t);
      }
    });
  });
});
