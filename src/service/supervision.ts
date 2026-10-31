import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Hers, and not shared. Under the old label, installing her service overwrote the
// neighbour's launchd job and `service stop` stopped his daemon instead of hers.
export const SERVICE_LABEL = "com.resident.daemon";

const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const LOG_DIR = join(homedir(), "Library", "Logs", "resident");
const PLIST_PATH = join(PLIST_DIR, `${SERVICE_LABEL}.plist`);
const STDOUT_LOG = join(LOG_DIR, "stdout.log");
const STDERR_LOG = join(LOG_DIR, "stderr.log");
const SERVICE_ENV_PASSTHROUGH = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "RESIDENT__LLM__API_KEYS",
  "RESIDENT__TELEGRAM__BOT_TOKEN",
  "RESIDENT__SEARCH__API_KEY",
] as const;

export type ServiceAction = "install" | "start" | "stop" | "status" | "uninstall";

export interface ServiceStatus {
  running: boolean;
  pid?: number;
  label: string;
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serviceEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = { CLI_ENABLED: "false" };
  for (const key of SERVICE_ENV_PASSTHROUGH) {
    const value = env[key];
    if (value) result[key] = value;
  }
  return result;
}

function macOsEnvironmentDict(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join("\n");
}

export function macOsPlistContent(
  execPath: string,
  stdoutLog: string,
  stderrLog: string,
  env: Record<string, string> = serviceEnvironment(),
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(execPath)}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${macOsEnvironmentDict(env)}
  </dict>
</dict>
</plist>
`;
}

function escapeSystemdValue(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function systemdEnvironmentLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `Environment=${key}=${escapeSystemdValue(value)}`)
    .join("\n");
}

export function systemdUnitContent(
  execPath: string,
  env: Record<string, string> = serviceEnvironment(),
): string {
  return `[Unit]
Description=Resident daemon
After=network.target

[Service]
ExecStart=${escapeSystemdValue(execPath)} start
Restart=always
RestartSec=3
${systemdEnvironmentLines(env)}

[Install]
WantedBy=multi-user.target
`;
}

function runChecked(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}\n${stderr}`);
  }
}

function runCapture(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  const out = result.stdout?.trim() ?? "";
  if (out) return out;
  return result.stderr?.trim() ?? "";
}

function installMacOs(execPath: string): void {
  mkdirSync(PLIST_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  const plistContent = macOsPlistContent(execPath, STDOUT_LOG, STDERR_LOG);
  writeFileSync(PLIST_PATH, plistContent, "utf8");
  chmodSync(PLIST_PATH, 0o600);

  runChecked("launchctl", ["load", "-w", PLIST_PATH]);
}

function startService(): void {
  runChecked("launchctl", ["load", "-w", PLIST_PATH]);
  runChecked("launchctl", ["start", SERVICE_LABEL]);
}

function stopService(): void {
  runChecked("launchctl", ["stop", SERVICE_LABEL]);
  runChecked("launchctl", ["unload", "-w", PLIST_PATH]);
}

function getStatus(): ServiceStatus {
  const output = runCapture("launchctl", ["list"]);
  const lines = output.split("\n");

  for (const line of lines) {
    if (line.includes(SERVICE_LABEL)) {
      const parts = line.trim().split(/\s+/);
      // Format: PID  Status  Label
      const pidStr = parts[0];
      const pid = pidStr !== "-" ? parseInt(pidStr, 10) : undefined;
      return {
        running: pidStr !== "-" && !isNaN(pid ?? NaN),
        pid,
        label: SERVICE_LABEL,
      };
    }
  }

  return { running: false, label: SERVICE_LABEL };
}

function uninstallService(): void {
  try {
    stopService();
  } catch {
    // Ignore stop errors: service may already be stopped
  }
  if (existsSync(PLIST_PATH)) {
    try {
      runChecked("launchctl", ["unload", "-w", PLIST_PATH]);
    } catch {
      // Ignore unload errors
    }
    unlinkSync(PLIST_PATH);
  }
}

export function handleAction(
  action: ServiceAction,
  execPath?: string,
): ServiceStatus | void {
  const resolvedExec = execPath ?? process.execPath;

  switch (action) {
    case "install":
      installMacOs(resolvedExec);
      return;
    case "start":
      startService();
      return;
    case "stop":
      stopService();
      return;
    case "status":
      return getStatus();
    case "uninstall":
      uninstallService();
      return;
  }
}
