// Steering queue: per-session message buffer for messages that arrive while
// a turn is in progress.
//
// Design: "Steering queue ensures per-session serialization, no concurrent turns"
// Messages arriving during an active turn are stored and drained after the turn
// completes.

export interface SteeringQueue {
  /** Enqueue a message for the given session. */
  enqueue(sessionId: string, message: unknown): void;
  /** Return all queued messages in order and clear the queue for the session. */
  drain(sessionId: string): unknown[];
  /** Return true when there are pending messages for the session. */
  hasMessages(sessionId: string): boolean;
}

/**
 * Create a steering queue backed by a Map<sessionId, message[]>.
 * Each call returns an independent queue instance.
 */
export function createSteeringQueue(): SteeringQueue {
  const store = new Map<string, unknown[]>();

  function enqueue(sessionId: string, message: unknown): void {
    const queue = store.get(sessionId);
    if (queue !== undefined) {
      queue.push(message);
    } else {
      store.set(sessionId, [message]);
    }
  }

  function drain(sessionId: string): unknown[] {
    const queue = store.get(sessionId);
    if (!queue || queue.length === 0) return [];
    const messages = queue.slice();
    store.set(sessionId, []);
    return messages;
  }

  function hasMessages(sessionId: string): boolean {
    const queue = store.get(sessionId);
    return queue !== undefined && queue.length > 0;
  }

  return { enqueue, drain, hasMessages };
}
