import { classifyTool, type Zone } from "./zones.js";

export interface OperationRisk {
  zone: Zone;
  isSensitive: boolean;
  isStateChange: boolean;
  targetPath?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function targetPathForToolArgs(toolName: string, args: unknown): string | undefined {
  const a = asRecord(args);
  if (toolName === "write" || toolName === "read" || toolName === "delete") return str(a.path);
  if (toolName === "edit") return str(a.path);
  if (toolName === "image_edit") return str(a.input_path) ?? str(a.output_path);
  if (toolName === "message") return str(a.file_path);
  if (toolName === "web_fetch") return str(a.save_path);
  if (toolName === "artifact_fetch") return str(a.output_path);
  if (toolName === "browser_capture") return str(a.output_path);
  if (toolName === "video_extract") return str(a.output_path);
  if (toolName === "document_extract") return str(a.path);
  return undefined;
}

export function classifyOperationRisk(toolName: string, args: unknown): OperationRisk {
  const name = toolName.toLowerCase();
  const a = asRecord(args);
  let zone = classifyTool(name);
  let isSensitive = zone >= 2;
  let isStateChange = zone >= 2;

  if (name === "web_fetch") {
    const method = String(a.method ?? "GET").toUpperCase();
    const mutatesRemote = method !== "GET" && method !== "HEAD";
    const savesLocal = typeof a.save_path === "string" && a.save_path.trim() !== "";
    zone = mutatesRemote || savesLocal ? 2 : 1;
    isSensitive = false;
    isStateChange = mutatesRemote || savesLocal;
  }

  if (name === "artifact_fetch") {
    // Downloads mutate local workspace state; auth/browser hazards are handled
    // inside the typed tool with SSRF/path/cookie checks rather than by generic R2.
    const protectedBackend = a.backend === "browser" || a.backend === "protected_scrape";
    zone = protectedBackend ? 3 : 2;
    isSensitive = false;
    isStateChange = true;
  }

  if (name === "video_extract") {
    // Caption/analysis extraction writes outputs under the workspace.
    zone = 2;
    isSensitive = false;
    isStateChange = true;
  }

  if (name === "browser_capture") {
    zone = 2;
    isSensitive = true;
    isStateChange = true;
  }

  if (name === "browser_read" || name === "opencli_query") {
    zone = 2;
    isSensitive = true;
    isStateChange = false;
  }

  if (name === "document_extract") {
    zone = 2;
    isSensitive = true;
    isStateChange = false;
  }

  if (name === "write" || name === "edit" || name === "delete" || name === "image_edit" || name === "resource_update") {
    zone = 2;
    isSensitive = false;
    isStateChange = true;
  }

  if (name === "self" && a.operation === "write") {
    zone = 2;
    isSensitive = true;
    isStateChange = true;
  }

  if (name === "message") {
    zone = 2;
    isSensitive = false;
    isStateChange = true;
  }

  if (name === "cron") {
    // Listing scheduled jobs is a read-only scheduler query. Mutations remain
    // gated because they create, remove, enable, or disable future behavior.
    zone = a.action === "list" ? 1 : 2;
    isSensitive = false;
    isStateChange = a.action !== "list";
  }

  if (name === "undo") {
    zone = a.action === "list" ? 1 : 2;
    isSensitive = false;
    isStateChange = a.action !== "list";
  }

  if (name === "connect_mcp") {
    // The runtime tool records a human-review proposal; it does not directly
    // attach new infrastructure from an LLM turn.
    zone = 3;
    isSensitive = true;
    isStateChange = false;
  }

  return {
    zone,
    isSensitive,
    isStateChange,
    targetPath: targetPathForToolArgs(name, args),
  };
}
