import { describe, it, expect } from "vitest";
import { classifyReversibility, IRREVERSIBLE_KEYWORDS } from "../../../src/security/reversibility.js";
import { classify } from "../../../src/security/rule-of-two.js";

// ---------------------------------------------------------------------------
// classifyReversibility(), builtin tools use argument-aware reversibility
// ---------------------------------------------------------------------------

describe("classifyReversibility — builtin tools", () => {
  it("write tool is reversible", () => {
    expect(classifyReversibility("write")).toBe(true);
  });

  it("read tool is reversible", () => {
    expect(classifyReversibility("read")).toBe(true);
  });

  it("edit tool is reversible", () => {
    expect(classifyReversibility("edit")).toBe(true);
  });

  it("bash tool is reversible", () => {
    expect(classifyReversibility("bash")).toBe(true);
  });

  it("bash tool is irreversible when the command sends or deploys state", () => {
    expect(classifyReversibility("bash", { command: "git push origin main" })).toBe(false);
  });

  it("message and cron mutations are irreversible side effects", () => {
    expect(classifyReversibility("message")).toBe(false);
    expect(classifyReversibility("cron", { action: "add" })).toBe(false);
    expect(classifyReversibility("cron", { action: "remove", job_id: "job-1" })).toBe(false);
  });

  it("cron list is reversible because it only reads scheduler state", () => {
    expect(classifyReversibility("cron", { action: "list" })).toBe(true);
  });

  it("artifact_fetch is reversible for downloads and irreversible when it sends the file out", () => {
    expect(classifyReversibility("artifact_fetch", { source: "workspace/file.zip" })).toBe(true);
    expect(classifyReversibility("artifact_fetch", { source: "https://example.com/file.zip" })).toBe(true);
    expect(classifyReversibility("artifact_fetch", { source: "https://example.com/file.zip", send: true })).toBe(false);
  });

  it("browser_capture is reversible because it only writes a workspace artifact", () => {
    expect(classifyReversibility("browser_capture", { url: "https://example.com", output_path: "shots/page.png" })).toBe(true);
  });

  it("web_fetch mutating methods are irreversible but read-only methods are reversible", () => {
    expect(classifyReversibility("web_fetch", { url: "https://example.com" })).toBe(true);
    expect(classifyReversibility("web_fetch", { url: "https://example.com", method: "HEAD" })).toBe(true);
    expect(classifyReversibility("web_fetch", { url: "https://example.com", method: "POST" })).toBe(false);
  });

  it("self is reversible only for read operations", () => {
    expect(classifyReversibility("self", { operation: "read", path: "iteration" })).toBe(true);
    expect(classifyReversibility("self", { operation: "write", path: "scratch", value: 1 })).toBe(false);
  });

  it("delete tool is reversible because it moves targets to trash", () => {
    expect(classifyReversibility("delete")).toBe(true);
  });

  it("glob tool is reversible", () => {
    expect(classifyReversibility("glob")).toBe(true);
  });

  it("grep tool is reversible", () => {
    expect(classifyReversibility("grep")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyReversibility(), MCP tool keyword matching
// ---------------------------------------------------------------------------

describe("classifyReversibility — MCP tools", () => {
  it("AC: MCP tool named send_email is irreversible", () => {
    expect(classifyReversibility("send_email")).toBe(false);
  });

  it("AC: MCP tool named browser_navigate is reversible", () => {
    expect(classifyReversibility("browser_navigate")).toBe(true);
  });

  it("MCP tool with delete keyword is irreversible", () => {
    expect(classifyReversibility("delete_file")).toBe(false);
  });

  it("MCP tool with publish keyword is irreversible", () => {
    expect(classifyReversibility("publish_post")).toBe(false);
  });

  it("MCP tool with deploy keyword is irreversible", () => {
    expect(classifyReversibility("deploy_service")).toBe(false);
  });

  it("MCP tool with remove keyword is irreversible", () => {
    expect(classifyReversibility("remove_record")).toBe(false);
  });

  it("MCP tool with drop keyword is irreversible", () => {
    expect(classifyReversibility("drop_table")).toBe(false);
  });

  it("MCP tool with terminate keyword is irreversible", () => {
    expect(classifyReversibility("terminate_instance")).toBe(false);
  });

  it("MCP tool with cancel keyword is irreversible", () => {
    expect(classifyReversibility("cancel_subscription")).toBe(false);
  });

  it("neutral MCP tool name is reversible", () => {
    expect(classifyReversibility("list_files")).toBe(true);
  });

  it("keyword matching is case-insensitive", () => {
    expect(classifyReversibility("Send_Email")).toBe(false);
    expect(classifyReversibility("DELETE_ROW")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classify(), escalation modifier with isReversible
// ---------------------------------------------------------------------------

describe("classify() — reversibility escalation", () => {
  it("AC: file write tool (builtin write, isStateChange=true) is reversible → auto-executes (no escalation)", () => {
    // Write is a builtin: classifyReversibility("write") = true
    // With isReversible=true: no escalation
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: true, isReversible: true });
    expect(result.decision).toBe("auto");
  });

  it("irreversible + state change escalates auto → confirm", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: true, isReversible: false });
    expect(result.decision).toBe("confirm");
    expect(result.reason).toContain("escalated");
    expect(result.reason).toContain("auto→confirm");
  });

  it("irreversible + state change + sensitive escalates confirm → block", () => {
    // Base: sensitive+stateChange → confirm; with !reversible → block
    const result = classify({ isUntrusted: false, isSensitive: true, isStateChange: true, isReversible: false });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("escalated");
    expect(result.reason).toContain("confirm→block");
  });

  it("AC: send_email (irreversible + isUntrusted+isStateChange) escalates auto → confirm", () => {
    // send_email: isUntrusted=true, isStateChange=true → base auto; !reversible → confirm
    const result = classify({ isUntrusted: true, isSensitive: false, isStateChange: true, isReversible: false });
    expect(result.decision).toBe("confirm");
  });

  it("irreversible + no state change → no escalation (read-only irreversible is fine)", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: false, isReversible: false });
    expect(result.decision).toBe("auto");
    expect(result.reason).not.toContain("escalated");
  });

  it("irreversible + untrusted + sensitive + no stateChange → auto (no escalation)", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: false, isReversible: false });
    expect(result.decision).toBe("auto");
    expect(result.reason).not.toContain("escalated");
  });

  it("already block + irreversible → stays block (no double-escalation)", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: true, isReversible: false });
    expect(result.decision).toBe("block");
    // Reason should NOT contain escalation since we skip the modifier when already block
    expect(result.reason).not.toContain("escalated");
  });

  it("isReversible defaults to true when omitted — backward compatible", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: true });
    expect(result.decision).toBe("auto");
  });

  it("properties tuple has 4 elements including isReversible as 4th", () => {
    const result = classify({ isUntrusted: true, isSensitive: false, isStateChange: true, isReversible: false });
    expect(result.properties).toHaveLength(4);
    expect(result.properties[3]).toBe(false);
  });

  it("properties tuple 4th element is true when reversible", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: false, isReversible: true });
    expect(result.properties[3]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IRREVERSIBLE_KEYWORDS export: sanity
// ---------------------------------------------------------------------------

describe("IRREVERSIBLE_KEYWORDS export", () => {
  it("exports a non-empty array", () => {
    expect(Array.isArray(IRREVERSIBLE_KEYWORDS)).toBe(true);
    expect(IRREVERSIBLE_KEYWORDS.length).toBeGreaterThan(0);
  });

  it("includes send and delete", () => {
    expect(IRREVERSIBLE_KEYWORDS).toContain("send");
    expect(IRREVERSIBLE_KEYWORDS).toContain("delete");
  });
});

// IF IT CANNOT BE SEEN, IT IS NOT REVERSIBLE.
//
// `argsText` returned "" when `JSON.stringify` threw, and "" reads as "there is nothing alarming in
// these arguments", the opposite of what is actually known. Three branches took it that way:
// `artifact_fetch` concluded it was not delivering, `web_fetch` defaulted to GET, and `bash` saw an
// empty command. All three answered REVERSIBLE and skipped the confirmation.
//
// There is no known reachable path, because tool arguments come from parsed model JSON and carry no
// cycles or BigInt. A safety check that fails in the wrong direction is worth fixing regardless: the
// next caller is not obliged to come from there, and "unreachable today" is not a property anybody
// re-checks.

describe("arguments that cannot be read", () => {
  const circular: Record<string, unknown> = { send: false };
  circular.self = circular;

  for (const tool of ["artifact_fetch", "web_fetch", "bash", "self", "cron", "some_mcp_tool"]) {
    it(`${tool} with unreadable arguments is NOT reversible`, () => {
      expect(classifyReversibility(tool, circular),
        "not knowing what she is about to do is not a reason to skip asking").toBe(false);
    });
  }

  it("BigInt is the other way to be unreadable", () => {
    expect(classifyReversibility("web_fetch", { size: BigInt(1) })).toBe(false);
  });

  it("but ABSENT arguments are still just absent", () => {
    // "No arguments" and "arguments I could not read" are different answers, and conflating them was
    // the bug. A tool called with nothing is judged on its name, exactly as before.
    expect(classifyReversibility("read", undefined)).toBe(true);
    expect(classifyReversibility("read", null)).toBe(true);
    expect(classifyReversibility("message", undefined), "and a wall stays a wall").toBe(false);
  });

  it("and ordinary arguments are unaffected", () => {
    expect(classifyReversibility("web_fetch", { url: "https://x.example", method: "GET" })).toBe(true);
    expect(classifyReversibility("web_fetch", { url: "https://x.example", method: "POST" })).toBe(false);
    expect(classifyReversibility("artifact_fetch", { url: "https://x.example", send: true })).toBe(false);
    expect(classifyReversibility("artifact_fetch", { url: "https://x.example" })).toBe(true);
  });
});
