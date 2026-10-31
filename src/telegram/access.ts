// access.ts, allow-list access control for the Telegram bot.
// Secure by default: empty allowedUserIds denies everyone.
// Wildcard sentinel: 0 in the list allows all users.

import type { Context, MiddlewareFn } from "grammy";

export interface AccessControl {
  isAllowed(userId: number): boolean;
}

/**
 * Creates an access-control object from a list of allowed Telegram user IDs.
 *
 * Rules:
 *   - Empty list  → deny all (secure by default)
 *   - [0, ...]    → allow all (0 is the wildcard sentinel; real IDs are always > 0)
 *   - [id, ...]   → whitelist: only the listed IDs are allowed
 */
export function createAccessControl(allowedUserIds: number[]): AccessControl {
  return {
    isAllowed(userId: number): boolean {
      // Empty list = deny all
      if (allowedUserIds.length === 0) return false;

      // Wildcard sentinel: 0 in the list means allow everyone
      if (allowedUserIds.includes(0)) return true;

      // Whitelist check
      return allowedUserIds.includes(userId);
    },
  };
}

/**
 * Creates a grammY middleware that silently drops messages from unauthorized
 * users. Unauthorized users receive no response and no error acknowledgment.
 */
export function createAccessMiddleware(
  accessControl: AccessControl
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    // If we can't determine the sender, deny silently
    if (userId === undefined) return;

    if (!accessControl.isAllowed(userId)) {
      // Silent ignore: no response, no error
      return;
    }

    await next();
  };
}
