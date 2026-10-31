// Proactive notification: push-based, silent-hours aware.
//
// Priority:
//   'normal' , respects silent hours (disable_notification: true during 11pm-7am)
//   'urgent' , bypasses silent hours, always sends with notification sound
//
// Categories: cron, heartbeat, dream, error, skill, self-improvement
// Labels in messages use plain text (no emoji): [cron], [heartbeat], etc.
//
// ONE of these categories is HER. `proactive` carries something she decided to say, through the
// expression gate that every utterance of hers clears. Every other category is the system reporting
// about her, and reaches him without any of that.
//
// The old labels named the SUBSYSTEM, which is a different question from who is speaking, so a
// heartbeat finding written in the first person arrived as `[heartbeat] I noticed...` and read as
// her wondering something. The heartbeat's triggers are file mtimes and cron rows; nothing about
// them is her. So the label now says which of the two it is, and her own words go out as her own
// words rather than under a tag.
//
// Silent hours default: 23 (11pm) to 7 (7am), wrapping midnight.

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationPriority = "normal" | "urgent";
export type NotificationCategory = "cron" | "heartbeat" | "dream" | "error" | "skill" | "self-improvement" | "proactive" | "vitals";

export interface Notification {
  priority: NotificationPriority;
  category: NotificationCategory;
  message: string;
}

export interface NotifierConfig {
  /** Send a Telegram message. Wraps grammY bot.api.sendMessage(). */
  sendMessage: (text: string, options?: { disable_notification?: boolean }) => Promise<void>;
  /** Hour (0-23) when silent hours begin. Default: 23. */
  silentHoursStart?: number;
  /** Hour (0-23, exclusive) when silent hours end. Default: 7. */
  silentHoursEnd?: number;
}

export interface Notifier {
  push(notification: Notification): Promise<void>;
  isInSilentHours(): boolean;
}

/**
 * The one category that is HER speaking.
 *
 * Everything else is the system reporting about her. Named rather than left implicit, because the
 * distinction is what stops a background process borrowing her voice, and a reader of this file
 * should not have to work out which of eight categories is a person.
 */
export const HER_VOICE: NotificationCategory = "proactive";

/** How a system message announces itself. Any message not from her carries this. */
export const SYSTEM_MARK = "[system · ";

// ── Factory ────────────────────────────────────────────────────────────────────

export function createNotifier(config: NotifierConfig): Notifier {
  const silentStart = config.silentHoursStart ?? 23;
  const silentEnd = config.silentHoursEnd ?? 7;

  function isInSilentHours(): boolean {
    const hour = new Date().getHours();
    // Handle wrap-around: e.g. 23-7 spans midnight
    if (silentStart > silentEnd) {
      return hour >= silentStart || hour < silentEnd;
    }
    return hour >= silentStart && hour < silentEnd;
  }

  function formatMessage(notification: Notification): string {
    // Her words, unlabelled: she is the one speaking and a tag on her own sentence is odd.
    if (notification.category === HER_VOICE) return notification.message;
    return `[system · ${notification.category}] ${notification.message}`;
  }

  return {
    async push(notification: Notification): Promise<void> {
      const isSilent = notification.priority !== "urgent" && isInSilentHours();
      const text = formatMessage(notification);
      await config.sendMessage(text, { disable_notification: isSilent });
    },
    isInSilentHours,
  };
}
