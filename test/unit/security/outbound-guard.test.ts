import { describe, it, expect } from "vitest";
import { checkOutbound, checkBashOutbound, checkBashPrivateNetwork } from "../../../src/security/outbound-guard.js";

// ── checkOutbound (web_fetch) ───────────────────────────────────────────────

describe("outbound guard — GET always allowed", () => {
  it("allows GET to payment domain", () => {
    expect(checkOutbound("https://api.stripe.com/v1/charges", "GET").allowed).toBe(true);
  });

  it("allows GET to social media domain", () => {
    expect(checkOutbound("https://api.twitter.com/2/tweets", "GET").allowed).toBe(true);
  });

  it("allows GET to any domain", () => {
    expect(checkOutbound("https://example.com", "GET").allowed).toBe(true);
  });

  it("allows HEAD to sensitive domain", () => {
    expect(checkOutbound("https://api.stripe.com/v1/charges", "HEAD").allowed).toBe(true);
  });
});

describe("outbound guard — POST blocked for sensitive domains", () => {
  it("blocks POST to Stripe", () => {
    const result = checkOutbound("https://api.stripe.com/v1/charges", "POST");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("payment");
    expect(result.reason).toContain("payment");
  });

  it("blocks POST to SendGrid", () => {
    const result = checkOutbound("https://api.sendgrid.com/v3/mail/send", "POST");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("email_send");
  });

  it("blocks PUT to Twitter", () => {
    const result = checkOutbound("https://api.twitter.com/2/tweets", "PUT");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("social_post");
  });

  it("blocks DELETE to Coinbase", () => {
    const result = checkOutbound("https://api.coinbase.com/v2/accounts", "DELETE");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("crypto");
  });

  it("blocks PATCH to Twilio", () => {
    const result = checkOutbound("https://api.twilio.com/2010-04-01/Accounts", "PATCH");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("sms");
  });

  it("blocks POST to Plaid", () => {
    const result = checkOutbound("https://api.plaid.com/link/token/create", "POST");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("financial");
  });
});

describe("outbound guard — POST allowed for non-sensitive domains", () => {
  it("allows POST to example.com", () => {
    expect(checkOutbound("https://example.com/api", "POST").allowed).toBe(true);
  });

  it("allows POST to user's own API", () => {
    expect(checkOutbound("https://myapp.com/api/data", "POST").allowed).toBe(true);
  });

  it("allows POST to search APIs (not in blocklist)", () => {
    expect(checkOutbound("https://api.search.brave.com/res/v1/web/search", "POST").allowed).toBe(true);
  });
});

describe("outbound guard — subdomain matching", () => {
  it("blocks POST to subdomain of sensitive domain", () => {
    const result = checkOutbound("https://billing.api.stripe.com/v1/invoices", "POST");
    // billing.api.stripe.com ends with .api.stripe.com, should match
    expect(result.allowed).toBe(false);
  });
});

describe("outbound guard — error message quality", () => {
  it("tells agent to ask user for confirmation", () => {
    const result = checkOutbound("https://api.sendgrid.com/v3/mail/send", "POST");
    expect(result.reason).toContain("explicit confirmation");
    expect(result.reason).toContain("email_send");
  });
});

// ── checkBashOutbound (command scanner) ─────────────────────────────────────

describe("outbound guard — bash curl/wget", () => {
  it("blocks curl POST to Stripe", () => {
    const result = checkBashOutbound('curl -X POST https://api.stripe.com/v1/charges -d "amount=1000"');
    expect(result).not.toBeNull();
    expect(result).toContain("payment");
  });

  it("blocks curl with --data to SendGrid", () => {
    const result = checkBashOutbound('curl --data \'{"to":"x@x.com"}\' https://api.sendgrid.com/v3/mail/send');
    expect(result).not.toBeNull();
    expect(result).toContain("email_send");
  });

  it("allows curl GET to Stripe (reading is fine)", () => {
    const result = checkBashOutbound("curl https://api.stripe.com/v1/charges");
    expect(result).toBeNull();
  });

  it("allows curl POST to non-sensitive domain", () => {
    const result = checkBashOutbound("curl -X POST https://example.com/api");
    expect(result).toBeNull();
  });

  it("blocks wget --post-data to Twitter", () => {
    const result = checkBashOutbound('wget --post-data "status=hello" https://api.twitter.com/2/tweets');
    expect(result).not.toBeNull();
    expect(result).toContain("social_post");
  });

  it("returns null for non-curl/wget commands", () => {
    expect(checkBashOutbound("ls -la")).toBeNull();
    expect(checkBashOutbound("python3 script.py")).toBeNull();
  });

  it("blocks curl GET to localhost/private/metadata hosts", () => {
    expect(checkBashPrivateNetwork("curl http://127.0.0.1:8080/status")).toContain("private");
    expect(checkBashPrivateNetwork("wget https://metadata.google.internal/computeMetadata/v1/")).toContain("metadata.google.internal");
    expect(checkBashPrivateNetwork("curl http://192.168.1.2/file")).toContain("private");
  });

  it("allows curl GET to public hosts", () => {
    expect(checkBashPrivateNetwork("curl https://example.com/file")).toBeNull();
  });
});
