import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { AppConfigSchema, type AppConfig } from "./schema.js";
import type { Diagnostic, DiagnosticResult } from "../types/diagnostic.js";

/**
 * Convert snake_case or SCREAMING_SNAKE_CASE to camelCase.
 * "daily_budget_cents" → "dailyBudgetCents"
 * "DAILY_BUDGET_CENTS" → "dailyBudgetCents"
 */
function snakeToCamel(s: string): string {
  return s
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_: string, c: string) => c.toUpperCase());
}

/**
 * Parse a string value into the most appropriate JS primitive.
 * JSON arrays/objects, numbers, booleans, comma-separated numbers, and plain strings are handled.
 */
function coerceValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }

  const num = Number(raw);
  if (!Number.isNaN(num) && trimmed !== "") return num;

  // Comma-separated numbers (e.g. for allowedUserIds)
  if (/^\d+(,\d+)*$/.test(trimmed)) {
    return trimmed.split(",").map(Number);
  }

  return raw;
}

/**
 * Set a value at a nested path in an object, creating intermediate
 * objects as needed. Preserves existing sibling values at each level.
 */
function setNested(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

/**
 * Deep-merge source into target. Arrays and primitives from source replace
 * the corresponding target values; nested objects are merged recursively.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, srcVal] of Object.entries(source)) {
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Scan process.env for RESIDENT__* variables and build an override object.
 *
 * Pattern: RESIDENT__SECTION__KEY  →  { section: { key: value } }
 * Each path segment is converted from SCREAMING_SNAKE_CASE to camelCase.
 * Values are coerced to appropriate primitives.
 *
 * The prefix is Resident-specific on purpose: this project is a separate being
 * from its god-agent ancestor, so it never inherits god-agent's GOD__* env
 * (its Anthropic key, its bot token). Config comes from config.yaml + RESIDENT__.
 */
function parseEnvOverrides(env: NodeJS.ProcessEnv): {
  overrides: Record<string, unknown>;
  diagnostics: Diagnostic[];
} {
  const overrides: Record<string, unknown> = {};
  const diagnostics: Diagnostic[] = [];
  const prefix = "RESIDENT__";

  for (const [envKey, rawValue] of Object.entries(env)) {
    if (!envKey.startsWith(prefix) || rawValue === undefined) continue;

    const rest = envKey.slice(prefix.length);
    // Split on double-underscore delimiter, convert each segment to camelCase
    const segments = rest.split("__").map(snakeToCamel);
    if (segments.length < 1) continue;

    const value = coerceValue(rawValue);
    setNested(overrides, segments, value);
    const isSensitive = /key|token|secret|password|credential/i.test(envKey);
    diagnostics.push({
      level: "info",
      message: `env override: ${envKey} → ${segments.join(".")} = ${isSensitive ? "[REDACTED]" : JSON.stringify(value)}`,
      source: "config",
    });
  }

  return { overrides, diagnostics };
}

/**
 * Load the application configuration.
 *
 * Resolution order (later wins):
 *   1. Zod schema defaults (hardcoded)
 *   2. YAML config file (if present)
 *   3. RESIDENT__* environment variables
 *
 * Env overrides are applied to the fully-resolved config so that
 * leaf overrides don't discard sibling defaults.
 *
 * @param configPath - Optional path to the YAML config file. Defaults to `./config.yaml`.
 * @throws {ZodError} when the merged config fails schema validation.
 */
export function loadConfig(configPath?: string): DiagnosticResult<AppConfig> {
  const diagnostics: Diagnostic[] = [];
  let yamlData: Record<string, unknown> = {};

  const filePath = configPath ?? "config.yaml";

  // Step 1: read YAML
  try {
    const raw = readFileSync(filePath, "utf-8");
    yamlData = (parseYaml(raw) as Record<string, unknown>) ?? {};
    diagnostics.push({ level: "info", message: `config file loaded: ${filePath}`, source: "config" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      diagnostics.push({ level: "info", message: `config file not found (${filePath}), using defaults`, source: "config" });
    } else {
      throw err;
    }
  }

  // Step 2: inject NODE_ENV if absent
  if (!("env" in yamlData)) {
    yamlData["env"] = process.env["NODE_ENV"] ?? "development";
  }

  // Step 3: parse YAML through Zod to fill in schema defaults.
  // This throws ZodError if YAML is structurally invalid (e.g. telegram: {} missing botToken).
  const baseConfig = AppConfigSchema.parse(yamlData);

  // Step 4: collect env overrides
  const { overrides, diagnostics: envDiagnostics } = parseEnvOverrides(
    process.env
  );
  diagnostics.push(...envDiagnostics);

  if (Object.keys(overrides).length === 0) {
    return { result: baseConfig, diagnostics };
  }

  // Step 5: deep-merge env overrides into the fully-resolved base config.
  // Cast to Record for merge; re-parse to re-validate and coerce types.
  const merged = deepMerge(
    baseConfig as unknown as Record<string, unknown>,
    overrides
  );

  // Step 6: re-validate after merging env overrides
  const result = AppConfigSchema.parse(merged);

  return { result, diagnostics };
}
