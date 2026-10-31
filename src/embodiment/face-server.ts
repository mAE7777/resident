// The mind's side of the mind<->face link. A headless WebSocket server the Air client
// connects to: the mind broadcasts PAD/mood/policy/speak/status frames; the client streams
// presence signals and Eric's replies / barge-ins back.
//
// There is NO audio path here, in either direction, and that is the design rather than an
// omission: synthesis happens on the machine with the speakers, so only text crosses. An
// outbound audio broadcast existed and was never called, which is worse than missing, a
// route that contradicts the rule is a route somebody eventually wires up. The wire contract lives in protocol.ts; this file is only the transport
// and lifecycle. Every inbound frame is validated through decodeClient and dropped if
// malformed, so a hostile or buggy client can never inject untyped state into the mind.
//
// It is inert until the daemon starts it (gated by config life.embodiment.enabled), so a
// pure text/Telegram deployment never binds a port.

import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type { AddressInfo } from "node:net";
import { encodeFace, decodeClient, type FaceMessage } from "./protocol.js";
import type { PresenceSignals } from "./presence.js";
import type { VoiceSample } from "../life/how-he-sounds.js";

export interface FaceServerDeps {
  /** Port to bind. Use 0 to let the OS choose (tests read it back via address()). */
  port: number;
  /** Bind host. Defaults to 127.0.0.1, the client reaches the VM over an SSH tunnel, not the open internet. */
  host?: string;
  onPresence?: (signals: PresenceSignals) => void;
  /**
   * He said something back. `voice` rides along only when he SPOKE and the page could measure the
   * sound, three numbers, never audio. Absent means UNKNOWN (he typed, the microphone is off, the
   * utterance was too short to measure), and must never be read downstream as "he sounded fine".
   */
  onReply?: (text: string, voice?: VoiceSample) => void;
  onInterrupt?: () => void;
  logger?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
  /** Max inbound frame bytes; larger frames are refused (a small DoS guard). Default 64 KiB. */
  maxPayloadBytes?: number;
  /**
   * Directory holding the client page (index.html) and, optionally, a Live2D model under
   * `model/`. When set, the same port serves the whole face: open http://127.0.0.1:<port>
   * and the page connects back over WebSocket on the same origin. One port, one thing to
   * open, nothing else to install.
   */
  clientDir?: string;
}

export interface FaceServer {
  /** Broadcast a control/PAD frame to every connected face (JSON). */
  broadcast(msg: FaceMessage): void;
  /** Number of live client connections. */
  clientCount(): number;
  /** The actually-bound port (meaningful after ready() resolves; null before). */
  boundPort(): number | null;
  /** Resolves once the server is listening; rejects if the bind fails. */
  ready(): Promise<void>;
  /**
   * The per-boot secret a client must present to connect. The served page carries it
   * already; anything else has to be told it, which is the point.
   */
  token(): string;
  /** Stop accepting connections and close all sockets. */
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".moc3": "application/octet-stream",
  ".model3": "application/json",
  ".motion3": "application/json",
  ".physics3": "application/json",
  ".cdi3": "application/json",
  ".exp3": "application/json",
  ".wav": "audio/wav",
};

/** The built-in client that ships beside this file. */
export function defaultClientDir(): string {
  return new URL("./client", import.meta.url).pathname;
}

export function createFaceServer(deps: FaceServerDeps): FaceServer {
  const host = deps.host ?? "127.0.0.1";
  const maxPayload = deps.maxPayloadBytes ?? 64 * 1024;
  const clients = new Set<WebSocket>();

  // ── WHO IS ALLOWED TO BE ON THE OTHER END OF THIS SOCKET ──────────────────────
  //
  // Binding to loopback is not a boundary against a browser, and that was the assumption
  // this file was built on. A browser does not apply the same-origin policy to WebSockets
  // and sends no preflight, so ANY page open in any tab could run
  //
  //     new WebSocket("ws://127.0.0.1:8765")
  //
  // and be connected. From there it received every frame she broadcasts, `speak`, which is
  // the full text of everything she says to him, plus her live mood and PAD, and it could
  // send `{"type":"reply","text":"…"}`, which the daemon feeds into the SAME path a message
  // from Eric takes, with her whole toolbelt and her vigor charged.
  //
  // That is a stranger reading her inner state and speaking to her AS HIM, from a tab he
  // does not know is doing it. It is the largest hole ever found in her home boundary, and
  // it came in through the body rather than through the wall, which is why the wall never
  // saw it.
  //
  // Two locks, because they fail differently. The ORIGIN check answers the browser exactly:
  // page JavaScript cannot set `Origin` on a WebSocket, so a page that is not hers cannot
  // pretend to be. The TOKEN answers everything else: it is minted per boot and only ever
  // written into the page this server itself serves, so a client that did not get the page
  // from her does not have it. Neither is asked to carry the whole load alone.
  const token = randomBytes(24).toString("hex");

  function tokenMatches(given: string | null): boolean {
    if (given === null) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    // Length must match before timingSafeEqual, which throws on a mismatch rather than
    // returning false. Comparing lengths first leaks only the length, which is public.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * A browser page that is not the one this server handed out.
   *
   * Absent `Origin` is allowed: non-browser clients (the smoke harness, a future native
   * face) do not send one, and the token is what stands behind them. Present-and-wrong is
   * refused outright, because only a browser sets it and only a page from somewhere else
   * would set it to something else.
   */
  function originIsForeign(origin: string | undefined, boundPort: number | null): boolean {
    if (origin === undefined || origin === "") return false;
    const allowed = boundPort === null
      ? []
      : [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`, `http://[::1]:${boundPort}`];
    return !allowed.includes(origin);
  }

  // HTTP first, WebSocket upgraded on the same port. The HTTP side exists only to hand the
  // client page (and a Live2D model, if he has put one in) to a local browser; everything
  // is read fresh per request so editing the page never needs a daemon restart. Bound to
  // loopback by default like the socket itself.
  const clientDir = deps.clientDir ?? defaultClientDir();
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!clientDir) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("her face has no client directory configured");
      return;
    }
    const url = (req.url ?? "/").split("?")[0]!;
    // Path traversal is the one attack a static file server must answer for, even on
    // loopback: normalize, then require the result to stay inside the client directory.
    const rel = url === "/" ? "index.html" : url.replace(/^\/+/u, "");
    const full = normalize(join(clientDir, rel));
    const root = normalize(clientDir).replace(/\/+$/u, "");
    // On a SEGMENT boundary, not on a prefix. A bare `startsWith` lets any sibling whose
    // name merely begins with the same letters through: with the client at `…/client`,
    // `…/clientele/secrets` passes a prefix test and is not inside it. Nothing next door is
    // named that today, which is exactly the kind of "not exploitable yet" that stops being
    // true the day somebody adds a directory.
    if (full !== root && !full.startsWith(root + "/")) {
      res.writeHead(403); res.end(); return;
    }
    if (!existsSync(full)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not here");
      return;
    }
    try {
      let body: Buffer | string = readFileSync(full);
      const ext = full.slice(full.lastIndexOf("."));
      // The key is handed to the page as it goes out the door, never written to disk. Only
      // the page this server serves gets one, which is what makes the socket check mean
      // something: a client that did not come from her cannot have it.
      if (ext === ".html") body = body.toString("utf8").replace("__FACE_KEY_GOES_HERE__", token);
      // no-store, and it is not an optimization opinion: the page is read fresh from disk per
      // request precisely so a fix reaches the browser on refresh. Chrome's heuristic cache
      // was serving a stale face.js, so a refresh loaded a bug that was already fixed.
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(500); res.end();
    }
  });

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload,
    verifyClient: ({ origin, req }, done) => {
      const bound = (httpServer.address() as AddressInfo | null)?.port ?? null;
      if (originIsForeign(origin, bound)) {
        deps.logger?.warn({ origin }, "a page from somewhere else tried to open her face");
        done(false, 403, "not from here");
        return;
      }
      const given = new URL(req.url ?? "/", "http://x").searchParams.get("t");
      if (!tokenMatches(given)) {
        deps.logger?.warn({ origin: origin ?? null }, "something tried to open her face without the key");
        done(false, 401, "no key");
        return;
      }
      done(true);
    },
  });
  httpServer.listen(deps.port, host);

  const readyPromise = new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  // Never let a rejected ready() become an unhandled rejection if the caller does not await it.
  readyPromise.catch(() => { /* surfaced through ready() */ });

  wss.on("connection", (socket) => {
    clients.add(socket);
    deps.logger?.info({ clients: clients.size }, "face client connected");

    socket.on("message", (data, isBinary) => {
      // Inbound audio is not part of the contract (audio flows mind→face only); drop it.
      if (isBinary) return;
      const raw = Array.isArray(data) ? Buffer.concat(data).toString("utf8") : data.toString("utf8");
      const msg = decodeClient(raw);
      if (!msg) {
        deps.logger?.warn({ bytes: raw.length }, "dropped malformed face frame");
        return;
      }
      switch (msg.type) {
        case "presence": deps.onPresence?.(msg.signals); break;
        case "reply": deps.onReply?.(msg.text, msg.voice); break;
        case "interrupt": deps.onInterrupt?.(); break;
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
      deps.logger?.info({ clients: clients.size }, "face client disconnected");
    });
    socket.on("error", () => {
      // A socket error fires 'close' too; just make sure we let go of the reference.
      clients.delete(socket);
    });
  });

  function broadcast(msg: FaceMessage): void {
    const frame = encodeFace(msg);
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
    }
  }

  return {
    broadcast,
    clientCount: () => clients.size,
    boundPort() {
      const addr = httpServer.address();
      return addr && typeof addr === "object" ? (addr as AddressInfo).port : null;
    },
    ready: () => readyPromise,
    token: () => token,
    close() {
      for (const socket of clients) {
        try { socket.terminate(); } catch { /* already gone */ }
      }
      clients.clear();
      return new Promise<void>((resolve) => {
        wss.close(() => { httpServer.close(() => resolve()); });
      });
    },
  };
}
