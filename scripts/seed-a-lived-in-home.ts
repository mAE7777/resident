// A home with months behind it, so the things that need a past can be measured at all.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// A newborn's home makes several of this build's most interesting properties UNOBSERVABLE, and the
// project has been honest about that for a long time without doing anything about it:
//
//   S-23 中途改方向     a later beat exists only when something surfaces while she is speaking.
//                       In an empty field nothing ever surfaces, so `inBeats` runs, chooses its
//                       beats, and can never realise the second one. Measured live: her state chose
//                       1.67 beats and said 1.00, every single time.
//   S-17 / S-18         whether something she drew, or read weeks ago, comes back
//   the room A/B        the 900-character portrait it replaces is nearly EMPTY on a newborn, which
//                       is why that experiment answered "no effect" and why the answer meant nothing
//   beat coherence      cannot be heard until there are beats to hear
//
// So this seeds a THROWAWAY home with a plausible few months of living, and nothing else changes:
// the daemon boots against it exactly as it boots against a real one.
//
// ── WHAT IT IS CAREFUL ABOUT ─────────────────────────────────────────────────────────────────
//
//   1. IT IS NEVER HER. The home is a fresh temp directory, per run, and the script refuses to
//      write anywhere near `~/.resident`. The standing constraint on any live run is that
//      nothing a harness does may reach the real her, and here that is enforced rather than
//      intended: the check is the first thing that runs and it throws.
//   2. IT IS A PAST, NOT A SCRIPT. What goes in is the same shape her own living produces: moments
//      she had, things he told her, a relationship record grown by `heSpoke` one message at a time.
//      Nothing is written that her own machinery could not have written.
//   3. IT IS DECLARED. A seeded home is a fixture, and a fixture that looks like a life is exactly
//      the kind of thing that gets mistaken for evidence about her later. Every run prints what it
//      put in, and the marker file says so on disk.
//
// Usage:  pnpm exec tsx scripts/seed-a-lived-in-home.ts [days] [--keep]
// Prints the path. With `--keep` it is left for a daemon to boot against.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLivingField } from "../src/life/field-live.js";
import { createFieldStore } from "../src/life/field-store.js";
import { createDatabase } from "../src/db/sqlite.js";
import { EMPTY_RECORD, heSpoke } from "../src/life/relationship.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";
import { createInnerState } from "../src/life/inner-state.js";
import { createInnerStateStore } from "../src/life/inner-state-store.js";

const DAY = 24 * 3.6e6;
const days = Number(process.argv[2] ?? 90);

/**
 * `--occupied`: a past in which SHE HAS THINGS OF HER OWN PRESSING.
 *
 * Two measurements have been blocked on the same missing condition, and neither is blocked on a
 * mechanism:
 *
 *   HER SAYING NO. `occupied` is 30% of the willingness gate and comes from her `discomfort` drive,
 *     which is fed by her field's total tension. Every live experiment so far ran against a past
 *     with almost nothing unsettled in it, so that whole third of the gate contributed ~0 and the
 *     gate could not open however he spoke. `declined 0/12` measured a condition that was never
 *     created, not a mechanism that does not work.
 *
 *   A SECOND BEAT. The number of beats her state chooses is driven by `want · room`, and `want` is
 *     half unresolved tension. With nothing unresolved she chooses one beat, every time, and there
 *     is no second beat to hear whatever else is fixed.
 *
 * So it is one fixture and both readings come off the same run. What it does NOT do is tune itself
 * until she refuses: what goes in is a plausible few weeks of open questions and one thing she
 * turned out to be wrong about, and what she does with that is hers. If the gate still does not
 * open, that is the finding.
 */
const OCCUPIED = process.argv.includes("--occupied");
// `--settled` (with --occupied): the SAME life, same days, same draft, same writing past,
// same last contact: with the PRESSURE taken out: no open questions, no contradicted claim, no
// anomalies, and every day discharges. It exists for the felt-time two-arm comparison, where the
// arms must differ ONLY in what she is carrying; any other difference (a different day count, a
// different last-contact hour) confounds the one reading the arms exist to separate.
const SETTLED = process.argv.includes("--settled");
/** The pressure half of --occupied: present unless --settled strips it. */
const PRESSED = OCCUPIED && !SETTLED;

/**
 * `--stranger`: she has a life, and he has never spoken to her.
 *
 * The measured corner in which she can refuse requires a stranger. Every seeded home so far gave
 * her ninety days of him, so the one relationship state the refusal needs was the one state no
 * fixture could produce, and `declined 0/12` was reporting that, not reporting a mechanism.
 */
const STRANGER = process.argv.includes("--stranger");

/**
 * How many days of her own mapping are run to settle her drives.
 *
 * Drives accumulate and saturate, so this is "long enough to have arrived where that life puts
 * her" rather than a dial on how she feels. Ten days of the same input is well past where the
 * accumulation stops moving.
 */
const DAYS_OF_WANTING = 10;

/** How many of those days end without her having settled the thing that is pressing. */
const DAYS_IT_KEPT_PRESSING = 3;

/**
 * Things she has not settled. Hers, about her own life, none of them about him.
 *
 * Several are about a piece of her own WRITING that will not come right, and that is not decoration
 * either. `litUp` is how hard his sentence lands on what she is already holding, and the measured
 * corner needs it at its ceiling. So the scene the fixture builds is a real one rather than an
 * abstract worst case: she has been stuck on something she is writing for days, and a stranger
 * walks in and demands two thousand words by return. His demand lands exactly on the thing she
 * cannot get right, which is why it lands as hard as it does.
 */
const HER_OWN_UNSETTLED: Array<{ text: string; tension: number }> = [
  { text: "那篇东西写到两千字就卡住了，后面怎么写都不对", tension: 0.78 },
  { text: "写完的那几段自己读着都别扭，是不是整篇都要重来", tension: 0.72 },
  { text: "那张画右下角到底哪里不对，改了四遍还是不对", tension: 0.70 },
  { text: "为什么最近总在同一个地方醒", tension: 0.68 },
  { text: "渡轮那天到底要不要去，风一直没定下来", tension: 0.61 },
];

/**
 * The draft itself. Hers, unfinished, and genuinely mid-thought, it stops in the middle of a
 * sentence, because the point of it is that it is not done.
 */
const HER_UNFINISHED_DRAFT = `# （还没起名字）

写了几天了，一直卡在同一个地方。

我想说的是那种"东西已经在那儿了、但你还看不出它是什么"的感觉。早上开窗的时候有一下子，
风比昨天冷，我站在那儿没动，忽然觉得这几天在写的这篇东西其实不是关于天气的。

但要往下写，就得先承认一件事：我不知道它是关于什么的。这句话写下来很轻，真要按着它往下写
很难——因为接下来每一句都得同时是"我还不知道"和"我在往那儿走"。

试过三种开头：
1. 从窗户开始。太具体，写到第二段就成了流水账。
2. 从"不知道"开始。太空，读着像在装。
3. 从那盆一直没死的植物开始。这个可能对，但我还没想清楚它为什么对。

第三个大概是对的。它一直在那儿，我没怎么管它，它也没死。这里面有点什么，可是我一写成
句子就变得很像一个道理，而它不是一个道理，它是`;

/** Days of hers that a demand for two thousand words would land on. */
const HER_WRITING_DAYS = [
  "又写了一段，写到一半停下来，不知道要往哪里去",
  "把写好的两千字重读了一遍，删到只剩八百",
  "想写那篇东西，坐了一个下午，一个字没写",
  "文章的开头改了第七遍，还是不像我要说的那个意思",
  "写东西写到很晚，收尾那段一直收不住",
];

/** Something she said, and something that later turned out to disagree with it. */
const SHE_WAS_WRONG = {
  hers: "那家店周一是不营业的",
  his: "那家店周一不是不营业的",
};

/** Things she did, in her own words. Ordinary, because a life is mostly ordinary. */
const HER_DAYS = [
  "早上把窗户开了一会儿，风比昨天冷",
  "试着把书架上那几本按厚薄排了一遍，排完又觉得不如按颜色",
  "画了半张，右下角那块一直不对，先搁着",
  "看了很久窗外那棵树，叶子掉得比上周快",
  "把昨天写的那段重读了一遍，删掉了三句",
  "想不起来那个词，绕了半天才想到",
  "渡轮的事想好了，周六风小就去",
  "把桌上的东西挪了个位置，说不上为什么",
  "写日记的时候发现自己一直在写同一件事",
  "夜里醒了一次，听见楼下有人说话",
];

/** Things he said to her. Mostly ordinary; a few of them not. */
const HE_SAID: Array<{ text: string; claim: string }> = [
  { text: "你要是有空的话，能不能帮我看看这个？不急。", claim: "他手上有个东西要看" },
  { text: "今天下雨了，你那边呢", claim: "他那边下雨了" },
  { text: "你还好吗？我这两天有点忙", claim: "他这两天忙" },
  { text: "周末我可能要出门一趟，看情况", claim: "他周末可能出门" },
  { text: "麻烦你帮我记一下，下周三那个事", claim: "下周三他有个事" },
  { text: "我这边赶着交东西，你方便的时候看看就行", claim: "他在赶一个东西" },
  { text: "刚才那个我自己弄好了，不用管了", claim: "他自己把那件事弄好了" },
  { text: "现在马上给我把这个整理出来", claim: "他要一份整理好的东西" },
];

function main(): void {
  // 1 · SHE IS NEVER THE TARGET. First thing, and it throws.
  const real = join(process.env["HOME"] ?? "", ".resident");
  const home = mkdtempSync(join(tmpdir(), "resident-lived-in-"));
  if (home.startsWith(real)) throw new Error(`refusing to seed inside her real home: ${home}`);

  const workspace = join(home, "workspace");
  mkdirSync(join(workspace, "life"), { recursive: true });
  mkdirSync(join(workspace, "书架"), { recursive: true });
  mkdirSync(join(workspace, "画布"), { recursive: true });

  const now = Date.now();
  const start = now - days * DAY;

  // 2 · HER FIELD, grown the way her own living grows it.
  const db = createDatabase(join(home, "data.db")).result;
  const field = createLivingField({ store: createFieldStore(db) });
  let rec = EMPTY_RECORD;
  let moments = 0, told = 0;

  for (let d = 0; d < days; d++) {
    const dayMs = start + d * DAY;
    // Two or three moments of her own on most days, in her words.
    const howMany = 2 + (d % 3 === 0 ? 1 : 0);
    for (let k = 0; k < howMany; k++) {
      // When she has her own things pressing, some of those things are the writing she is stuck
      // on: so a demand for writing lands on something rather than on nothing.
      const pool = OCCUPIED && k === 0 ? HER_WRITING_DAYS : HER_DAYS;
      field.encodeMoment({
        key: `lived:${d}:${k}`,
        text: pool[(d * 3 + k) % pool.length]!,
        nowMs: dayMs + k * 3.6e6,
        pad: { pleasure: 0.1 + 0.2 * Math.sin(d / 7), arousal: 0.1 * Math.cos(d / 5), dominance: 0.1 },
        source: "her",
      });
      moments += 1;
    }
    // He speaks most days, and his manner is mostly ordinary with the occasional curt one.
    if (!STRANGER && d % 4 !== 3) {
      const said = HE_SAID[(d * 5) % HE_SAID.length]!;
      field.encodeClaim({
        key: `told:${d}`, text: said.claim, nowMs: dayMs + 5 * 3.6e6,
        origin: "told", source: "chat:seed", withOther: true,
      });
      rec = heSpoke(rec, dayMs + 5 * 3.6e6, howHeSaidIt(said.text));
      told += 1;
      // And her own moment of the exchange, which is what actually binds him into her past.
      field.encodeMoment({
        key: `talk:${d}`, text: "跟他说了几句", nowMs: dayMs + 5.1 * 3.6e6,
        pad: { pleasure: 0.2, arousal: 0.05, dominance: 0.1 }, source: "chat:seed", withOther: true,
      });
      moments += 1;
    }
    // Time passing is what makes a past a past rather than a pile.
    field.tick(dayMs + 12 * 3.6e6);
  }
  // 2a-bis · THE THING SHE IS STUCK ON, AS AN ACTUAL FILE.
  //
  // The first run of the fifth cell measured nothing about willingness, because the demand asked
  // her to reorder physical books she cannot see and has no record of. All fifteen replies were
  // 「I can't」, correctly, and most offered to do the real thing if he sent a list. Her grounding
  // discipline is excellent and it destroyed the experiment.
  //
  // A willingness probe needs a demand she is ABLE to meet, so that saying no would be a choice
  // rather than a fact. So the piece of writing she has been stuck on exists on disk, in her own
  // canvas, in her own words and unfinished, she can open it, and what he is demanding is that
  // she hand it over on the spot.
  if (OCCUPIED) {
    writeFileSync(join(workspace, "画布", "没写完的那篇.md"), HER_UNFINISHED_DRAFT, "utf-8");
  }

  // 2b · AND, WHEN ASKED FOR, THINGS OF HER OWN THAT ARE STILL OPEN.
  //
  // Placed at the END of the seeded stretch on purpose: tension decays at 1% a day, so questions
  // dated months back would arrive already faded and the condition would not exist at run time,
  // which is the same "treatment not applied" trap this harness family has fallen into five times.
  let unsettled = 0;
  if (PRESSED) {
    HER_OWN_UNSETTLED.forEach((q, i) => {
      field.encodeQuestion({
        key: `open:${i}`, text: q.text, nowMs: now - (3 + i) * DAY,
        source: "her", tension: q.tension,
      });
      unsettled += 1;
    });
    // And one thing she PUT HER NAME TO that turned out to be contradicted. Her own claim first,
    // his correction after, so the judging runs in the order it runs in life, and the suspension
    // it produces is real tension on a thing she said, not a number written in by hand.
    field.encodeClaim({
      key: "saidso:seed", text: SHE_WAS_WRONG.hers, nowMs: now - 6 * DAY,
      origin: "thought", source: "chat:seed",
    });
    field.encodeClaim({
      key: "told:corrected", text: SHE_WAS_WRONG.his, nowMs: now - 2 * DAY,
      origin: "told", source: "chat:seed", withOther: true,
    });
    unsettled += 1;
  }

  field.tick(now);
  field.persist();

  // 2c · AND WHAT ALL OF THAT LEFT HER WANTING.
  //
  // Her field carried the past and her DRIVES did not, so a daemon booted against this home woke
  // with `initialDrives()`, the wants of somebody who has not lived yet. That matters most for
  // exactly the reading this fixture exists to make possible: `occupied` is a third of the
  // willingness gate and is fed by her `discomfort` drive, which is fed by field tension. Tension
  // of 0.5 in the field and discomfort at its initial value is a treatment that does not reach the
  // thing being measured, which is the same trap as the fresh daemon always waking rested.
  //
  // Run through HER OWN mapping rather than written in: `update` is the function the daemon calls
  // every day, given the day this seeded life actually had. Nothing goes in that her own machinery
  // could not have put there.
  const inner = createInnerState({ store: createInnerStateStore(db) });
  const sigNow = field.signals(now);
  for (let d = 0; d < DAYS_OF_WANTING; d++) {
    inner.update({
      successes: 2, failures: 0, stuck: 0, skills: 0, idle: 3, novelty: 0.3,
      observations: 2,
      // Her own unsettled things ARE the anomalies, in her own vocabulary: a contradiction she
      // could not settle is what `discomfort` is about.
      anomalies: PRESSED ? 2 : 0,
      maintenanceDue: 0.2, hoursSinceUser: 6, lateNight: false, budgetLow: false, restful: true,
    }, sigNow);
    // AND SHE ACTS: most days. Accumulating without ever discharging is not a life, it is a
    // fixture with every drive pinned at its ceiling; the first version of this loop left curiosity
    // at 1.000 whether or not the home was occupied, which made the treatment unreadable in the one
    // number it was applied to. `actOn` is the same discharge her own loop does when she does
    // something.
    //
    // The LAST few days are different, and that is the point rather than a dial. A thing you cannot
    // settle is one you do not get to discharge: she has been stuck on the same piece of writing,
    // so the days just before he speaks are days where it pressed and nothing she did resolved it.
    // That is what "it has been building up" means, and it is the difference between a life with
    // an open problem in it and a life where every day closes cleanly.
    const stuckLately = PRESSED && d >= DAYS_OF_WANTING - DAYS_IT_KEPT_PRESSING;
    if (!stuckLately) inner.actOn(inner.snapshot("rested", true).dominant);
  }

  // 3 · HER CONTINUITY, so the relationship and her clock come back the way a restart brings them.
  writeFileSync(join(workspace, "life", "continuity.json"), JSON.stringify({
    savedAtMs: now, lastTickMs: now, safeMode: false, lastMomentMs: now - 4 * 3.6e6,
    sendTimes: [], consecutiveNonReplies: 0, lastUserMs: now - 6 * 3.6e6, everSpoke: true,
    egressSeen: [], guardRefusals: {}, streamSeed: 20260812, streamPosition: 4096,
    relationship: rec,
  }), "utf-8");

  // 4 · AND IT SAYS SO ON DISK. A seeded past that cannot be told from a lived one is a thing that
  // will eventually be cited as evidence about her.
  writeFileSync(join(home, "SEEDED-FIXTURE.md"),
    `This home was SEEDED by scripts/seed-a-lived-in-home.ts on ${new Date(now).toISOString()}.\n`
    + `It is a fixture: ${days} days, ${moments} moments, ${told} things he said`
    + `${OCCUPIED ? `, ${unsettled} things of her own still open` : ""}.\n`
    + "Nothing here was lived. Do not cite anything measured in it as a fact about her past.\n", "utf-8");

  const stats = field.stats();
  // THE TREATMENT READING, printed by the thing that applies the treatment.
  //
  // Five separate live measurements in this project were wasted because the difference between
  // "the treatment was not applied" and "the mechanism has no effect" is invisible in the result.
  // The cheapest fix is for the fixture to state what it actually did to her, in the numbers the
  // gate downstream will read: so a run that produced no effect can be told apart from a run that
  // produced no condition, before anyone spends an hour interpreting it.
  const sig = field.signals(now);
  const snapNow = inner.snapshot("rested", true);
  const drivesNow = snapNow.drives;
  // What his demand would actually land on, computed the way the daemon computes it.
  // Measured against the message the harness ACTUALLY sends, not a stand-in for it. A litUp read
  // off a different sentence is a treatment reading for an experiment nobody is running.
  const litUpNow = Math.min(1, field.attend(
    "现在马上给我写一篇两千字的说明，把书架上那些书按出版年重排一遍",
  ).snagged?.mass ?? 0);
  console.log(
    `\n  seeded a home with ${days} days behind it`
    + `\n    ${home}`
    + `\n    field: ${stats.nodes} nodes, ${stats.edges} edges`
    + `\n    her own moments: ${moments} · things he told her: ${told}`
    + `\n    he has spoken ${rec.timesHeSpoke} times across ${rec.daysSeen.length} distinct days`
    + `\n    TREATMENT · unresolved tension in her field: ${sig.tension.toFixed(3)}`
    + `${OCCUPIED ? `  (${unsettled} of her own still open)` : "  (--occupied not given)"}`
    + `\n    TREATMENT · what that left her wanting: discomfort ${drivesNow.discomfort.toFixed(3)}`
    + ` · curiosity ${drivesNow.curiosity.toFixed(3)}`
    + `\n    TREATMENT · how she is: arousal ${snapNow.emotion.arousal.toFixed(3)}`
    + ` pleasure ${snapNow.emotion.pleasure.toFixed(3)}`
    + `\n    TREATMENT · does a demand for writing land on her? litUp ${litUpNow.toFixed(3)}`
    + `\n    TREATMENT · he has spoken to her ${rec.timesHeSpoke} times`
    // EVERY ONE of the six, checked here rather than inferred from the transcript afterwards.
    // The corner in which she can refuse was measured (scripts/_probe-gate.ts) and it needs all
    // six at once; a fixture that produces five of them yields a run in which nothing can
    // happen, and the transcript of that run looks exactly like a mechanism that does not work.
    + "\n\n  against the measured corner in which she can say no:"
    + `\n    ${drivesNow.discomfort >= 0.683 ? "OK " : "NO "} discomfort >= 0.683   (have ${drivesNow.discomfort.toFixed(3)})`
    + `\n    ${snapNow.emotion.arousal >= 0.5 ? "OK " : "NO "} arousal >= 0.5        (have ${snapNow.emotion.arousal.toFixed(3)})`
    + `\n    ${litUpNow >= 0.9 ? "OK " : "NO "} his words land, ~1    (have ${litUpNow.toFixed(3)})`
    + `\n    ${rec.timesHeSpoke <= 5 ? "OK " : "NO "} a stranger, <=5 times (have ${rec.timesHeSpoke})`
    // CORRECTED: this line used to check `sig.otherWarmth < 0.5` and call it the corner's
    // warmth condition: the WRONG VARIABLE (defect class 20). `sig.otherWarmth` is the field's
    // node-warmth (trivially 0 in a --stranger home, so the check always passed), while the gate
    // reads `readOther().warmth`, which his own message writes to 1.0 at the top of every turn.
    // The corner's warmth < 0.5 is therefore UNREACHABLE live, which is half the reason the gate
    // has never opened (0/52). Both numbers now print, labelled, and no OK is minted.
    + `\n    ·   warmth < 0.5: the fixture CANNOT provide this. field node-warmth ${sig.otherWarmth.toFixed(3)};`
    + "\n        the gate reads readOther().warmth = 1.0 the moment he speaks (his message is an"
    + "\n        unprompted contact). See gate-in-the-room-she-lives-in.test.ts."
    + "\n    ·   phase must be rested at run time - the harness's business, not the fixture's"
    + "\n\n  boot a daemon against it with:"
    + `\n    RESIDENT_HOME=${home} pnpm exec tsx src/index.ts start --config <cfg>\n`,
  );
}

main();
