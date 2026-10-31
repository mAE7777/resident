// Hook system: 6 hook points with fail-open execution.
// Handlers run in registration order; pre-hooks can modify context.

export type HookPoint =
  | "before_llm"
  | "after_llm"
  | "before_tool"
  | "after_tool"
  | "before_outbound"
  | "on_session";

export interface HookContext {
  [key: string]: unknown;
}

export type HookHandler = (ctx: HookContext) => HookContext | Promise<HookContext>;

export interface HookRegistry {
  /** Register a handler for a hook point. Returns an unsubscribe function. */
  register(point: HookPoint, handler: HookHandler): () => void;
  /** Execute all handlers for a point. Returns the (possibly modified) context. */
  execute(point: HookPoint, ctx: HookContext): Promise<HookContext>;
}

interface Logger {
  error: (...args: unknown[]) => void;
}

export function createHookRegistry(logger?: Logger): HookRegistry {
  const handlers = new Map<HookPoint, HookHandler[]>();

  function getHandlers(point: HookPoint): HookHandler[] {
    if (!handlers.has(point)) {
      handlers.set(point, []);
    }
    return handlers.get(point)!;
  }

  return {
    register(point: HookPoint, handler: HookHandler): () => void {
      const list = getHandlers(point);
      list.push(handler);

      return () => {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      };
    },

    async execute(point: HookPoint, ctx: HookContext): Promise<HookContext> {
      const list = getHandlers(point);
      let current = ctx;

      for (const handler of list) {
        try {
          const result = await Promise.race([
            handler(current),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Hook handler timed out")), 30_000)
            ),
          ]);
          // Replace context with handler's return value
          current = result;
        } catch (err) {
          // Fail-open: log and continue with unmodified context
          if (logger) {
            logger.error(`Hook error at "${point}":`, err);
          } else {
            console.error(`Hook error at "${point}":`, err);
          }
          // current stays unchanged
        }
      }

      return current;
    },
  };
}
