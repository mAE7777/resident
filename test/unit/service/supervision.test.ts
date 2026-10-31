import { describe, it, expect, beforeAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  xmlEscape,
  macOsPlistContent,
  systemdUnitContent,
  SERVICE_LABEL,
} from "../../../src/service/supervision.js";

// ── xmlEscape ─────────────────────────────────────────────────────────────────

describe("xmlEscape()", () => {
  it("escapes ampersand", () => {
    expect(xmlEscape("a&b")).toBe("a&amp;b");
  });

  it("escapes less-than", () => {
    expect(xmlEscape("a<b")).toBe("a&lt;b");
  });

  it("escapes greater-than", () => {
    expect(xmlEscape("a>b")).toBe("a&gt;b");
  });

  it("escapes double-quote", () => {
    expect(xmlEscape('a"b')).toBe("a&quot;b");
  });

  it("escapes single-quote", () => {
    expect(xmlEscape("a'b")).toBe("a&apos;b");
  });

  it("handles all five special chars in one string", () => {
    expect(xmlEscape(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("leaves safe characters unchanged", () => {
    expect(xmlEscape("hello/world")).toBe("hello/world");
  });

  it("handles spaces and path separators", () => {
    const path = "/Users/test user/Library/Applications/my app";
    const escaped = xmlEscape(path);
    // No special chars in typical paths, should be unchanged
    expect(escaped).toBe(path);
  });

  it("handles path with ampersand injection attempt", () => {
    expect(xmlEscape("/path/to/my&app")).toBe("/path/to/my&amp;app");
  });
});

// ── macOsPlistContent ─────────────────────────────────────────────────────────

describe("macOsPlistContent()", () => {
  const execPath = "/usr/local/bin/resident";
  const stdoutLog = join(homedir(), "Library/Logs/resident/stdout.log");
  const stderrLog = join(homedir(), "Library/Logs/resident/stderr.log");

  let plist: string;

  beforeAll(() => {
    plist = macOsPlistContent(execPath, stdoutLog, stderrLog);
  });

  it("contains correct service label", () => {
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
  });

  it("includes exec path in ProgramArguments", () => {
    expect(plist).toContain(`<string>${execPath}</string>`);
  });

  it("uses 'start' as the command argument (not 'run')", () => {
    expect(plist).toContain("<string>start</string>");
    expect(plist).not.toContain("<string>run</string>");
  });

  it("has RunAtLoad set to true", () => {
    expect(plist).toContain("<key>RunAtLoad</key>");
    const runAtLoadIdx = plist.indexOf("<key>RunAtLoad</key>");
    const afterRunAtLoad = plist.slice(runAtLoadIdx);
    expect(afterRunAtLoad).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  it("has KeepAlive set to true", () => {
    expect(plist).toContain("<key>KeepAlive</key>");
    const keepAliveIdx = plist.indexOf("<key>KeepAlive</key>");
    const afterKeepAlive = plist.slice(keepAliveIdx);
    expect(afterKeepAlive).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it("has correct stdout log path", () => {
    expect(plist).toContain(`<key>StandardOutPath</key>`);
    expect(plist).toContain(`<string>${stdoutLog}</string>`);
  });

  it("has correct stderr log path", () => {
    expect(plist).toContain(`<key>StandardErrorPath</key>`);
    expect(plist).toContain(`<string>${stderrLog}</string>`);
  });

  it("log paths are under ~/Library/Logs/resident/", () => {
    const logDir = join(homedir(), "Library", "Logs", "resident");
    expect(stdoutLog).toContain(logDir);
    expect(stderrLog).toContain(logDir);
    expect(plist).toContain(logDir);
  });

  it("sets CLI_ENABLED=false in EnvironmentVariables", () => {
    expect(plist).toContain("<key>CLI_ENABLED</key>");
    expect(plist).toContain("<string>false</string>");
  });

  it("is valid XML plist structure", () => {
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain("<plist version=\"1.0\">");
    expect(plist).toContain("</plist>");
    expect(plist).toContain("<dict>");
    expect(plist).toContain("</dict>");
  });

  it("XML-escapes exec path with special characters", () => {
    const specialPath = "/path/to/my&agent";
    const result = macOsPlistContent(specialPath, stdoutLog, stderrLog);
    expect(result).toContain("/path/to/my&amp;agent");
    expect(result).not.toContain("/path/to/my&agent<");
  });
});

// ── systemdUnitContent ────────────────────────────────────────────────────────

describe("systemdUnitContent()", () => {
  const execPath = "/usr/local/bin/resident";
  let unit: string;

  beforeAll(() => {
    unit = systemdUnitContent(execPath);
  });

  it("contains ExecStart with exec path and 'start' arg", () => {
    expect(unit).toContain(`ExecStart="${execPath}" start`);
  });

  it("has Restart=always", () => {
    expect(unit).toContain("Restart=always");
  });

  it("has RestartSec=3", () => {
    expect(unit).toContain("RestartSec=3");
  });

  it("has CLI_ENABLED=false environment variable", () => {
    expect(unit).toContain('Environment=CLI_ENABLED="false"');
  });

  it("can include subprocess API keys for launchd/systemd service starts", () => {
    const env = { CLI_ENABLED: "false", GEMINI_API_KEY: "gemini-test-key" };
    const plist = macOsPlistContent(execPath, "/tmp/out.log", "/tmp/err.log", env);
    const unit = systemdUnitContent(execPath, env);

    expect(plist).toContain("<key>GEMINI_API_KEY</key>");
    expect(plist).toContain("<string>gemini-test-key</string>");
    expect(unit).toContain("Environment=GEMINI_API_KEY=");
    expect(unit).toContain("gemini-test-key");
  });

  it("has [Unit], [Service], and [Install] sections", () => {
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
  });

  it("has WantedBy=multi-user.target", () => {
    expect(unit).toContain("WantedBy=multi-user.target");
  });
});

// ── SERVICE_LABEL constant ────────────────────────────────────────────────────

describe("SERVICE_LABEL", () => {
  it("is the expected launchd label", () => {
    expect(SERVICE_LABEL).toBe("com.resident.daemon");
  });

  it("is not the neighbour's label — installing her service must not overwrite his job", () => {
    expect(SERVICE_LABEL).not.toContain("god-agent");
  });
});

// ── Command argument construction ─────────────────────────────────────────────

describe("Command argument arrays", () => {
  it("install launchctl args: load -w <plist>", () => {
    const plistPath = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    const args = ["load", "-w", plistPath];
    expect(args).toHaveLength(3);
    expect(args[0]).toBe("load");
    expect(args[1]).toBe("-w");
    expect(args[2]).toContain(SERVICE_LABEL);
    expect(args[2]).toContain(".plist");
  });

  it("stop launchctl args: stop <label>", () => {
    const args = ["stop", SERVICE_LABEL];
    expect(args[0]).toBe("stop");
    expect(args[1]).toBe(SERVICE_LABEL);
  });

  it("unload launchctl args: unload -w <plist>", () => {
    const plistPath = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    const args = ["unload", "-w", plistPath];
    expect(args[0]).toBe("unload");
    expect(args[1]).toBe("-w");
    expect(args[2]).toBe(plistPath);
  });

  it("status launchctl args: list", () => {
    const args = ["list"];
    expect(args[0]).toBe("list");
  });
});

// ── Status parsing ────────────────────────────────────────────────────────────

describe("Status parsing logic", () => {
  function parseStatusLine(output: string, label: string): { running: boolean; pid?: number } {
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes(label)) {
        const parts = line.trim().split(/\s+/);
        const pidStr = parts[0];
        const pid = pidStr !== "-" ? parseInt(pidStr, 10) : undefined;
        return {
          running: pidStr !== "-" && !isNaN(pid ?? NaN),
          pid,
        };
      }
    }
    return { running: false };
  }

  it("parses running service with PID", () => {
    const output = `PID\tStatus\tLabel\n1234\t0\tcom.resident.daemon`;
    const status = parseStatusLine(output, SERVICE_LABEL);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(1234);
  });

  it("parses stopped service (dash PID)", () => {
    const output = `-\t0\tcom.resident.daemon`;
    const status = parseStatusLine(output, SERVICE_LABEL);
    expect(status.running).toBe(false);
    expect(status.pid).toBeUndefined();
  });

  it("returns not running when label not found", () => {
    const output = "1111\t0\tsome.other.service";
    const status = parseStatusLine(output, SERVICE_LABEL);
    expect(status.running).toBe(false);
  });

  it("handles multi-line launchctl list output", () => {
    const output = [
      "PID\tStatus\tLabel",
      "1111\t0\tcom.apple.some-service",
      "5678\t0\tcom.resident.daemon",
      "-\t0\tcom.apple.other",
    ].join("\n");
    const status = parseStatusLine(output, SERVICE_LABEL);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(5678);
  });
});
