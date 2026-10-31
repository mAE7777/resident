// Where a turn's words come out.
//
// A conversation with her used to be a Telegram function. `runAgentAndStream` took a grammy
// `Context` and used it in exactly four places, all of them "send text" or "edit text", and
// the stream bridge underneath it already accepted those two as injected closures. So the
// channel abstraction was almost there; what was missing was anybody else being allowed to
// be the channel, which is why the face-server's `onReply` could only ever write to a log.
//
// Two things a channel does:
//   - it RENDERS, by receiving text to show and to revise (that is the bridge's contract)
//   - it may also OBSERVE the raw event stream, which is how the voice gets her words
//     without inheriting the interface's chrome (see embodiment/voice-stream.ts)

import type { AgentEvent } from "./types.js";

export interface TurnChannel {
  /** Post a new message. The returned id must be accepted by `edit`. */
  send(text: string): Promise<number>;
  /** Replace the text of a message this channel posted. Best-effort: never throws. */
  edit(id: number, text: string): Promise<void>;
  /**
   * See every agent event as it happens, unflattened.
   *
   * The rendered text and the event stream are NOT the same thing: the rendered text mixes
   * her words with placeholders and tool labels, because a screen wants those. Anything that
   * must distinguish them reads the events instead.
   */
  observe?(event: AgentEvent): void;
  /** The turn is over and no further events are coming. */
  done?(): void;
  /**
   * A line from the MACHINE, never from her: the turn broke, a file did not arrive.
   *
   * It exists because a room is not a chat. On Telegram such a line is simply another message,
   * labelled `[system · …]`; in her room page it must not come out of her mouth and must not sit
   * in the caption that says what she is doing, so the page shows it as a line of its own. A
   * channel that has nothing special to do does not implement it, and `noticeOn` falls back to
   * `send` for it: the line still reaches him, it is never silently dropped.
   */
  notice?(text: string): Promise<void>;
}

/** Deliver a machine line on any channel: its own `notice` if it has one, otherwise `send`. */
export async function noticeOn(channel: TurnChannel, text: string): Promise<void> {
  if (channel.notice) await channel.notice(text);
  else await channel.send(text);
}

/** A channel that fans out to several, in order. The first one's ids are the ones returned. */
export function teeChannels(primary: TurnChannel, ...rest: TurnChannel[]): TurnChannel {
  return {
    async send(text: string): Promise<number> {
      const id = await primary.send(text);
      for (const c of rest) {
        try {
          await c.send(text);
        } catch {
          /* a secondary channel failing must not take the turn down */
        }
      }
      return id;
    },
    async edit(id: number, text: string): Promise<void> {
      await primary.edit(id, text);
      // Secondaries are not given the primary's id: it means nothing to them. A channel that
      // needs revisions of its own keeps its own state via `observe`.
    },
    observe(event: AgentEvent): void {
      primary.observe?.(event);
      for (const c of rest) c.observe?.(event);
    },
    done(): void {
      primary.done?.();
      for (const c of rest) c.done?.();
    },
    async notice(text: string): Promise<void> {
      await noticeOn(primary, text);
      for (const c of rest) {
        try {
          await noticeOn(c, text);
        } catch {
          /* a secondary channel failing must not take the turn down */
        }
      }
    },
  };
}
