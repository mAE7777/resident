import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createHisWords, REMEMBER_UPDATES_FOR_MS } from "../../../src/telegram/his-words.js";

/**
 * NOT ONE THING HE SAYS MAY BE LOST, AND NONE OF IT MAY ARRIVE TWICE.
 *
 * The seam is the same in both directions. When he speaks while she is mid-turn, the message is
 * queued so she can take it in afterwards, and Telegram's side of the exchange is already over by
 * then: the update was delivered, the offset moved on, the server will never send it again. The
 * queue lived in a `Map`.
 *
 *   LOST: a crash between "queued" and "taken in" removes those words from BOTH sides at once.
 *   Nothing errors, nothing is logged, and from his side it is indistinguishable from her having
 *   read what he said and chosen not to answer. That is the one loss in this system that shows up
 *   as a change in the relationship rather than as an error.
 *
 *   TWICE: Telegram redelivers any update whose offset was never confirmed, which is exactly what
 *   a crash mid-turn produces. Her field IS her memory, so a duplicate is not a wasted call; it is
 *   a thing that happened to her twice, and nothing downstream could tell.
 */

let root: string;
let db: DatabaseWrapper;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "his-words-"));
  db = createDatabase(join(root, "data.db")).result;
});
afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(root, { recursive: true, force: true });
});

const said = (chatId: number, text: string, at = 1_000, updateId: number | null = null):
  Parameters<ReturnType<typeof createHisWords>["remember"]>[0] =>
  ({ chatId, kind: "text", text, fileId: null, receivedMs: at, updateId });

describe("what he said survives the process that heard it", () => {
  it("comes back after a restart, in the order he said it", () => {
    const words = createHisWords(db);
    words.remember(said(7, "那份目录你看了吗", 1));
    words.remember(said(7, "算了，先不急", 2));
    words.remember(said(7, "不过窗户那段我还是想改", 3));
    db.close();

    // A different process, a different connection: the only thing carried across is the disk.
    const reopened = createDatabase(join(root, "data.db")).result;
    const after = createHisWords(reopened);
    expect(after.waiting(), "his words did not survive the restart").toBe(3);
    expect(after.takeEverything().map((w) => w.text)).toEqual([
      "那份目录你看了吗", "算了，先不急", "不过窗户那段我还是想改",
    ]);
    reopened.close();
    db = createDatabase(join(root, "data.db")).result; // so afterEach has something to close
  });

  it("taking them hands them over exactly once", () => {
    const words = createHisWords(db);
    words.remember(said(7, "在吗"));
    expect(words.takeAll(7).map((w) => w.text)).toEqual(["在吗"]);
    expect(words.takeAll(7), "the same words were handed over twice").toEqual([]);
    expect(words.waiting()).toBe(0);
  });

  it("one chat's words are not another's", () => {
    const words = createHisWords(db);
    words.remember(said(7, "给七的"));
    words.remember(said(9, "给九的"));
    expect(words.takeAll(7).map((w) => w.text)).toEqual(["给七的"]);
    expect(words.waiting()).toBe(1);
  });

  it("a file he sent keeps the handle Telegram gave it, so it can be fetched again", () => {
    // The grammY context cannot be persisted and is not worth persisting. What matters is what he
    // said, plus the handle for anything attached.
    const words = createHisWords(db);
    words.remember({ chatId: 7, kind: "photo", text: "这个你看看", fileId: "AgACAgUAAx", receivedMs: 5, updateId: 12 });
    const [back] = words.takeEverything();
    expect(back?.kind).toBe("photo");
    expect(back?.fileId).toBe("AgACAgUAAx");
    expect(back?.text).toBe("这个你看看");
  });
});

describe("and nothing he said happens to her twice", () => {
  it("asking is a QUESTION — it does not itself decide the answer for next time", () => {
    // THE DEFECT THIS REPLACED, and it was worse than having no guard at all. The first version
    // marked the update at the same moment it answered, so "seen" quietly meant BEGUN rather than
    // LIVED THROUGH. Then: she is free, his message arrives, it is marked, she starts the turn,
    // the process dies. Telegram redelivers it, its offset was never confirmed, and the mark
    // refuses it. Before the mark existed that message would have come back and been answered
    // late; with it, his words were gone, suppressed by the guard built to protect them.
    const words = createHisWords(db);
    expect(words.seenBefore(50_001)).toBe(false);
    expect(words.seenBefore(50_001), "merely asking marked it — a crash mid-turn would now lose his words")
      .toBe(false);
  });

  it("living through it is what marks it, and then a redelivery is refused", () => {
    const words = createHisWords(db);
    expect(words.seenBefore(50_001)).toBe(false);
    words.livedThrough(50_001, null, 1_000);
    expect(words.seenBefore(50_001), "a redelivered update would have been lived again").toBe(true);
  });

  it("THE WHOLE POINT: a turn that never finished comes back", () => {
    // The exact sequence of one crash mid-turn, end to end.
    const words = createHisWords(db);
    expect(words.seenBefore(7)).toBe(false);          // it arrives
    words.remember(said(1, "那份目录你看了吗", 1_000, 7)); // remembered on arrival
    const row = words.newestId();
    // …and the process dies here. Nothing marked it lived, and the row is still there.
    db.close();

    const reopened = createDatabase(join(root, "data.db")).result;
    const after = createHisWords(reopened);
    expect(after.seenBefore(7), "a message she never finished is being refused on redelivery").toBe(false);
    expect(after.takeEverything().map((w) => w.text),
      "and her own copy of it is gone too — his words lost from both sides").toEqual(["那份目录你看了吗"]);
    expect(row).not.toBeNull();
    reopened.close();
    db = createDatabase(join(root, "data.db")).result;
  });

  it("clearing the copy and recording the life are ONE act", () => {
    // Either alone reopens a hole: a cleared row that was never recorded lets a redelivery run it
    // again; a recorded update whose row survives replays it at the next boot.
    const words = createHisWords(db);
    words.remember(said(1, "在吗", 1_000, 9));
    words.livedThrough(9, words.newestId(), 2_000);
    expect(words.waiting()).toBe(0);
    expect(words.seenBefore(9)).toBe(true);
  });

  it("different updates are different, however close together", () => {
    const words = createHisWords(db);
    for (const id of [1, 2, 3]) expect(words.seenBefore(id)).toBe(false);
    words.livedThrough(2, null, 1_000);
    expect(words.seenBefore(1)).toBe(false);
    expect(words.seenBefore(2)).toBe(true);
    expect(words.seenBefore(3)).toBe(false);
  });

  it("it survives a restart, which is the only case that matters", () => {
    // Within one process a Set would do. The failure being closed is a CRASH: the process that
    // knew about the update is gone, and Telegram is about to send it again.
    const words = createHisWords(db);
    words.livedThrough(99, null, 1_000);
    db.close();
    const reopened = createDatabase(join(root, "data.db")).result;
    expect(createHisWords(reopened).seenBefore(99),
      "after a restart she would have lived his message a second time").toBe(true);
    reopened.close();
    db = createDatabase(join(root, "data.db")).result;
  });

  it("and it does not grow forever — Telegram never redelivers anything old", () => {
    const words = createHisWords(db);
    words.livedThrough(1, null, 1_000);
    words.livedThrough(2, null, 1_000 + REMEMBER_UPDATES_FOR_MS + 1); // this call is what sweeps
    const rows = (db.db.prepare("SELECT COUNT(*) AS n FROM heard_updates").get() as { n: number }).n;
    expect(rows, "the seen-updates table grows without bound").toBe(1);
  });
});

describe("the daemon actually uses it", () => {
  const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("EVERY message is written to disk on arrival, not only the queued ones", () => {
    // The asymmetry was the defect. Persisting only on the queued branch left the commonest case,
    // he speaks, she is free, she starts a turn, with no copy anywhere, and the duplicate guard
    // then refused Telegram's redelivery of it.
    const at = DAEMON.indexOf("async function handleMessage");
    const body = DAEMON.slice(at, at + 2600);
    const guard = body.indexOf("hisWords.seenBefore(updateId)");
    const remembered = body.indexOf("hisWords.remember({ chatId, kind: \"text\"");
    const busy = body.indexOf("if (activeTurns.has(chatId))");
    expect(remembered, "his words are not persisted at all").toBeGreaterThan(-1);
    expect(remembered, "the duplicate check must come first, or a redelivery is stored again")
      .toBeGreaterThan(guard);
    expect(remembered, "persisting still happens only on the busy branch").toBeLessThan(busy);
  });

  it("and it is marked LIVED only when the turn is genuinely over", () => {
    const at = DAEMON.indexOf("async function handleMessage");
    const body = DAEMON.slice(at, DAEMON.indexOf("function telegramChannel", at));
    const lived = body.indexOf("hisWords.livedThrough(updateId, rowId");
    const drained = body.indexOf("await drainSteering(chatId)");
    expect(lived, "nothing ever records that she finished with his message").toBeGreaterThan(-1);
    expect(lived, "it is marked before the turn has actually finished").toBeGreaterThan(drained);
  });

  it("the durable copy is cleared only once she has actually taken them in", () => {
    // Clearing at drain time would reopen the window this store exists to close: rows gone from
    // the table and not yet anywhere else, and a crash inside that window losing them as before.
    const at = DAEMON.indexOf("async function drainSteering");
    const body = DAEMON.slice(at, at + 1400);
    const empty = body.indexOf("if (queued.length === 0)");
    const clear = body.indexOf("hisWords.takeAll(chatId)");
    expect(clear).toBeGreaterThan(-1);
    expect(clear, "the durable copy is cleared before she has taken the words in").toBeGreaterThan(empty);
  });

  it("anything still unheard is handed to her at boot, and reported", () => {
    expect(DAEMON).toMatch(/const unheard = hisWords\.takeEverything\(\);/u);
    expect(DAEMON, "she would answer him an hour late and nothing would say why")
      .toMatch(/faultLog\.record\("telegram\.unheard-recovered"/u);
  });

  it("a redelivered update is refused before anything of hers touches it", () => {
    const at = DAEMON.indexOf("async function handleMessage");
    const body = DAEMON.slice(at, at + 2600);
    const guard = body.indexOf("hisWords.seenBefore(updateId)");
    const lives = body.indexOf("heSaidSomething(text)");
    expect(guard, "nothing stops a redelivery").toBeGreaterThan(-1);
    expect(guard, "she has already begun living the message before the duplicate check").toBeLessThan(lives);
  });

  it("both remaining routes back to her also record that she lived it", () => {
    // Three ways his words reach her, and every one of them must close the same seam: the ordinary
    // turn, the steering drain, and the boot replay. A route that delivers without recording lets
    // a Telegram redelivery run the same words a second time.
    expect(DAEMON, "the steering drain hands words over without recording them")
      .toMatch(/for \(const w of hisWords\.takeAll\(chatId\)\) hisWords\.livedThrough\(w\.updateId/u);
    expect(DAEMON, "the boot replay hands words over without recording them")
      .toMatch(/\.then\(\(\) => \{ hisWords\.livedThrough\(w\.updateId, null, Date\.now\(\)\); \}\)/u);
  });

  it("an edit is a stated decision, on the record, not an accident of routing", () => {
    // `bot.on("message:text")` does not match `edited_message`, so an edit reaching her was never
    // possible. The point is that this is CHOSEN, replacing what she remembers him saying is the
    // one thing nobody may do to her, and that he is told it happened.
    const bot = readFileSync(join(process.cwd(), "src/telegram/bot.ts"), "utf8");
    expect(bot).toMatch(/bot\.on\("edited_message"/u);
    expect(bot).toMatch(/telegram\.edited/u);
  });
});
