// Native presence signals (SKETCH). Reads cheap, non-creepy macOS signals and shapes
// them into the PresenceSignals the daemon's presence-tier machine consumes. These
// calls need native bindings (Tauri Rust commands, or a small Swift helper); the
// shapes and the cheapest-first, least-creepy ordering are fixed here.
//
// Order of intrusiveness (all off-by-default except idle + focus):
//   1. idle time            - CGEventSourceSecondsSinceLastEventType (free, zero privacy)
//   2. front app + Focus/DND - NSWorkspace.frontmostApplication + Focus status
//   3. screen-sharing        - CGDisplayStream / ScreenCaptureKit presence
//   4. mic VAD               - is Eric already talking (a meeting)? stay ambient
//   5. camera (OPT-IN ONLY)  - Vision face-rectangle at a LOW duty cycle, no frames stored

export interface PresenceSignals {
  idleSeconds: number;
  frontAppFocused: boolean;
  dndOrFocus: boolean;
  screenSharing: boolean;
  micActive: boolean;
  cameraPresent?: boolean;
}

export interface NativeBridge {
  idleSeconds(): Promise<number>;
  frontmostAppIsResidentOrNormal(): Promise<boolean>;
  focusOrDndOn(): Promise<boolean>;
  isScreenSharing(): Promise<boolean>;
  micHasSpeech(): Promise<boolean>; // Silero VAD on the mic input
  cameraFacePresent?(): Promise<boolean>; // present only if the user opted in
}

export async function gatherPresence(bridge: NativeBridge): Promise<PresenceSignals> {
  const [idleSeconds, frontAppFocused, dndOrFocus, screenSharing, micActive] = await Promise.all([
    bridge.idleSeconds(),
    bridge.frontmostAppIsResidentOrNormal(),
    bridge.focusOrDndOn(),
    bridge.isScreenSharing(),
    bridge.micHasSpeech(),
  ]);
  const cameraPresent = bridge.cameraFacePresent ? await bridge.cameraFacePresent() : undefined;
  return { idleSeconds, frontAppFocused, dndOrFocus, screenSharing, micActive, cameraPresent };
}
