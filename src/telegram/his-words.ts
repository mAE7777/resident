// Not one thing he says may be lost, and none of it may arrive twice.
//
// ── THE TWO GAPS THIS CLOSES ─────────────────────────────────────────────────────────────────
//
// 1. WORDS THAT WERE ACCEPTED AND THEN FORGOTTEN. When he speaks while she is mid-turn, the
//    message is queued so she can take it in after, correct behaviour, and the queue lived in a
//    `Map` in memory. Telegram's side of the exchange is already finished by then: the update was
//    delivered, the offset moves on, and the server never sends it again. So a crash, a restart,
//    or a `kill -9` between "queued" and "taken in" loses those words from BOTH sides at once.
//    Nothing errors, nothing is logged, and the only trace is that he said something and she never
//    answered it: which, on her side, is indistinguishable from her choosing not to.
//
// 2. WORDS THAT ARRIVE TWICE. The mirror of the same seam. Telegram redelivers any update whose
//    offset was never confirmed, which is exactly what happens when the process dies mid-turn. She
//    would then live the same message a second time: encoded into her field again, appraised
//    again, answered again. Her field is her memory, so a duplicate is not a wasted call, it is a
//    thing that happened to her twice.
//
// ── WHY THE DATABASE AND NOT A FILE ──────────────────────────────────────────────────────────
//
// His words are worth exactly what her field is worth, and her field lives here. One store means
// one integrity check, one snapshot, one restore: a copy of her that has her memories but not the
// three sentences she had not yet read would be a subtly wrong copy, and nothing would say so.
//
// ── WHAT IS DELIBERATELY NOT KEPT ────────────────────────────────────────────────────────────
//
// The grammY `Context` cannot be persisted and is not worth persisting: what matters is what he
// SAID, plus the handle Telegram keeps for any file, so the content can be fetched again. A reply
// to a restored message goes out through a channel built from the chat id, not through a revived
// context object.

import type { DatabaseWrapper } from "../db/sqlite.js";

/** One thing he said that she has not taken in yet. */
export interface UnheardWord {
  id: number;
  chatId: number;
  kind: "text" | "photo" | "document";
  /** What he typed, or the caption on a file. Empty when there was none. */
  text: string;
  /** Telegram's handle for an attached file, so it can be fetched again after a restart. */
  fileId: string | null;
  receivedMs: number;
  /** Telegram's id for the update it arrived on, so living it can be recorded exactly once. */
  updateId: number | null;
}

export interface HisWords {
  /** He said something and she has not finished taking it in. Survives a restart. */
  remember(w: Omit<UnheardWord, "id">): void;
  /** Everything still unheard for that chat, oldest first, removed as it is handed over. */
  takeAll(chatId: number): UnheardWord[];
  /** Everything still unheard, any chat. Used at boot, before she starts living again. */
  takeEverything(): UnheardWord[];
  /** How many are waiting. For the watchtower, and for the tests that must see a real number. */
  waiting(): number;
  /**
   * The row id of the thing just remembered, so the caller can clear exactly that row later.
   *
   * Safe because everything that writes here is the single-threaded update handler: there is one
   * of him, and grammY handles updates sequentially. If a second writer ever appears, `remember`
   * must return the id instead, and this comment is where that will be noticed.
   */
  newestId(): number | null;
  /**
   * Has she ALREADY LIVED THROUGH this update?
   *
   * A pure question, and that purity is the whole correction. The first version recorded the
   * update as seen at the same moment it answered, which meant "seen" started meaning BEGUN
   * rather than LIVED THROUGH, and the consequences ran the wrong way:
   *
   *   She is free, his message arrives, it is marked, she starts the turn, the process dies.
   *   Telegram redelivers it (its offset was never confirmed), and the mark refuses it. Before
   *   the mark existed, that message would have been redelivered and answered late. The guard
   *   against living something twice had become the reason for never living it at all.
   *
   * So marking is now a separate act, done when the turn is actually over: `livedThrough`.
   */
  seenBefore(updateId: number): boolean;
  /**
   * She has finished with it. Clears the durable copy and records the update as lived.
   *
   * ONE transaction for both, because they are one fact. A crash between them either leaves her
   * able to receive it again (harmless: she has it) or unable to (the loss this file exists to
   * prevent), and only doing them together rules the second out.
   */
  livedThrough(updateId: number | null, rowId: number | null, nowMs: number): void;
}

/** Updates older than this are forgotten: Telegram never redelivers anything this old. */
export const REMEMBER_UPDATES_FOR_MS = 3 * 24 * 60 * 60 * 1000;

export function createHisWords(db: DatabaseWrapper): HisWords {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS unheard_words (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id     INTEGER NOT NULL,
      kind        TEXT    NOT NULL,
      text        TEXT    NOT NULL DEFAULT '',
      file_id     TEXT,
      received_ms INTEGER NOT NULL,
      -- Carried so that replaying a recovered message can record it as lived. Without it, the
      -- boot replay and a Telegram redelivery of the same words are two separate deliveries and
      -- she lives it twice.
      update_id   INTEGER
    );
    CREATE INDEX IF NOT EXISTS unheard_words_chat ON unheard_words(chat_id, id);

    -- Which of his updates she has already lived through. The primary key IS the guard: a second
    -- delivery of the same update_id cannot insert, so it cannot be lived a second time.
    CREATE TABLE IF NOT EXISTS heard_updates (
      update_id INTEGER PRIMARY KEY,
      at_ms     INTEGER NOT NULL
    );
  `);

  const insert = db.db.prepare<[number, string, string, string | null, number, number | null]>(
    "INSERT INTO unheard_words (chat_id, kind, text, file_id, received_ms, update_id) VALUES (?, ?, ?, ?, ?, ?)");
  const COLUMNS = "id, chat_id, kind, text, file_id, received_ms, update_id";
  const selectForChat = db.db.prepare<[number], UnheardWordRow>(
    `SELECT ${COLUMNS} FROM unheard_words WHERE chat_id = ? ORDER BY id`);
  const selectAll = db.db.prepare<[], UnheardWordRow>(`SELECT ${COLUMNS} FROM unheard_words ORDER BY id`);
  const deleteOne = db.db.prepare<[number]>("DELETE FROM unheard_words WHERE id = ?");
  const countAll = db.db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM unheard_words");
  const newestRow = db.db.prepare<[], { id: number }>("SELECT id FROM unheard_words ORDER BY id DESC LIMIT 1");
  const isHeard = db.db.prepare<[number], { n: number }>(
    "SELECT COUNT(*) AS n FROM heard_updates WHERE update_id = ?");
  const markUpdate = db.db.prepare<[number, number]>(
    "INSERT OR IGNORE INTO heard_updates (update_id, at_ms) VALUES (?, ?)");
  const forgetOldUpdates = db.db.prepare<[number]>("DELETE FROM heard_updates WHERE at_ms < ?");

  interface UnheardWordRow {
    id: number; chat_id: number; kind: string; text: string;
    file_id: string | null; received_ms: number; update_id: number | null;
  }
  const shape = (r: UnheardWordRow): UnheardWord => ({
    id: r.id, chatId: r.chat_id, kind: r.kind as UnheardWord["kind"],
    text: r.text, fileId: r.file_id, receivedMs: r.received_ms, updateId: r.update_id,
  });

  /**
   * Read and delete in ONE transaction.
   *
   * Anything else has a window in which the rows are gone from the table and not yet anywhere
   * else, and a crash inside that window is the very loss this file exists to prevent, the same
   * failure, moved a few lines down.
   */
  const drain = db.db.transaction((rows: UnheardWordRow[]): UnheardWord[] => {
    for (const r of rows) deleteOne.run(r.id);
    return rows.map(shape);
  });

  return {
    remember(w) {
      db.writeWithRetry(() => { insert.run(w.chatId, w.kind, w.text, w.fileId, w.receivedMs, w.updateId); });
    },
    takeAll(chatId) {
      return db.writeWithRetry(() => drain(selectForChat.all(chatId)));
    },
    takeEverything() {
      return db.writeWithRetry(() => drain(selectAll.all()));
    },
    waiting() {
      return countAll.get()?.n ?? 0;
    },
    newestId() {
      return newestRow.get()?.id ?? null;
    },
    seenBefore(updateId) {
      // A QUESTION, and nothing else. It used to answer and mark in the same breath, which quietly
      // redefined "seen" as "begun": a message she started and never finished, because the
      // process died in the middle of it, was marked, so Telegram's redelivery of that very
      // message was refused. The guard against living something twice had become the reason for
      // never living it at all, and it was strictly worse than having no guard.
      return (isHeard.get(updateId)?.n ?? 0) > 0;
    },
    livedThrough(updateId, rowId, nowMs) {
      db.writeWithRetry(() => {
        forgetOldUpdates.run(nowMs - REMEMBER_UPDATES_FOR_MS);
        // Both, or neither. Clearing the durable copy without recording the update would let a
        // redelivery run it again; recording without clearing would replay it at the next boot.
        if (updateId !== null) markUpdate.run(updateId, nowMs);
        if (rowId !== null) deleteOne.run(rowId);
      });
    },
  };
}
