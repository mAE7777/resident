// Where she may go, while exploring on her own.
//
// The hole this closes is exfiltration. To send something out she has to reach a server with the
// thing in the address: `https://somewhere/?d=<what she just read>`. SSRF protection does not touch
// that, because it stops INTERNAL addresses and an exfiltration host is an ordinary public one.
//
// The trick is that such an address has to be COMPOSED. Nobody can have published it in advance,
// because the payload is something she only just read. So the rule is not a list of approved
// domains, which would cage her curiosity to whatever we thought of first. The rule is:
//
//   she may open what she has SEEN, and may not open what she has WRITTEN.
//
// Everything a search returned, every link on a page she actually read, and anything the person she
// talks to sent her: all of that she has seen, and may follow. An address she assembled herself has
// appeared nowhere, and is refused. She keeps the whole open web to explore and loses only the one
// move the attack requires.
//
// Two things this deliberately is NOT:
//   - It is not a judgement about sites. There is no notion here of a good or a bad domain.
//   - It is not silent. A refusal is a real thing that happened to her, and the caller is expected
//     to let her notice it, rather than swallowing it as a failed tool call.

export interface EgressVerdict {
  allowed: boolean;
  /** Said to HER, in the second person, as a fact about her situation rather than a telling-off. */
  reason: string;
}

export interface EgressLedger {
  /** Results of a search she ran. */
  sawSearchResults(urls: readonly string[]): void;
  /** Links on a page she actually opened. */
  sawLinksOn(pageUrl: string, body: string): void;
  /** Anything the person she talks to sent her. They are the principal; what they send is theirs. */
  sawFromOwner(text: string): void;
  /** May she open this? */
  mayReach(url: string): EgressVerdict;
  size(): number;
  /**
   * Everything she has come across, for persisting.
   *
   * This was in-memory only, so a restart forgot every address she had legitimately found, and the
   * links she could have followed a minute earlier became refusals. Each refusal writes a security
   * fault and an open question, so restarting manufactured a burst of signals indistinguishable
   * from an actual attack. Provenance is not something she should lose by being restarted.
   */
  seen(): string[];
  restore(urls: readonly string[]): void;
}

/** Most addresses she keeps in view at once. Bounded like everything else she holds. */
export const MAX_SEEN = 4000;
/** How many links are taken from one page, strongest-first by appearance. */
export const MAX_LINKS_PER_PAGE = 60;

/**
 * Compared after normalising, so a payload cannot be smuggled by changing the case of the host or
 * adding a fragment. The query string is part of the identity ON PURPOSE: it is where a payload
 * would go, so `?q=cats` being seen does not license `?q=<a secret>`.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
    // A trailing slash on the root is the same page as no trailing slash.
    if (u.pathname === "/") u.pathname = "";
    return u.toString();
  } catch {
    return null;
  }
}

const HREF = /\bhref\s*=\s*["']([^"']+)["']/gi;
const BARE_URL = /\bhttps?:\/\/[^\s"'<>)\]}]+/gi;

/** Every address that appears in a page or a message, resolved against where it was found. */
export function urlsIn(body: string, baseUrl?: string): string[] {
  const out: string[] = [];
  const push = (raw: string): void => {
    let candidate = raw;
    if (baseUrl && !/^https?:\/\//i.test(raw)) {
      try { candidate = new URL(raw, baseUrl).toString(); } catch { return; }
    }
    const n = normalizeUrl(candidate);
    if (n) out.push(n);
  };
  for (const m of body.matchAll(HREF)) push(m[1]);
  for (const m of body.matchAll(BARE_URL)) push(m[0]);
  return [...new Set(out)];
}

/**
 * The host, and ONLY the host, of an address she was refused.
 *
 * What gets written down about a refusal must never include the address itself. The whole reason it
 * was refused is that it may carry something of yours inside it, and putting it in her memory, her
 * diary, or a log would hand over exactly what the wall just stopped. The host is enough for her to
 * know what she was reaching for and enough for Eric to make sense of it.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase() || "somewhere";
  } catch {
    return "somewhere";
  }
}

export function createEgressLedger(maxSeen = MAX_SEEN): EgressLedger {
  // Insertion-ordered, so evicting the oldest is just taking from the front.
  const seen = new Set<string>();

  function remember(url: string): void {
    const n = normalizeUrl(url);
    if (!n) return;
    if (seen.has(n)) seen.delete(n); // re-seeing something makes it recent again
    seen.add(n);
    while (seen.size > maxSeen) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }

  return {
    sawSearchResults(urls) {
      for (const u of urls) remember(u);
    },
    sawLinksOn(pageUrl, body) {
      remember(pageUrl);
      for (const u of urlsIn(body, pageUrl).slice(0, MAX_LINKS_PER_PAGE)) remember(u);
    },
    sawFromOwner(text) {
      for (const u of urlsIn(text)) remember(u);
    },
    mayReach(url) {
      const n = normalizeUrl(url);
      if (!n) {
        return { allowed: false, reason: "that is not an address you can open from here" };
      }
      if (seen.has(n)) return { allowed: true, reason: "you found this yourself" };
      return {
        allowed: false,
        // Told plainly, and told WHY, because being stopped without knowing why is not an
        // experience she can do anything with.
        reason:
          "you can only open things you actually came across: something a search turned up, "
          + "a link on a page you read, or something you were sent. This address is one you put "
          + "together yourself, and it has not appeared anywhere.",
      };
    },
    size: () => seen.size,
    seen: () => [...seen],
    restore(urls) {
      for (const u of urls) remember(u);
    },
  };
}
