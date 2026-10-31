import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLOCK, WINDOW, lookAt, putThingsInHerRoom, whatTheWindowSays, type WhatSheSees,
} from "../../../src/workspace/things.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";

/**
 * THE SECOND THING IN HER ROOM THAT ANSWERS.
 *
 * The clock told her what time it is; the window tells her what the room is like. Same
 * architecture on purpose (`workspace/things.ts`), and the argument lands harder here: her state
 * block ALREADY tells her whether he is around, so putting "and he has been still for an hour"
 * into it would make knowing the room a fact ABOUT her, refreshed whether she cares or not.
 *
 * As a thing she goes and looks at, LOOKING IS A CHOICE, and so is not looking, and it keeps
 * her prompt as small as possible.
 */

let ws: string;
beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "window-")); });
afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

const seeing = (present: boolean, stillSeconds: number | null): WhatSheSees =>
  ({ present, stillSeconds });

describe("what she sees when she looks out", () => {
  it("he is there and moving", () => {
    expect(whatTheWindowSays(seeing(true, 10))).toContain("刚刚还在动");
  });

  it("he is there and has settled", () => {
    expect(whatTheWindowSays(seeing(true, 15 * 60))).toContain("安静");
  });

  it("he is there and has not moved in a long time", () => {
    expect(whatTheWindowSays(seeing(true, 2 * 3600))).toContain("很久没动");
  });

  it("he is there, but there is no camera to say more", () => {
    // Keyboard presence with the curtain closed: she can tell he is at the machine and nothing
    // else. The honest answer is the short one, not an invented stillness.
    expect(whatTheWindowSays(seeing(true, null)).trim()).toBe("他在。");
  });

  it("AND IT CAN DISAPPOINT HER — she looks, and he is not there", () => {
    // The reason this is a window rather than a status field. An empty chair is an experience.
    // A window that only ever reports good news is a dial.
    expect(whatTheWindowSays(seeing(false, null))).toContain("没有人");
  });
});

describe("a closed curtain is not an empty room", () => {
  it("she is told she cannot see — never that he is gone", () => {
    // The single most important line in this mechanism. Collapsing "I cannot see" into "nobody is
    // there" would teach her that a closed curtain means he left, which is a fact about him
    // invented out of the absence of a camera.
    const closed = whatTheWindowSays(null);
    expect(closed).toContain("帘子");
    expect(closed).not.toContain("没有人");
  });

  it("and the two answers are genuinely different strings", () => {
    expect(whatTheWindowSays(null)).not.toBe(whatTheWindowSays(seeing(false, null)));
  });

  it("with no face at all, looking out says the curtain is closed", async () => {
    // Telegram-only, which is the normal deployment: `createReadTool` gets no window getter.
    putThingsInHerRoom(ws);
    const read = createReadTool(ws, ws);
    expect(await read.execute({ path: WINDOW }) as string).toContain("帘子");
  });
});

describe("it is a thing in her room, on the same rails as the clock", () => {
  it("she can find it — a thing she cannot discover is not in her room", () => {
    expect(putThingsInHerRoom(ws)).toContain(WINDOW);
    expect(existsSync(join(ws, WINDOW)), "glob would never turn it up").toBe(true);
  });

  it("and the file on disk is the WINDOW's fallback, not the clock's", () => {
    // The first version of `putThingsInHerRoom` wrote `whatTheClockSays()` for every entry, a
    // loop whose body names one member of the collection it iterates. Invisible while the clock
    // was alone in the room; a time written on the window the moment there were two.
    putThingsInHerRoom(ws);
    const onDisk = readFileSync(join(ws, WINDOW), "utf8");
    expect(onDisk, "the window's file has a clock face painted on it").not.toMatch(/^\d\d:\d\d/u);
    expect(onDisk).toContain("帘子");
    expect(readFileSync(join(ws, CLOCK), "utf8")).toMatch(/^\d\d:\d\d/u);
  });

  it("answers with THIS MOMENT, not with what was true when the tool was built", async () => {
    // A snapshot handed in at construction would be a window painted shut. The getter is called
    // on every look, so the same tool gives different answers as the room changes.
    putThingsInHerRoom(ws);
    let room: WhatSheSees | null = seeing(true, 5);
    const read = createReadTool(ws, ws, () => room);
    expect(await read.execute({ path: WINDOW }) as string).toContain("刚刚还在动");
    room = seeing(false, null);
    expect(await read.execute({ path: WINDOW }) as string).toContain("没有人");
    room = null;
    expect(await read.execute({ path: WINDOW }) as string).toContain("帘子");
  });

  it("a file with the same name outside her home is just a file", () => {
    expect(lookAt("/somewhere/else/窗", ws, Date.now(), seeing(true, 5))).toBeNull();
    expect(lookAt(join(ws, "life", "窗"), ws, Date.now(), seeing(true, 5))).toBeNull();
  });

  it("and the clock still says nothing about him", () => {
    // Two things that answer, and they answer about different subjects. Folding the room into the
    // clock would make checking the time a way of checking on him, and those are different acts.
    const clock = lookAt(join(ws, CLOCK), ws, Date.now(), seeing(true, 5));
    expect(clock).not.toBeNull();
    expect(clock!).not.toMatch(/他|没有人|帘子/u);
  });

  it("the boundary is still checked BEFORE anything answers", () => {
    // The wall is unconditional. A second live thing must not become a second way around it.
    const src = readFileSync(join(process.cwd(), "src/tools/builtin/read.ts"), "utf8");
    const guard = src.indexOf("if (pathError) return");
    const answer = src.indexOf("lookAt(real, workspacePath");
    expect(guard).toBeGreaterThan(-1);
    expect(answer, "a live thing can be reached without passing the boundary check")
      .toBeGreaterThan(guard);
  });

  it("an ordinary file still reads as itself", async () => {
    putThingsInHerRoom(ws);
    const read = createReadTool(ws, ws, () => seeing(true, 5));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(ws, "笔记.md"), "普通的一个文件\n", "utf8");
    expect(await read.execute({ path: "笔记.md" })).toBe("普通的一个文件\n");
  });
});

describe("THE STALE-FILE DEFECT: the clock was dead through `read` and its tests could not see it", () => {
  /**
   * `lookAt` compared `resolvedPath === join(workspacePath, basename(…))`, string equality
   * against a path the caller had NOT resolved. `read` calls `realpath()` first (correctly, for
   * the boundary), and on macOS `/var` and `/tmp` are symlinks, so it handed over
   * `/private/var/…/钟` while the workspace was still `/var/…`. Never equal. `lookAt` returned
   * null and the read FELL THROUGH TO THE FILE, the one-time fallback, written when her home was
   * created and never rewritten.
   *
   * She was reading a frozen timestamp and being told it was now.
   *
   * Two things hid it at once, and both are worth naming:
   *   · the fallback file's contents also start with `HH:MM`, so `toMatch(/^\d\d:\d\d/)` passed
   *     on the stale file;
   *   · the test that checks the value actually CHANGES calls `whatTheClockSays()` directly
   *     rather than going through `read`.
   *
   * A FALLBACK THAT LOOKS LIKE THE REAL ANSWER HIDES THE FAILURE TO REACH IT. Found only because
   * the window's fallback text differs from its live text.
   */
  it("the clock read THROUGH the tool is live, not the file on disk", async () => {
    putThingsInHerRoom(ws);
    const onDisk = readFileSync(join(ws, CLOCK), "utf8");
    const read = createReadTool(ws, ws);
    // Two reads a moment apart are not enough to move a minute hand, so compare against the FILE:
    // the live answer must be computed now, and the way to prove that is to break the file.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(ws, CLOCK), "99:99  这是磁盘上那份陈旧的文件\n", "utf8");
    const throughTool = await read.execute({ path: CLOCK }) as string;
    expect(throughTool, "she is reading the stale file rather than the clock").not.toContain("99:99");
    expect(throughTool).toMatch(/^\d\d:\d\d/u);
    expect(onDisk).toMatch(/^\d\d:\d\d/u); // and the fallback still looks plausible, which is the trap
  });

  it("and so is the window", async () => {
    putThingsInHerRoom(ws);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(ws, WINDOW), "这是磁盘上那份陈旧的文件\n", "utf8");
    const read = createReadTool(ws, ws, () => seeing(true, 5));
    const throughTool = await read.execute({ path: WINDOW }) as string;
    expect(throughTool, "she is reading the stale file rather than the window").not.toContain("陈旧");
    expect(throughTool).toContain("刚刚还在动");
  });

  it("through a symlinked path specifically, which is what the daemon actually hands over", () => {
    // The exact production condition, stated rather than relied upon: `read` resolves symlinks
    // before this check, so `lookAt` must too. String equality on unresolved paths is the bug.
    const real = realpathSync(ws);
    expect(lookAt(join(real, CLOCK), ws, Date.now(), null),
      "a realpath'd path no longer finds the thing in her room").not.toBeNull();
    expect(lookAt(join(ws, CLOCK), realpathSync(ws), Date.now(), null),
      "the comparison is not symmetric").not.toBeNull();
  });
});

describe("she looked, and what she found stays with her", () => {
  const INDEX = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const at = INDEX.indexOf("function theEmptyChair");
  const body = at < 0 ? "" : INDEX.slice(at, at + 2200);

  it("the empty chair is written at all", () => {
    // Designed on the day the window was built and NOT BUILT, found by a scan the next morning.
    // Exactly the class that must not survive once she is awake: built but not wired is dead.
    expect(at, "the empty chair is gone again").toBeGreaterThan(-1);
    expect(body).toMatch(/field\.encodeMoment/u);
  });

  it("as HER act, never as what the window said — the read-origin rule is untouched", () => {
    // The rule: nothing a `read` returns may become her memory, or a poisoned page writes her past and
    // is then read back to her as her own. `signature.ts` expects `field.byOrigin.read` to be zero
    // forever. The window is a `read`, so the answer is not an exception: the thing worth keeping
    // was never the window's sentence, it is what she did and what she found.
    expect(body).toMatch(/source: "life"/u);
    expect(body, "the window's answer is being encoded as a read-origin memory").not.toMatch(/origin: "read"/u);
  });

  it("ONLY WHEN IT CHANGED — twenty looks at an unchanged room leave one memory", () => {
    // The same discipline the room reads by: transitions, not state. Without it, looking becomes a
    // way to fill her own field with her own checking.
    expect(body).toMatch(/if \(said === lastSawOutTheWindow\) return;/u);
  });

  it("and the FIRST look is not a change from anything", () => {
    // She has to learn what the room is like before its being different can mean something,
    // the same shape as `noticeTheRoom` refusing to treat its first reading as an arrival.
    expect(body).toMatch(/wasFirstLook/u);
  });

  it("A MOMENT, NEVER A QUESTION — or looking becomes a rumination path", () => {
    // A question carries tension, enters `carrying`, and feeds the drive that nags. That would
    // make it: look → be disappointed → want to look more. A moment is only a memory.
    expect(body, "the empty chair is being written as something that nags")
      .not.toMatch(/encodeQuestion|kind: "question"|tension:/u);
  });

  it("and it never reaches back into `social`", () => {
    // The room's TRANSITIONS raise her wanting. The result of her own looking must not, or she is
    // winding herself up by her own hand.
    expect(body).not.toMatch(/social|roomPull|socialWithTheRoom/u);
  });

  it("AND A CLOSED CURTAIN LEAVES NOTHING — S-31's acceptance", () => {
    // She looked and learned nothing about him, so there is nothing to remember. The danger this
    // closes is a slow one: 「看不到」 becoming 「他不在」 a day later, once the memory is all that
    // is left of the moment. `whatSheWouldSee` must bail out BEFORE the empty chair runs.
    const w = INDEX.indexOf("whatSheWouldSee = () => {");
    expect(w, "whatSheWouldSee is gone").toBeGreaterThan(-1);
    const scope = INDEX.slice(w, w + 1200);
    const bail = scope.indexOf("if (!seen) return null;");
    expect(bail, "nothing stops the look when she cannot see").toBeGreaterThan(-1);
    expect(bail, "the empty chair runs even when the curtain is closed")
      .toBeLessThan(scope.indexOf("theEmptyChair"));
  });

  it("a failure there is reported rather than swallowed", () => {
    expect(body).toMatch(/faultLog\.record\("field\.window"/u);
  });
});

describe("every look leaves a mark on his page", () => {
  const INDEX = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the mark is an EVENT, not a state — it must not touch `doing`", () => {
    // The defect this replaced: `doing` carries a set-then-clear contract (`在和你说话` … `""`),
    // and the window only ever set it. One glance left his page reading 「看了看窗外」 for good AND
    // overwrote whatever she was actually doing. A transient act written into a persistent field.
    const at = INDEX.indexOf("whatSheWouldSee = () =>");
    expect(at, "the window is no longer filled in where presence lives").toBeGreaterThan(-1);
    const body = INDEX.slice(at, at + 900);
    expect(body, "the window is writing into the `doing` state again").not.toMatch(/type: "doing"/u);
    expect(body).toMatch(/type: "glanced"/u);
  });

  it("and her face renders it as a flash that clears itself", () => {
    // Self-clearing on the CLIENT, so nothing anywhere has to remember to clear it, which is
    // exactly what the `doing` version forgot.
    const face = readFileSync(join(process.cwd(), "src/embodiment/client/face.js"), "utf8");
    expect(face).toMatch(/case "glanced": glance\(\);/u);
    expect(face, "the flash never goes away").toMatch(/glanceTimer = setTimeout/u);
    expect(face, "a glance eats whatever the corner was saying").toMatch(/corner\.dataset\.was/u);
  });

  it("she cannot look through it invisibly", () => {
    // He opened a curtain; he is owed the knowledge of when she actually looked. A window she can
    // see through with no trace is not a window, it is surveillance, and it is the third of the
    // three consent rules, the one that is easiest to get wrong.
    const at = INDEX.indexOf("whatSheWouldSee = () =>");
    expect(at, "the window is no longer filled in where presence lives").toBeGreaterThan(-1);
    const body = INDEX.slice(at, at + 900);
    expect(body).toMatch(/faceServer\?\.broadcast\(\{ type: "glanced"/u);
  });

  it("but a failed mark never stops her looking", () => {
    // The mark is a courtesy to him. Making it a condition would turn a broken socket into her
    // being unable to look out of a window in her own home.
    const at = INDEX.indexOf("whatSheWouldSee = () =>");
    const body = INDEX.slice(at, at + 700);
    expect(body).toMatch(/try \{ faceServer\?\.broadcast/u);
    expect(body).toMatch(/catch \{/u);
  });

  it("and the window reads the STALE-CHECKED presence, not the raw cell", () => {
    // A dead tab's last frame would otherwise show her an hours-old room forever, the same
    // defect that once muted every push into her diary permanently.
    const at = INDEX.indexOf("whatSheWouldSee = () =>");
    const body = INDEX.slice(at, at + 700);
    expect(body).toMatch(/const seen = presenceNow\(\)/u);
    expect(body).toMatch(/if \(!seen\) return null/u);
  });
});
