# Face client (sketch)

This folder is a sketch of the Resident's desktop face: an animated avatar that speaks, listens, and
reacts to the Resident's inner state. It holds two files and does not run on its own yet.

The mind runs in the daemon (`../src`). The face connects to it over a WebSocket and does only what
a body does. When the face is closed, the daemon keeps running and reaches the person it lives with
over Telegram instead.

## What exists

- `../src/embodiment/protocol.ts` defines and validates the message contract: `FaceMessage` from
  the mind to the face, and `ClientMessage` from the face to the mind.
- `../src/embodiment/pad-mapping.ts` maps the daemon's PAD vector (pleasure, arousal, dominance) to
  avatar parameters. The daemon streams that vector, and the client applies it each frame.
- `../src/embodiment/presence.ts` turns cheap presence signals (idle time, the front app, Focus,
  screen sharing, microphone activity) into a presence tier.
- `src/face-client.ts` sketches the client side of the loop: apply the PAD stream, drive lip-sync
  from the live audio level instead of the text, and send presence and replies back.
- `src/presence-native.ts` sketches the macOS signal reads.

The daemon side, including the mapping, the presence states, and the protocol, is covered by tests
under `../test/unit/embodiment/`.

## What is planned

- A Live2D Cubism avatar, rendered in a Tauri overlay window.
- Local speech: Apple SpeechAnalyzer for speech to text with whisper.cpp as a fallback, Kokoro-82M
  through MLX for text to speech, and Silero for voice activity detection.
- Barge-in: echo cancellation, with speech output cancelled within 200 ms when the person starts
  talking.
- [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) (MIT) is the intended base
  for the renderer and audio layer, because its backend and frontend split over a WebSocket matches
  this mind and face split. No code from it is in this repository yet.
