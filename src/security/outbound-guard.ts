// Outbound guard: blocks mutating HTTP requests (POST/PUT/DELETE/PATCH) to
// sensitive domains. GET is always allowed (reading is safe).
//
// Purpose: protect user from accidental destructive actions. "Send email to my
// boss saying I quit" should be blocked at the code level, prompt engineering
// alone can't prevent this reliably.
//
// Categories:
//   PAYMENT: Stripe, PayPal, Square, Braintree
//   CRYPTO: Coinbase, Binance, Kraken, blockchain
//   EMAIL_SEND: SendGrid, Mailgun, Postmark, SES (sending APIs, not reading)
//   SOCIAL_POST: Twitter/X, Facebook, LinkedIn, Instagram (posting APIs)
//   SMS: Twilio, Vonage/Nexmo, MessageBird
//   FINANCIAL: Plaid, Yodlee, banking APIs
//
// GET/HEAD requests are ALWAYS allowed: reading from any domain is safe.
// The blocklist only applies to state-changing methods.

import { createLogger } from "../utils/logger.js";

const logger = createLogger("outbound-guard");

// ── Sensitive domain patterns ────────────────────────────────────────────────

const SENSITIVE_DOMAINS: Array<{ pattern: string; category: string }> = [
  // Payment processors
  { pattern: "api.stripe.com", category: "payment" },
  { pattern: "api.paypal.com", category: "payment" },
  { pattern: "connect.squareup.com", category: "payment" },
  { pattern: "api.braintreegateway.com", category: "payment" },
  { pattern: "api.paddle.com", category: "payment" },
  { pattern: "api.lemonsqueezy.com", category: "payment" },
  { pattern: "checkout.stripe.com", category: "payment" },

  // Cryptocurrency exchanges
  { pattern: "api.coinbase.com", category: "crypto" },
  { pattern: "api.binance.com", category: "crypto" },
  { pattern: "api.kraken.com", category: "crypto" },
  { pattern: "api.gemini.com", category: "crypto" },
  { pattern: "api.blockchain.com", category: "crypto" },
  { pattern: "api.kucoin.com", category: "crypto" },

  // Email sending APIs (NOT reading, only services whose primary purpose is SENDING)
  { pattern: "api.sendgrid.com", category: "email_send" },
  { pattern: "api.mailgun.net", category: "email_send" },
  { pattern: "api.postmarkapp.com", category: "email_send" },
  { pattern: "api.sparkpost.com", category: "email_send" },
  { pattern: "email.us-east-1.amazonaws.com", category: "email_send" },  // SES
  { pattern: "email.us-west-2.amazonaws.com", category: "email_send" },
  { pattern: "api.resend.com", category: "email_send" },
  { pattern: "api.mailchimp.com", category: "email_send" },
  { pattern: "api.sendbird.com", category: "email_send" },

  // Social media posting APIs
  { pattern: "api.twitter.com", category: "social_post" },
  { pattern: "api.x.com", category: "social_post" },
  { pattern: "graph.facebook.com", category: "social_post" },
  { pattern: "api.instagram.com", category: "social_post" },
  { pattern: "api.linkedin.com", category: "social_post" },
  { pattern: "oauth.reddit.com", category: "social_post" },
  { pattern: "discord.com/api", category: "social_post" },
  { pattern: "api.slack.com", category: "social_post" },

  // SMS / messaging APIs
  { pattern: "api.twilio.com", category: "sms" },
  { pattern: "api.vonage.com", category: "sms" },
  { pattern: "rest.nexmo.com", category: "sms" },
  { pattern: "api.messagebird.com", category: "sms" },

  // Financial / banking aggregation
  { pattern: "api.plaid.com", category: "financial" },
  { pattern: "api.yodlee.com", category: "financial" },
  { pattern: "api.teller.io", category: "financial" },
  { pattern: "api.mx.com", category: "financial" },
];

// Methods that change state (mutating)
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// ── Check function ───────────────────────────────────────────────────────────

export interface OutboundCheckResult {
  allowed: boolean;
  reason?: string;
  category?: string;
}

/**
 * Check if an outbound HTTP request should be allowed.
 * GET/HEAD always allowed. POST/PUT/DELETE/PATCH to sensitive domains blocked.
 */
export function checkOutbound(url: string, method: string): OutboundCheckResult {
  const upperMethod = method.toUpperCase();

  // GET and HEAD are always safe (reading, not writing)
  if (!MUTATING_METHODS.has(upperMethod)) {
    return { allowed: true };
  }

  // Parse hostname from URL
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // Can't parse URL, allow (will fail at fetch time anyway)
    return { allowed: true };
  }

  // Check against sensitive domains
  for (const { pattern, category } of SENSITIVE_DOMAINS) {
    if (hostname === pattern || hostname.endsWith("." + pattern)) {
      logger.warn(
        { url, method: upperMethod, category, hostname },
        "outbound guard blocked mutating request to sensitive domain"
      );
      return {
        allowed: false,
        reason: `Blocked: ${upperMethod} to ${hostname} (${category}). This is a sensitive service — sending emails, making payments, or posting to social media requires your explicit confirmation. Tell the user what you want to do and ask them to perform this action themselves or confirm.`,
        category,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a bash command contains curl/wget to a sensitive domain with a mutating method.
 * Returns null if safe, or a block description if dangerous.
 */
export function checkBashOutbound(command: string): string | null {
  const lower = command.toLowerCase();

  // Only check curl and wget commands
  if (!lower.includes("curl") && !lower.includes("wget")) {
    return null;
  }

  // Check if command targets a sensitive domain with a mutating method
  // curl -X POST https://api.stripe.com/... or curl --data ... https://api.stripe.com/...
  const isMutating =
    lower.includes("-x post") || lower.includes("-x put") ||
    lower.includes("-x delete") || lower.includes("-x patch") ||
    lower.includes("--data") || lower.includes("-d ") ||
    lower.includes("--upload") || lower.includes("-f ") ||
    // wget --post-data or --post-file
    lower.includes("--post-data") || lower.includes("--post-file");

  if (!isMutating) return null;

  for (const { pattern, category } of SENSITIVE_DOMAINS) {
    if (lower.includes(pattern)) {
      return `Blocked: mutating request to ${pattern} (${category}). This is a sensitive service. Ask the user for confirmation before sending data to payment, email, social media, or financial services.`;
    }
  }

  return null;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
}

function isBlockedPrivateHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);

  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!v4) return false;

  const octets = v4.slice(1).map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168
  );
}

/**
 * Check if a bash command contains curl/wget to local/private network hosts.
 * This closes the host-bash bypass around safeFetch's DNS/IP SSRF guard.
 */
export function checkBashPrivateNetwork(command: string): string | null {
  const lower = command.toLowerCase();
  if (!lower.includes("curl") && !lower.includes("wget")) {
    return null;
  }

  const urls = command.match(/https?:\/\/[^\s"'<>]+/giu) ?? [];
  for (const rawUrl of urls) {
    try {
      const parsed = new URL(rawUrl);
      if (isBlockedPrivateHost(parsed.hostname)) {
        return `Blocked: bash network request to private or metadata host ${parsed.hostname}. Use web_fetch for public HTTP(S) reads, or ask the user for an explicit host/network exception.`;
      }
    } catch {
      // Ignore malformed shell fragments; the command will fail normally.
    }
  }

  return null;
}
