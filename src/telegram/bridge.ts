import type { AgentEvent } from "../agent/types.js";
import type { FloodControl } from "./flood.js";
import type { ThinkFilter } from "./think-filter.js";
import { splitMessage } from "./utf16.js";
import { breathe, pauseBefore } from "../life/breath.js";

export interface BridgeConfig {
  sendMessage: (text: string) => Promise<number>;
  editMessage: (messageId: number, text: string) => Promise<void>;
  floodControl: FloodControl;
  thinkFilter?: ThinkFilter;
  /**
   * The breath (S-4, breath.ts): when present and returning a unit, a finished reply is
   * delivered as up to three messages split at sentence boundaries, a delivery property, so
   * it lives here at the channel and nowhere near her history or memory, which keep the whole
   * reply as the one thing she said. Null or absent = one message, exactly as before.
   */
  breathUnit?: () => number | null;
  /** Test seam for the identity guard below; production always uses breathe(). */
  segmenter?: (text: string, unit: number) => string[];
  /** Test seam for the beat between segments; production waits for real milliseconds. */
  pause?: (ms: number) => Promise<void>;
  /** Where the identity guard reports. A silent guard is the defect class this repo hunts. */
  onFault?: (where: string, detail: unknown) => void;
  /**
   * The native "typing…" chat action. Since the first evening this is the ONLY way the bridge
   * may signal work-in-progress: every status BUBBLE it used to edit into the chat (「在想……」,
   * 「在翻记忆……」, tool labels, retry notes) was machinery speaking in their room under her
   * name, and the chat carries two voices only, hers and his. Wordless, no message, self-expiring.
   */
  sendTyping?: () => Promise<void>;
}

export interface StreamBridge {
  onEvent(event: AgentEvent): Promise<void>;
  finalize(): Promise<void>;
  /** End the turn withholding the undelivered remainder, and return it (see implementation). */
  finalizeQuietly(): Promise<string>;
  reset(): void;
}

/**
 * Bridges an AgentEvent stream to Telegram message edits.
 *
 * Behaviour:
 * - On the first text chunk, sends "Thinking..." to get a message ID, then
 *   edits it as more text arrives at ~1 s intervals.
 * - tool_start finalizes the current message and clears the message ID so the
 *   next text chunk starts a fresh Telegram message.
 * - thinking_chunk events are suppressed (handled at the event level in
 *   addition to the inline <think>…</think> tag filter).
 * - When FloodControl disables editing, text is accumulated and delivered as
 *   a single final message on finalize().
 * - Messages exceeding 4096 UTF-16 chars are split and sent as separate
 *   messages; the last segment becomes the "live" message.
 */
/**
 * HER REGISTER, NOT THE MACHINE'S (the last shipping surface of it). Every string here
 * appears in HER message bubble, under her name, while she works. "Thinking…" and
 * "Working: Write File..." were interface chrome speaking English service register as her,
 * the same defect the face solved structurally (`voice-stream.ts` exists so the mouth never
 * reads the chrome), left live on the one channel he actually uses. These are the same
 * vocabulary as her B4 doing frames (在想事情 / 在和你说话): what she is doing, in her words.
 */
export function createStreamBridge(config: BridgeConfig): StreamBridge {
  const { sendMessage, editMessage, floodControl, thinkFilter, breathUnit, onFault, sendTyping } = config;
  const segmenter = config.segmenter ?? breathe;
  const pause = config.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let messageId: number | null = null;
  let buffer = "";
  let lastEditTime = 0;
  let lastStatusTime = 0;

  // ── helpers ─────────────────────────────────────────────────────────────────

  async function attemptEdit(): Promise<void> {
    if (!floodControl.shouldEdit()) return;

    const now = Date.now();
    if (now - lastEditTime < floodControl.getCurrentInterval()) return;

    const text = buffer.trim();
    if (!text) return;

    // FIRST CONTENT CREATES THE MESSAGE. There is no placeholder any more: the old flow sent
    // 「在想……」 to reserve a message id and edited over it, which put a machine bubble under
    // her name before she had said anything. Her message now begins as her words.
    if (messageId === null) {
      const parts = splitMessage(text);
      for (let i = 0; i < parts.length - 1; i++) await sendMessage(parts[i]);
      messageId = await sendMessage(parts[parts.length - 1]);
      // The RAW buffer survives in the common one-part case: trimming it here once ate a
      // trailing space the think-filter had deliberately emitted, and the next chunk glued
      // itself to the previous word. Only the >4096 overflow path may rebase the buffer.
      if (parts.length > 1) buffer = parts[parts.length - 1];
      lastEditTime = Date.now();
      return;
    }

    // Handle message splitting
    const parts = splitMessage(text);
    if (parts.length > 1) {
      // Send all but the last part as standalone messages
      for (let i = 0; i < parts.length - 1; i++) {
        try {
          await editMessage(messageId!, parts[i]);
          floodControl.onEditSuccess();
        } catch {
          floodControl.onEditFailure();
        }
        messageId = await sendMessage(parts[i + 1]);
      }
      // After splitting, the last part becomes the current live message
      buffer = parts[parts.length - 1];
      lastEditTime = Date.now();
      return;
    }

    try {
      await editMessage(messageId!, text);
      floodControl.onEditSuccess();
      lastEditTime = Date.now();
    } catch {
      floodControl.onEditFailure();
    }
  }

  async function showAlive(): Promise<void> {
    // Telegram's typing hint lasts ~5s; refresh just under that, and never while her words are
    // already on screen: a person who has started speaking is visibly present.
    const now = Date.now();
    // Presence is redundant only when her words are ALREADY ON SCREEN. In breath mode the
    // buffer fills while the screen stays empty, exactly when the typing hint matters most,
    // so the guard is "a message exists", not "the buffer has content".
    if (messageId !== null && buffer.trim()) return;
    if (now - lastStatusTime < 4_000) return;
    lastStatusTime = now;
    try { await sendTyping?.(); } catch { /* an aliveness hint is never worth a fault */ }
  }

  async function finalizeCurrentMessage(): Promise<void> {
    const flushed = thinkFilter ? thinkFilter.flush() : "";
    buffer += flushed;

    const text = buffer.trim();
    if (!text) {
      buffer = "";
      return;
    }

    if (messageId === null) {
      // Nothing was sent while she composed (breath mode, or a reply that finished before the
      // first flush). Deliver as breaths when the unit says so: first message goes at once,
      // every later one waits its beat, the identity guard below is shared with the edit path.
      const unit0 = breathUnit?.() ?? null;
      let segs = unit0 !== null ? segmenter(text, unit0) : [text];
      if (segs.join("") !== text) {
        onFault?.("breath.identity", `segments do not reconcatenate to the reply (unit ${unit0})`);
        segs = [text];
      }
      let sentOne = false;
      for (const seg of segs) {
        for (const part of splitMessage(seg)) {
          if (sentOne) await pause(pauseBefore(part));
          await sendMessage(part);
          sentOne = true;
        }
      }
      buffer = "";
      return;
    }

    // Editing may have been disabled by flood control, send the whole buffer
    if (!floodControl.shouldEdit()) {
      const parts = splitMessage(text);
      // Edit the existing message with the first part, send rest as new messages
      let first = true;
      for (const part of parts) {
        if (first) {
          try {
            await editMessage(messageId!, part);
          } catch {
            // Best-effort on finalize
          }
          first = false;
        } else {
          await sendMessage(part);
        }
      }
      buffer = "";
      return;
    }

    // Normal finalize. The breath first: her state may deliver this reply as two or three
    // messages at sentence boundaries (breath.ts). Each breath segment then still passes
    // through the 4096 splitter, so the length law and the breath law compose instead of
    // fighting. Segment one edits the live placeholder; later segments are fresh messages,
    // which is exactly what a person's follow-on message is.
    const unit = breathUnit?.() ?? null;
    let segments = unit !== null ? segmenter(text, unit) : [text];
    // THE IDENTITY LAW, ENFORCED AT RUNTIME. The tests plant six reply shapes against it, but
    // a future edit to the splitter could still lose a byte in some seventh shape, and a
    // breath that drops words is her being misquoted by her own channel. If the join is not
    // the reply, the reply goes whole and the guard says so loudly.
    if (segments.join("") !== text) {
      onFault?.("breath.identity", `segments do not reconcatenate to the reply (unit ${unit})`);
      segments = [text];
    }
    let first = true;
    let currentId = messageId!;
    for (const segment of segments) {
      const parts = splitMessage(segment);
      for (const part of parts) {
        if (first) {
          try {
            await editMessage(currentId, part);
            floodControl.onEditSuccess();
          } catch {
            floodControl.onEditFailure();
          }
          first = false;
        } else {
          // The beat: composition time for what is about to arrive (breath.ts). Between
          // messages only: the first left as fast as it ever did.
          await pause(pauseBefore(part));
          currentId = await sendMessage(part);
        }
      }
    }
    buffer = "";
  }

  // ── public API ───────────────────────────────────────────────────────────────

  return {
    async onEvent(event: AgentEvent): Promise<void> {
      switch (event.type) {
        case "text_chunk": {
          const filtered = thinkFilter
            ? thinkFilter.process(event.content)
            : event.content;
          if (filtered) {
            buffer += filtered;
          }
          // BREATH MODE HOLDS THE STREAM: with the unit present, nothing is sent while she
          // composes: the typing hint carries her presence, and the reply arrives at finalize
          // as breaths. Streaming edits in public are how a machine writes; messages that
          // arrive whole, with pauses, are how a person texts.
          if (breathUnit) await showAlive();
          else await attemptEdit();
          break;
        }

        case "thinking_chunk":
          // Suppressed at event level (native thinking tokens)
          break;

        case "tool_start": {
          // Silent tools (memory_search, glob, grep, etc.) don't break the
          // message stream: keeps Telegram conversation continuous.
          if (!event.silent) {
            await finalizeCurrentMessage();
            messageId = null;
            buffer = "";
            lastEditTime = 0;
            await showAlive();
          }
          break;
        }

        case "tool_end": {
          // Success or failure, what he may see is only that she is still with it. The machine
          // detail is already on the fault channel; a person does not narrate her own errors
          // mid-sentence.
          if (!buffer.trim()) await showAlive();
          break;
        }

        case "progress":
          // The authored progress lines (loop.ts) no longer render: any sentence here is
          // machinery in their room. Presence is signalled the way a person signals it.
          await showAlive();
          break;

        case "compaction":
          await showAlive();
          break;

        case "error":
          // The detail is the machine's and stays on the fault channel and in the logs.
          await showAlive();
          break;
      }
    },

    async finalize(): Promise<void> {
      await finalizeCurrentMessage();
    },

    /**
     * End the turn WITHOUT delivering what is still held, and hand it back (one channel per
     * turn). When her sentences already went out through the message tool, the loop's mandatory
     * closing text is an orphan channel, and the model fills it with inner narration: once a
     * line about the four messages she had just sent reached his phone as a fifth message. The caller routes what this returns to her diary: the thought is hers to keep,
     * the channel was never the place for it. Anything ALREADY sent this turn stands, this
     * only withholds what no one has seen.
     */
    async finalizeQuietly(): Promise<string> {
      const flushed = thinkFilter ? thinkFilter.flush() : "";
      buffer += flushed;
      const held = buffer.trim();
      buffer = "";
      return held;
    },

    reset(): void {
      messageId = null;
      buffer = "";
      lastEditTime = 0;
      lastStatusTime = 0;
        floodControl.resetForNewTurn();
    },
  };
}
