// Inbound secret scanning: scan user messages before LLM sees them
// Blocked messages never reach LLM context
import { createLeakScanner } from "./leak.js";

export interface InboundScanResult {
  allowed: boolean;
  reason?: string;
}

// Command prefixes that explicitly provide credentials to the vault,
// these are user-initiated vault operations and should not be rejected
const VAULT_COMMAND_PREFIXES = [
  "/vault set ",
  "/vault add ",
  "/secret set ",
  "/secret add ",
  "/store key ",
];

function isVaultCommand(message: string): boolean {
  const trimmed = message.trimStart();
  return VAULT_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

const leakScanner = createLeakScanner();

export function scanInbound(message: string): InboundScanResult {
  // Exception: messages explicitly providing credentials to the agent's vault
  if (isVaultCommand(message)) {
    return { allowed: true };
  }

  const { matches } = leakScanner.scanForLeaks(message);

  // Block on any match with action 'block'
  const blocking = matches.find((m) => m.action === "block");
  if (blocking) {
    return {
      allowed: false,
      reason: `Message contains what appears to be a secret (${blocking.description}). Remove the credential before sending.`,
    };
  }

  // Warn on 'warn' matches, still allow but surface the warning
  // (inbound scan: warn-level matches pass through; callers can inspect result)
  return { allowed: true };
}
