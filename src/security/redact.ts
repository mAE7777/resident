// Secret redaction: 44+ patterns ported from Hermes redact.py
// Applies pattern matching to mask API keys, tokens, and credentials in text

// Masking strategy: <18 chars → "***", >=18 → first6...last4
export function maskToken(token: string): string {
  if (token.length < 18) {
    return "***";
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

// Known API key prefixes: match the prefix + contiguous token chars
// Ported from Hermes redact.py _PREFIX_PATTERNS (lines 21-57)
const PREFIX_PATTERNS = [
  String.raw`sk-[A-Za-z0-9_-]{10,}`,           // OpenAI / OpenRouter / Anthropic (sk-ant-*)
  String.raw`ghp_[A-Za-z0-9]{10,}`,            // GitHub PAT (classic)
  String.raw`github_pat_[A-Za-z0-9_]{10,}`,    // GitHub PAT (fine-grained)
  String.raw`gho_[A-Za-z0-9]{10,}`,            // GitHub OAuth access token
  String.raw`ghu_[A-Za-z0-9]{10,}`,            // GitHub user-to-server token
  String.raw`ghs_[A-Za-z0-9]{10,}`,            // GitHub server-to-server token
  String.raw`ghr_[A-Za-z0-9]{10,}`,            // GitHub refresh token
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`,    // Slack tokens
  String.raw`AIza[A-Za-z0-9_-]{30,}`,          // Google API keys
  String.raw`pplx-[A-Za-z0-9]{10,}`,           // Perplexity
  String.raw`fal_[A-Za-z0-9_-]{10,}`,          // Fal.ai
  String.raw`fc-[A-Za-z0-9]{10,}`,             // Firecrawl
  String.raw`bb_live_[A-Za-z0-9_-]{10,}`,      // BrowserBase
  String.raw`gAAAA[A-Za-z0-9_=-]{20,}`,        // Codex encrypted tokens
  String.raw`AKIA[A-Z0-9]{16}`,                // AWS Access Key ID
  String.raw`sk_live_[A-Za-z0-9]{10,}`,        // Stripe secret key (live)
  String.raw`sk_test_[A-Za-z0-9]{10,}`,        // Stripe secret key (test)
  String.raw`rk_live_[A-Za-z0-9]{10,}`,        // Stripe restricted key
  String.raw`SG\.[A-Za-z0-9_-]{10,}`,          // SendGrid API key
  String.raw`hf_[A-Za-z0-9]{10,}`,             // HuggingFace token
  String.raw`r8_[A-Za-z0-9]{10,}`,             // Replicate API token
  String.raw`npm_[A-Za-z0-9]{10,}`,            // npm access token
  String.raw`pypi-[A-Za-z0-9_-]{10,}`,         // PyPI API token
  String.raw`dop_v1_[A-Za-z0-9]{10,}`,         // DigitalOcean PAT
  String.raw`doo_v1_[A-Za-z0-9]{10,}`,         // DigitalOcean OAuth
  String.raw`am_[A-Za-z0-9_-]{10,}`,           // AgentMail API key
  String.raw`sk_[A-Za-z0-9_]{10,}`,            // ElevenLabs TTS key (sk_ underscore)
  String.raw`tvly-[A-Za-z0-9]{10,}`,           // Tavily search API key
  String.raw`exa_[A-Za-z0-9]{10,}`,            // Exa search API key
  String.raw`gsk_[A-Za-z0-9]{10,}`,            // Groq Cloud API key
  String.raw`syt_[A-Za-z0-9]{10,}`,            // Matrix access token
  String.raw`retaindb_[A-Za-z0-9]{10,}`,       // RetainDB API key
  String.raw`hsk-[A-Za-z0-9]{10,}`,            // Hindsight API key
  String.raw`mem0_[A-Za-z0-9]{10,}`,           // Mem0 Platform API key
  String.raw`brv_[A-Za-z0-9]{10,}`,            // ByteRover API key
];

// Single alternation regex with word-boundary assertions, mirrors Python _PREFIX_RE
const PREFIX_RE = new RegExp(
  `(?<![A-Za-z0-9_-])(${PREFIX_PATTERNS.join("|")})(?![A-Za-z0-9_-])`,
  "g"
);

// ENV assignment: KEY=value where KEY contains secret-like name
const SECRET_ENV_NAMES = `(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)`;
const ENV_ASSIGN_RE = new RegExp(
  `([A-Z0-9_]{0,50}${SECRET_ENV_NAMES}[A-Z0-9_]{0,50})\\s*=\\s*(['"]?)(\\S+)\\2`,
  "g"
);

// JSON field patterns: "apiKey": "value", "token": "value", etc.
const JSON_KEY_NAMES = `(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|auth_token|bearer|secret_value|raw_secret|secret_input|key_material)`;
const JSON_FIELD_RE = new RegExp(
  `("${JSON_KEY_NAMES}")\\s*:\\s*"([^"]+)"`,
  "gi"
);

// Authorization headers
const AUTH_HEADER_RE = /Authorization:\s*Bearer\s+(\S+)/gi;

// Telegram bot tokens: bot<digits>:<token> or <digits>:<token>
const TELEGRAM_RE = /(bot)?(\d{8,}):([-A-Za-z0-9_]{30,})/g;

// Private key blocks
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

// Database connection strings: redact password only
const DB_CONNSTR_RE = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi;

// JWT tokens (eyJ..., base64-encoded JSON headers)
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/g;

// Discord user/role mentions: <@snowflake_id> or <@!snowflake_id>
const DISCORD_MENTION_RE = /<@!?(\d{17,20})>/g;

// E.164 phone numbers: +<country><number>, 7-15 digits
const SIGNAL_PHONE_RE = /(\+[1-9]\d{6,14})(?![A-Za-z0-9])/g;

export function redact(text: string): string {
  if (!text) return text;

  // Known prefixes (sk-, ghp_, etc.), reset lastIndex before each use
  PREFIX_RE.lastIndex = 0;
  text = text.replace(PREFIX_RE, (_match, token) => maskToken(token));

  // ENV assignments: OPENAI_API_KEY=sk-abc...
  ENV_ASSIGN_RE.lastIndex = 0;
  text = text.replace(ENV_ASSIGN_RE, (_match, name, quote, value) => {
    return `${name}=${quote}${maskToken(value)}${quote}`;
  });

  // JSON fields: "apiKey": "value"
  JSON_FIELD_RE.lastIndex = 0;
  text = text.replace(JSON_FIELD_RE, (_match, key, value) => {
    return `${key}: "${maskToken(value)}"`;
  });

  // Authorization headers
  AUTH_HEADER_RE.lastIndex = 0;
  text = text.replace(AUTH_HEADER_RE, (_match, token) => {
    return `Authorization: Bearer ${maskToken(token)}`;
  });

  // Telegram bot tokens: mask token part only
  TELEGRAM_RE.lastIndex = 0;
  text = text.replace(TELEGRAM_RE, (_match, prefix, digits) => {
    const pre = prefix ?? "";
    return `${pre}${digits}:***`;
  });

  // Private key blocks
  PRIVATE_KEY_RE.lastIndex = 0;
  text = text.replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]");

  // Database connection string passwords
  DB_CONNSTR_RE.lastIndex = 0;
  text = text.replace(DB_CONNSTR_RE, (_match, before, _password, after) => {
    return `${before}***${after}`;
  });

  // JWT tokens
  JWT_RE.lastIndex = 0;
  text = text.replace(JWT_RE, (token) => maskToken(token));

  // Discord mentions
  DISCORD_MENTION_RE.lastIndex = 0;
  text = text.replace(DISCORD_MENTION_RE, (match) => {
    const hasBang = match.includes("!");
    return `<@${hasBang ? "!" : ""}***>`;
  });

  // E.164 phone numbers
  SIGNAL_PHONE_RE.lastIndex = 0;
  text = text.replace(SIGNAL_PHONE_RE, (match, phone) => {
    if (phone.length <= 8) {
      return phone.slice(0, 2) + "****" + phone.slice(-2);
    }
    return phone.slice(0, 4) + "****" + phone.slice(-4);
  });

  return text;
}
