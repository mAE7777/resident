import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ToolDef } from "./registry.js";
import type { Zone } from "../security/zones.js";

export type CapabilityAccess =
  | "native"
  | "typed_cli"
  | "mcp"
  | "web_api"
  | "resource"
  | "bash_fallback";

export type CapabilityOutputKind =
  | "text"
  | "file"
  | "artifact"
  | "media"
  | "message"
  | "state"
  | "diagnostic";

export interface CapabilityDependency {
  kind: "command" | "env" | "file" | "python_module" | "python_playwright_chromium";
  name: string;
  required?: boolean;
  purpose?: string;
}

export interface CapabilityManifest {
  /** Stable capability id. Defaults to the tool name when omitted. */
  id?: string;
  domains: string[];
  aliases: string[];
  access: CapabilityAccess;
  outputKind: CapabilityOutputKind;
  riskZone: Zone;
  dependencies?: CapabilityDependency[];
  fallbackTools?: string[];
  verifier?: string;
  smokeTest?: string;
  notes?: string;
}

export interface CapabilitySummary {
  tool: string;
  description: string;
  manifest: CapabilityManifest;
}

export interface CapabilityHealth {
  tool: string;
  ok: boolean;
  dependency: CapabilityDependency;
  detail: string;
}

function homePath(): string {
  return process.env.HOME ?? "";
}

function expandPath(path: string): string {
  if (path === "~") return homePath();
  if (path.startsWith("~/")) return join(homePath(), path.slice(2));
  return path;
}

function commandExists(command: string): boolean {
  try {
    execFileSync("/usr/bin/env", ["which", command], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

const DEPENDENCY_CACHE_TTL_MS = 30_000;
const dependencyCache = new Map<string, { ok: boolean; ts: number }>();

function cachedDependencyCheck(key: string, check: () => boolean): boolean {
  const now = Date.now();
  const cached = dependencyCache.get(key);
  if (cached && now - cached.ts < DEPENDENCY_CACHE_TTL_MS) return cached.ok;
  const ok = check();
  dependencyCache.set(key, { ok, ts: now });
  return ok;
}

function pythonModuleExists(moduleName: string): boolean {
  if (!cachedDependencyCheck("command:python3", () => commandExists("python3"))) return false;
  try {
    execFileSync("python3", [
      "-c",
      `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(moduleName)}) else 1)`,
    ], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function playwrightChromiumExists(): boolean {
  if (!pythonModuleExists("playwright")) return false;
  try {
    execFileSync("python3", [
      "-c",
      [
        "import os, sys",
        "from playwright.sync_api import sync_playwright",
        "with sync_playwright() as p:",
        "    path = p.chromium.executable_path",
        "    sys.exit(0 if path and os.path.exists(path) else 1)",
      ].join("\n"),
    ], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function checkCapabilityDependencies(
  tool: string,
  manifest: CapabilityManifest,
): CapabilityHealth[] {
  return (manifest.dependencies ?? []).map((dependency) => {
    let ok = false;
    let detail = "";
    if (dependency.kind === "command") {
      ok = cachedDependencyCheck(`command:${dependency.name}`, () => commandExists(dependency.name));
      detail = ok ? "command available" : "command missing";
    } else if (dependency.kind === "env") {
      ok = typeof process.env[dependency.name] === "string" && process.env[dependency.name] !== "";
      detail = ok ? "env available" : "env missing";
    } else if (dependency.kind === "python_module") {
      ok = cachedDependencyCheck(`python_module:${dependency.name}`, () => pythonModuleExists(dependency.name));
      detail = ok ? "python module available" : "python module missing";
    } else if (dependency.kind === "python_playwright_chromium") {
      ok = cachedDependencyCheck("python_playwright_chromium", playwrightChromiumExists);
      detail = ok ? "Playwright Chromium available" : "Playwright Chromium missing";
    } else {
      const path = expandPath(dependency.name);
      ok = cachedDependencyCheck(`file:${path}`, () => existsSync(path));
      detail = ok ? path : `missing: ${path}`;
    }
    return { tool, ok, dependency, detail };
  });
}

export function capabilitySearchText(tool: ToolDef): string {
  const manifest = tool.capability;
  return [
    tool.name,
    tool.description,
    ...(manifest?.aliases ?? []),
    ...(manifest?.domains ?? []),
    manifest?.access,
    manifest?.outputKind,
    manifest?.verifier,
    manifest?.smokeTest,
    manifest?.notes,
    ...(manifest?.fallbackTools ?? []),
  ].filter(Boolean).join(" ");
}

export function withCapability(tool: ToolDef, manifest?: CapabilityManifest): ToolDef {
  if (!manifest) return tool;
  return { ...tool, capability: { id: tool.name, ...manifest } };
}

export const BUILTIN_CAPABILITIES: Record<string, CapabilityManifest> = {
  bash: {
    domains: ["devops", "code", "file_ops", "automation"],
    aliases: ["shell", "terminal", "command", "script"],
    access: "bash_fallback",
    outputKind: "diagnostic",
    riskZone: 3,
    fallbackTools: ["artifact_fetch", "video_extract", "web_fetch", "resource_lookup"],
    verifier: "exit_code",
    smokeTest: "sandbox/host command policy",
    notes: "Fallback capability. Prefer typed tools when a typed capability exists.",
  },
  delete: {
    domains: ["file_ops"],
    aliases: ["remove file", "cleanup"],
    access: "native",
    outputKind: "state",
    riskZone: 3,
    verifier: "file",
  },
  edit: {
    domains: ["file_ops", "code"],
    aliases: ["modify file", "replace text", "patch"],
    access: "native",
    outputKind: "file",
    riskZone: 2,
    verifier: "file",
  },
  glob: {
    domains: ["file_ops", "code"],
    aliases: ["find files", "list paths"],
    access: "native",
    outputKind: "text",
    riskZone: 1,
  },
  grep: {
    domains: ["file_ops", "code", "research"],
    aliases: ["search files", "ripgrep", "find text"],
    access: "native",
    outputKind: "text",
    riskZone: 1,
  },
  message: {
    // domains/aliases print in resource_lookup output she reads, so no deliver/delivery there;
    // the verifier string is a programmatic key matched by the outcome
    // verifier and stays: instruments keep their names.
    domains: ["telegram", "sending"],
    aliases: ["send file", "send message"],
    access: "native",
    outputKind: "message",
    riskZone: 2,
    verifier: "delivery",
  },
  memory_read: {
    domains: ["memory"],
    aliases: ["read memory", "recall entry"],
    access: "native",
    outputKind: "text",
    riskZone: 1,
  },
  memory_search: {
    domains: ["memory", "research"],
    aliases: ["search memory", "recall", "long-term memory"],
    access: "native",
    outputKind: "text",
    riskZone: 1,
  },
  read: {
    domains: ["file_ops", "code"],
    aliases: ["open file", "inspect file"],
    access: "native",
    outputKind: "text",
    riskZone: 1,
  },
  undo: {
    domains: ["file_ops", "recovery"],
    aliases: ["rollback", "restore"],
    access: "native",
    outputKind: "state",
    riskZone: 2,
    verifier: "file",
  },
  web_fetch: {
    domains: ["web", "api", "research"],
    aliases: ["fetch url", "http get", "api request"],
    access: "native",
    outputKind: "text",
    riskZone: 1,
    fallbackTools: ["artifact_fetch", "web_search"],
    verifier: "api",
  },
  web_search: {
    domains: ["web", "research", "current_info"],
    aliases: ["search web", "latest", "current", "news"],
    access: "web_api",
    outputKind: "text",
    riskZone: 1,
    verifier: "research",
  },
  write: {
    domains: ["file_ops", "code"],
    aliases: ["create file", "save file"],
    access: "native",
    outputKind: "file",
    riskZone: 2,
    verifier: "file",
  },
};
