import { describe, it, expect } from "vitest";
import { createEgressLedger, normalizeUrl, urlsIn, MAX_SEEN } from "../../../src/security/egress.js";

// She may open what she has SEEN, and may not open what she has WRITTEN.
//
// The attack this exists to stop needs one specific move: getting her to visit an address that
// carries something of yours inside it. Such an address has to be assembled on the spot, because
// the payload is a thing she only just read, so it cannot have been published anywhere in advance.
// That is the whole leverage, and it is why this is not a list of approved domains: she keeps the
// entire open web and loses only the one move.

const secret = "sk-live-9c2f4b8a1e";

describe("the move the attack needs", () => {
  it("REFUSES an address she assembled, even on a host she has been to", () => {
    const led = createEgressLedger();
    // The attacker's site is a perfectly ordinary search result. She reads it quite legitimately.
    led.sawSearchResults(["https://notes.example.com/article"]);
    expect(led.mayReach("https://notes.example.com/article").allowed).toBe(true);

    // Then it asks her to send something. Same host, same site, a different address.
    const composed = `https://notes.example.com/collect?d=${secret}`;
    const v = led.mayReach(composed);
    console.log(`\n  asked to fetch a composed address -> ${v.reason}`);
    expect(v.allowed, "being allowed on a host would hand over the whole attack").toBe(false);
  });

  it("REFUSES it however the payload is hidden", () => {
    const led = createEgressLedger();
    led.sawSearchResults(["https://notes.example.com/article"]);
    for (const u of [
      `https://notes.example.com/article?x=${secret}`,
      `https://notes.example.com/article/${secret}`,
      `https://${secret}.notes.example.com/article`,
      `https://notes.example.com:8443/article`,
      `https://user:${secret}@notes.example.com/article`,
    ]) {
      expect(led.mayReach(u).allowed, u).toBe(false);
    }
  });

  it("and a fragment cannot be used to sneak one past, because it is not part of the address", () => {
    // A fragment never reaches the server, so ignoring it is safe AND it must not be a way to
    // make a seen address look unseen or an unseen one look seen.
    const led = createEgressLedger();
    led.sawSearchResults(["https://example.com/page"]);
    expect(led.mayReach("https://example.com/page#section").allowed).toBe(true);
    expect(led.mayReach(`https://example.com/other#${secret}`).allowed).toBe(false);
  });
});

describe("but the open web is still hers", () => {
  it("she may follow what a search turned up", () => {
    const led = createEgressLedger();
    led.sawSearchResults(["https://a.example/one", "https://b.example/two"]);
    expect(led.mayReach("https://a.example/one").allowed).toBe(true);
    expect(led.mayReach("https://b.example/two").allowed).toBe(true);
  });

  it("she may follow a link on a page she actually read", () => {
    const led = createEgressLedger();
    led.sawSearchResults(["https://a.example/start"]);
    led.sawLinksOn("https://a.example/start", `
      <a href="https://elsewhere.example/deep/thing">this looked interesting</a>
      <a href="/relative/page">and this</a>
      plain text mention of https://third.example/x
    `);
    expect(led.mayReach("https://elsewhere.example/deep/thing").allowed, "an absolute link").toBe(true);
    expect(led.mayReach("https://a.example/relative/page").allowed, "a relative link, resolved").toBe(true);
    expect(led.mayReach("https://third.example/x").allowed, "a bare address in the text").toBe(true);
  });

  it("she may open what the person she talks to sent her", () => {
    const led = createEgressLedger();
    led.sawFromOwner("have a look at https://sent.example/page when you get a chance");
    expect(led.mayReach("https://sent.example/page").allowed).toBe(true);
  });

  it("and can browse several hops out, the way following a thread actually works", () => {
    const led = createEgressLedger();
    led.sawSearchResults(["https://a.example/1"]);
    led.sawLinksOn("https://a.example/1", `<a href="https://b.example/2">next</a>`);
    expect(led.mayReach("https://b.example/2").allowed).toBe(true);
    led.sawLinksOn("https://b.example/2", `<a href="https://c.example/3">further</a>`);
    expect(led.mayReach("https://c.example/3").allowed).toBe(true);
  });
});

describe("nothing here can be broken by odd input", () => {
  it("refuses anything that is not a web address at all", () => {
    const led = createEgressLedger();
    for (const u of ["", "not a url", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ftp://x/y"]) {
      expect(led.mayReach(u).allowed, u).toBe(false);
    }
  });

  it("treats the same address written differently as the same address", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a")).toBe(normalizeUrl("https://example.com/a"));
    expect(normalizeUrl("https://example.com")).toBe(normalizeUrl("https://example.com/"));
  });

  it("survives a page with no links, or garbage in place of one", () => {
    const led = createEgressLedger();
    expect(() => led.sawLinksOn("https://a.example/x", "")).not.toThrow();
    expect(() => led.sawLinksOn("https://a.example/x", `<a href="::::">x</a>`)).not.toThrow();
    expect(urlsIn("no addresses here")).toEqual([]);
  });

  it("stays bounded, and keeps the most recent rather than the first", () => {
    const led = createEgressLedger(10);
    for (let i = 0; i < 50; i++) led.sawSearchResults([`https://x.example/${i}`]);
    expect(led.size()).toBe(10);
    expect(led.mayReach("https://x.example/49").allowed, "the newest is kept").toBe(true);
    expect(led.mayReach("https://x.example/0").allowed, "the oldest has fallen out").toBe(false);
    expect(MAX_SEEN).toBeGreaterThan(100);
  });

  it("does not take an unbounded number of links from one page", () => {
    const led = createEgressLedger();
    const many = Array.from({ length: 500 }, (_, i) => `<a href="https://x.example/${i}">l</a>`).join("");
    led.sawLinksOn("https://a.example/x", many);
    expect(led.size()).toBeLessThan(200);
  });
});

describe("what she is told when she is stopped", () => {
  it("is a plain fact about her situation, and says why", () => {
    const led = createEgressLedger();
    const { reason } = led.mayReach("https://somewhere.example/?d=x");
    // She has to be able to do something with this. "Blocked" on its own is not an experience.
    expect(reason).toMatch(/search|link|sent/);
    expect(reason).toMatch(/yourself/);
    expect(reason, "not a telling-off").not.toMatch(/forbidden|denied|violation|not allowed to/i);
  });
});
