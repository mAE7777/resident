// proxy.ts, 4-level proxy resolution cascade for Telegram bot connections.
// Level 1: TELEGRAM_PROXY_URL / TELEGRAM_PROXY
// Level 2: HTTPS_PROXY / HTTP_PROXY / ALL_PROXY (+ lowercase variants)
// Level 3: macOS system proxy via scutil --proxy
// Level 4: direct (undefined)

import { execFileSync } from "child_process";

/**
 * Resolve a proxy URL from environment variables or OS configuration.
 * Returns undefined if no proxy is configured (use direct connection).
 */
export function resolveProxy(): string | undefined {
  // ── Level 1: Telegram-specific env var ────────────────────────────────────
  const telegramProxy =
    process.env["TELEGRAM_PROXY_URL"] ?? process.env["TELEGRAM_PROXY"];
  if (telegramProxy) return telegramProxy;

  // ── Level 2: Standard proxy env vars ─────────────────────────────────────
  const standardProxy =
    process.env["HTTPS_PROXY"] ??
    process.env["https_proxy"] ??
    process.env["HTTP_PROXY"] ??
    process.env["http_proxy"] ??
    process.env["ALL_PROXY"] ??
    process.env["all_proxy"];
  if (standardProxy) return standardProxy;

  // ── Level 3: macOS system proxy via scutil ────────────────────────────────
  if (process.platform === "darwin") {
    const macProxy = detectMacosSystemProxy();
    if (macProxy) return macProxy;
  }

  // ── Level 4: Direct connection ────────────────────────────────────────────
  return undefined;
}

/**
 * Parse scutil --proxy output to detect macOS system proxy settings.
 * Uses execFileSync with array args, no shell injection possible.
 */
function detectMacosSystemProxy(): string | undefined {
  try {
    const output = execFileSync("scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 5000,
    });

    const settings = parseScutilOutput(output);

    // Check HTTPS proxy first (preferred)
    if (settings["HTTPSEnable"] === "1") {
      const host = settings["HTTPSProxy"] ?? "";
      const port = settings["HTTPSPort"] ?? "443";
      if (host) return `http://${host}:${port}`;
    }

    // Fall back to HTTP proxy
    if (settings["HTTPEnable"] === "1") {
      const host = settings["HTTPProxy"] ?? "";
      const port = settings["HTTPPort"] ?? "80";
      if (host) return `http://${host}:${port}`;
    }

    // Check SOCKS proxy (with remote DNS resolution)
    if (settings["SOCKSEnable"] === "1") {
      const host = settings["SOCKSProxy"] ?? "";
      const port = settings["SOCKSPort"] ?? "1080";
      if (host) return `socks5://${host}:${port}`;
    }
  } catch {
    // scutil may not be available or may time out, fall through to direct
  }

  return undefined;
}

/**
 * Parse scutil --proxy output into a key-value record.
 * Each line has the format: "  Key : Value"
 */
function parseScutilOutput(output: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const colonIdx = line.indexOf(" : ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 3).trim();
    if (key) settings[key] = value;
  }
  return settings;
}
