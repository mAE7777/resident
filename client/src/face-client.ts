// Face client (SKETCH). The client-side of the mind<->face WebSocket loop: apply the
// daemon's PAD stream + speak events to a Live2D model, and stream presence + replies
// back up. This is a starting point for the Tauri/web app; the Live2D and audio calls
// are against the renderer/audio layer the forked base provides (Open-LLM-VTuber),
// noted with TODO where a real runtime binding is required.
//
// The PAD->Live2D mapping and the protocol are the daemon's source of truth
// (../../src/embodiment/pad-mapping.ts, protocol.ts); mirror them here or import
// once this dir shares a tsconfig with the daemon.

interface Live2DModel {
  setParameter(id: string, value: number): void;
}
interface AudioSink {
  /** Play a streamed utterance; call onFrame with the current RMS for lip-sync. */
  play(utteranceId: string, onFrame: (rms: number) => void): void;
  cancel(utteranceId: string): void;
}

// Minimal mirror of the daemon's PAD->Live2D mapping (keep in sync with pad-mapping.ts).
function applyPad(model: Live2DModel, p: { pleasure: number; arousal: number; dominance: number }): void {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  model.setParameter("ParamMouthForm", clamp(p.pleasure, -1, 1));
  model.setParameter("ParamAngleY", clamp(12 * p.dominance, -30, 30));
  model.setParameter("ParamEyeLOpen", clamp(0.75 + 0.25 * p.arousal, 0.2, 1));
  model.setParameter("ParamEyeROpen", clamp(0.75 + 0.25 * p.arousal, 0.2, 1));
}

export function connectFace(url: string, model: Live2DModel, audio: AudioSink): WebSocket {
  const ws = new WebSocket(url);

  ws.onmessage = (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    switch (msg.type) {
      case "pad":
        applyPad(model, msg as never);
        break;
      case "speak":
        // Drive the mouth from the LIVE played audio, never from the text.
        audio.play(String(msg.utteranceId), (rms) => model.setParameter("ParamMouthOpenY", Math.min(1, rms * 3.2)));
        break;
      case "cancel":
        audio.cancel(String(msg.utteranceId));
        model.setParameter("ParamMouthOpenY", 0);
        break;
      // mood / policy / status update ambient UI (TODO: status chrome)
      default:
        break;
    }
  };

  return ws;
}

/** Stream presence signals up on an interval (gathered by presence-native.ts). */
export function reportPresence(ws: WebSocket, signals: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "presence", signals }));
}

/** Eric spoke or barged in. */
export function reportReply(ws: WebSocket, text: string): void {
  ws.send(JSON.stringify({ type: "reply", text }));
}
export function reportInterrupt(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: "interrupt" }));
}
