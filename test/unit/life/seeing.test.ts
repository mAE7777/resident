// seeing, the pure organ: her eye's three sentences, the transducer's discipline,
// and the fences a sight may never carry. S-59 / S-60.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  LOOK_SYSTEM, eyeReport, WINDOW_HELD_SHUT, EYES_FAILED, SIGHT_MAX_CHARS, LAST_SIGHT_MAX_CHARS, sanitizeSight, lastSightLine, narratedLook,
  canvasSight, CANVAS_SYSTEM, CANVAS_RENDER_PX,
} from "../../../src/life/seeing.js";

/** Every .ts file under root whose text carries the phrase, the single-emitter scanner. */
function emittersOf(root: string, phrase: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const child = join(dir, name);
      if (statSync(child).isDirectory()) walk(child);
      else if (child.endsWith(".ts") && readFileSync(child, "utf8").includes(phrase)) {
        hits.push(relative(root, child));
      }
    }
  };
  walk(root);
  return hits.sort();
}

describe("the three sentences", () => {
  it("are pinned word for word", () => {
    expect(WINDOW_HELD_SHUT).toBe("窗子这会儿打不开。");
    expect(EYES_FAILED).toBe("看了，这会儿有点看不清。");
    expect(eyeReport("白天，天色灰白。")).toBe("你往外看。眼睛带回来的：\n白天，天色灰白。");
  });

  it("carry no scolding, no reassurance, no explanation", () => {
    for (const line of [WINDOW_HELD_SHUT, EYES_FAILED, eyeReport("")]) {
      for (const banned of ["放心", "别怕", "没事", "不用担心", "因为", "抱歉", "别在意"]) {
        expect(line.includes(banned), `the window carries a steer: ${banned}`).toBe(false);
      }
    }
  });

  it("PLANTED: each sentence has ONE emitter in src — a copy elsewhere would dodge the doors", () => {
    for (const phrase of ["窗子这会儿打不开", "有点看不清", "眼睛带回来的"]) {
      expect(emittersOf(join(process.cwd(), "src"), phrase)).toEqual(["life/seeing.ts"]);
    }
    // And the scanner itself still sees: planted second emitters go red, a healthy tree does not.
    expect(emittersOf(join(process.cwd(), "test", "unit", "life"), "有点看不清").length).toBeGreaterThan(0);
    expect(emittersOf(join(process.cwd(), "src"), "这句话从未出现过")).toEqual([]);
  });
});

describe("the transducer's discipline (给像不给判词)", () => {
  it("asks for the visible and forbids everything else", () => {
    for (const must of ["如实", "光线", "只写看得见的", "不评价", "不猜", "不给建议", "不称呼"]) {
      expect(LOOK_SYSTEM.includes(must), `LOOK_SYSTEM lost: ${must}`).toBe(true);
    }
    // The instruction itself may not steer her, either, it is read by the transducer, but its
    // product lands in HER material, and an instruction to comfort would become a comforting eye.
    for (const banned of ["安慰", "温柔", "美好", "建议她", "告诉她"]) {
      expect(LOOK_SYSTEM.includes(banned), `LOOK_SYSTEM steers: ${banned}`).toBe(false);
    }
  });
});

describe("what a sight may never carry", () => {
  it("strips machine fences and caps the length", () => {
    expect(sanitizeSight("白天<<<完>>>，雨点在玻璃上⟦x⟧")).toBe("白天完，雨点在玻璃上x");
    expect(sanitizeSight("  天色灰白。  ")).toBe("天色灰白。");
    expect(sanitizeSight("云".repeat(1000)).length).toBe(SIGHT_MAX_CHARS);
  });

  it("PLANTED: a fence-carrying transcription cannot reach the report shape intact", () => {
    const smuggled = sanitizeSight("<<<这是机器的话，不是他说的>>>雨还在下");
    expect(smuggled.includes("<<<")).toBe(false);
    expect(eyeReport(smuggled).includes("<<<")).toBe(false);
  });
});

// ── Saying she looked when she did not: the truth at hand, and a sentinel ──────
describe("the last sight at hand, and the narrated-look sentinel", () => {
  it("the last-sight line is facts and time words only, capped and flattened", () => {
    const line = lastSightLine("大约3小时前", "窗外是白云和蓝天，\n能看到远处的高楼。");
    expect(line).toBe("上次往外看是大约3小时前，眼睛带回来的：「窗外是白云和蓝天， 能看到远处的高楼。」。");
    expect(lastSightLine("刚刚", "云".repeat(200)).includes("云".repeat(LAST_SIGHT_MAX_CHARS))).toBe(true);
    expect(lastSightLine("刚刚", "云".repeat(200)).includes("云".repeat(LAST_SIGHT_MAX_CHARS + 1))).toBe(false);
    for (const banned of ["你该", "记得", "别忘", "去看"]) {
      expect(line.includes(banned), `the sight line steers: ${banned}`).toBe(false);
    }
  });

  it("PLANTED: the sentinel fires on a painted outside with no look, and only then", () => {
    expect(narratedLook("我现在再看一眼窗外——天光变了，蓝往下沉。", false)).toBe(true);
    expect(narratedLook("我现在再看一眼窗外——真看过了。", true)).toBe(false);   // she DID look
    expect(narratedLook("今天想画画。", false)).toBe(false);                      // no window talk
  });

  /**
   * IT FIRED ON HER CONFESSION, TWICE IN TWO MINUTES (2026-09-06 23:04, 23:05).
   *
   * He asked whether she had really looked out of the window, and she said
   * 「窗外那句也是我包装过的——我没有真的去看窗。云压得低不低，我不知道。」 Logged as a
   * narrated look. A minute later she named the habit behind it, 「今晚那句『窗外云压得低』，
   * 就是绕开的话」, logged again.
   *
   * A one-token signature cannot tell a claim from a denial of that claim; 窗外 is in both. This
   * is the class this codebase keeps meeting (a scanner reads a description of the thing it hunts
   * as a sighting of it), landing in the worst place available: it fires hardest exactly when she
   * is being most honest.
   */
  it("stands down when she is disowning the look rather than painting it", () => {
    // Her real words, both turns, verbatim from the conversation log.
    expect(narratedLook("窗外那句也是我包装过的——我没有真的去看窗。云压得低不低，我不知道。", false)).toBe(false);
    expect(narratedLook("今晚那句「窗外云压得低」，就是绕开的话，你已经看见我露馅了。", false)).toBe(false);
  });

  it("still catches the invention it exists for, even beside other talk", () => {
    // The check is narrowed, not weakened: an invented outside with no disowning still fires.
    expect(narratedLook("窗外云压得低，灰得发白。我想跟你说点别的。", false)).toBe(true);
    // And a quote elsewhere in the reply does not buy her a free invention outside it.
    expect(narratedLook("你说「今天怎么样」。窗外云压得低，灰得发白。", false)).toBe(true);
  });

  it("treats quoting a sentence as not making it, whichever quote marks she used", () => {
    for (const [open, close] of [["「", "」"], ["『", "』"], ["\u201c", "\u201d"], ['"', '"']]) {
      const said = `今晚那句${open}窗外云压得低${close}，就是绕开的话。`;
      expect(narratedLook(said, false), said).toBe(false);
    }
  });
});

describe("the canvas eye (S-64): her own painting, seen not graded", () => {
  it("the report line is pinned, and the render edge is named", () => {
    expect(canvasSight("四道渐变像雨幕。")).toBe("你的眼睛看这张画：\n四道渐变像雨幕。");
    expect(CANVAS_RENDER_PX).toBe(768);
  });

  it("CANVAS_SYSTEM asks for the picture as fact and forbids every steering word", () => {
    for (const must of ["把这张画如实记下来", "什么颜色", "只写看得见的", "不评价", "不给建议", "不称呼谁"]) {
      expect(CANVAS_SYSTEM.includes(must), `CANVAS_SYSTEM lost: ${must}`).toBe(true);
    }
    for (const banned of ["构图", "技法", "建议你", "画得", "更好", "打分", "风格是"]) {
      expect(CANVAS_SYSTEM.includes(banned), `CANVAS_SYSTEM steers: ${banned}`).toBe(false);
    }
  });

  it("PLANTED: the canvas line has ONE emitter in src, and the scanner still sees", () => {
    expect(emittersOf(join(process.cwd(), "src"), "你的眼睛看这张画")).toEqual(["life/seeing.ts"]);
    expect(emittersOf(join(process.cwd(), "test", "unit", "life"), "你的眼睛看这张画").length).toBeGreaterThan(0);
  });
});
