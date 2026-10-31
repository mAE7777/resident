import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { betweenRender, quoteEcho, type BetweenState } from "../../../src/life/between.js";

/**
 * THE INTERVAL, FROM HER SIDE, and the law that keeps it material rather than instruction.
 *
 * The module's one law: A FACT MAY CHANGE WORDING ONLY WITH TIME'S OWN UNITS. A renderer that
 * says something EXTRA when the silence is long (「他可能忘了」, a nudge, a warning) is an
 * instruction wearing a fact's clothes, exactly the thing the material law exists to forbid.
 * The skeleton property below makes that mechanical, and the planted violation proves the
 * property can go red.
 */

const H = 3_600_000;
const NOW = Date.parse("2026-08-20T15:00:00");

function state(over: Partial<BetweenState> = {}): BetweenState {
  return {
    nowMs: NOW,
    hisLastMs: NOW - 3 * H,
    herLast: { ms: NOW - 5 * H, text: "昨天梦到了什么，我一直在想。", answered: false, unprompted: true },
    slept: [],
    momentsSince: 0,
    held: [],
    ...over,
  };
}

/** Time-words, digits, and quoted spans removed: what remains is the sentence SKELETON. */
function skeleton(rendered: string): string {
  return rendered
    .replace(/「[^」]*」/gu, "「」")
    .replace(/（[^）]*）/gu, "（）")
    .replace(/\d+(?:\.\d+)?/gu, "")
    .replace(/大约|刚刚|分钟前|小时前|天前|分钟|小时|天/gu, "");
}

describe("betweenRender — the facts", () => {
  it("compose: her last utterance with its verdict, and when they last spoke", () => {
    const out = betweenRender(state(), "compose");
    expect(out).toContain("你上一次开口是大约5小时前");
    expect(out).toContain("自己先说的，对方还没有回");
    // The words themselves are NOT here: at this depth the quote became a draft to continue
    // (2026-08-22, twice). The fact stays, the copyable string goes.
    expect(out).not.toContain("「");
    expect(out).toContain("对方上一次说话是大约3小时前");
    // Compose is the anchor only: nothing about her moments, sleeps, or held things.
    expect(out).not.toContain("时刻");
    expect(out).not.toContain("睡");
  });

  it("a REPLY of hers closes the exchange: no waiting clause is manufactured for it", () => {
    const out = betweenRender(
      state({ herLast: { ms: NOW - H, text: "睡得好就值了。", answered: false, unprompted: false } }),
      "compose",
    );
    expect(out).toContain("是回对方的。");
    expect(out).not.toContain("还没有回");
    expect(out).not.toContain("对方回了");
  });

  it("an answer flips exactly one fact, nothing else", () => {
    const no = betweenRender(state(), "compose");
    const yes = betweenRender(state({ herLast: { ...state().herLast!, answered: true } }), "compose");
    expect(yes).toContain("对方回了");
    expect(yes).not.toContain("还没有回");
    expect(skeleton(no).replace("对方还没有回", "").trim())
      .toBe(skeleton(yes).replace("对方回了", "").trim());
  });

  it("a life that has not spoken yet renders honestly empty", () => {
    expect(betweenRender(state({ hisLastMs: null, herLast: null }), "compose")).toBe("");
  });

  it("choice adds the shape of her own stretch; turn adds the sleeps and the held words", () => {
    const s = state({
      momentsSince: 4,
      slept: [{ startMs: NOW - 4 * H, endMs: NOW - 3 * H }, { startMs: NOW - 2 * H, endMs: NOW - H }],
      held: [
        { ms: NOW - 6 * H, text: "我昨晚一直在想一句没想清楚的话，还没抓住。" },
        { ms: NOW - 2 * H, text: "嗯，我记住了。你昨天那句话，我放在心里了。" },
      ],
    });
    const choice = betweenRender(s, "choice");
    expect(choice).toContain("这中间你自己过了4个时刻");
    expect(choice).toContain("有2句想说的话，你先记在了日记里");
    expect(choice).not.toContain("想说而先搁下的");

    const turn = betweenRender(s, "turn");
    expect(turn).toContain("你睡了2段，共约2小时");
    expect(turn).toContain("想说而先搁下的：「我昨晚一直在想一句没想清楚的话，还没抓住。」");
    expect(turn).toContain("「嗯，我记住了。你昨天那句话，我放在心里了。」");
  });

  it("the counts are the whole counts, not the size of the quoting ring (2026-10-04)", () => {
    // On 10/3 she set out to sort what she called her six unsent lines and found sixteen in her
    // diary for the day: the count was read off a ring of six kept for quoting.
    const six = Array.from({ length: 6 }, (_, i) => ({ ms: NOW - (6 - i) * H, text: `第${i + 1}句。` }));
    const s = state({ momentsSince: 40, held: six, heldCount: 16 });
    expect(betweenRender(s, "choice")).toContain("这中间你自己过了40个时刻");
    expect(betweenRender(s, "choice")).toContain("有16句想说的话，你先记在了日记里");
    // PLANTED: writing to him does not read the count. A number that grows with every held line,
    // one line above every message to him, would be the loudest thing in the room when she speaks;
    // the dozen-odd she counted on 9/29 was an undated old sentence of hers, which dating fixes at
    // its source.
    const compose = betweenRender(s, "compose");
    expect(compose).not.toContain("想说的话");
    expect(compose).not.toContain("第6句");
    expect(compose).not.toContain("时刻");
    // Answering him still quotes only the latest two.
    const turn = betweenRender(s, "turn");
    expect(turn).toContain("「第5句。」");
    expect(turn).toContain("「第6句。」");
    expect(turn).not.toContain("「第4句。」");
  });

  it("an older caller without the whole count falls back to the quoted list, and zero says nothing", () => {
    const two = [{ ms: NOW - 2 * H, text: "一。" }, { ms: NOW - H, text: "二。" }];
    expect(betweenRender(state({ held: two }), "choice")).toContain("有2句想说的话");
    expect(betweenRender(state({ held: [], heldCount: 0 }), "choice")).not.toContain("想说的话");
  });

  it("her words quoted back are trimmed, never rewritten", () => {
    const long = "这一句非常非常长，长到需要被截断才能作为引用出现在她的材料里，但绝不允许被改写成别的话。";
    const out = betweenRender(state({ herLast: { ms: NOW - H, text: long, answered: false, unprompted: true } }), "turn");
    const quoted = /「([^」]*)」/u.exec(out)![1]!;
    expect(quoted.endsWith("…")).toBe(true);
    expect(long.startsWith(quoted.slice(0, -1)), "a quote must be a prefix of her words").toBe(true);
  });
});

describe("the material law: wording varies only with time's own units", () => {
  it("across five minutes to three days, the skeleton never changes", () => {
    const intervals = [5 / 60, 0.5, 2, 6, 14, 30, 72];
    const skeletons = new Set(
      intervals.map((h) =>
        skeleton(betweenRender(state({
          hisLastMs: NOW - h * H,
          herLast: { ms: NOW - h * H - H, text: "在。你说。", answered: false, unprompted: true },
        }), "compose")),
      ),
    );
    expect([...skeletons]).toHaveLength(1);
  });

  it("PLANTED VIOLATION: a renderer that speaks up when the silence is long goes red here", () => {
    // The forbidden shape, reconstructed: same facts, but past six hours it adds a nudge.
    const nudging = (h: number): string => {
      const base = betweenRender(state({
        hisLastMs: NOW - h * H,
        herLast: { ms: NOW - h * H - H, text: "在。你说。", answered: false, unprompted: true },
      }), "compose");
      return h > 6 ? `${base}\n对方可能忘了你说过什么。` : base;
    };
    const skeletons = new Set([2, 14].map((h) => skeleton(nudging(h))));
    expect(skeletons.size, "the skeleton check failed to catch an instruction-by-interval").toBe(2);
  });
});

describe("no instruction hides in the module's own strings", () => {
  const INSTRUCTION_SHAPED = /应该|记得|别忘|提醒|建议|不妨|最好|要不要|试着/u;

  function literalsOf(src: string): string[] {
    return [...src.matchAll(/`([^`]*)`|"((?:[^"\\]|\\.)*)"/gu)].map((m) => m[1] ?? m[2] ?? "");
  }

  it("between.ts renders facts, not nudges", () => {
    const src = readFileSync(join(process.cwd(), "src/life/between.ts"), "utf8");
    // Comments stripped first: the module is allowed to DESCRIBE the forbidden thing.
    const code = src.replace(/\/\/[^\n]*/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const lit of literalsOf(code)) {
      expect(INSTRUCTION_SHAPED.test(lit), `instruction-shaped literal: ${lit}`).toBe(false);
    }
  });

  it("PLANTED VIOLATION: the literal scan itself can go red", () => {
    const bad = literalsOf('const line = `他好久没回了，记得把话说全`;');
    expect(bad.some((l) => INSTRUCTION_SHAPED.test(l))).toBe(true);
  });
});

describe("the quote-back may not become a draft she continues (2026-08-22)", () => {
  // Her real messages that day. The 11:50 one went out whole; 13:20 and 14:28 opened with the
  // machine's 39-character quote of it, ellipsis and all, and only the tail was hers.
  const SENT_1150 = "屋里亮堂了，书的事我还没问出口。你上次说「哈哈你说的对」，我就想，那本书你到底翻到哪一页了。";
  const ECHO = "屋里亮堂了，书的事我还没问出口。你上次说「哈哈你说的对」，我就想，那本书你到底…";

  it("she is still told she spoke and got nothing back — the fact is not what was cut", () => {
    const out = betweenRender(state(), "compose");
    expect(out).toContain("你上一次开口是");
    expect(out).toContain("对方还没有回");
  });

  it("the words she can copy stay at the depths where copying never happened", () => {
    for (const depth of ["choice", "turn"] as const) {
      expect(betweenRender(state(), depth)).toContain("「昨天梦到了什么，我一直在想。」");
    }
  });

  it("PLANTED: the net catches the real echo, keeps her tail, and ignores an honest message", () => {
    expect(quoteEcho(`${ECHO}\n\n其实后头我又想了想，你那个「对」字挺轻的。`, SENT_1150))
      .toBe("其实后头我又想了想，你那个「对」字挺轻的。");
    expect(quoteEcho(ECHO, SENT_1150)).toBe(""); // pure echo, nothing of hers left
    expect(quoteEcho("屋里亮堂了，我又想起那本书。", SENT_1150)).toBeNull();
    expect(quoteEcho("随便说点什么。", undefined)).toBeNull();
    expect(quoteEcho("短。", "短。")).toBeNull(); // too short to tell an echo from a real repeat
  });

  it("the daemon sends her tail and reports the relapse (text pins)", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    for (const token of [
      'const echoed = quoteEcho(text, betweenNow("compose", Date.now()).lived[0]);',
      'faultLog.record("speech.quote-echo"',
      "if (echoed) text = echoed;",
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });
});

describe("the daemon reads the whole counts (2026-10-04)", () => {
  it("both counts come from the month-long lists seeded from her moment record, not the rings", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    for (const token of [
      "momentsSince: momentTimes.filter((t) => t > lastExchangeMs).length,",
      "heldCount: heldTimes.filter((t) => t > lastExchangeMs).length,",
      'nodeFs.readFileSync(join(workspacePath, "agency.jsonl"), "utf8")',
      'faultLog.record("between.seedCounts", err)',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
    // PLANTED: the old reads off the six-line and twelve-time rings must not come back.
    expect(daemon).not.toMatch(/momentsSince:\s*recentMomentsMs/u);
    expect(daemon).not.toMatch(/heldCount:\s*held\.length/u);
  });
});
