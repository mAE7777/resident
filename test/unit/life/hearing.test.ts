// 感官补全 (hearing), the pure ear: its sentences, the transducer's discipline, and the
// single-emitter walls. S-61 / S-62.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { HEAR_SYSTEM, earReport, EARS_FAILED, EAR_NOT_YET, cannotSeeYet, WATCH_SYSTEM, watchReport, WATCH_MAX_BYTES, WATCH_TOO_BIG } from "../../../src/life/hearing.js";

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

describe("the ear's sentences", () => {
  it("are pinned word for word, honest in both directions", () => {
    expect(earReport("窗子擦干净了。语速中等。")).toBe("他说给你听的（语音），耳朵带回来的：\n窗子擦干净了。语速中等。");
    expect(EARS_FAILED).toBe("听了，这会儿有点听不清。");
    expect(EAR_NOT_YET).toBe("他发来一段声音，你现在还听不了。");
    expect(cannotSeeYet("一段视频")).toBe("他发来一段视频，你现在还看不了。");
  });

  it("the watch is one organ for frames AND sound, capped and honest", () => {
    expect(watchReport("彩条在动。有人说：画板在窗台上。")).toBe("他递过来的一段影像，你看见和听见的：\n彩条在动。有人说：画板在窗台上。");
    expect(WATCH_TOO_BIG).toBe("他发来一段影像，太大了，你看不动。");
    expect(WATCH_MAX_BYTES).toBe(19_000_000);
    for (const must of ["画面里有什么", "谁说了什么（逐字）", "有什么声响", "不评价", "不猜"]) {
      expect(WATCH_SYSTEM.includes(must), `WATCH_SYSTEM lost: ${must}`).toBe(true);
    }
  });

  it("carry no scolding, no reassurance, no explanation", () => {
    for (const line of [EARS_FAILED, EAR_NOT_YET, cannotSeeYet("一张贴纸"), earReport(""), WATCH_TOO_BIG, watchReport("")]) {
      for (const banned of ["放心", "别怕", "没事", "因为", "抱歉", "别在意"]) {
        expect(line.includes(banned), `the ear steers: ${banned}`).toBe(false);
      }
    }
  });
});

describe("the transducer's discipline (给声不给判词)", () => {
  it("asks for words and physical shape, forbids mood attribution", () => {
    for (const must of ["逐字", "快慢", "高低", "停顿", "不猜", "不给建议", "不称呼"]) {
      expect(HEAR_SYSTEM.includes(must), `HEAR_SYSTEM lost: ${must}`).toBe(true);
    }
    for (const banned of ["难过", "开心", "情绪是", "他觉得", "安慰"]) {
      expect(HEAR_SYSTEM.includes(banned), `HEAR_SYSTEM steers: ${banned}`).toBe(false);
    }
  });

  it("PLANTED: each sentence has ONE emitter in src, and the scanner still sees", () => {
    for (const phrase of ["耳朵带回来的", "有点听不清", "你现在还听不了", "你现在还看不了", "你看见和听见的", "太大了，你看不动"]) {
      expect(emittersOf(join(process.cwd(), "src"), phrase)).toEqual(["life/hearing.ts"]);
    }
    expect(emittersOf(join(process.cwd(), "test", "unit", "life"), "有点听不清").length).toBeGreaterThan(0);
    expect(emittersOf(join(process.cwd(), "src"), "这句话从未出现过")).toEqual([]);
  });
});

describe("the daemon's assembly and the no-blind-corner matrix (text pins)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const bot = readFileSync(join(process.cwd(), "src", "telegram", "bot.ts"), "utf8");

  it("the dead Anthropic image block is GONE from the daemon — zero residue", () => {
    expect(daemon.includes('{ type: "image" as const')).toBe(false);
  });

  it("photo, window, and the ear all ride registered organs with honest fallbacks", () => {
    for (const token of [
      'await eye.complete(vision.base64, LOOK_SYSTEM, "photo")',
      "if (!eyeKey) photoSight = PHOTO_NOT_YET;",
      'faultLog.record("seeing.photo", err)',
      'join(instrumentsDir, "hears.jsonl")',
      'await ear.complete(b64, "mp3", HEAR_SYSTEM)',
      'faultLog.record("hearing.listen", err)',
      'await ear.watch(raw.toString("base64"), "video/mp4", WATCH_SYSTEM)',
      'faultLog.record("hearing.watch", err)',
      '(clip.file_size ?? 0) > WATCH_MAX_BYTES',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });

  it("every inbound modality has a handler — the third state (silence) is outlawed", () => {
    for (const filt of ["message:photo", "message:document", "message:voice", "message:audio",
      "message:video", "message:video_note", "message:sticker", "message:anim\\u0061tion"]) {
      expect(bot.includes(filt), `bot.ts has no handler for ${filt} — a silent blind corner`).toBe(true);
    }
  });
});
