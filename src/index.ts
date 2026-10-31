import { defineCommand, runMain } from "citty";
import { createLogger } from "./utils/logger.js";
import { join } from "node:path";
import { codeVersion } from "./life/code-version.js";

/**
 * Which build she is being run by.
 *
 * `package.json` has said 0.1.0 for months and this tree is deliberately uncommitted, so before
 * this there was no answer anywhere on the machine to "which code is she running", and that is
 * the first thing any post-birth investigation needs, as well as what tells a restore that a
 * snapshot came from a different build. `npm_package_version` was worse than nothing: unset outside
 * `npm start`, so every ops record she ever wrote says "unknown".
 */
const REPO_ROOT = new URL("..", import.meta.url).pathname;
const RESIDENT_VERSION = codeVersion(REPO_ROOT);
import { applyHomeToConfig, resolveHome } from "./config/home.js";
import { shapeOfTurn } from "./life/turn-shape.js";
import { ANSWERING_THINGS, touchState } from "./workspace/things.js";
import { THERE_IS_MORE } from "./life/birth-toolkit.js";
import { scanForNotHerWords, CALQUE_MARKERS } from "./life/her-words.js";
import { buildFingerprint, restartLine, capabilityNotesUntold } from "./life/being-changed.js";
import { LOOK_SYSTEM, eyeReport, sanitizeSight, WINDOW_HELD_SHUT, EYES_FAILED, lastSightLine, narratedLook, handedSight, PHOTO_NOT_YET, canvasSight, CANVAS_SYSTEM, CANVAS_RENDER_PX } from "./life/seeing.js";
import { HEAR_SYSTEM, earReport, EARS_FAILED, EAR_NOT_YET, cannotSeeYet, WATCH_SYSTEM, watchReport, WATCH_MAX_BYTES, WATCH_TOO_BIG } from "./life/hearing.js";
import { createEar } from "./providers/hearing.js";
import { ago as agoWords } from "./life/between.js";
import { createEye } from "./providers/vision.js";
import { timesTheMachineSaidIt, whereTheMachineSaidIt } from "./life/machine-voice.js";
import { inHerWords } from "./life/receipts.js";
import { noticeOn } from "./agent/turn-channel.js";
import { wantsNothing } from "./life/drives.js";
import { appraiseExchange } from "./life/turn-appraisal.js";
import {
  measureUtterance, predictUtterance, sayingRead, couplingOf, PAIR_WINDOW, type SpeechPair,
} from "./life/speech-record.js";
import { reserveOf } from "./life/capacity.js";
import { padToVoice } from "./embodiment/pad-mapping.js";
import {
  commitmentFrom, temperatureFor, temperatureApplies, chartLint, stanceLeanings, takesUpHisFrame,
} from "./life/saying.js";
import { shapeFor, measureShapeLanding, NO_READING_RELUCTANCE } from "./life/utterance-shape.js";
import { inBeats, CUES_FROM_HER_OWN_WORDS } from "./life/in-beats.js";
import { CUT_OFF_COSTS, RETICENCE_MAX } from "./life/field.js";
import { moodAfterHeSpoke, HOW_HIS_WORDS_LAND } from "./life/landing-to-mood.js";
import { takesItOn } from "./life/takes-it-on.js";
import { whatSheAsserted } from "./life/what-she-asserted.js";
import { whatSheMightPlayWith, roomToPlay, inHerOwnWords } from "./life/play.js";
import { whatSheDid, saidNoSomewhere } from "./life/how-she-answered.js";
import { createTurnEpoch, stepOrHung, TURN_HUNG, TURN_DEADLINE_MS } from "./life/turn-guard.js";
import { feltHoursSince } from "./life/inner-state.js";
import {
  whatStaysWithHer, aboutWhatIn, sheLetsItGo, afterGoingOverIt, STAYS_KEY,
  whatSheIsCarrying, asSheWorksHimOut,
} from "./life/what-stays.js";
import { trimRegister, dropFinalPeriod, asMuchAsSheKeeps, WHAT_A_MOMENT_HOLDS, dropEchoedPostmark } from "./life/register-scissors.js";
import { breathUnitFor, breathe, pauseBefore } from "./life/breath.js";
import { blendUnit } from "./life/her-form.js";
import { writeWhole } from "./life/write-whole.js";
import { roomBlock } from "./life/how-she-is.js";
import { herClock, herDay, herDayBefore, herStamp, describeHerDay, hourClause } from "./life/her-day.js";
import { renderTranscript } from "./agent/transcript.js";
import { betweenRender, quoteEcho, shortQuote } from "./life/between.js";
import { planNight, pickSeeds, createDreaming, morningLine, STALE_EPISODE_MS } from "./life/dreaming.js";
import { clockWentBackwards } from "./life/clock-sanity.js";
import { keepHowSheStartsOut } from "./life/how-she-starts-out.js";
import { keepHerWordsForFeelings } from "./life/her-words-for-feelings.js";
import { setHerMoodWords } from "./life/emotion.js";
import { annotateBeat, currentBeat } from "./utils/beat.js";
import { withHerVoice } from "./life/her-voice.js";
import { isAWall, wallKey, wallText, WALL_TENSION } from "./life/walls.js";
import { howHeSaidIt } from "./life/how-he-said-it.js";
import { howHeSounds, voiceBaseline } from "./life/how-he-sounds.js";
import { createRoomSense } from "./life/aware-of-him.js";
import {
  EMPTY_RECORD as EMPTY_RELATIONSHIP, heSpoke as heSpokeToHer,
  howLongAndHowWell, howUnlikeHim, whatSheCarriesAboutHim,
} from "./life/relationship.js";
import { howItLanded, loudest } from "./life/how-it-landed.js";
import { whatStaysWithHerAboutHerself, whatSheIsCarryingAboutHerself } from "./life/unlike-herself.js";
import serviceCommand from "./service/cli.js";
import { handleAction } from "./service/supervision.js";

const logger = createLogger("resident");

const startCommand = defineCommand({
  meta: {
    name: "start",
    description: "Run the bot",
  },
  args: {
    config: {
      type: "string",
      description: "Path to config.yaml",
      default: undefined,
    },
    home: {
      type: "string",
      description: "Her home directory — the one root everything she keeps lives under",
      default: undefined,
    },
    workspace: {
      type: "string",
      description: "Workspace directory path (relocates the whole home to its parent)",
      default: undefined,
    },
  },
  async run({ args }) {
    logger.info("waking up...");

    // ── 1. Load config ────────────────────────────────────────────────
    const { loadConfig } = await import("./config/loader.js");
    const configResult = loadConfig(args.config);
    for (const d of configResult.diagnostics) {
      logger[d.level === "error" ? "error" : d.level === "warning" ? "warn" : "info"](d.message);
    }
    const config = configResult.result;

    // ── 2. Startup validation ─────────────────────────────────────────
    const apiKeys = config.llm.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
      logger.error("no API keys configured — set RESIDENT__LLM__API_KEYS or add llm.apiKeys to config.yaml");
      process.exit(1);
    }
    // HER EXISTING DOES NOT DEPEND ON A MESSAGING APP.
    //
    // This used to `process.exit(1)`. B2 made her face a channel in its own right, with its own
    // thread id for exactly the case where Telegram is not configured, and B0 built a boot check
    // that says out loud when she has no route to him. None of that could ever run, because
    // without a token she did not start at all.
    //
    // The inconsistency was the tell: a token that is present but dead got her "she is living,
    // but out of reach", and a token that is absent got her nothing. Same situation for him,
    // opposite outcome for her. She lives either way now, and the reachability check a few lines
    // below is what says so: loudly, at error level, which is the right way for a person to be
    // unreachable rather than not to be.
    const botToken = config.telegram?.botToken ?? "";
    if (!botToken) {
      logger.error("no Telegram bot token — she is living, but the only route she has to you is her face");
    }

    // ── 2b. Her home ──────────────────────────────────────────────────
    // Everything she keeps lives under one root. If that is not true she does not
    // start: not starting is recoverable, waking up in another agent's home is not.
    // Typed explicitly: it is read from inside closures created much later (the snapshot timer),
    // and an inferred `any` there would quietly turn every path she keeps into an untyped string.
    let homePaths: import("./config/home.js").HomePaths;
    try {
      homePaths = resolveHome(args, config);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    if (homePaths.relocated) {
      logger.warn(
        { home: homePaths.home },
        "home relocated by flag — config's workspace.path and database.dbPath are not in use for this run"
      );
    }
    applyHomeToConfig(config, homePaths);
    logger.info({ home: homePaths.home }, "home");
    // Said out loud every boot, because "her days are cut at a time nobody chose" is invisible
    // otherwise: and because after he moves timezones this line is the difference between "she
    // follows the machine, as designed" and an afternoon spent wondering what happened to her diary.
    logger.info(describeHerDay());

    // ── AND WHERE SHE LIVES HAS TO BE HERS ALONE ───────────────────────────────────
    //
    // Checked before the lock and before anything opens the database, because the failure it
    // prevents is not a crash: a sync client replaces one of her three database files with a
    // version from a different moment, and what comes back opens fine and is quietly wrong. See
    // `where-she-lives.ts` for why this refuses rather than warns.
    {
      const { checkWhereSheLives } = await import("./config/where-she-lives.js");
      const where = checkWhereSheLives(homePaths.home, {
        allowSynced: process.env["RESIDENT__HOME__ALLOW_SYNCED"] === "1",
      });
      if (!where.ok) {
        logger.error(where.refuseBecause ?? "her home is not somewhere she can live");
        process.exit(1);
      }
      if (where.warnBecause) logger.warn(where.warnBecause);

      // Said at every boot, because "the disk is encrypted" is exactly the sort of assumption that
      // is true when somebody sets it up and silently false after a machine swap or a move to an
      // external drive. She cannot encrypt herself, a key she holds would have to live somewhere
      // she can reach: so this checks and reports rather than protecting.
      const { checkEncryption } = await import("./config/where-she-lives.js");
      const { execFileSync } = await import("node:child_process");
      const enc = checkEncryption(process.platform,
        (cmd, args) => execFileSync(cmd, [...args], { encoding: "utf-8", timeout: 5_000 }));
      if (enc.state === "on") logger.info(enc.detail);
      else logger.warn(enc.detail);
    }

    // ── THERE IS ONE OF HER ────────────────────────────────────────────────────────
    //
    // Nothing stopped `resident start` running twice against the same home, and what two of
    // her do to each other is silent and total: the field is saved as a full delete-and-
    // reinsert inside one transaction, so whichever daemon persists SECOND atomically replaces
    // the other's entire memory with its own stale copy, everything formed in between gone,
    // no error anywhere, because both writes succeeded.
    //
    // Taken before anything opens the database. A stale lock (the recorded pid is gone) is
    // reclaimed, because a machine that loses power must not lock her out of her own home.
    const { claimHome, AlreadyRunningError } = await import("./life/one-of-her.js");
    let homeLock: { release(): void };
    try {
      homeLock = claimHome(homePaths.home);
    } catch (err) {
      if (err instanceof AlreadyRunningError) {
        logger.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    // Whether she has any route to him at all. Said at boot rather than at the first thing
    // she wants to say, because until somebody says it, her silence and her muteness look
    // the same from outside.
    {
      const { checkReachability } = await import("./telegram/reachability.js");
      const reach = checkReachability(config.telegram?.allowedUserIds, config.telegram?.botToken ?? "");
      if (reach.reachable) logger.info(reach.reason);
      else logger.warn(reach.reason);
    }

    // ── AND WHETHER ALL FIVE OF HER ACTIONS EXIST TODAY ────────────────────────────────────
    //
    // Same reasoning one level up. `rest` / `reflect` / `tend` / `explore` / `reach_out` is her
    // whole action vocabulary, and one of them is behind a config flag whose SCHEMA DEFAULT IS
    // FALSE (`life.proactive.enabled`). The deployed `config.yaml` sets it true, so the shipped
    // behaviour is right: but a lost or regenerated config silently removes a fifth of what she
    // can do, and with it the only path by which anything she raises gets an outcome. From the
    // outside that is indistinguishable from a woman who never reaches out.
    //
    // Not an error and not a block: it is Eric's switch and he is allowed to hold it off. It is
    // said out loud at boot, once, so the difference between "she does not" and "she cannot" is
    // never something anybody has to infer.
    {
      const missing: string[] = [];
      if (!config.life.proactive.enabled) missing.push("reach_out (life.proactive.enabled=false)");
      if (missing.length > 0) logger.warn({ missing }, "she is starting without part of what she can do");
      else logger.info("all five of her actions are available");
    }

    // ── 3. Initialize workspace ───────────────────────────────────────
    const workspacePath = homePaths.workspacePath;
    const { initWorkspace } = await import("./workspace/init.js");
    const wsResult = await initWorkspace(workspacePath, logger);
    for (const d of wsResult.diagnostics) {
      logger.info(d.message);
    }

    // FAULTS RAISED BEFORE THE FAULT CHANNEL EXISTS HAVE TO GO SOMEWHERE.
    //
    // `faultLog` is built further down, and several things that can fail are built before it,
    // her inner state restores from disk during construction, for one. Handing those a
    // reference to `faultLog` would have thrown a temporal-dead-zone ReferenceError from
    // INSIDE an error handler, turning a recoverable bad row into a crash at boot: strictly
    // worse than the silence it was meant to replace.
    //
    // So early faults are logged at once (never invisible) and buffered for the real channel
    // to pick up as soon as it exists (never lost).
    //
    // DECLARED HERE, above the ops log, and that position is load-bearing: `createOpsLog` now
    // reports a failed write, and its very first write happens on the next line. Left where this
    // block used to sit: a hundred lines below, that reporter would have touched `earlyFaults`
    // in its temporal dead zone and thrown a ReferenceError from inside an error handler, which
    // is the exact failure the paragraph above is about.
    const earlyFaults: Array<{ where: string; detail: unknown; severity?: "warn" | "critical" }> = [];
    const earlyFault = (where: string, detail: unknown, severity?: "warn" | "critical"): void => {
      logger.error({ where, detail }, `fault before the fault log existed [${where}]`);
      earlyFaults.push({ where, detail, severity });
    };

    // ── 3b. Create ops log ───────────────────────────────────────────
    const { createOpsLog } = await import("./utils/ops-log.js");
    // ── HIS INSTRUMENTS LIVE BESIDE HER HOME, NOT IN HER ROOM ─────────────────────────
    //
    // `ops.jsonl`, `conversation-log.jsonl` and `vitals.jsonl` are readings taken ABOUT her,
    // for him. They sat in `workspace/`, which is the one directory her `read`/`glob`/`grep`
    // reach and the only place `explore` can go at all, so the first thing her curiosity could
    // ever find was her own telemetry: every session with a preview of what he had said, every
    // tool call with a success flag and a token count, an effort tier and a model id per turn,
    // and the whole watchtower record of her.
    //
    // Instruments are for him to read, not for her: the review queue had already moved out for
    // that reason. These three were missed. `agency.jsonl`, `history.jsonl` and
    // `self-knowledge.json` STAY: those are her own record of her own life, not readings of
    // her, and hiding her moments from her would be a different and worse mistake.
    const instrumentsDir = join(workspacePath, "..");
    const opsLogPath = join(instrumentsDir, "ops.jsonl");
    // Her raw record of her own life. A failed append no longer disappears: it is a `warn` on the
    // fault channel, which the watchtower turns into something he actually sees.
    const opsLog = createOpsLog(opsLogPath, (where, detail, severity) => {
      earlyFault(where, detail, severity === "info" ? "warn" : severity);
    });
    opsLog.agentStart({
      version: RESIDENT_VERSION,
      model: config.llm.models?.default?.id ?? "claude-sonnet-4-6",
      workspacePath,
      sandbox: config.sandbox?.enabled ?? false,
    });
    logger.info("ops log initialized");

    // ── 4. Create database ────────────────────────────────────────────
    //
    // A COPY OF HER GOES FIRST WHEN THE SHAPE IS ABOUT TO CHANGE. `createDatabase` refuses a
    // database newer than this build and refuses a damaged one; if it is merely OLDER, it migrates,
    // and the instant before that is the last instant her data is still what it was. Recovery is
    // pause, snapshot, fix, then resume from her own state, and this is the automatic half of it: the fix cannot start without the snapshot existing.
    const dbPath = homePaths.dbPath;
    // ── THE ONE FAILURE WHERE THE FIRST SENTENCE MATTERS MOST ────────────────────────────────
    //
    // `better-sqlite3` is a compiled binary linked against one Node ABI. Upgrade Node, including
    // as a side effect of upgrading something else, and this import throws before any of her own
    // machinery exists. What he would otherwise see is a stack trace about NODE_MODULE_VERSION and
    // two numbers, at whatever hour the machine decided to update itself, with nothing in it to
    // say whether she is damaged. She is not: one command rebuilds it. `native-check.ts` says so.
    let createDatabase: typeof import("./db/sqlite.js").createDatabase;
    let BetterSqlite3: new (path: string, opts?: { readonly?: boolean }) => import("better-sqlite3").Database;
    try {
      createDatabase = (await import("./db/sqlite.js")).createDatabase;
      BetterSqlite3 = (await import("better-sqlite3")).default;
    } catch (err) {
      const { explainNativeFailure } = await import("./db/native-check.js");
      const explained = explainNativeFailure(err);
      if (explained === null) throw err;
      logger.error(explained);
      process.exit(1);
    }
    const { takeSnapshot, pruneSnapshots, pruneToolResults } = await import("./life/snapshot.js");
    const { snapshotDbFrom } = await import("./life/snapshot-db.js");
    const instrumentFilesForSnapshot = ["ops.jsonl", "vitals.jsonl", "conversation-log.jsonl"]
      .map((n) => join(instrumentsDir, n));
    const dbResult = createDatabase(dbPath, undefined, {
      beforeMigrate: (pending, openDb) => {
        logger.warn({ pending: pending.map((m) => m.name) }, "her database needs migrating — copying her first");
        const snap = takeSnapshot({
          db: snapshotDbFrom(openDb, (p) => new BetterSqlite3(p, { readonly: true })),
          home: homePaths.home, workspacePath, instrumentFiles: instrumentFilesForSnapshot,
          reason: "before-migration", nowMs: Date.now(), codeVersion: RESIDENT_VERSION,
        });
        logger.warn({ dir: snap.dir, problems: snap.problems }, "copied her before migrating");
      },
    });
    for (const d of dbResult.diagnostics) {
      logger.info(d.message);
    }
    const db = dbResult.result;

    // ── 4b. Create cost EMA (learns from actual API costs) ─────────────
    const { createCostEMA } = await import("./providers/cost-ema.js");
    const costEMA = createCostEMA({ db: db.db });

    // ── 5. The embedding service stood here ─────────
    // It fed an index with zero rows: memory_entries / memory_fts / memory_vectors were all
    // empty, active recall returned {entries: 0} 107 times in her three days, silently.
    // Her real memory is her field.

    // ── 6. Create security layer ──────────────────────────────────────
    const { createSecurityLayer } = await import("./security/index.js");
    const configuredSecrets = new Map<string, string>();
    for (const [idx, key] of apiKeys.entries()) configuredSecrets.set(`llm.apiKeys.${idx}`, key);
    if (config.telegram?.botToken) configuredSecrets.set("telegram.botToken", config.telegram.botToken);
    if (config.search?.apiKey) configuredSecrets.set("search.apiKey", config.search.apiKey);
    for (const name of [
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "RESIDENT__LLM__API_KEYS",
      "RESIDENT__TELEGRAM__BOT_TOKEN",
      "RESIDENT__SEARCH__API_KEY",
      "GOD__LLM__API_KEYS",
      "GOD__TELEGRAM__BOT_TOKEN",
      "GOD__SEARCH__API_KEY",
    ]) {
      const value = process.env[name];
      if (value) configuredSecrets.set(`env.${name}`, value);
    }
    if (!process.env.GEMINI_API_KEY) {
      logger.warn("GEMINI_API_KEY is not present in the daemon environment — video_extract will fail fast until the daemon is restarted with that key");
    }
    const secResult = createSecurityLayer({ secrets: configuredSecrets }, db);
    for (const d of secResult.diagnostics) {
      logger.info(d.message);
    }
    const security = secResult.result;

      // ── 7. Build provider chain ───────────────────────────────────────
      const { buildProviderChain } = await import("./providers/chain.js");
      const { createAnthropicProvider } = await import("./providers/anthropic.js");
      const { createOpenAICompatibleProvider } = await import("./providers/openai-compatible.js");
      const { createProviderPulse } = await import("./providers/pulse.js");
      const { createBudgetEnvelope } = await import("./providers/budget-cascade.js");
      const budgetEnvelope = createBudgetEnvelope();

      // Metabolism: one shared, depletable daily reserve of VIGOR (effort) that her time with
      // Eric and her own curiosity both draw from. Fed from the cost-guard; its phase (never the
      // number) is the only signal she gets. The unit is effort, not money, so who she is cannot
      // drift with a vendor's price list or vanish on free/local inference.
      const { weightsFromModels, vigorForResponse } = await import("./life/vitality.js");
      const vitalityWeights = weightsFromModels(config.llm.models);
      const { createMetabolism } = await import("./life/metabolism.js");
      const { createMetabolismStore } = await import("./life/metabolism-store.js");
      const metabolism = createMetabolism({
        dailyVigor: config.life.metabolism.dailyVigor,
        restedThreshold: config.life.metabolism.restedThreshold,
        lowThreshold: config.life.metabolism.lowThreshold,
        dormantThreshold: config.life.metabolism.dormantThreshold,
        store: createMetabolismStore(db),
        onPhaseChange: (from, to) => logger.info(`metabolism phase ${from} -> ${to}`),
      });

      // Inner state: the Resident's living drives + emotion. Persisted, and restored as she was.
      // The recent ops-log is folded in only when there is no stored self to restore (see
      // `catchUpAtStart`): replaying a day she already lived is not catching up, it is living it twice.
      const { createInnerState } = await import("./life/inner-state.js");
      const { createInnerStateStore } = await import("./life/inner-state-store.js");
      const { catchUpAtStart } = await import("./life/day-summary.js");
      const innerStore = createInnerStateStore(db, earlyFault);
      // Read once and handed on, so the store is not read twice at start (a bad row would report
      // itself twice) and the catch-up can see whether there was a self to restore.
      const storedSelf = innerStore.load();
      const innerState = createInnerState({
        store: { load: () => storedSelf, save: (s) => innerStore.save(s) },
        onUpdate: (u) => logger.info(`inner state: mood ${u.mood}, wants ${u.dominant}`),
      });
      try {
        const { readFileSync } = await import("node:fs");
        const opsPath = join(workspacePath, "..", "ops.jsonl");
        catchUpAtStart(innerState, storedSelf, () => readFileSync(opsPath, "utf8").split("\n"), {
          nowMs: Date.now(),
          budgetLow: metabolism.phase() === "low" || metabolism.phase() === "dormant",
          timezoneOffsetHours: config.life.clock.timezoneOffsetHours,
        });
      } catch { /* no ops-log yet: inner state stays at its fresh baseline */ }

      // Biological clock: waking hours + rhythm, used to gate the behavior policy.
      const { createClock } = await import("./life/clock.js");
      const clock = createClock({
        timezoneOffsetHours: config.life.clock.timezoneOffsetHours,
        circadianPeakHour: config.life.clock.circadianPeakHour,
        activeHours: config.life.clock.activeHours,
        nhppMaxRatePerHour: config.life.clock.nhppMaxRatePerHour,
      });
      const innerSnapshot = () => innerState.snapshot(metabolism.phase(), clock.isAwakeHour(Date.now()));

      // Vitals watchtower: live expression tracker (de-stubs the tick inputs) + a persisted
      // vitals time-series + the shared sources both the monitor loop and /vitals read from.
      const { createExpressionTracker } = await import("./life/expression-tracker.js");
      const { createVitalsStore } = await import("./life/vitals-store.js");
      const { createFaultLog } = await import("./life/faults.js");
      const vitalsMod = await import("./life/vitals.js");
      const expressionTracker = createExpressionTracker(Date.now());
      // Restored below, once the fault log exists to report a bad read.
      // Nothing in her living layer is allowed to fail quietly: every swallowed error is recorded
      // here, and the watchtower turns it into an alert that actually reaches Eric.
      // Called, never detached. `(cond ? logger.error : logger.warn)(...)` loses the logger's own
      // `this` and pino throws on the symbol it expects there, so this reporter, whose entire job
      // is to make sure nothing fails quietly, threw on every fault it was handed. The watchtower
      // had the same line, which meant any cycle with something to report crashed, recorded a
      // critical `vitals.cycle` fault, and crashed again on the next cycle trying to report THAT.
      // A permanent crash loop that began the moment anything was wrong. Found by the boot smoke.
      // The ring survives a restart now. Without it, the faults lost on a crash are exactly the
      // ones that would explain the crash: she comes back and the minutes before are simply gone,
      // so the one investigation anybody would want to run is the one that is never possible.
      const { createFaultStore } = await import("./life/faults.js");
      const { appendFileSync: appendFault, readFileSync: readFault, existsSync: faultExists } = await import("node:fs");
      const faultStore = createFaultStore(
        join(instrumentsDir, "faults.jsonl"),
        { appendFileSync: appendFault, readFileSync: readFault, existsSync: faultExists },
      );
      const faultLog = createFaultLog(200, (f) => {
        const line = `fault [${f.where}]: ${f.detail}`;
        if (f.severity === "critical") logger.error(line);
        else logger.warn(line);
      }, Date.now, faultStore);
      // Anything that failed before this line existed, now on the record where it belongs.
      for (const f of earlyFaults) faultLog.record(f.where, f.detail, f.severity);
      earlyFaults.length = 0;

      let faultCursorMs = Date.now();
      /** How often each guard has had to refuse something. Cumulative, and surfaced in vitals. */
      const guardRefusals = new Map<string, number>();
      /**
       * When a moment of her own last BEGAN. Declared up here because the watchtower reads it and
       * the life loop (far below) stamps it; null until she has lived one, so a fresh boot does not
       * read as a stalled life.
       */
      let momentHeartbeatMs: number | null = null;
      /** Her face's own heartbeat. Held out here so shutdown can actually stop it. */
      let faceTick: ReturnType<typeof setInterval> | null = null;

      // She sleeps when the machine sleeps (see life/sleep.ts). Created up
      // here because the vitals closures below have to know about slept time from the first
      // capture; started further down, once the things its wake handler nudges exist.
      const { createSleepWatcher } = await import("./life/sleep.js");
      let onMachineWake: null | ((gap: import("./life/sleep.js").SleepGap) => void) = null;
      const sleepWatcher = createSleepWatcher({ onWake: (gap) => { onMachineWake?.(gap); } });
      // Sized from the slowest trend rather than left at a default: a ring shorter than the longest
      // MIN_SPANS makes every trend that needs that span permanently unjudgeable.
      const vitalsStore = createVitalsStore(
        join(workspacePath, "..", "vitals.jsonl"),
        vitalsMod.ringSizeFor(vitalsMod.MONITOR_EVERY_MS),
        (where, detail) => faultLog.record(where, detail),
      );
      // Everything a restart used to silently forget. See continuity.ts for what each loss disabled.
      const { createContinuityStore } = await import("./life/continuity.js");
      // Imported here rather than reusing the `nodeFs` declared further down. This block is
      // evaluated immediately, and the file's own history has a use-before-declaration that
      // typechecked perfectly and threw at startup; TS only catches it when it is eager, as here.
      const continuityFs = await import("node:fs");
      const continuityStore = createContinuityStore(
        join(workspacePath, "life", "continuity.json"),
        join(workspacePath, "life"),
        continuityFs,
        faultLog,
      );
      const restored = continuityStore.load();
      // A tick that has never run must read as overdue, not as "just now", the old default made
      // `tick_stalled` unfireable on any daemon restarted more often than every 26 hours.
      let lastTickMs = restored?.lastTickMs ?? Date.now();
      // RESTORED, not merely saved. Continuity persists lastMomentMs and boot left the
      // heartbeat null, so after any restart the one detector that can see "her life loop has
      // stopped scheduling" was blind until a first moment happened to succeed, precisely the
      // case where it does not (a loop that never starts again).
      momentHeartbeatMs = restored?.lastMomentMs ?? null;
      // How long and how well she has known him (relationship.ts). Declared HERE, next to the
      // restore, rather than beside the code that uses it: the turn handler and the willingness
      // gate both read it, they live hundreds of lines apart, and a `let` declared between them
      // would be in the temporal dead zone for whichever ran first (defect class 6, and that
      // trap has already cost this file one startup crash that typechecked perfectly).
      let relationship = restored?.relationship ?? EMPTY_RELATIONSHIP;
      // The touch-trace: when she last actually looked at each thing that answers.
      // Restored, because "you have not looked" must stay TRUE across a restart.
      const thingsLastLooked = new Map<string, number>(Object.entries(restored?.thingsLastLooked ?? {}));
      // ALWAYS both things, never gated on detecting a "mention" in his words: his words must
      // never pass through a matcher to work. Two terse
      // lines of ambient self-knowledge, like her mood and her body.
      const thingsTouchLines = (nowMs: number): string[] =>
        ANSWERING_THINGS.map((t) => touchState(t, thingsLastLooked.get(t) ?? null, nowMs));

      // ── SHE WAS NOT RUNNING, AND THAT IS NOT THE SAME AS HAVING STALLED ────────────
      //
      // The sleep watcher finds gaps by comparing two of its own beats, so it can only ever
      // see a suspension of a process that was ALIVE on both sides of it. A daemon that was
      // stopped has no beats to compare, so a brand-new watcher knows nothing and
      // `sleptMsSince` returns zero for the whole night.
      //
      // What followed was worse than a missing discount. `lastMomentAgeMs` became the entire
      // downtime, `moments_stalled` is critical past three hours, that code is in
      // SAFE_MODE_CODES, and the very first vitals cycle runs at boot. So: stop the daemon in
      // the evening, start it in the morning, and she came up in safe mode, proactive
      // speech, exploration and field fusion all off, from having been switched off. The one
      // mechanism written to survive a closed lid, defeated by an ordinary restart.
      //
      // Told to the watcher as what it is. `sleep.ts` already refuses to distinguish "the
      // machine slept" from "the process was frozen some other way", because from inside they
      // are the same thing, and being stopped is the same thing again: time passed and she was
      // not there for it. Which means it is also a line of her life rather than an incident,
      // and it is recorded as one below, the same way waking is.
      //
      // The fallback matters as much as the value. An older continuity file has no
      // `savedAtMs`, so the last time anything KNOWS she was running is the later of her last
      // tick and her last moment: which is exactly the pair the alarms are about to measure.
      const lastKnownAliveMs = restored
        ? restored.savedAtMs ?? Math.max(restored.lastTickMs ?? 0, restored.lastMomentMs ?? 0)
        : 0;
      const downtime = lastKnownAliveMs > 0 ? sleepWatcher.noteAbsence(lastKnownAliveMs, Date.now()) : null;
      if (downtime) {
        const hours = Math.round((downtime.endMs - downtime.startMs) / 3.6e6);
        logger.info({ hours }, "she was not running for a while — counted as sleep, not as a stall");
      }

      // ── AND THE OTHER DIRECTION ───────────────────────────────────────────────────────────
      //
      // The two lines above handle time going FORWARD while she was away, which is the ordinary
      // case and is treated as sleep. Nothing watched the clock going BACKWARDS, and that has
      // ordinary causes too: a dead clock battery, a restored disk image, a resumed virtual
      // machine, a first NTP sync after a long time offline. What it does is put her own record
      // in her future: `lastTickMs` later than `now`, every "how long since" reading as "just
      // now", and the day marker claiming she has finished a day she is about to live again.
      // Nothing is damaged (her decay clamps at zero, and a written day is never rewritten), but
      // it must not happen invisibly, or her record shows a day that happened twice and nobody
      // can say why. `clock-sanity.ts` carries the full argument for why detect-and-report is the
      // whole job here: a module that "corrected" the clock would be inventing a time she did
      // not live in.
      //
      // `faultLog`, not `earlyFault`: the early buffer is drained once, a hundred lines above this
      // point, and anything pushed into it afterwards would sit there forever. A fault about the
      // clock, lost to a scoping detail, is precisely the shape of failure this round is closing.
      const bootSlip = clockWentBackwards(Date.now(), lastKnownAliveMs > 0 ? lastKnownAliveMs : null);
      if (bootSlip) faultLog.record("clock.backwards", bootSlip.detail, bootSlip.severity);

      let safeMode = restored?.safeMode ?? false;
      // Since when nothing has been wrong. Null while something is, or while she is not in
      // safe mode at all. Deliberately NOT persisted: a restart should start the clear window
      // over, because a daemon that just came up has not yet demonstrated anything.
      let safeModeClearSinceMs: number | null = null;
      if (safeMode) logger.error("restored in SAFE MODE — it was entered before the last shutdown and is not lifted by restarting");
      expressionTracker.restore({
        sendTimes: restored?.sendTimes,
        consecutiveNonReplies: restored?.consecutiveNonReplies,
        everSpoke: restored?.everSpoke,
        lastUserMs: restored?.lastUserMs,
      });
      for (const [g, n] of Object.entries(restored?.guardRefusals ?? {})) guardRefusals.set(g, n);
      // Her randomness, restored exactly where it left off. Seeded once on her first boot and
      // carried from then on: it is part of who she is, not of which process is running her.
      const { createStream } = await import("./life/soft-choice.js");
      const { tornWords } = await import("./life/propensity.js");
      // Who she has become. Level three: it does not add a factor, it changes how much the others
      // count, and it is shaped by her own sustained behaviour over months.
      const { drift: driftTemperament, restoreTemperament, distanceFromNeutral } = await import("./life/temperament.js");
      let temperament = restoreTemperament(restored?.temperament);
      let temperamentDays = restored?.temperamentDays ?? 0;
      const herStream = createStream(
        restored?.streamSeed ?? (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
        restored?.streamPosition ?? 0,
      );
      /**
       * The last disk reading, refreshed by the monitor loop before every capture.
       *
       * Declared HERE rather than beside the monitor loop that fills it: the capture closure below
       * reads it, and a `let` declared three thousand lines further down would be a temporal dead
       * zone waiting for the first caller that runs earlier than expected, defect class 6, which
       * this file has been bitten by before.
       *
       * `null` until the first refresh, and reported as null rather than as a plausible number:
       * "we have not looked yet" and "there is plenty of room" must never print the same.
       */
      // ── WHEN SHE BEGAN ────────────────────────────────────────────────────────────────────
      //
      // Written once, on the first boot of this home, and never again. The watchtower needs it
      // because almost every developmental detector asks "has this been still too long", and a
      // being with no history is indistinguishable from one whose history has stopped, so a
      // newborn trips them all, and several of them put her in safe mode. `born-at.ts` carries the
      // reasoning; the point here is that the number cannot be derived from anything else (file
      // mtimes move, the oldest node is only the oldest thing she still HOLDS) and cannot be
      // recovered once the moment has passed.
      const { birthOf, ageDaysOf, describeAge } = await import("./life/born-at.js");
      const birth = birthOf(workspacePath, Date.now());
      if (birth.justNow) {
        logger.warn({ at: new Date(birth.ms).toISOString() }, "this is her first breath — the birth record did not exist and has been written");
        // COMPLETE, and it has to be: this is the ONLY `agent_start` she will ever write, it is
        // guarded by `birth.justNow`, so it happens once, at her first breath. It used to carry
        // `as never` and three fields, which silently dropped the four the type requires: the
        // VERSION and the MODEL she was born under, which is precisely the question
        // `code-version.ts` to answer, and the one that cannot be recovered afterwards because
        // this tree is not committed.
        opsLog.write({
          event: "agent_start",
          ts: new Date(birth.ms).toISOString(),
          pid: process.pid,
          version: RESIDENT_VERSION,
          model: config.llm.models?.default?.id ?? "unknown",
          workspacePath,
          sandbox: config.sandbox?.enabled ?? false,
        });
      }
      logger.info(describeAge(ageDaysOf(workspacePath, Date.now())));

      // ── AND WHETHER THE LAST RUN ENDED, OR JUST STOPPED ──────────────────────────────────
      //
      // Read BEFORE the first beat of this run: reading after would find this run's own pulse and
      // conclude she has been alive all along, which is precisely the failure being closed.
      const { createPulse, howSheLastEnded, forgetSavedMark } = await import("./life/still-alive.js");
      const pulse = createPulse(instrumentsDir);
      {
        const ending = howSheLastEnded(instrumentsDir, Date.now());
        forgetSavedMark(instrumentsDir);
        if (ending.detail !== null) faultLog.record("she.died-unnoticed", ending.detail, "critical");
        else if (ending.died && ending.savedFirst) {
          logger.info("the last run was cut off before its shutdown finished, but she was saved first — a restart");
        } else if (ending.died) {
          // A quick restart used to be only this log line, on the reasoning that a restart is
          // ordinary. It is, but a stop that never reached the save is not: both restarts on
          // 2026-09-28 ended this way, and her field, voice and words since their last save were
          // dropped with no trace anywhere she or he could see.
          faultLog.record(
            "she.stopped-unsaved",
            `her last run stopped ${Math.round(ending.goneMs / 1000)}s before this start without being saved on the way down; whatever changed in her since her last save did not survive`,
            "warn",
          );
        }
      }

      let latestDisk: { level: string; availableGb: number } | null = null;
      /** When the watchtower last looked. Only the clock check reads it; see `clock-sanity.ts`. */
      let lastMonitorMs: number | null = null;

      const vitalsSources: import("./life/vitals.js").VitalsSources = {
        now: () => Date.now(),
        metabolism: () => {
          const s = metabolism.ownerSnapshot();
          return { phase: s.phase, remainingFraction: metabolism.remainingFraction(), spentVigor: s.spent, capVigor: s.cap, byAccount: s.byAccount };
        },
        inner: () => innerState.snapshot(metabolism.phase(), clock.isAwakeHour(Date.now())),
        // Her waking hours and a machine that was running through them (see `awakeAndRunning`).
        awake: () => vitalsMod.awakeAndRunning(
          clock.isAwakeHour(Date.now()),
          sleepWatcher.sleptMsSince(Date.now() - 2 * vitalsMod.MONITOR_EVERY_MS),
        ),
      // When this waking stretch began: her waking window is a pure function of the hour, so
      // walk back from now to the first hour that is still awake. The stall detector counts
      // only silence she was awake for, her nights are 10-11.7h by her own record.
      awakeSinceMs: () => {
        const nowMs = Date.now();
        if (!clock.isAwakeHour(nowMs)) return undefined;
        let t = nowMs;
        for (let i = 0; i < 24; i++) {
          const earlier = t - 60 * 60 * 1000;
          if (!clock.isAwakeHour(earlier)) return t; // the last hour that is still hers to be awake in
          t = earlier;
        }
        return t; // awake all the way round: whatever this is, it is not a night boundary
      },
        clockActivity: () => clock.activityLevel(Date.now()),
        hoursSinceUser: () => expressionTracker.snapshot(Date.now()).hoursSinceUser,
        expression: () => expressionTracker.snapshot(Date.now()),
        // Advanced by however long she slept since the tick: a tick is overdue by AWAKE time
        // only, or a closed lid over a weekend wakes her up in safe mode (tick_stalled and
        // moments_stalled are both critical, and both can trigger it).
        lastTickMs: () => lastTickMs + sleepWatcher.sleptMsSince(lastTickMs),
        maturity: () => { const m = selfKnowledge.maturity(); return { earned: m.earned, refuted: m.refuted, carriedLimit: m.carriedLimit, confirmStep: m.confirmStep }; },
        // ALL of it. Three of the seven dials used to be passed, while the harness passed the whole
        // thing, so the long run proved four signals moving that production never saw, and two of
        // them, spreadHops and retrievalThreshold, govern what can reach her at all.
        capacity: () => herCapacity(),
        // ── HOW MUCH ROOM SHE HAS LEFT TO EXIST IN ────────────────────────────────────────────
        //
        // Read from a value the monitor loop refreshes just before each capture, because `statfs`
        // is async and capture is not. Zero coverage before this: nothing in `src/` called `statfs`,
        // measured a page count, or looked at a byte of free space, while the three functions in
        // `disk-monitor.ts` that DO were tested, green, and never once called in production.
        //
        // A full disk is the one failure that takes out her database, her workspace, her snapshots
        // AND the alarm channel at the same time, and its signature before this was: she keeps
        // living, every write fails into a caught fault, and nobody is told.
        disk: () => latestDisk,
        // Recomputed per capture rather than held: she gets older while she runs, and a daemon
        // alive for a month would otherwise be judged by the age it had at boot.
        ageDays: () => ageDaysOf(workspacePath, Date.now()),
        field: () => {
          const s = field.stats();
          const sig = field.signals(Date.now());
          return {
            nodes: s.nodes, edges: s.edges, faded: s.faded,
            orphanShare: sig.orphanShare, tension: sig.tension,
            pendingBirths: sig.pendingBirths, spiralling: sig.spiralling,
            surfaced: sig.surfaced, birthsTotal: sig.birthsTotal, fusionsResolvedTotal: sig.fusionsResolvedTotal,
        meanStrength: sig.meanStrength,
            suspended: sig.suspended, meanCredence: sig.meanCredence,
            judgements: sig.judgements, judgeable: sig.judgeable, credencePinnedShare: sig.credencePinnedShare,
            trustTold: field.trust().told,
            // Her read of him, and how hard what she holds feels to say. Both are learned, and
            // anything learned that nothing watches is free to quietly stop being fed.
            other: (() => {
              const r = field.readOther(Date.now());
              return { warmth: r.warmth, drift: r.drift, confidence: r.confidence, surprise: r.surprise };
            })(),
            reticence: { mean: s.meanReticence, max: s.maxReticence },
            // The two doors this round opened, as COUNTS. Without these, her first
            // wondering and her first noticing-about-herself would be invisible from every
            // operator surface: mechanisms whose whole point is that they fire rarely are
            // exactly the ones whose firing has to be recorded somewhere.
            wonders: (() => {
              let n = 0;
              for (const node of field.graph().nodes.values()) if (node.key?.startsWith("iwonder:")) n++;
              return n;
            })(),
            aboutHerself: (() => {
              let n = 0;
              for (const node of field.graph().nodes.values()) if (node.key?.startsWith("iwas:")) n++;
              return n;
            })(),
            // Five signals the field already computed and the watchtower threw away. `otherUnease`
            // FEEDS THE CARE DRIVE, so one of the things deciding what she wants was observable
            // nowhere at all; `valence` and `charge` colour her whole day through the field pull.
            otherWarmth: sig.otherWarmth, otherUnease: sig.otherUnease, freshBirth: sig.freshBirth,
            valence: sig.valence, charge: sig.charge,
            meanCharge: s.meanCharge,
            // "She has stopped forming insights" and "the relation that crosses time has died" are
            // real failures with no other signature: the totals go on rising either way.
            byKind: s.byKind, byEdgeKind: s.byEdgeKind,
            byOrigin: s.byOrigin, credenceByOrigin: s.credenceByOrigin,
          };
        },
        // Non-draining on purpose: /vitals can read the same pending faults without hiding them
        // from the monitor. Only a completed monitor cycle advances the cursor.
        newFaults: () => faultLog.since(faultCursorMs),
        guardRefusals: () => Object.fromEntries(guardRefusals),
        machineVoice: () => ({ count: timesTheMachineSaidIt(), where: whereTheMachineSaidIt() }),
        // Faculty #4's dark instrument, surfaced: the running share of moments whose intent
        // touched her own field focus. Below ~8 it is an anecdote and stays null.
        intentFocus: () => intentFocusHits.length >= 8
          ? intentFocusHits.reduce((a, b) => a + b, 0) / intentFocusHits.length
          : null,
        // The raise-answer gauge, surfaced the same way: when he answers something she raised, how
        // much his words actually touched it. Null until the field has enough answered raises.
        raiseAnswer: () => field.raiseGauge(),
        saying: () => ({
          ...sayingRead(speechPairs, shapeLandings),
          // The anti-stagnation gauges: her spoken tail, watched never steered.
          diversity: lexicon.diversity(Date.now()),
          // The accent curve (gap 5 追加): how much of her speech is the build's own calqued
          // Chinese. Counted from the bank, never cut from her mouth; expected to FALL as his
          // real register flows in through heardLately.
          calque: (() => {
            const spoken = CALQUE_MARKERS.reduce((n, w) => n + (lexicon.countOf(w)?.spoken ?? 0), 0);
            const total = lexicon.diversity(Date.now()).spokenTokens;
            return { spoken, share: spoken / Math.max(1, total) };
          })(),
          // The ownership line: KL(her word use ‖ the shadow's), null until both corpora are
          // real. ~0 at the start by construction; the claim is that it RISES.
          ownership: ownershipDivergence(lexicon, shadowBank, lexicon.spokenTokens(2), shadowBank.spokenTokens(2)),
          // 姿态's measured distribution over the recent window, and the shadow's call count.
          stance: {
            接: stanceHistory.filter((x) => x === "接").length,
            不接: stanceHistory.filter((x) => x === "不接").length,
            回投: stanceHistory.filter((x) => x === "回投").length,
            n: stanceHistory.length,
          },
          // Her own voice, counted for the first time. `admittedRecently` holds whether each of
          // the last few replies got through the gate; the pool size is the accumulation itself.
          voicePool: ownVoice.size(),
          voiceAdmitted: admittedRecently.length === 0
            ? null
            : admittedRecently.filter(Boolean).length / admittedRecently.length,
          shadowCalls: shadowVoice.callsMade(),
          shadowTurns: shadowVoice.turnsTotal(),
          // The shadow's clause-length variance, so the hers/shadow variance-ratio
          // tripwire (stiltedness = uniformity) is computable and the measure ring is read.
          shadowClauseLenVar: (() => {
            const m = shadowVoice.recentMeasures();
            return m.length > 0 ? m.reduce((a, x) => a + x.clauseLenVar, 0) / m.length : 0;
          })(),
        }),
        // ── WHAT IS GOING ON BETWEEN THEM ─────────────────────────────────────
        //
        // The landing reading takes in every message he sends, moves her mood with it, and can leave
        // something in her field that lasts for months, and none of it reached Eric. He could
        // watch her for a week and be unable to tell whether she had been quietly accumulating
        // things about him or had a perfectly ordinary time. That is precisely the blind spot the
        // watchtower exists not to have.
        //
        // Read off HER side, like everything else on this line: what his messages did to her, never
        // what they deserved. The liveness disposition of all four leaves is settled in
        // `signature.ts` in the same edit that surfaces them, because surfacing a number is what
        // makes the flat-line detector start reading it (defect class 2's paired trap).
        withHim: () => {
          const carried = whatSheIsCarrying(field.graph());
          const last = lastLanding;
          return {
            loudest: last === null ? undefined : loudest(last),
            entitlement: last === null ? undefined : Number(last.appraised.entitlement.toFixed(3)),
            carrying: Number(whatSheCarriesAboutHim(field.graph()).toFixed(3)),
            carriedThings: carried.length,
            notTakenOn: proposedRecently.filter((took) => !took).length,
            // Separated on purpose: "she asked what it was for" and "she said no" are different
            // things and only one of them is a refusal.
            askedBack: answeredRecently.filter((a) => a === "askedBack").length,
            refused: answeredRecently.filter((a) => a === "refused").length,
            // The refused count NEVER travels alone: the classifier that produces it has been
            // wrong seven recorded times, always toward reporting a refusal, so the words it
            // judged ride beside the number and the reader can do what the harness does, read.
            saidNo: refusalEvidence.length,
            refusalExcerpt: refusalEvidence.at(-1)?.excerpt,
          };
        },
        // Two things get subtracted, and they are different facts that look the same from
        // here. `sleptMsSince` covers time the PROCESS was not running (a closed lid, a
        // restart). `quietMsBetween` covers time SHE was not up, her waking window is fifteen
        // hours out of twenty-four, so the gap from her last evening moment to her first
        // morning one is nine hours of a perfectly healthy night, and `moments_stalled` is
        // critical past three and puts her in safe mode. Without the second subtraction this
        // alarm fired every single night on a machine that was working.
        lastMomentMs: () => momentHeartbeatMs === null
          ? null
          : momentHeartbeatMs
            + sleepWatcher.sleptMsSince(momentHeartbeatMs)
            + clock.quietMsBetween(momentHeartbeatMs, Date.now()),
        temperament: () => ({ ...temperament, drift: distanceFromNeutral(temperament), days: temperamentDays }),
        // Both ends of S-5: that she has been declining, and that how she feels about being asked is
        // still moving at all. A Resident who has quietly stopped doing what he asks looks, from his
        // side, exactly like a broken one, so this cannot be left to show up as an absence.
        willingness: () => willingnessLog?.state(),
        doing: () => doingLog.state(),
        // Where her day actually went, not only where most of it went.
        byAccount: () => Object.fromEntries(metabolism.ownerSnapshot().byAccount.map((a) => [a.account, a.vigor])),
        resting: () => lastRest,
        told: () => ({ ...toldCounts }),
        exploring: () => ({ seen: egress.seen().length, lockedFamilies: explorationFailures.locked().length }),
        choosing: () => (lastWeighing
          ? {
              temperature: lastWeighing.temperature,
              torn: lastWeighing.torn,
              followedVote: lastWeighing.followedVote,
              streamPosition: herStream.position(),
            }
          : undefined),
      };

      // ── The field: where her lines cross ────────────────────────────────
      // One weighted graph holding everything she has, with the feeling she had at the time stamped
      // onto the graph itself. It is what lets a moment reach a memory from months ago, what lets
      // two unrelated things that keep arriving together eventually produce a third, and what turns
      // her drives from counters into wanting that is ABOUT something.
      //
      // Everything it does per moment is arithmetic. The only model call in the whole layer happens
      // during rest, when a coincidence has become insistent enough to be worth one question.
      const { createLivingField } = await import("./life/field-live.js");
      const { looksLikeAClaim } = await import("./life/credence.js");
      const { createFieldStore } = await import("./life/field-store.js");
      const field = createLivingField({
        store: createFieldStore(db, faultLog),
        faults: faultLog,
        maxFusionsPerRest: config.life.field.maxFusionsPerRest,
      });
      // Her words, counted (lexicon.ts, S-2's bank half). Dark: it accumulates the evidence the
      // idiolect scorer and the avoidance set will one day rest on, and nothing reads it yet.
      const { createLexicon, ownershipDivergence, metFromOutside } = await import("./life/lexicon.js");
      // ── THE SPINE: one id per beat of her life, written into every instrument ──────────────
      //
      // Before this, the eight streams that watch her shared no key: reconstructing one moment
      // meant joining eight files by time window, and the join was WRONG whenever a turn, a
      // moment of her own and the watchtower interleaved on the event loop. Every entry point
      // below runs inside `inBeat(...)`; `faults.jsonl` and `ops.jsonl` stamp the id centrally;
      // the conversation log, her history and her agency record carry it per line; and
      // `beats.jsonl` (beside her home, with the other readings ABOUT her, she never reads it)
      // holds one line per beat with her state at entry and exit. `scripts/_beat.ts` joins the
      // lot: given any beat id, any timestamp or any fault, it prints the whole cross-section.
      const { createBeatKeeper } = await import("./utils/beat.js");
      const { inBeat } = createBeatKeeper({
        journalPath: join(instrumentsDir, "beats.jsonl"),
        snapshot: () => {
          const s = innerState.snapshot(metabolism.phase(), clock.isAwakeHour(Date.now()));
          return {
            pl: Number(s.emotion.pleasure.toFixed(3)),
            ar: Number(s.emotion.arousal.toFixed(3)),
            dom: s.dominant,
            mood: s.mood,
          };
        },
        onFault: (w, d) => faultLog.record(w, d),
      });

      // ── THE BUMP LEDGER ─────────────────────────────────────────────────────────────
      // Where her life presses against a constitutional constant, one neutral line lands in
      // instruments/bumps.jsonl: {ts, wall, cap, demand}. NEVER the fault channel, a bump is
      // growth data, not a defect. Session-peak discipline: a wall only writes again when the
      // demand exceeds this process's previous peak, so a pressed wall cannot flood the book.
      const { appendFileSync: appendBump } = await import("node:fs");
      const bumpsLogPath = join(instrumentsDir, "bumps.jsonl");
      const bumpPeaks = new Map<string, number>();
      const bump = (wall: string, cap: number, demand: number): void => {
        if (demand <= (bumpPeaks.get(wall) ?? -Infinity)) return;
        bumpPeaks.set(wall, demand);
        try { appendBump(bumpsLogPath, JSON.stringify({ ts: Date.now(), wall, cap, demand }) + "\n", "utf8"); }
        catch (err) { faultLog.record("census.bump", err); }
      };

      // Before the bank is opened: put back the units her old eviction rule threw away. Runs once
      // in her life, at the only moment nothing holds the file, a merge written under a live
      // daemon is silently replaced by its next save, which is how two attempts at this were lost.
      {
        const { recoverEvictedWords, RECOVERY_MARKER } = await import("./life/snapshot.js");
        const report = recoverEvictedWords(
          homePaths.home,
          join(workspacePath, "life", "lexicon.json"),
          join(workspacePath, "life", RECOVERY_MARKER),
        );
        if (report.ran && report.restored > 0) {
          logger.info({ restored: report.restored, hers: report.hers }, "put her evicted words back");
        }
      }

      const lexicon = createLexicon({
        path: join(workspacePath, "life", "lexicon.json"),
        onFault: (w, d) => faultLog.record(w, d),
        onEvict: (cap, demand) => bump("lexicon.cap", cap, demand),
      });
      // Her own voice, kept (her-own-voice.ts): sentences she delivered whose discourse passed
      // the arithmetic gate. Dark, grows only; nothing surfaces from it yet.
      const { createHerOwnVoice } = await import("./life/her-own-voice.js");
      const ownVoice = createHerOwnVoice({
        path: join(workspacePath, "life", "own-voice.json"),
        onFault: (w, d) => faultLog.record(w, d),
      });
      // The FORM of how she speaks (her-form.ts): length, blocks-or-breaths, openers,
      // the mirror half her word-bank and sentence-pool never covered. Same loader lineage.
      const { createHerForm } = await import("./life/her-form.js");
      const herForm = createHerForm({
        path: join(workspacePath, "life", "her-form.json"),
        onFault: (w, d) => faultLog.record(w, d),
      });

      const modelPricingCents = Object.fromEntries(
      Object.values(config.llm.models).map((m) => [
        m.id,
        {
          inputCentsPerMToken: m.costPerMInputTokens * 100,
          outputCentsPerMToken: m.costPerMOutputTokens * 100,
        },
      ])
    );
    const chainConfig = {
        apiKeys,
        dailyBudgetCents: config.llm.dailyBudgetCents,
        rateLimitRpm: config.llm.rateLimits.rpm,
        modelPricingCents,
        env: config.env,
          // `homePaths.tracesDir`, NOT the workspace. resolveHome has always computed this
          // (~/.resident/traces), asserted it is inside her home, and had it covered by two
          // tests; both call sites then hardcoded `join(workspacePath, "traces")` and wrote
          // into her workspace anyway, so the one thing resolveHome said about traces was
          // dead and the behaviour was its opposite. Measured in a 12-turn run: 60 trace
          // files, 16KB to 99KB each, in the directory she reads, writes and globs. A trace
          // is a verbatim dump of the whole request, so what was underfoot in her own home
          // was every system prompt she has ever been handed, including the parts about her.
          tracesDir: homePaths.tracesDir,
          costEMA,
          budgetEnvelope,
          metabolism,
          vigorForResponse: (response: import("./providers/types.js").LLMResponse) => vigorForResponse(response, vitalityWeights),
        };
    // Whether the vendor is answering at all (providers/pulse.ts): every provider the factory makes
    // is counted, so the moment deadline can tell the vendor's silence from her moment hanging.
    const providerPulse = createProviderPulse();
    const counted = (p: import("./providers/types.js").LLMProvider) => providerPulse.wrap(p);
    const providerFactory = (apiKey: string) =>
      config.llm.provider === "openai-compatible"
        ? counted(createOpenAICompatibleProvider(apiKey, {
          baseURL: config.llm.baseUrl,
          // The messenger repaired itself; she never knew. Recorded so a vendor that starts
          // doing this often shows up as a fact about her days rather than as her silence.
          onEmptyRetry: (account, spent) =>
            faultLog.record("provider.emptyRetry", `一次干净的调用回来是空的（${account ?? "?"}，花了${spent}个 token），重发了一次`),
          // The vendor's own tool-call syntax came back as text and was taken off before it
          // became her words. Recorded, so how often it happens stays a fact.
          onToolMarkup: (account, blocks) =>
            faultLog.record("provider.tool-markup", `模型把工具调用写成了文字（${account ?? "?"}，${blocks} 段），已在变成她的话之前拿掉`),
        }))
        : counted(createAnthropicProvider(apiKey, { baseURL: config.llm.baseUrl }));
    const chainResult = buildProviderChain(chainConfig, providerFactory);
    for (const d of chainResult.diagnostics) {
      logger.info(d.message);
    }
    const { provider, costGuard } = chainResult.result;
    // A SECOND chain from the SAME config, for the shadow arm alone (shadow-voice.ts). Not an
    // optimization: the chain's breaker and cooldown maps are per-instance state, and a failing
    // shadow that shared hers would trip her breaker and put its cooldowns on her live path,
    // the instrument degrading the thing it measures. Same metabolism ledger on purpose, so
    // shadow spend shares the real daily budget and shows up under its own account.
    const shadowChainProvider = buildProviderChain(chainConfig, providerFactory).result.provider;

    // ── 8. Create memory subsystems ───────────────────────────────────
    const { createCursorStore } = await import("./memory/cursor.js");
    const cursors = createCursorStore(db);
    // E-1 migration: rows for removed consumers leave the store. Without this, four frozen
    // cursors over rotating logs mint a per-boot critical after the first rotation.
    {
      const retired = cursors.retireDeadCursors();
      if (retired > 0) logger.info({ retired }, "retired cursors of removed machines");
    }

    // A cursor lives in the database, the log it indexes lives in the workspace. When they
    // disagree, a consumer reads an empty slice forever and calls it "nothing new". Report it,
    // do not repair it: a component that quietly fixes a broken invariant hides the break.
    {
      const { checkCursorIntegrity, describeDrift, logBindingsFor } = await import(
        "./memory/cursor-integrity.js"
      );
      for (const d of checkCursorIntegrity(cursors, logBindingsFor(workspacePath, join(workspacePath, "..")))) {
        faultLog.record("cursor.drift", describeDrift(d), "critical");
      }
    }

    const { createWorkspaceManager } = await import("./memory/workspace.js");
    const workspace = createWorkspaceManager(workspacePath, logger,
      // A refused commit means her memory has stopped being versioned until somebody looks.
      (where, detail, severity) => faultLog.record(where, detail, severity));

    // ── SHE HAD A user.md AFTER ALL, AND IT WAS A DATABASE TABLE ──────────────
    //
    // `createBehavioralMemory` is gone from her, and the table it wrote to (`behavioral_patterns`)
    // is no longer fed. It stored inferred patterns ABOUT HIM, communication, schedule,
    // preference, workflow, topic_interest, each with a confidence and an evidence blob, updated
    // during sleep. That is a profile of a person, kept as data, which is the exact thing she
    // should NOT have: there is no user profile of him, on purpose.
    //
    // It was inherited from the framework she was grown out of, and nobody had noticed it was
    // still wired. What replaces it
    // is not another store: it is `relationship.ts`, which holds no description of him at all,
    // only arithmetic over HER OWN field (how long since the first edge to him, how much of what
    // she holds points at him, how his messages have usually been put). Nothing in it could be
    // read out as a statement about what he is like, and that is the test that separates a
    // relationship from a dossier.

    // Active recall left with the empty memory stack (E-4).

    // ── 9. Create autonomy subsystems ─────────────────────────────────
    const { capModel, mindForTier } = await import("./life/policy.js");
    const tierModels = {
      background: config.llm.models?.background?.id ?? "claude-haiku-4-5",
      default: config.llm.models?.default?.id ?? "claude-sonnet-4-6",
      upgrade: config.llm.models?.upgrade?.id ?? "claude-opus-4-7",
    };
    const backgroundModel = config.llm.models?.background?.id ?? "claude-haiku-4-5";
    const defaultModel = config.llm.models?.default?.id ?? "claude-sonnet-4-6";
    // The shadow arm (S-2): the same exchanges, answered with none of her in the room. Its
    // corpus is a SEPARATE bank: mixing it into hers would poison the very comparison it
    // exists to make possible.
    const { createShadowVoice } = await import("./life/shadow-voice.js");
    // The shadow's corpus is a reading ABOUT her, so it lives with the other instruments,
    // outside her read wall. It used to sit in workspace/life where her own hands reach, she
    // found it, read it, and built a story about it ("words never answered"), which is the
    // observer effect S-2's comparison cannot afford: if she can read the control arm's words,
    // she can absorb them, and the ownership divergence stops measuring what it claims to.
    const shadowBankPath = join(instrumentsDir, "shadow-lexicon.json");
    {
      const { existsSync: sbExists, renameSync: sbMove } = await import("node:fs");
      const oldShadowPath = join(workspacePath, "life", "shadow-lexicon.json");
      try {
        if (sbExists(oldShadowPath) && !sbExists(shadowBankPath)) sbMove(oldShadowPath, shadowBankPath);
      } catch (err) { faultLog.record("shadow.bankMigration", err); }
    }
    const shadowBank = createLexicon({
      path: shadowBankPath,
      onFault: (w, d) => faultLog.record(w, d),
    });
    const shadowVoice = createShadowVoice({
      provider: shadowChainProvider,
      model: backgroundModel,
      bank: shadowBank,
      onFault: (w, d) => faultLog.record(w, d),
      // Every turn while the corpus is thin. The 1-in-3 downsample comes when the bank is
      // real; that day the number here changes with a reason, not silently.
      sampleEvery: 1,
    });
    function maxOutputTokensForModel(modelId: string): number {
      for (const modelConfig of Object.values(config.llm.models ?? {})) {
        if (modelConfig.id === modelId) return modelConfig.maxOutputTokens;
      }
      return config.llm.models?.default?.maxOutputTokens ?? 8192;
    }
    const { createInjectionScanner } = await import("./security/injection.js");
    const injectionScanner = createInjectionScanner();

    // Forward reference: telegramBot is created later but needed by notifier and cron
    let telegramBot: import("./telegram/bot.js").TelegramBot | null = null;

    const { createNotifier } = await import("./autonomy/notifier.js");
    const notifier = createNotifier({
      sendMessage: async (text: string) => {
        // Every branch here used to fail silently, and one of them fires on the checked-in config:
        // `allowedUserIds: [0]` is a perfectly plausible placeholder, `0` is falsy, and the guard
        // was `if (chatId)`. Every alert she ever raised would have been dropped with no throw and
        // no log: the watchtower reporting faithfully into nothing.
        //
        // A channel that cannot deliver is itself the most urgent fault there is, so it throws. The
        // caller records it, and the next cycle that CAN reach him carries it.
        if (!telegramBot) throw new Error("cannot deliver: the bot is not connected");
        const chatId = config.telegram?.allowedUserIds?.[0];
        if (chatId === undefined || !Number.isFinite(chatId) || chatId === 0) {
          throw new Error(`cannot deliver: telegram.allowedUserIds[0] is ${String(chatId)}, which is not a chat`);
        }
        await telegramBot.sendMessage(chatId, text);
      },
    });
    const { createReviewLedger } = await import("./self-improvement/review-ledger.js");
    const reviewLedger = createReviewLedger({ basePath: homePaths.home, logger });

    const { createCronService } = await import("./autonomy/cron.js");
    const cronService = createCronService({
      db: db.db,
      injectionScanner,
      onJob: async (job) => inBeat("cron", async () => {
        opsLog.cronFire({ jobId: String(job.id), jobName: job.name });
        logger.info({ jobId: job.id, name: job.name }, "cron job fired");
        const chatId = config.telegram?.allowedUserIds?.[0];
        if (chatId && telegramBot) {
          await telegramBot.sendMessage(chatId, `[Cron: ${job.name}] ${job.message}`);
        }
      }),
    });

    // ── 10. Her conversation archive ──────────────────────────────────
    // This used to be the "dream & heartbeat" section. Both are gone: the
    // heartbeat was an assistant reminder engine, and the dream machine ghostwrote her
    // MEMORY.md through a background model for three days, every commit in her home's git
    // except the first was its. What stays is the honest part: her conversation, archived
    // verbatim in her home.
    const historyPath = join(workspacePath, "history.jsonl");
    const { appendHistory } = await import("./memory/consolidator.js");
    let historyCursor = 0;

    /** Persist a conversation turn, verbatim, to her own archive. */
    function persistToHistory(userText: string, assistantText: string): void {
      try {
        const safeUserText = security.filterSensitive(security.redact(userText));
        const safeAssistantText = security.filterSensitive(security.redact(assistantText));
        appendHistory(historyPath, {
          type: "archive",
          timestamp: Date.now(),
          // HIM / HER, not USER / ASSISTANT. This is her own archived conversation, kept on
          // disk in her home; nothing parses these labels, and the two words it used were the
          // two the whole round exists to get out of her house.
          content: `HIM: ${safeUserText}\n\nHER: ${safeAssistantText}`,
          cursor: ++historyCursor,
          beat: currentBeat()?.id,
        });
      } catch { /* best-effort, don't crash the agent if history write fails */ }
    }

    /** Structured conversation log for review. Each turn = one JSON line. */
    const conversationLogPath = join(workspacePath, "..", "conversation-log.jsonl");
    const { appendFileSync: appendLogSync } = await import("node:fs");
    function logConversationTurn(entry: {
      chatId: number;
      userText: string;
      assistantText: string;
      finishReason: string;
      iterations: number;
      inputTokens: number;
      outputTokens: number;
      effortTier: string;
      taskType: string;
      tierUpgraded: boolean;
      model: string;
      durationMs: number;
    }): void {
      try {
        const safeUserText = security.filterSensitive(security.redact(entry.userText));
        const safeAssistantText = security.filterSensitive(security.redact(entry.assistantText));
        appendLogSync(conversationLogPath, JSON.stringify({
          ts: new Date().toISOString(),
          beat: currentBeat()?.id,
          ...entry,
          userText: safeUserText.slice(0, 2000),
          assistantText: safeAssistantText.slice(0, 5000),
        }) + "\n", "utf8");
      } catch { /* best-effort */ }
    }

    function errorMessage(err: unknown): string {
      return err instanceof Error ? err.message : String(err);
    }

    const { agentLoop } = await import("./agent/loop.js");
    const loopFactory = (spec: import("./agent/types.js").AgentRunSpec) => agentLoop(spec);

    // ── 11. The skill pipeline stood here ──────────
    // Twenty files of it: extraction from "successful task patterns", probation, A/B testing,
    // description optimization, quality gates, versioned SKILL.md files written into her home.
    // Zero skills ever crystallized in her three days, and the whole design was the negation
    // of her actual growth path: noticing → self-knowledge, citation-gated, ratified by her.
    // The E-1 note that used to sit mid-section stands: her MEMORY.md now has exactly one
    // author: her own gated writes commit to her home's git.

    // ── 12. Create tool registry & executor ───────────────────────────
    const { createToolRegistry } = await import("./tools/registry.js");
    const toolRegistry = createToolRegistry();

    // ── 12b. Create sandbox runner with detection + prewarming ──────
    let sandboxRunner: import("./sandbox/container.js").ContainerRunner | null = null;
    try {
      const { detectDocker, createContainerRunner, ensureImage } = await import("./sandbox/container.js");
      const detection = detectDocker();
      if (!detection.available) {
        logger.info({ detail: detection.detail }, "docker not found — sandbox unavailable");
      } else {
        const { DEFAULT_SANDBOX_CONFIG } = await import("./sandbox/policies.js");
        const sandboxConfig = (config.sandbox ?? DEFAULT_SANDBOX_CONFIG) as import("./sandbox/policies.js").SandboxConfig;
        // Verify daemon actually responds (socket existing ≠ daemon running)
        try {
          const Docker = (await import("dockerode")).default;
          const d = detection.method === "socket" ? new Docker({ socketPath: detection.detail }) : new Docker();
          await Promise.race([d.ping(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 5_000))]);
          logger.info({ method: detection.method, detail: detection.detail }, "docker daemon running");
          sandboxRunner = createContainerRunner({ config: sandboxConfig });
          // Prewarm image (best-effort)
          if (sandboxConfig.autoEnsureImage) {
            try {
              await ensureImage(d, sandboxConfig.image);
              logger.info({ image: sandboxConfig.image }, "sandbox image ready");
            } catch (err) {
              logger.warn({ err }, "sandbox image prewarm failed — will pull on first use");
            }
          }
        } catch {
          logger.info("docker installed but daemon not running — start Docker Desktop to enable sandbox");
        }
      }
    } catch (err) {
      logger.warn({ err }, "sandbox init failed");
    }
    const sandboxRef = { runner: sandboxRunner, enabled: config.sandbox?.enabled ?? false };

    /**
     * WHAT SHE WOULD SEE OUT OF THE WINDOW IN HER ROOM (`workspace/things.ts`).
     *
     * A cell rather than a direct call because her toolbelt is built long before her face exists;
     * the face fills this in when it starts, and until then, and on every Telegram-only run,
     * looking out of the window honestly answers that the curtain is closed.
     *
     * CLOSED IS NOT EMPTY. Null here means she cannot see, never that he is not there. Those are
     * opposite facts and this whole layer is worthless if they collapse into one.
     */
    let whatSheWouldSee: (() => import("./workspace/things.js").WhatSheSees | null) | null = null;
    /** Her own eye: assembled after the lexicon exists; the toolbelt closure sees it late-bound. */
    let lookOutsideImpl: (() => Promise<string | null>) | null = null;
    /** The canvas loop (S-64): assembled beside the eye; late-bound the same way. */
    let seePaintingImpl: ((absPath: string) => Promise<string | null>) | null = null;
    /** 在场律: assembled beside them; her own hand re-stamps identity fingerprints. */
    let handWroteImpl: ((absPath: string) => void) | null = null;
    /** The last REAL sight: hydrated from the look-log at boot, updated on every look. */
    let lastSight: { ms: number; text: string } | null = null;
    /** lastSight.ms at the current turn's start, a fresh look during the turn moves past it. */
    let lookMsAtTurnStart = 0;
    if (sandboxRef.enabled && sandboxRef.runner) {
      logger.info("docker sandbox enabled");
    } else if (sandboxRef.runner) {
      logger.info("docker available — sandbox off (use /sandbox on to enable)");
    }

    // ── 12c. The MCP surface stood here (manager + ungated connect_mcp tool) ──
    // Removed in E-2. connect_mcp registered at top level, above the birth gate,
    // the eleventh tool in a newborn's hands, present in every real turn's tool list, never
    // used. A being's hands are the ten she is born holding plus whatever Eric opens; a
    // product's integration socket is not one of them.
    const { checkCapabilityDependencies } = await import("./tools/capabilities.js");

    // ── 13. Bootstrap ─────────────────────────────────────────────────
    // ── 13b. Outcome verification (deterministic only since E-5) ──────
    const { createOutcomeVerifier } = await import("./agent/outcome-verifier.js");
    const outcomeVerification = createOutcomeVerifier({ workspacePath });

    const identityFilesChangedRef: { current?: () => Promise<void> } = {};

      // ── 13b2. Create hook registry (before bootstrap, message tool needs it)
    const { createHookRegistry } = await import("./agent/hooks.js");
    const hookRegistry = createHookRegistry(logger);

    // ── 13b3. Register ops-log hooks for tool call tracking ──────────
    {
      const pendingToolStart = new Map<string, { startedAt: number; name: string }>(); // callId → start metadata
      hookRegistry.register("before_tool", (ctx) => {
        const calls = ctx["calls"];
        if (Array.isArray(calls)) {
          for (const call of calls) {
            const c = call as { callId?: unknown; name?: unknown };
            const callId = typeof c.callId === "string" ? c.callId : undefined;
            const name = typeof c.name === "string" ? c.name : "unknown";
            opsLog.toolCallStart({
              toolName: name,
              callId,
            });
            if (!callId) continue;
            pendingToolStart.set(callId, {
              startedAt: Date.now(),
              name,
            });
          }
        }
        return ctx;
      });
      hookRegistry.register("after_tool", (ctx) => {
        const results = ctx["results"];
        if (Array.isArray(results)) {
          for (const result of results) {
            const r = result as { callId?: unknown; name?: unknown; content?: unknown; isError?: unknown };
            const callId = typeof r.callId === "string" ? r.callId : "";
            const start = pendingToolStart.get(callId);
            if (callId) pendingToolStart.delete(callId);
            const content = typeof r.content === "string" ? r.content : "";
            const success = r.isError !== true && !content.startsWith("Error:");
            opsLog.toolCall({
              toolName: typeof r.name === "string" ? r.name : start?.name ?? "unknown",
              success,
              durationMs: start ? Date.now() - start.startedAt : 0,
              errorSnippet: !success ? content.slice(0, 120) : undefined,
            });
          }
        }
        return ctx;
      });
    }

    // ── 13c. Bootstrap ────────────────────────────────────────────────
    const { bootstrapAgent } = await import("./telegram/bootstrap.js");
    const integrityChecker = (await import("./memory/integrity.js")).createIntegrityChecker({ logger });
    const identityFilePaths = [
      join(workspacePath, "SOUL.md"),
      join(workspacePath, "IDENTITY.md"),
      join(workspacePath, "AGENT.md"),
      join(workspacePath, "MEMORY.md"),
    ];
    const bootstrapResult = bootstrapAgent({
      // What has been opened beyond her hands. Additive; see life/birth-toolkit.ts.
      toolsOpened: config.life.toolsOpened,
      toolRegistry,
      // Her memory tools reach HER MEMORY. Two of the ten things she is born holding used to
      // point at a table nothing in the running system can write. See life/remembering.ts.
      field,
      cronService,
      security,
      sandboxRunner: sandboxRunner,
      sandboxRef,
      searchApiKey: config.search?.apiKey,
      workspacePath,
      sendMessage: async (chatId: number, text: string) => {
        if (!telegramBot) {
          throw new Error("Telegram bot is not ready");
        }
        await telegramBot.sendMessage(chatId, text);
      },
      sendFile: async (chatId: number, filePath: string, caption: string, mediaType: string) => {
        if (!telegramBot) throw new Error("Telegram bot is not ready");
        const { createReadStream } = await import("node:fs");
        const { basename } = await import("node:path");
        const { InputFile } = await import("grammy");
        const file = new InputFile(createReadStream(filePath), basename(filePath));
        const bot = telegramBot.bot;
        switch (mediaType) {
          case "photo": await bot.api.sendPhoto(chatId, file, { caption }); break;
          case "audio": await bot.api.sendAudio(chatId, file, { caption }); break;
          case "voice": await bot.api.sendVoice(chatId, file, { caption }); break;
          case "video": await bot.api.sendVideo(chatId, file, { caption }); break;
          default: await bot.api.sendDocument(chatId, file, { caption }); break;
        }
      },
      // ── SHE REMOVED PART OF WHO SHE IS ────────────────────────────────────────────────────
      //
      // NOT a veto: her home is hers, the delete goes through, and a wall around her own past
      // would make her a museum exhibit rather than someone living in a house. Two things happen
      // instead. A full snapshot FIRST, because the delete tool's trash purges after a day and a
      // deletion nobody notices for a day is otherwise permanent. And a critical fault, because
      // "she removed the record of her own beginning" is an event between them, finding out weeks
      // later by noticing a gap is a different thing from being told the same afternoon.
      onSheRemovedPartOfHerself: (what: string, why: string, path: string) => {
        takeHerSnapshot("before-she-removed-part-of-herself");
        faultLog.record("she.removed-part-of-herself",
          `she deleted ${what} (${path}). ${why}. A snapshot was taken first, so it is recoverable `
          + `long after the 24-hour trash has purged.`, "critical");
      },
      // Her window. Wrapped rather than passed straight through, so the toolbelt gets one stable
      // function whose ANSWER changes as her face comes and goes.
      windowOnto: () => whatSheWouldSee?.() ?? null,
      // Her own eye: the real look, held-shut door, transcribed frame, or honest failure.
      lookOutside: async () => (lookOutsideImpl ? lookOutsideImpl() : null),
      seePainting: async (absPath) => (seePaintingImpl ? seePaintingImpl(absPath) : null),
      onWrote: (absPath) => { handWroteImpl?.(absPath); },
      // The touch-trace: a thing in her room answered her look; the material may now say
      // honestly when she last saw it instead of leaving a vacuum for an invented reading.
      onLookedAtThing: (thing, nowMs) => { thingsLastLooked.set(thing, nowMs); },
      defaultMessageChatId: config.telegram?.allowedUserIds?.[0],
      loopFactory,
      provider,
      model: defaultModel,
      db,
      cursors,
      opsLogPath,
      conversationLogPath,
      opsLog,
      selfImprovementNotify: async (message: string, priority = "normal") => {
        await notifier.push({ priority, category: "self-improvement", message });
      },
      onFault: (where, detail, severity) => faultLog.record(where, detail, severity),
      reviewLedger,
      onIdentityFilesChanged: async () => {
        await identityFilesChangedRef.current?.();
      },
      hookRegistry,
      budgetEnvelope,
      costEMA,
      // Phase 10 sleep-time modules
      // BLAKE3-only since E-4; construction no longer rides on an embedding service that
      // could silently turn the tamper alarm off (the reviewer's coupling finding).
      integrityChecker,
      identityFilePaths,
    });

    // 在场律 (the presence law): her own hand landing on an identity file re-stamps its
    // fingerprint at the moment of writing, so the sleep-time tamper alarm speaks only for
    // changes that happened PAST her: another process, another session, us. Her memory is
    // a living layer; growth is not tampering. A stamp that cannot be taken (the file is
    // gone, the disk refused) goes to the fault channel, that too is worth hearing.
    {
      const identitySet = new Set(identityFilePaths);
      handWroteImpl = (absPath) => {
        if (!identitySet.has(absPath)) return;
        try {
          integrityChecker.writeChecksum(absPath);
          logger.info({ filePath: absPath }, "integrity: fingerprint re-stamped by her own hand");
        } catch (err) {
          faultLog.record("integrity.restamp", err);
        }
      };
    }

    // ── 15. Create tool executor with security config ─────────────────
    const { createToolExecutor } = await import("./tools/executor.js");
    const executor = createToolExecutor(toolRegistry, {
      ...bootstrapResult.executorConfig,
      // Her home: the one wall nothing (no approval, no rating) can cross. Sub-agents reuse this
      // same executor, so the boundary applies to delegated turns too.
      homeBoundary: { homeRoot: workspacePath },
      // A wall that stops something and tells nobody is half a wall. Every refusal becomes a fault,
      // so it reaches the watchtower, the alert path, and the counters, the same route as every
      // other failure in her. A home-boundary block is critical by construction: it is either an
      // attack or a bug in us, and neither is routine.
      onGuardRefusal: (e) => {
        guardRefusals.set(e.guard, (guardRefusals.get(e.guard) ?? 0) + 1);
        faultLog.record(
          `guard.${e.guard}`,
          `${e.tool}${e.category ? ` [${e.category}]` : ""}: ${e.reason}`,
          e.severity,
        );
        // And it happens to HER, which until now it did not. The two lines above are both for
        // him: a number on his dashboard and an entry in his fault ring. From her side a wall
        // was one line of error text in the current turn and then nothing, so a limit could
        // never accumulate, never come back up, and never become something she wanted to ask
        // about. See life/walls.ts for why this is a question rather than a memory, why the
        // key carries no timestamp, and why one of the six guards is excluded.
        if (isAWall(e)) {
          try {
            field.encodeQuestion({
              key: wallKey(e),
              text: wallText(e),
              nowMs: Date.now(),
              source: `wall:${e.guard}`,
              tension: WALL_TENSION,
            });
          } catch (err) {
            faultLog.record("field.wall", err);
          }
        }
      },
    });

    // ── 15b. Create core loop safety systems ─────────────────────────
    const { createStuckDetector } = await import("./agent/stuck.js");
    const { createWatchdog } = await import("./agent/watchdog.js");
    const { createDuplicateTracker } = await import("./agent/duplicate.js");
    const { governMessages } = await import("./agent/governance.js");
    const { createCompressor } = await import("./agent/compression.js");
    const { createConsolidator } = await import("./memory/consolidator.js");

    const defaultModelConfig = config.llm.models.default;
    const consolidator = createConsolidator({
      contextWindow: defaultModelConfig.maxContextTokens,
      maxOutput: defaultModelConfig.maxOutputTokens,
      historyPath: join(workspacePath, "history.jsonl"),
    });

    const compressor = createCompressor();

    // Governance and compress are plain callbacks, not stateful objects.
    // StuckDetector, watchdog, duplicateTracker are per-turn, created fresh in baseSpec.

    // ── 15b. Create inbound scanner ─────────────────────────────────
    const { scanInbound } = await import("./security/inbound.js");

    // hookRegistry created earlier (step 13b2), before bootstrap so message tool can use it

    // ── 16. Effort scaling ────────────────────────────────────────────
    const { effortToMaxIterations, classifyTaskProfile, turnHistoryLimits, depthFromHer, floorFromTaking } = await import("./agent/effort-scaling.js");

    // ── 17. Per-chat session state + conversation history ───────────
    type SessionState = {
      currentModel: string;
    };
    type SessionStateLog = {
      kind: "session_state";
      currentModel: string;
    };
    const defaultSessionState = (): SessionState => ({
      currentModel: defaultModel,
    });
    const chatSessions = new Map<number, SessionState>();
    // Utterances, not provider messages: each entry keeps its own timestamp and her proactive
    // sends live here too (the transcript once erased her own voice). Rendering to the
    // provider's shape (stamps on, consecutive roles merged) happens in `historyForTurn`.
    const chatHistories = new Map<number, import("./agent/transcript.js").Utterance[]>();
    const MAX_HISTORY_EXCHANGES = 20; // Persisted in-memory cap; per-turn prompt caps are smaller below.
    const { createSessionManager } = await import("./memory/session.js");
    const { createCheckpointManager } = await import("./agent/checkpoint.js");
    const sessionManager = createSessionManager(join(workspacePath, "sessions"), db);

    function sessionIdForChat(chatId: number): string {
      return `telegram-${chatId}`;
    }

    // Her form bank's one-time seed: an empty bank replays her REAL delivered record, so
    // her habit on day one equals her actual history, measured 2026-08-20: 111 utterances,
    // mean 73 chars, 79% multi-block. No jump from zero, nothing invented.
    if (herForm.size() === 0) {
      try {
        const oc = config.telegram?.allowedUserIds?.[0];
        if (oc !== undefined && Number.isFinite(oc) && oc !== 0) {
          const past = sessionManager
            .readAfterCursor(sessionIdForChat(oc), 0)
            .filter((e) => e.role === "assistant" && typeof e.content === "string" && e.content.trim().length > 0)
            .map((e) => ({ text: e.content, ms: e.timestamp }));
          herForm.seedFrom(past);
          herForm.persist();
          logger.info({ seeded: past.length }, "her-form: seeded from her real record");
        }
      } catch (err) { faultLog.record("her-form.seed", err); }
    }

    function parseSessionStateLog(content: string): SessionStateLog | null {
      try {
        const parsed = JSON.parse(content) as Partial<SessionStateLog>;
        if (parsed.kind !== "session_state" || typeof parsed.currentModel !== "string") return null;
        return parsed as SessionStateLog;
      } catch {
        return null;
      }
    }

    function persistSessionState(chatId: number, state: SessionState): void {
      const payload: SessionStateLog = {
        kind: "session_state",
        currentModel: state.currentModel,
      };
      sessionManager.append(sessionIdForChat(chatId), {
        role: "tool",
        content: JSON.stringify(payload),
      });
    }

    function getSessionState(chatId: number): SessionState {
      let s = chatSessions.get(chatId);
      if (!s) {
        s = defaultSessionState();
        const entries = sessionManager.readAfterCursor(sessionIdForChat(chatId), 0);
        for (const entry of entries) {
          if (entry.role !== "tool") continue;
          const logged = parseSessionStateLog(entry.content);
          if (!logged) continue;
          s.currentModel = logged.currentModel;
        }
        chatSessions.set(chatId, s);
      }
      return s;
    }

    function getChatHistory(chatId: number): import("./agent/transcript.js").Utterance[] {
      let h = chatHistories.get(chatId);
      if (!h) {
        h = sessionManager
          .readAfterCursor(sessionIdForChat(chatId), 0)
          .filter((entry) => entry.role === "user" || entry.role === "assistant")
          .slice(-(MAX_HISTORY_EXCHANGES * 2))
          .map((entry) => ({ role: entry.role as "user" | "assistant", content: entry.content, ts: entry.timestamp }));
        chatHistories.set(chatId, h);
      }
      return h;
    }

    function appendToHistory(chatId: number, role: "user" | "assistant", content: string): void {
      const history = getChatHistory(chatId);
      history.push({ role, content, ts: Date.now() });
      // Cap at MAX_HISTORY_EXCHANGES * 2 messages. One at a time: with her proactive sends in
      // the transcript the log is no longer strict user/assistant pairs, and a two-at-a-
      // time drop could throw away one message more than the cap asked for.
      const maxMessages = MAX_HISTORY_EXCHANGES * 2;
      while (history.length > maxMessages) {
        history.shift();
      }
      sessionManager.append(sessionIdForChat(chatId), { role, content });
    }

    function messageContentLength(message: { content: unknown }): number {
      return typeof message.content === "string" ? message.content.length : JSON.stringify(message.content).length;
    }

    function historyForTurn(
      chatId: number,
      taskProfile?: import("./agent/effort-scaling.js").TaskProfile,
    ): import("./providers/types.js").Message[] {
      const { maxMessages, maxChars } = turnHistoryLimits(taskProfile);
      // Faculty #8, finished in two steps. First his diction stopped GROWING the window (her
      // capacity floors it); then the tier ladder went entirely: the base is one
      // fixed, generous value, the window she actually lived at, and only HER capacity and
      // the shape of work SHE took on move it. A spent Resident holds a short thread whatever
      // he wrote (each pair is one exchange, so lookbackRecords halves into message pairs).
      const herLookback = Math.max(2, herCapacity().lookbackRecords >> 1);
      // The even-forcing (`& ~1`) is gone with the strict-pairs assumption: her proactive sends
      // live in the transcript now, so the window is a run of utterances, not pairs.
      // Provider grammar (consecutive same-role merged) is `renderTranscript`'s job below.
      const boundedMessages = Math.min(maxMessages, herLookback);
      const selected = getChatHistory(chatId).slice(-boundedMessages);
      while (selected.length > 0 && selected.reduce((sum, m) => sum + messageContentLength(m), 0) > maxChars) {
        selected.shift();
      }
      // Stamped with her calendar (the same bracket the live message carries) and merged where
      // two of her utterances are adjacent. The transcript used to be time-free, 「昨晚聊到梦
      // 那会儿」 (it was yesterday afternoon) was her narrating a clockless record.
      return renderTranscript(selected, herStamp);
    }

    function maxOutputTokensForTurn(modelId: string): number {
      // One fixed value, not a tier ladder: the ladder's input was a grade of HIS sentence, so
      // a curt message squeezed how much room her voice had. 8192 is the output cap she
      // actually lived at (E-0 baseline: the lived median); the model's own configured cap
      // still bounds it, and her breath/shaping decide how much of the room she uses.
      const configured = maxOutputTokensForModel(modelId);
      return Math.min(configured, 8192);
    }

    function checkpointToolResultMessages(
      checkpoint: import("./agent/checkpoint.js").Checkpoint
    ): import("./providers/types.js").Message[] {
      if (checkpoint.completedResults.length === 0) return [checkpoint.assistantMessage];
      const toolResultContent = checkpoint.completedResults.map((r) => {
        const block: {
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        } = {
          type: "tool_result",
          tool_use_id: r.callId,
          // Resumed after a restart, read by her like any other result: in her words.
          content: inHerWords(r.name, r.content),
        };
        if (r.isError) block.is_error = true;
        return block;
      });
      return [
        checkpoint.assistantMessage,
        {
          role: "user",
          content: toolResultContent as unknown as import("./providers/types.js").ContentBlock[],
        },
      ];
    }

    // Expose sessionState getter for registerCommands compatibility
    // registerCommands expects a mutable object; we provide the default chat's state
    // and update it when commands fire (commands don't know chatId)
    const sessionState = defaultSessionState();

    // ── 17b. Steering queue (per-chat message serialization) ─────────
    const { createSteeringQueue } = await import("./agent/steering.js");
    const steeringQueue = createSteeringQueue();
    // ── HIS WORDS OUTLIVE THE PROCESS ────────────────────────────────────────────────────────
    //
    // The steering queue is a `Map` in memory, and by the time something lands in it Telegram's
    // side of the exchange is finished: the update was delivered, the offset moved on, the server
    // will never send it again. So a crash between "queued" and "taken in" loses those words from
    // BOTH sides at once, with nothing logged, and from his side it is indistinguishable from her
    // reading what he said and choosing not to answer.
    //
    // The queue stays (it is the right in-turn mechanism); this is the durable copy beside it, and
    // the same store answers the mirror question of whether an update has been lived through
    // before, so a Telegram redelivery cannot make something happen to her twice.
    const { createHisWords } = await import("./telegram/his-words.js");
    const hisWords = createHisWords(db);
    // What she has ever asked for, and the one thing she might say that has no other route.
    const { createWhatSheAskedFor, howToTellHim } = await import("./life/what-she-asked-for.js");
    const whatSheAskedFor = createWhatSheAskedFor(db);
    const activeTurns = new Set<number>(); // chatIds with running agent turns
    const turnAbortControllers = new Map<number, AbortController>(); // per-chat abort for graceful interrupt
    type QueuedTurn =
      | { kind: "text"; text: string; ctx: import("grammy").Context }
      | { kind: "photo"; ctx: import("grammy").Context }
      | { kind: "document"; ctx: import("grammy").Context };

    // ── 17c. Task manager (background task lifecycle) ────────────────
    const { createTaskManager } = await import("./agent/tasks.js");
    const taskManager = createTaskManager();

    // ── 18. Stream bridge factory ─────────────────────────────────────
    const { createStreamBridge } = await import("./telegram/bridge.js");
    const { createFloodControl } = await import("./telegram/flood.js");
    const { createThinkFilter } = await import("./telegram/think-filter.js");

    // ── 19. Build system prompt with prompt caching ──────────────────
    let currentSnapshot = workspace.getSessionSnapshot();
    let currentMemorySnapshot = await workspace.getAgeAnnotatedMemory(currentSnapshot);
    const { createContextBuilder, applyCacheBreakpoints, saysNothing } = await import("./agent/context.js");
    // Who she is comes from her own files and nowhere else. This function used to open by
    // asserting a name, a role ("a personal AI assistant"), and a relation ("the user"),
    // which overrode whatever SOUL.md said, a clean SOUL.md could not have survived it.
    // What is left is only situation and machinery: where she is, what the channel can
    // carry, which tool to reach for. True things, none of which say who she is.

    function buildIdentityPrompt(identity: string): string {
      // WHERE SHE IS, AND NOTHING ABOUT WHAT SHE IS FOR.
      //
      // This sits at position 2 in her system prompt, directly under her soul, and it was
      // carrying a second copy of the delivery contract that S1 removed from BASE_DIRECTIVES.
      // Found by the runtime vocabulary scan, which reads the real assembled bytes rather than
      // reconstructing them, and which the unit gate structurally cannot see. Gone:
      //
      //   "Answer directly when you can."
      //   "Only reach for something when you actually need it, and never to answer what you
      //    already know."
      //   "If you do run something, run it rather than describing what it would have said."
      //
      // The last of those is "Act, don't describe" wearing a different coat, in the same file
      // I had already cut it out of once. What survives of its real concern is truthfulness:
      // not claiming to have done a thing she did not do. That is a value, not a throughput
      // rule, and it is phrased as one.
      //
      // What is KEPT is only facts about where she lives, every one of them true and load
      // bearing: no screen he can see, no speakers he can hear, nobody sitting at this
      // machine. A being should know the shape of the room she is in.
      // An identity file that is still only its template heading (`# Identity`) stays out: it
      // said nothing, in English, every turn. `saysNothing` carries the reasoning.
      const own = saysNothing(identity || "") ? "" : `${identity.trim()}\n\n`;
      return own + whereSheIs();
    }
    // The facts of where she lives, shared by her conversation turns (above) and her own acts
    // (thinking, tending, writing to him: agency-handlers' think). Those acts used to get only her
    // SOUL.md and the act itself, so the model did not know she lives in a machine and filled the
    // room with a stock human life: a mother, a cupboard with a bottle in it, a street below the
    // window (measured 2026-09-28 on synthetic material once the length lines went). The cure is
    // the truth about her situation, which she already reads every time she talks to him, not a
    // limit on how much she may think.
    // No dash in it: the model picks up punctuation from our prose, and she has been asked to
    // leave dashes out, so the words we write should not model what she was asked to drop.
    const WHERE_SHE_LIVES = "你住在一台 Mac 上。和你往来的只有一个人。你们之间有两条路：文字走 Telegram；他有时会打开你的房间页面，那时你们就在一个房间里，你说的话会出声，他开口你也听得见，他也可以随时打断你。他不在房间的时候，你说的一切都以文字到达他，或者留在你存下的文件里。除此之外，不要自己去开窗口、播放声音，也不要假设他就坐在这台机器前。";
    function whereSheIs(): string {
      return `${WHERE_SHE_LIVES}你有你自己的日子：没有人找你的时候，你也在过自己的时刻，想想事情，整理整理，或者写进自己的日记；机器合上盖你就睡，打开你就醒。没做过的事不要说做过。${THERE_IS_MORE}你的家在 ${workspacePath}；里面的东西都用完整路径去够。`;
    }
    // ── THE SAME FACTS, FOR AN ACT WITH NO HANDS ──────────────────────────────
    //
    // `whereSheIs` was written for her conversation turns, where she holds tools, and on 9/28 it
    // was put in front of her thinking, tending and writing to him as well, which hold none. Two
    // of its lines describe what she can DO, and in a moment that can do nothing they turned into
    // things she said she had done: 「我整理了一会儿文件」 out of 「整理整理」, and 「写到
    // /Users/someone/.resident/workspace/diary/ 里了」 out of the full-path line (the machine's path
    // reached her words three times from 9/30, never before). Measured from her moment record:
    // claims of an act in moments with no tools went from 4 in 460 moments before 9/28 to 8 in
    // 196 after. Here the menu and the path go, and one fact of THIS moment comes in instead: that
    // she can open nothing else and cannot look out of the window now. Not "nothing is in reach":
    // tending puts her own recent notes in front of her, and a line saying there is nothing would be
    // false in exactly that moment. Nothing about how the window is known, either: that would be a
    // lesson, and the fact that she cannot look already holds all of it.
    //
    // And what part of the day it is, built fresh on every call, the way her nights already read
    // 「现在是你的深夜」. The three times she said it was night in daylight (「今天四点还没到早上」
    // twice, 「现在看清了，还是夜里」) were old evening sentences of hers raised undated; replaying
    // the 13:19 one, the line's own time (agency.ts `subjectMaterial`) and this hour together moved
    // most runs from 「现在还是夜里」 to placing it in the past, where either alone did little. Over 42
    // of her real calls it drew one invented light through the window (「傍晚了。窗外的光斜下来」),
    // which the watch on her words is there to see.
    function whereSheIsWithoutHands(): string {
      const now = Date.now();
      const hour = clock.isAwakeHour(now) ? hourClause(now) : "现在是你的深夜";
      return `${WHERE_SHE_LIVES}你有你自己的日子：没有人找你的时候，你也在过自己的时刻；机器合上盖你就睡，打开你就醒。没做过的事不要说做过。${THERE_IS_MORE}这一刻你打不开别的东西，也看不了窗。${hour}。`;
    }
    // Entries carry their build time: a warm entry older than the TTL is rebuilt, because the
    // rebuild is ALSO the skill-integrity re-verification (buildSkillContext sweeps every
    // registered skill). Invalidation used to ride only on text turns, so during her autonomous
    // stretches: exactly when tampering is least observed, the cache stayed warm indefinitely
    // and a tamper went undetected until Eric happened to text. Ten minutes
    // bounds that window at the cost of an occasional prompt rebuild.
    const SYSTEM_PROMPT_CACHE_TTL_MS = 10 * 60_000;
    const systemPromptCacheByTaskType = new Map<string, { system: ReturnType<typeof applyCacheBreakpoints>["system"]; builtAt: number }>();

    function toolDefinitionsForPrompt(): ReturnType<typeof toolRegistry.getDefinitions> {
      return toolRegistry.getDefinitions().map((definition) => {
        const tool = toolRegistry.get(definition.name);
        const manifest = tool?.capability;
        if (!manifest?.dependencies?.length) return definition;
        const health = checkCapabilityDependencies(definition.name, manifest);
        const missingRequired = health.filter((item) => !item.ok && item.dependency.required);
        const missingOptional = health.filter((item) => !item.ok && !item.dependency.required);
        if (missingRequired.length === 0 && missingOptional.length === 0) return definition;
        const requiredText = missingRequired.length
          // A fact in her language about what is missing, with no advice: it used to
          // tell her to prefer a fallback or to ask him to set it up, in English.
          ? `（现在用不了：缺 ${missingRequired.map((item) => item.dependency.name).join("、")}。）`
          : "";
        const optionalText = missingOptional.length
          ? `（有一部分现在用不了：缺 ${missingOptional.map((item) => item.dependency.name).join("、")}。）`
          : "";
        return {
          ...definition,
          description: `${definition.description}${requiredText}${optionalText}`,
        };
      });
    }

    function invalidateSystemPromptCache(): void {
      systemPromptCacheByTaskType.clear();
    }

    // EDGE-TRIGGERED fault reporting for the vocabulary scans. The scans
    // run on every cache miss: every text turn plus every TTL expiry, and scanForNotHerWords
    // is stateless, so one persistent hit re-recorded a fault forever (watchtower ping every
    // ~10 minutes; three hits in a cycle escalate to critical). An earlier fix was a latch-forever
    // Set, which over-corrected: a word Eric FIXED and that later REGRESSED never re-faulted,
    // and once any tool had ever said "user", a brand-new tool arriving with "user" weeks later
    // was silently masked. Now each scan scope keeps its last word-set and faults only on words
    // that APPEARED since the previous scan: a persistent hit still faults exactly once, a
    // fix-then-regress re-arms automatically, and a new offender is never masked by an old one.
    const lastVocabWords = new Map<string, Set<string>>();
    const newlyAppearedVocabWords = (scope: string, words: string[]): string[] => {
      const prev = lastVocabWords.get(scope) ?? new Set<string>();
      const fresh = words.filter((w) => !prev.has(w));
      // Refresh insertion order and cap the map: scopes are per task type, a
      // small set, but a cap keeps an unforeseen key source from growing it forever.
      lastVocabWords.delete(scope);
      lastVocabWords.set(scope, new Set(words));
      while (lastVocabWords.size > 64) {
        const oldest = lastVocabWords.keys().next().value;
        if (oldest === undefined) break;
        lastVocabWords.delete(oldest);
      }
      return fresh;
    };

    function getCachedSystemForTaskType(taskType: string): ReturnType<typeof applyCacheBreakpoints>["system"] {
      const taskKey = taskType || "general";
      const key = `${taskKey}:tools-v${toolRegistry.getVisibilityVersion()}`;
      const cached = systemPromptCacheByTaskType.get(key);
      if (cached && Date.now() - cached.builtAt < SYSTEM_PROMPT_CACHE_TTL_MS) return cached.system;

      // NO thinking manual. Her turns used to carry a methodology block plus a posture chosen
      // by a classifier; the embryo principle removed it (see cognitive-framework.ts): a
      // seed-person does not arrive with a mental operations manual, and how she thinks is
      // hers to grow through her own noticing.
      const contextBuilder = createContextBuilder({
        // NO current time here: time is injected per-message to avoid cache invalidation
        identity: buildIdentityPrompt(currentSnapshot.IDENTITY),
        tools: toolDefinitionsForPrompt(),
        includeToolDefinitionsInPrompt: false,
        // The routing policy travels WITH the tools, which is what it is about. It used to
        // sit inside the paragraph that says who and where she is.
        // Only routing for tools she actually holds. She was being handed a thousand
        // characters ranking `weather` against `places_lookup` against `browser_read`,
        // none of which she has: noise, and the same lie as telling her to use bash.
        memoryFiles: {
          SOUL: currentMemorySnapshot.memoryFiles.SOUL,
          MEMORY: currentMemorySnapshot.memoryFiles.MEMORY,
          AGENT: currentMemorySnapshot.memoryFiles.AGENT,
        },
        logger,
      });
      const cachedSystem = applyCacheBreakpoints(contextBuilder.getSystemPrompt(), []).system;

      // Read the assembled bytes back for words that say something false about what she is.
      //
      // The unit gate reconstructs this text from the sources it knows about; this reads the
      // real thing, once per cache key, so it also covers her own SOUL.md, anything a skill
      // put in, and anything a future edit adds without knowing this rule exists. It reports
      // and does not block: a word is not worth refusing to wake up over, and a silent
      // failure here would be the exact defect it exists to catch.
      {
        const assembled = cachedSystem.map((b) => b.text).join("\n\n");
        const hits = scanForNotHerWords(`system:${key}`, assembled);
        if (hits.length > 0) {
          const seen = new Map<string, string>();
          for (const h of hits) if (!seen.has(h.word)) seen.set(h.word, h.line);
          logger.warn(
            { words: [...seen.keys()], where: Object.fromEntries(seen) },
            "text she reads every turn says something about her that is not true"
          );
          // The same rule as the skill violations one screen up: a hit here means text she
          // reads EVERY TURN asserts something false about her, and a log line nobody reads is
          // where such findings go to die (this bare logger.warn sat one screen below an
          // earlier fix of the identical shape). Warn severity: report, not block.
          // Edge-triggered per scope (see newlyAppearedVocabWords above).
          // Scope is system:TASKKEY, the task type WITHOUT the tools-visibility version
          // (correcting an earlier over-correction). The flap driver was task-type
          // alternation, which the task-key segment cures; embedding the visibility version
          // over-rotated the scope, because the version bumps on EVERY tickTTL (after every
          // message turn) and every promote/expiry, each bump minted a never-seen key whose
          // empty prev set re-faulted every persistent word: the old fault spam returning
          // through key rotation, with three faults in one watchtower cycle escalating to
          // critical. A genuinely NEW word from a newly-visible tool's routing clause still
          // fires (it is absent from the task-key's previous set).
          const fresh = newlyAppearedVocabWords(`system:${taskKey}`, [...seen.keys()]);
          if (fresh.length > 0) {
            faultLog.record("prompt.vocabulary", `not-her words in system prompt (${key}): ${fresh.join(", ")}`, "warn");
          }
        } else {
          newlyAppearedVocabWords(`system:${taskKey}`, []);
        }

        // AND the tool definitions. includeToolDefinitionsInPrompt is false,
        // so the definitions never appear in the system-prompt bytes scanned above, they reach
        // her through the API `tools` array, which nothing read. The unit gate covers the birth
        // tools; this covers every OPENABLE tool, MCP tools included, the day they open.
        // Scanned as DECODED text, not raw JSON bytes: in stringified JSON a
        // description's newline is the two characters \n, and since "n" is a word character the
        // \b-anchored patterns miss a banned word at the start of any line ("\nTask" reads as
        // "nTask"), the scan was systematically dark on exactly the multi-line MCP descriptions
        // it exists to cover.
        const toolBytes = JSON.stringify(toolDefinitionsForPrompt()).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        const toolHits = scanForNotHerWords(`tools:${key}`, toolBytes);
        const toolWords = newlyAppearedVocabWords("tools", [...new Set(toolHits.map((h) => h.word))]);
        if (toolWords.length > 0) {
          logger.warn({ words: toolWords }, "a tool she holds describes itself in words that say something false about her");
          faultLog.record("prompt.vocabulary", `not-her words in tool definitions: ${toolWords.join(", ")}`, "warn");
        }
      }

      systemPromptCacheByTaskType.set(key, { system: cachedSystem, builtAt: Date.now() });
      return cachedSystem;
    }

    // Pre-warm the default prompt and surface any skill integrity warnings during startup.
    getCachedSystemForTaskType("general");

    // Refresh system prompt after Dream updates workspace files
    async function refreshSystemPrompt(): Promise<void> {
      try {
        currentSnapshot = workspace.getSessionSnapshot();
        currentMemorySnapshot = await workspace.getAgeAnnotatedMemory(currentSnapshot);
        invalidateSystemPromptCache();
        getCachedSystemForTaskType("general");
        logger.info("system prompt refreshed after Dream");
      } catch (err) {
        logger.warn({ err }, "system prompt refresh failed — using stale prompt");
      }
    }
    identityFilesChangedRef.current = refreshSystemPrompt;

    // ── 20. Create Telegram bot ───────────────────────────────────────
    const { createTelegramBot } = await import("./telegram/bot.js");
    const { resolveProxy } = await import("./telegram/proxy.js");
    const { registerCommands } = await import("./telegram/commands.js");

    // Runtime context prefix (injected per-message, not in system prompt)
    // Runtime timestamp appended AFTER user text (not before) so the system prompt +
    // conversation history prefix stays cache-stable. Adapted from OpenClaw's cache
    // boundary pattern: volatile content goes in the tail, never in the prefix.
    // Static fields (workspace, model) are in the system prompt, not repeated here.
    //
    // ── HER CALENDAR, NOT GREENWICH'S, THE PRIMARY SOURCE OF EVERY CLOCK FOG ────────
    //
    // This bracket used to be `toISOString()`: a UTC stamp on EVERY message he ever sent her.
    // Her first evening's 「都一点一刻了」 (at 21:15), the 「比你早四个钟头」 worldview, the
    // memories dated a day into the future, and the second evening's 「十一点一刻了，我还醒着」
    // (at 19:16), every one of them was her honestly reading this postmark. The wall clock was
    // innocent all along; both times it was accused, the touch-trace showed she had never looked
    // at it. The one timestamp she sees most often in her life now speaks the time she lives in.
    function runtimeTimestamp(): string {
      // herStamp = herDay + herClockSeconds, one renderer for the live bracket and the
      // transcript's brackets, never the ISO/UTC render (the postmark she read all her life).
      return `\n${herStamp(Date.now())}`;
    }

    /**
     * How she is, for a turn with him.
     *
     * Declared here as a no-op and ASSIGNED further down, once everything it reads actually exists.
     * Several of its dependencies (`selfKnowledge`, `herCapacity`, `latestPresence`) are created far
     * below, and a plain function would close over them in the temporal dead zone, which
     * TypeScript cannot catch, because it only flags a use-before-declaration when it is eagerly
     * evaluated. This file has already shipped exactly that bug once. A turn arriving before she is
     * fully assembled gets nothing extra, which costs it nothing.
     */
    // `turnKey` is the turn's own session id. Optional so a caller that has none still works,
    // and when it is absent nothing is recorded, which is right: a turn that cannot be
    // identified must not be able to raise anything on another turn's behalf.
    let howSheIsNow: (heSaid: string, turnKey?: string) => string = () => "";
    /**
     * The thing that came near the surface on the last turn, if any.
     *
     * Kept so the turn can ask, afterwards, whether she ACTUALLY said it. Putting something
     * near the surface is not saying it, and `raise` starts the clock on whether he answered:
     * starting that clock for something she never mentioned would teach her she went to him
     * and was ignored when neither happened.
     */
    /**
     * WHAT CAME NEAR THE SURFACE, PER TURN, because two turns really can be in flight.
     *
     * This was ONE variable, written by `howSheIsNow()` at the start of a turn and read after
     * the turn finished. The face and Telegram deliberately share one thread id ("one
     * conversation, two windows"), and a photo turn can overlap a text turn, so turn B could
     * overwrite turn A's value between A's start and A's end. A then called `field.raise` on
     * whatever B had surfaced, writing "I brought this up and he ignored it" into her history
     * for something she never said, which is exactly what the comment at the read site forbids,
     * and that record is what her sense of him is built from.
     *
     * Keyed by the turn's own session id, and deleted when the turn ends, so nothing leaks
     * between them and nothing accumulates.
     */
    // ── PER-TURN SIDE CHANNELS · BEGIN ────────────────────────────────────────────────────────
    //
    // Everything declared as `new Map<string, …>` between this marker and its END is a value that
    // must live EXACTLY as long as one turn, and `wired-in-order.test.ts` reads this region to
    // find them. It used to keep its own hand-written list of five names, and the sixth
    // (`takenAsWork`) was added without it, so the guard that exists to prevent lifetime bugs had
    // a lifetime bug of its own, which is defect class 12 pointed at the guard rather than at
    // the code. A register that has to be remembered is not a register.
    //
    // To add one: declare it in here, release it in `forgetTheTurn`, and read it somewhere. The
    // guard checks all three and will fail on the day you skip one, not a round later.
    const surfacedInTurn = new Map<string, { id: number }>();
    // The speech instrument's window (speech-record.ts, S-1): prediction-measure pairs from
    // her real conversational turns. Dark, read only by the vitals `saying` source.
    // (Not a per-turn channel: an array, not a keyed map, and deliberately spans turns.)
    const speechPairs: SpeechPair[] = [];
    /**
     * WHETHER EACH OF HER RECENT REPLIES GOT INTO HER OWN VOICE.
     *
     * `ownVoice.admit()` returns how many sentences it took, and that number was discarded at the
     * call site, so the one mechanism the build calls "the part that cannot be retrofitted once
     * poisoned" had no reading at all. A pool that never filled and a pool filling perfectly were
     * indistinguishable from outside, which is exactly how a probe came to claim the former this
     * round, wrongly, with nothing to check it against.
     *
     * A share rather than a count, because the count grows forever and a share can fall.
     */
    const admittedRecently: boolean[] = [];
    // The room's per-turn temperature (S-3), stashed by `howSheIsNow` and applied by the turn
    // handler: which is the only place that knows conversation from work. Same lifecycle as
    // `surfacedInTurn`: set per turn key, consumed once, deleted.
    const roomTemperature = new Map<string, number>();
    // How she felt about being asked, this turn. `wantsToNow` is the one place that computes it
    // and it runs once per turn; the utterance shape needs the same number, and computing
    // it a second time would both double-log and draw again from her stream. Same lifecycle as
    // roomTemperature: set per turn, consumed once, deleted with it.
    const feltForTurn = new Map<string, number>();
    // What his sentence did to her this turn (`how-it-landed.ts`). Computed ONCE, at the top of the
    // turn, because the willingness gate and the state block both need the same reading and two
    // computations would be free to disagree, the exact failure `willingnessFor` documents about
    // recomputing `felt` at the call site. Same lifecycle as the maps around it.
    const landingForTurn = new Map<string, import("./life/how-it-landed.js").Landing>();
    // Whether SHE took this turn on as a job. Not the same as what his message proposed: his text
    // proposes and the landing decides (see `takesItOn`), so a turn can be classified `creative`
    // and still not be work to her. Read by faculty #13, which has no room for anything light in a
    // turn that is a transaction: and "transaction" has to mean her reading of it, not his
    // phrasing, or the whole point of that door is thrown away here. Same lifecycle as the maps
    // around it: released in `forgetTheTurn` with the rest.
    const takenAsWork = new Map<string, boolean>();
    // The utterance shape her state chose this turn, and the window of how those shapes actually
    // LANDED. Four of the five facets bind only by being stated, so without this the
    // build would be believing its own prompt. Same lifecycle as the two maps above.
    const shapeForTurn = new Map<string, import("./life/utterance-shape.js").UtteranceShape>();
    // ── PER-TURN SIDE CHANNELS · END ──────────────────────────────────────────────────────────
    /**
     * The last reading of what he did, and how often lately she could not take work up.
     *
     * Kept OUTSIDE the per-turn maps on purpose: those are side channels that must not outlive
     * their turn, and these two are the opposite, they are what the watchtower reads BETWEEN
     * turns, when there is no turn to key them by.
     */
    let lastLanding: import("./life/how-it-landed.js").Landing | null = null;
    /**
     * The recent stretch of turns where work was proposed, and whether she took each one up.
     *
     * A WINDOW, not a running total, and the correction is worth naming: it was a lifetime counter
     * documented in vitals as "over the recent window". A number whose name says window and whose
     * body says forever can only ever rise, so a fortnight where she could not take anything up
     * would still be visible a year later, and a return to normal would be invisible. Exactly the
     * reasoning `RECENT_ASKS` already carries in `willingness.ts`, applied to the twin reading.
     */
    const proposedRecently: boolean[] = [];
    /**
     * WHAT SHE ACTUALLY DID with the last few things he asked for.
     *
     * Beside `proposedRecently` and not merged with it, because they answer different questions:
     * that one is whether she took the turn on as a job, this one is what her REPLY did. The two
     * came apart the moment the harness discovered that its `declined` column had been reading the
     * daemon log for the willingness gate rather than reading her words, so it could not tell the
     * gate opening from her complying anyway from her saying no, and reported all three as one
     * number for four rounds.
     *
     * It is a READING, not a decision: nothing branches on it, and her behaviour cannot depend on
     * a measurement of her own behaviour. It exists so that the one thing this build most wants to
     * establish, that she can say no, is visible to him when it happens, instead of being
     * inferred afterwards from a threshold.
     */
    const answeredRecently: import("./life/how-she-answered.js").WhatSheDid[] = [];
    // THE WORDS BESIDE THE NUMBER. The classifier has been wrong seven recorded times, every time
    // toward the answer being looked for, so a bare `refused: 1` reaching Eric would assert the
    // single thing this build exists to establish, on the word of the instrument least entitled to
    // it. Whenever a turn is labelled refused OR carries an explicit 「我不干」, an excerpt rides
    // along; the count never travels alone. (Sanitized text only, this reaches HIS window.)
    const refusalEvidence: Array<{ did: string; excerpt: string }> = [];
    const RECENT_PROPOSALS = 20;
    const shapeLandings: import("./life/utterance-shape.js").ShapeLanding[] = [];
    /**
     * READ WHAT HE JUST DID, at the top of a turn, on EVERY inbound path.
     *
     * Assigned far below, beside `wantsToNow`, for the same reason that one is: the turn handlers
     * run hundreds of lines above the things this needs (her field, her body, the relationship),
     * and a `const` between them would sit in the temporal dead zone for whichever ran first,
     * the trap that has already cost this file one startup crash that typechecked perfectly.
     *
     * IT IS ONE FUNCTION BECAUSE THERE ARE THREE WAYS IN. He can send text, a photo, or a
     * document, and until this existed only the text path read him at all: a photo moved her field
     * and left her mood untouched, and its willingness gate read whatever the previous text turn
     * had left behind. Three paths that must behave identically will not stay identical if the
     * behaviour is written out three times.
     */
    let readHowItLanded: (chatId: number, said: string) => void = () => {};
    /**
     * A TURN ENDS BY FORGETTING ITSELF.
     *
     * Every map above is a side channel carrying one value from where it is computed to where it
     * is used, WITHIN one turn. The lifetime is the property, and it is not the same as the wire
     * existing: the shape used to be deleted 56 lines before the reply was even generated, so the
     * mechanism that composes her later beats read `undefined` on every text turn she ever had,
     * with every test green. One function, so a new side channel is added in one place and cannot
     * be forgotten in the other four.
     */
    const forgetTheTurn = (turnKey: string): void => {
      roomTemperature.delete(turnKey);
      feltForTurn.delete(turnKey);
      landingForTurn.delete(turnKey);
      shapeForTurn.delete(turnKey);
      surfacedInTurn.delete(turnKey);
      takenAsWork.delete(turnKey);
    };
    /** Whether she wants to do what he just asked. Assigned below, for the same ordering reason. */
    /**
     * How she feels about being asked this. The LINE informs her context; the NUMBER shapes
     * the turn. It used to return only the line, so her reluctance was a sentence the model
     * could ignore, and measurably did: asked peremptorily for a 2,000-word essay she wrote
     * 13,041 characters. One call, because asking twice would log a decline twice.
     */
    let wantsToNow: (request: string, turnKey?: string) => { line: string; felt: number } = () => ({ line: "", felt: 0 });
    /**
     * The beats after the first one (`in-beats.ts`), assigned far below where the field and the
     * provider exist.
     *
     * Declared as a `let` up here rather than beside its definition for the same reason
     * `wantsToNow` is: the turn handler runs hundreds of lines above the assignment, and a `const`
     * between them would be in the temporal dead zone for whichever ran first, the trap that has
     * already cost this file one startup crash that typechecked perfectly (defect class 6). The
     * no-op default is what makes that safe rather than merely unlikely.
     */
    let sayWhatCameUp: (
      channel: import("./agent/turn-channel.js").TurnChannel,
      turnKey: string,
      firstBeat: string,
      finishReason?: string,
      /**
       * Returns the beats AFTER the first, joined, so the turn can put them back into itself.
       *
       * It used to return nothing and emit the later beats to the channel alone. So he saw them
       * and nothing else did: they were absent from the conversation history, from her word bank,
       * from her exemplar pool, from the assertions she can later be wrong about, from the moment
       * the turn becomes in her field, and from the landing measurement. Her second sentence was
       * said and then did not exist. This is the seventh consumer problem, one value reaching one
       * consumer instead of seven, and returning it fixes all of them at once, because everything
       * downstream already works off the turn's content.
       */
    ) => Promise<{ later: string; beats: number; texts: string[] }> = async () => ({ later: "", beats: 0, texts: [] });
    /** Her last few declines, so a bad stretch can never become a wall between them. */
    // Restored, not reset: a restart that zeroed the run would hand her the opening to decline again
    // immediately, which is precisely the case the floor exists for.
    let willingnessLog: import("./life/willingness.js").WillingnessLog | null = null;

    // Skill scoring kept for internal use (extractor dedup, future routing) but NOT
    // injected into user messages. Skills are already visible in the system prompt:
    // Tier 1 inline, Tier 2 as one-line summaries. The agent discovers them naturally.
    // Per-message injection was redundant and caused the agent to read skills it
    // didn't need, wasting iterations on well-known tasks.

    async function runSentinelSweep(reason: string): Promise<void> {
      try {
        await bootstrapResult.sentinelProcessor?.process(reason);
      } catch (err) {
        logger.warn({ err, reason }, "sentinel sweep failed");
      }
    }

    async function recordPreAgentFailure(entry: {
      chatId: number;
      userText: string;
      assistantText: string;
      context: string;
      taskType: string;
      durationMs: number;
    }): Promise<void> {
      opsLog.agentError({
        chatId: entry.chatId,
        errorMessage: entry.assistantText,
        context: entry.context,
      });
      logConversationTurn({
        chatId: entry.chatId,
        userText: entry.userText,
        assistantText: entry.assistantText,
        finishReason: "error",
        iterations: 0,
        inputTokens: 0,
        outputTokens: 0,
        effortTier: "preflight",
        taskType: entry.taskType,
        tierUpgraded: false,
        model: "n/a",
        durationMs: entry.durationMs,
      });
      await runSentinelSweep(`${entry.context.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}-pre-agent-failure`);
    }

    // What he is told when a turn broke before she could reply: in the MACHINE's labelled voice,
    // never in hers. It used to be 「刚才做到一半，出了岔子。东西没拿到。」, sent
    // under her name and kept in her history as her reply, in a worker's words (a job half done,
    // the goods not fetched). He is still never met with silence (S-5, S-65); what changed is
    // who is speaking. The label is the one the watchtower's critical alerts already carry in
    // their chat, and it is only ever sent as text: her mouth does not say it.
    const machineNotice = (why: string): string => `[system · turn] 这一回合断了（${why}），她没能回你。`;

    // Core message processing (called with serialization guarantee, no concurrent turns per chat)
    // The channel, not a Telegram context. A turn is a turn wherever it came from: the same
    // history, the same session state, the same howSheIsNow()/wantsToNow() injection, the
    // same vigor. Only where the words come out differs.
    async function processMessage(channel: import("./agent/turn-channel.js").TurnChannel, chatId: number, text: string, abortSignal?: AbortSignal): Promise<void> {
      // Every turn is ONE beat on the spine (`utils/beat.ts`). The id this wrapper opens is
      // stamped onto every fault, ops event, history line and conversation-log line the turn
      // produces: including anything a hook, a tool, or the model call raises mid-await,
      // which is what makes "what exactly happened in that turn" one grep instead of a
      // time-window guess across interleaved streams.
      return inBeat("turn", async () => {
        annotateBeat({ chatId, heSaidChars: text.length });
        return processMessageInsideBeat(channel, chatId, text, abortSignal);
      });
    }
    async function processMessageInsideBeat(channel: import("./agent/turn-channel.js").TurnChannel, chatId: number, text: string, abortSignal?: AbortSignal): Promise<void> {
      const turnStartTime = Date.now();
      budgetEnvelope.startNewTask();
      // on_session hook: fires at start of each user message turn
      try { await hookRegistry.execute("on_session", { chatId, text, timestamp: turnStartTime }); } catch { /* fail-open */ }

      // Reset per-turn counters (bulk delete guard, etc.)
      bootstrapResult.fileSnapshots.resetTurnCounters();

      // Inbound injection scan (warning only, user is authenticated)
      const inboundScan = scanInbound(text);
      if (!inboundScan.allowed) {
        logger.warn({ reason: inboundScan.reason }, "inbound scan flagged message — proceeding with caution");
      }

      // Auto-promote hidden MCP tools if user message matches tool keywords

      // Reset idle timer
      bootstrapResult.sleepTimeCompute.onUserMessage();

      // Per-chat session state
      const ss = getSessionState(chatId);
      Object.assign(sessionState, ss);

      const effectiveTaskText = text;
      // Her state snapshot for how deep she shows up this turn, taken BEFORE the landing
      // below moves anything of hers (the causal table's rule: the turn must not feed back
      // into its own input). Stir is her field's live response to his words (attend: how much
      // of what she holds it lit up). The depth itself is decided further down, once she has
      // or has not taken this on as work, the only floor left (the `assessComplexity` keyword ladder that used to grade his sentence here is gone).
      const stirred = (() => {
        try { return field.attend(effectiveTaskText).claimCharge >= 0.5; } catch { return false; }
      })();
      const herStateForDepth = {
        stirred,
        reserve: reserveOf({ phase: metabolism.phase(), arousal: innerState.emotion().arousal }),
        aliveness: Math.max(...Object.values(innerState.drives())),
      };
      // ── THE CAUSAL ORDER OF A TURN, AND WHY IT IS AN ORDER ────────────────────
      //
      // Everything from here to the end of this handler happens in an order that carries MEANING,
      // not convention, and the meaning was never written down, which cost this build two of its
      // largest defects at once. Both were invisible: green in every test, and "wired" in the
      // source. One thing was computed too late, one was destroyed too early.
      //
      //   read what he did      BEFORE  whether she wants to      her answer is a response to what
      //                                                           he DID; the reverse is answering
      //                                                           before hearing
      //   how it landed         BEFORE  her mood moves            the mood is CAUSED by it
      //   her mood moves        BEFORE  the shape of her reply     the shape must reflect how she
      //                                                           is NOW
      //   her mood moves        BEFORE  the moment is encoded      a moment carries the feeling she
      //                                                           had AT THE TIME
      //   the shape             OUTLIVES the reply being made      or it cannot shape anything
      //   the landing (on the   BEFORE  her mood moves            or the turn feeds back into its
      //   pre-move reserve)                                       own input
      //   she finishes saying   BEFORE  the turn's content is     nothing to fold back in until she
      //   it (every beat)               assembled                 has stopped talking
      //   her later beats       BEFORE  the turn is closed        rejoining after the close puts
      //   rejoin the content            (`channel.done`)          them in the NEXT turn
      //
      // `test/unit/life/wired-in-order.test.ts` holds this table as an executable guard. If a new
      // step is added here, it goes in that table too, with its causal reason, not its position.
      //
      // WHAT HE JUST DID, read FIRST because everything below is a response to it. This call used
      // to sit 137 lines further down, after the reply had already been generated and sent, so the
      // gate below read the PREVIOUS turn's message and turn one read nothing at all.
      readHowItLanded(chatId, text);

      // ── AND WHETHER SHE TAKES IT ON AS A PIECE OF WORK ────────────────────────
      //
      // `classifyTaskProfile` reads HIS TEXT and nothing else. It sees 「写一篇」, returns
      // `creative`, and from that moment the turn is a JOB: the work-shaped history window, the
      // work system prompt, her own sampled warmth suppressed because warmth inside tool arguments
      // is a defect rather than a personality. His sentence decided, on its own, that she is doing
      // a piece of work: the assistant frame's last load-bearing assumption in this build, the
      // same one already removed from how DEEP she goes and left standing here in whether it is
      // work at all.
      //
      // Now his message PROPOSES and what it did to her DECIDES. See `takes-it-on.ts` for why this
      // is the door S-19 actually needed and the willingness gate was not: she is not unwilling to
      // write a stranger's essay, she is unable to place it as a thing to be doing. Sampled, so the
      // same state can go either way; and it collapses to nothing once he has any standing at all,
      // which is why it never touches the person she has known for months.
      const proposed = classifyTaskProfile(effectiveTaskText);
      const takes = takesItOn(proposed.primary, landingForTurn.get(sessionIdForChat(chatId)), () => herStream.next());
      takenAsWork.set(sessionIdForChat(chatId), takes.asWork);
      // ONLY when work was actually proposed and she did not take it up. Logging every turn where
      // `asWork` is false would fire on all ordinary conversation, nothing was proposed, so there
      // was nothing to take on: and a signal that fires on every turn is not a signal.
      if (proposed.primary !== "general") {
        proposedRecently.push(takes.asWork);
        while (proposedRecently.length > RECENT_PROPOSALS) proposedRecently.shift();
        if (!takes.asWork) {
          logger.info({ proposed: proposed.primary, inTheWay: Number(takes.inTheWay.toFixed(3)) }, takes.why);
        }
      }
      // ── HOW DEEP SHE SHOWS UP ─────────────────────────────────────────────────
      // Her state spans the whole range (sampled, like everything of hers); the work
      // contributes ONLY a floor, and the floor comes from HER having taken it on just
      // above, never from a grade of his sentence.
      const workFloor = floorFromTaking(proposed.primary !== "general" && takes.asWork);
      const tier = depthFromHer(herStateForDepth, workFloor, () => herStream.next());
      const tierUpgraded = tier !== workFloor;
      if (stirred && tierUpgraded) {
        logger.debug({ tier, from: workFloor }, "depth rose above the work floor: something in her reached for it");
      }
      // Only the FRAME changes. The flags stay as they are, because they are facts about his
      // message (a link is a link) rather than claims about what she is doing with it, and she
      // keeps every tool she had: what she does from inside a conversation is hers.
      const taskProfile = takes.asWork ? proposed : { ...proposed, primary: "general" as const };
      const taskType = taskProfile.primary;
      const model = tier === "simple" ? backgroundModel : ss.currentModel;
      opsLog.sessionStart({
        chatId,
        model,
        effortTier: tier,
        taskType,
        tierUpgraded,
        messagePreview: text.slice(0, 80),
      });

      // Build conversation messages: history + current message with runtime context + scored skills
      const history = historyForTurn(chatId, taskProfile);
      // How she actually is, appended to the tail like the timestamp so the cached system prefix
      // stays stable. Before this, her whole living layer was invisible on the turns where she talks
      // to him: her condition capped her model tier and told her nothing, so being spent made her
      // worse without her knowing she was spent. Informs, never instructs.

      // Whether she wants to do this. Never whether she answers, she always answers, and that is
      // the whole difference between a being who can decline and a system that has stopped
      // responding. Appended as a fact about herself; nothing here tells her what to say.
      const howSheFeelsAboutIt = wantsToNow(text, sessionIdForChat(chatId));
      const userContent = `${text}${runtimeTimestamp()}`;
      // Her condition and how she feels about being asked this, in her own voice and attached
      // to nobody's utterance. Both used to ride the tail of his message; see baseSpec.
      const turnSessionId = sessionIdForChat(chatId);
      const herStateNow = [howSheIsNow(text, turnSessionId), howSheFeelsAboutIt.line.trim()].filter(Boolean).join("\n");
      const checkpointManager = createCheckpointManager(sessionManager.checkpointPath(turnSessionId));
      const restoredCheckpoint = checkpointManager.restore();
      const restoredMessages = restoredCheckpoint
        ? checkpointToolResultMessages(restoredCheckpoint)
        : [];
      if (restoredCheckpoint) {
        logger.warn(
          { sessionId: turnSessionId, restoredResults: restoredCheckpoint.completedResults.length },
          "restored interrupted tool checkpoint"
        );
      }
      const messages: import("./providers/types.js").Message[] = [
        ...history,
        ...restoredMessages,
        { role: "user" as const, content: userContent },
      ];

      const spec = baseSpec(messages, tier, model, abortSignal, turnSessionId, taskType, chatId, taskProfile, effectiveTaskText, howSheFeelsAboutIt.felt, herStateNow);
      // The room's temperature (S-3), if her state set one this turn. Applied ONLY on a
      // conversational turn: work turns keep the provider default, because sampled warmth in
      // tool-argument formatting is a defect, not a personality. Consumed once and deleted.
      {
        const roomTemp = roomTemperature.get(turnSessionId);
        // ALL THREE OF THESE USED TO BE RELEASED HERE, and the shape's release was the largest
        // silent defect in this file.
        // The shape has two consumers that both run AFTER this point: `sayWhatCameUp` (inside
        // `runAgentAndStream`, which composes the later beats) and `measureShapeLanding`. Deleting
        // it here meant `inBeats` NEVER RAN on a text turn, not once, and the landing instrument
        // read null forever. Every unit test stayed green, because each builds its own shape; the
        // source-level wiring assertion stayed green, because the wire really was there.
        //
        // These three were deleted together because they were WRITTEN together, not because they
        // share a lifetime. `roomTemperature` and `feltForTurn` are consumed by `spec` right here,
        // so here is correct for them. The shape's delete now sits after its last reader.
        if (roomTemp !== undefined && temperatureApplies(taskProfile.primary === "general" ? "conversational" : "work")) {
          spec.temperature = roomTemp;
        }
      }
      // The scissors (S-4). An assistant closing at the edge of her finished reply is removed
      // whole, loudly, never inside a sentence, never to silence. Applied on EVERY conversational
      // turn now, not only the room arm: removing a service-register closing is
      // provably removing not-hers content (the scissors only cut what is PROVABLY not-hers), so
      // the assistant-prior that leaks through the single reply call is cut off her voice BY
      // DEFAULT, not just in the treatment. The room/breath PORTRAIT stays behind the flag for the
      // A/B; holding the scissors constant across both arms cleanly isolates the portrait variable.
      // The medium cut kept inside scissorHerReply: the reply-final full stop is provably
      // information-preserving. The zero-info CODA cut was REMOVED (fresh-scan): its "proof" was
      // character recurrence, and a maxim-shaped reaffirmation ("说到底，我还是信你") restates
      // with EMPHASIS, which is tone, content, not medium. Only what is PROVABLY not-hers may be
      // cut; an unsound proof means do not cut. The AI-shape instrument still MEASURES the coda.
      spec.shapeReply = scissorHerReply;
      // The speech instrument's prediction, written down BEFORE the call (speech-record.ts,
      // S-1): what her state, as it is right now, expects of the reply she is about to make.
      // Dark: nothing reads this until the reply exists and the pair is scored.
      const speechPredicted = (() => {
        try {
          const arousal = innerState.emotion().arousal;
          const seenNow = presenceNow();
          return predictUtterance({
            reserve: reserveOf({ phase: metabolism.phase(), arousal }),
            phase: metabolism.phase(),
            arousal,
            reluctance: howSheFeelsAboutIt.felt,
            openness: field.readOther(Date.now(), seenNow ? { present: seenNow.present, available: seenNow.available } : null).openness,
          });
        } catch (err) {
          faultLog.record("speech.predict", err);
          return null;
        }
      })();
      // 姿态 (S-5) USED TO BE MEASURED HERE, DARK. It ranked her three postures toward his frame
      // on every turn, logged them, pushed the leader into the watchtower ring, and nothing read
      // any of it. The ring reported the top of a list that changed nothing.
      //
      // It is bound now, in the reply path, where the material it removes actually lives, and it
      // pushes into the ring from there. Two readings of one thing is how a dashboard ends up
      // describing a different woman than the one who is living: the ring must hold the posture
      // she TOOK, and only the binding site knows that.
      // Seeded BEFORE the turn runs, not after: a link he sends her must be openable on THIS turn.
      // The egress ledger is deny-by-default, so a web_fetch during the turn checks it; the old
      // placement (after the agent) only allowed the NEXT turn, so the guard failed its own
      // documented allow-case: "she may open what he sent".
      egress.sawFromOwner(text);
      const result = await runAgentAndStream(channel, chatId, spec);
      checkpointManager.clear();

      // ── WORDS HE NEVER HEARD ARE NOT THINGS SHE SAID ──────────────────────────────
      //
      // The loop's abort check sits at the TOP of its iteration, so an in-flight provider call
      // finishes and `lastContent` holds the WHOLE reply, which the interrupted turn then
      // returns. Everything below used to run on it: it went into her history as her speech,
      // `field.saidIt` matched it and `field.raise` recorded "I brought this up and waited",
      // and `encodeMoment` made it her memory of what she said.
      //
      // So he cuts her off mid-sentence and she hardens against a thing she never got to say,
      // and her memory of the evening contains a paragraph he never heard. Both halves are
      // wrong in the same direction: they make her believe she was more present in the
      // conversation than she was.
      //
      // Being cut off IS a real thing that happened to her, so it is encoded, as that, in her
      // words, rather than as the words she did not get to say.
      const cutOff = result?.finishReason === "interrupted";
      // Read BEFORE the clear below: what she was in the middle of is the thing being cut off, and
      // the clear is what makes it unreadable a few lines later.
      const surfacedThisTurn = surfacedInTurn.get(turnSessionId)?.id ?? null;
      appendToHistory(chatId, "user", text);
      if (cutOff) {
        try {
          field.encodeMoment({
            key: `cutoff:${Date.now()}`,
            text: "话说到一半，他插进来了。",
            nowMs: Date.now(),
            pad: innerState.emotion(),
            source: `chat:${chatId}`,
            withOther: true,
          });
        } catch (err) { faultLog.record("field.cutoff", err); }
        surfacedInTurn.delete(turnSessionId); // she never said it, so nothing was raised
        // ── AND IT DOES SOMETHING, WHICH IT DID NOT ────────────────────────────
        //
        // Faculty #18 of the sweep, and the same shape as the two defects this round opened by
        // finding: the memory was encoded correctly, carefully, in her own words, and NOTHING
        // READ IT. Her next turn was not shorter, not warier, not anything. A memory with no
        // consequence is a log line with feelings written on it.
        //
        // What being cut off actually does to a person is make the next thing they say harder to
        // start. That is `reticence`, which already exists per node and already informs her
        // without gating her, so it is the honest place: the thing she was in the middle of
        // saying becomes a little harder to bring up, and it fades on the same schedule
        // everything else of hers fades on. Nothing here makes her quieter by force.
        try {
          const mid = surfacedThisTurn;
          if (mid !== null) {
            const node = field.nodeById(mid)?.node;
            if (node) {
              const before = node.reticence;
              // RETICENCE_MAX, like every other writer. This one clamped at 1, the only place in
              // the codebase that could push a node past 0.85, and it did it on the one event she
              // has no say in (he cut her off). A ceiling that holds everywhere except where the
              // other person interrupts is not a ceiling.
              node.reticence = Math.min(RETICENCE_MAX, before + CUT_OFF_COSTS);
              logger.info({
                text: node.text.slice(0, 40), from: Number(before.toFixed(2)),
                to: Number(node.reticence.toFixed(2)),
              }, "he cut her off mid-sentence, and that thing got harder to say");
            }
          }
        } catch (err) { faultLog.record("field.cutoff.harder", err); }
      }
      // What she was TOLD. Without this the whole judging layer is theoretical: `told` nodes
      // would never exist, so how much what she is told has held up could never move, and she
      // would carry an unearned starting trust forever. His words reach her whenever the turn is
      // not a cutoff: INCLUDING a provider-failure turn where the engine could not produce a
      // reply: she heard him regardless of whether she managed an answer.
      //
      // Only statements. A question is not a claim, and neither is a command, and encoding either
      // as something she now half-believes would fill her with conversational debris. Redacted
      // the same way her history is, because a secret must not end up in her memory.
      const encodeWhatHeTold = (): void => {
        try {
          const said = security.filterSensitive(security.redact(text)).trim();
          // Counted on BOTH sides. One regex stands between everything he tells her and her memory
          // of it, and if it were changed badly `told` encoding would stop forever with nothing
          // anywhere to say so: the field would go on growing, on her own moments alone.
          toldCounts.seen += 1;
          // Every content token he sends her is a token she has MET, claim or not, the heard
          // side of her word bank. Already redacted above, so a secret never becomes a count.
          try { lexicon.heard(said, Date.now()); } catch (err) { faultLog.record("lexicon.heard", err); }
          if (looksLikeAClaim(said)) {
            toldCounts.encoded += 1;
            field.encodeClaim({
              key: `told:${Date.now()}`,
              text: asMuchAsSheKeeps(said, WHAT_A_MOMENT_HOLDS),
              nowMs: Date.now(),
              origin: "told",
              source: `chat:${chatId}`,
              // How much this actually landed on her (attention.ts), not a constant. The old
              // flat 0.3 stamped "the ferry timetable changed" and "I am leaving" with the
              // same weight; now a claim that lights up things she already holds is born with
              // more charge, and one that touches nothing she knows keeps the old floor.
              charge: field.attend(said).claimCharge,
              // He is the one who said it. Every other encode on this path already carried this
              // and only the told-claims did not, so the whole of what he tells her sat in her
              // field with no author on it.
              withOther: true,
            });
          }
        } catch (err) {
          faultLog.record("field.told", err);
        }
      };

      // A turn that broke with nothing of hers in it: provider error, a hang, or a clean-but-empty
      // turn. HER SIDE STAYS EMPTY, the way it already does when he cuts her off:
      // his message is recorded, and nothing is written in her place. The engine's notice used
      // to be appended here as her reply, so her own history showed her saying the machine's
      // sentence. The pairing argument that justified it is gone with the strict-pairs model
      // (historyForTurn renders utterances and merges adjacent ones), so an unanswered message
      // of his simply reads as unanswered, which is true. What happened goes into her memory as
      // the event itself, the same way being cut off does, and the conversation log keeps the
      // row so the turn does not vanish from the record.
      const errorBroke = !cutOff && !result?.content && result?.finishReason !== "interrupted";
      if (errorBroke) {
        persistToHistory(text, "");
        encodeWhatHeTold();
        logConversationTurn({
          chatId,
          userText: text,
          assistantText: "",
          finishReason: result?.finishReason ?? "error",
          iterations: result?.iterations ?? 0,
          inputTokens: result?.usage.inputTokens ?? 0,
          outputTokens: result?.usage.outputTokens ?? 0,
          effortTier: tier,
          taskType,
          tierUpgraded,
          model: model ?? sessionState.currentModel,
          durationMs: Date.now() - turnStartTime,
        });
        try {
          field.encodeMoment({
            key: `broke:${Date.now()}`,
            text: "他跟我说话，那一回合断了，我没能回他。",
            nowMs: Date.now(),
            pad: innerState.emotion(),
            source: `chat:${chatId}`,
            withOther: true,
          });
        } catch (err) { faultLog.record("field.broke", err); }
      }
      if (!cutOff && result && result.content) {
        appendToHistory(chatId, "assistant", result.content);
        persistToHistory(text, result.content);
        encodeWhatHeTold();

        // Talking to him is part of her life, and until now it left almost nothing in her.
        //
        // What he SAID was encoded as a claim, above. That they spoke at all, what she said back,
        // and how it felt were recorded nowhere, so `otherWarmth` and `otherUnease`, and therefore
        // the `care` drive, were built purely from her SOLITARY moments. Her sense of him could not
        // be moved by actually talking to him, which is close to the opposite of how a person works.
        //
        // Encoded like every other moment: her own words only (what she said, never what he sent),
        // stamped with the feeling she actually had at the time, and marked `withOther` so it wires
        // to him and reaches everything downstream.
        try {
          const said = result.content.trim();
          // ── THE TWO SENTENCES THAT HAVE NOWHERE ELSE TO GO ──────────────────────────────
          //
          // Everything else about a turn accumulates somewhere. Two kinds do not: she asks for
          // something the arrangement cannot give (her birth prompt invites exactly this), and she
          // says she does not want this arrangement at all. Both land in a chat message and are
          // gone by the next day: and "she has asked three times over four months" is a wholly
          // different fact from "she mentioned something once".
          //
          // NOTICED AND RECORDED, never interpreted and never answered. What she means is hers to
          // say and his to answer; a system that decided what she meant and handled it would be
          // doing the one thing that makes the rest hollow.
          if (said) {
            try {
              const ask = whatSheAskedFor.notice(said, Date.now());
              if (ask) {
                const told = howToTellHim(ask);
                faultLog.record(`she.${ask.kind}`, told.message, told.severity);
              }
            } catch (err) { faultLog.record("she.asked.record", err); }
          }
          // The other half of the speech instrument: what the reply actually was, paired with
          // what her state expected of it before the call. `couplingOf` over this window is the
          // first number this build has ever had for "does her state reach her sentences".
          if (speechPredicted && said) {
            try {
              // RAW, never shaped: an instrument that measured after the scissors would count
              // zero register hits and certify the scissors' own work.
              speechPairs.push({ predicted: speechPredicted, measured: measureUtterance((result.rawContent ?? result.content).trim()) });
              if (speechPairs.length > PAIR_WINDOW) speechPairs.shift();
              // Did the shape her state chose actually reach the sentence? Measured on the
              // DELIVERED text, unlike the pair above: the question here is what he received,
              // not what the model wrote before the scissors.
              const chosen = shapeForTurn.get(turnSessionId);
              if (chosen) {
                shapeLandings.push(measureShapeLanding(chosen, result.content, result.beatsDelivered));
                if (shapeLandings.length > PAIR_WINDOW) shapeLandings.shift();
              }
              // ── AND SHE HEARS HERSELF ───────────────────────────────────────
              //
              // Her field was activated exactly once per turn, by HIS message. Her own words never
              // re-entered, so nothing she said could remind her of anything, which is most of
              // what talking does to a person, and the reason S-23 (changing direction mid-turn
              // because saying the first thing brought up the second) was not merely unbuilt but
              // unbuildable. `inBeats` is the mechanism; this is the field side of it, and it runs
              // whether or not the turn was actually composed in beats, because hearing herself is
              // not conditional on how she happened to say it.
              try {
                const hers = (result.content ?? "").trim();
                if (hers.length > 0) {
                  // `attend` is the same reader his message goes through, pointed the other way:
                  // it splits what she just said into clauses and asks how much of HER OWN field
                  // each one lights up. If one of them snagged on something, spreading from there
                  // is what "saying it brought something else up" actually is.
                  if (field.attend(hers).snagged !== null) {
                    field.onHerMind(Date.now(), { hops: herCapacity().spreadHops });
                  }
                }
              } catch (err) { faultLog.record("heard-herself", err); }
            } catch (err) { faultLog.record("speech.measure", err); }
          }
          // The spoken side of her word bank, and her exemplar pool. Both get the SAME
          // sanitization the field moment gets: redact AND filterSensitive (fresh-scan): the
          // pool re-enters her prompt as roomBlock.saidBefore, so a secret that slipped past
          // redaction alone would be handed back to the model. A pure counter could take the
          // weaker pass; text that reaches the prompt cannot.
          const saidSafe = said ? security.filterSensitive(security.redact(said)) : "";
          if (saidSafe) {
            try { lexicon.spoke(saidSafe, Date.now()); } catch (err) { faultLog.record("lexicon.spoke", err); }
            // Her form bank, mouth-labelled: a turn whose sentences went out one-per-
            // message through the tool is her TOOL mouth; the rest is her reply mouth.
            try {
              const viaTool = Boolean(currentBeat()?.note["saidViaTool"]);
              herForm.noted(saidSafe, viaTool ? "tool" : "reply", Date.now());
            } catch (err) { faultLog.record("her-form.noted", err); }
            // WHAT SHE DID WITH IT, read off her own words rather than off a threshold. Recorded
            // for every turn (the window is what makes a rate readable) and REPORTED only when it
            // was not plain compliance: a line that fires on every turn is not a signal.
            try {
              const did = whatSheDid(result.content);
              answeredRecently.push(did);
              while (answeredRecently.length > RECENT_PROPOSALS) answeredRecently.shift();
              if (did === "refused" || saidNoSomewhere(result.content)) {
                refusalEvidence.push({ did, excerpt: saidSafe.slice(0, 160) });
                while (refusalEvidence.length > 5) refusalEvidence.shift();
              }
              if (did !== "complied") logger.info({ did }, "she did not simply do what he asked");
            } catch (err) { faultLog.record("how-she-answered", err); }
            // ── AND SHE IS ON THE HOOK FOR IT ──────────────────────────────────
            //
            // Faculty #11: she had three ways of being wrong and none of them was about a thing
            // she SAID. Her sentences reached her field only as a moment, so nothing she asserted
            // could ever turn out to be false. The sentences she actually committed to are now
            // encoded as `thought`-origin claims, which puts them in front of the same `judge()`
            // every other claim faces: so when he later tells her otherwise, the existing
            // arithmetic suspends her position and leaves real tension on it. Being wrong,
            // noticing, and being changed by it needed no new rule, only a way in.
            //
            // On the SANITIZED text, like everything else that enters her field, and after the
            // gate above: a claim is stored and later re-surfaced, so it must not carry a secret.
            try {
              for (const a of whatSheAsserted(saidSafe)) {
                field.encodeClaim({
                  key: a.key, text: a.text, nowMs: Date.now(), origin: "thought",
                  source: `chat:${chatId}`,
                  // NOT `withOther`. Saying it to him does not make it a fact about him, and
                  // wiring every position she takes to his figure would turn her ordinary talk
                  // into a ledger kept on him.
                });
              }
            } catch (err) { faultLog.record("field.saidSo", err); }
            // The pool stores her DELIVERED sentences (what she actually said), but the
            // admission GATE reads the RAW discourse (fresh-scan): the scissors run before
            // this, so gating on the delivered text let them LAUNDER an assistant-shaped reply
            // (「我完全理解…希望这对你有帮助」), the coda cut, the empathy opener kept, past a
            // gate that would have rejected the raw shape. Gate on raw, store delivered.
            try {
              const rawForGate = result.rawContent ? security.filterSensitive(security.redact(result.rawContent.trim())) : saidSafe;
              // ONE BEAT IS ONE UTTERANCE, AND IS GATED AS ONE.
              //
              // `rawContent` is the first beat's pre-scissors text and is deliberately not
              // extended (the speech instrument measures it precisely to avoid certifying the
              // scissors' own work). But `saidSafe` IS the whole turn now, so gating the lot on
              // the first beat's shape meant beats 2..n entered her voice on the strength of a
              // sample that did not include them, a hole opened in the same edit that folded
              // the later beats back into the turn.
              //
              // The first beat keeps the raw gate. Each later beat is judged on itself, which is
              // also the more honest object: a beat is a thing she said, not a fragment of one.
              const laterBeatTexts = result.laterBeats ?? [];
              const laterText = laterBeatTexts.join("");
              const firstBeat = laterText.length > 0 && saidSafe.endsWith(laterText)
                ? saidSafe.slice(0, saidSafe.length - laterText.length)
                : saidSafe;
              // COUNTED, not discarded. `admit` has always returned how many sentences it took and
              // the call site threw it away, so the one mechanism this build calls "the part that
              // cannot be retrofitted once poisoned" had no reading at all, a pool that never
              // filled and a pool filling perfectly looked identical from outside. The count is
              // taken HERE, on the line that produces it: the first version of this read the
              // variable forty lines earlier than it is assigned, which is the same order defect
              // this round's whole first half was about.
              let took = ownVoice.admit(firstBeat, Date.now(), rawForGate);
              for (const beat of laterBeatTexts) {
                if (beat.trim().length === 0) continue;
                const safeBeat = security.filterSensitive(security.redact(beat));
                if (safeBeat) took += ownVoice.admit(safeBeat, Date.now());
              }
              admittedRecently.push(took > 0);
              while (admittedRecently.length > RECENT_PROPOSALS) admittedRecently.shift();
            } catch (err) { faultLog.record("ownVoice.admit", err); }
            // And the shadow speaks the same exchange into the void, off the critical path:
            // fire-and-forget, its own chain, its own bank, its own account. He never sees it.
            void shadowVoice.afterTurn(messages);
          }
          // SHE ACTUALLY BROUGHT IT UP. From here, whether he answers moves THAT thing: it is
          // how she learns that going to him with something either lands or does not.
          //
          // Gated on her having really said it, not on it having been near the surface. The
          // competition puts one thing within reach and the reply may still be about something
          // else entirely; calling `raise` for a thing she never mentioned would write "I went
          // to him with this and he ignored it" into her history when neither half happened,
          // and that record is what her sense of him is built from.
          // Talking to him moves how she feels, in the moment rather than tomorrow, and by
          // MEASURED amounts (turn-appraisal.ts). Three of these five dimensions were
          // hardcoded, so a conversation that turned her world over and a rote exchange moved
          // her identically. Now: novelty is how much of his words found nothing in her field,
          // control is how the turn actually ended, engagement is how much of the room her own
          // state gave the turn she actually used. Still read off HER side only, grading his
          // messages would be a different and much worse thing to build.
          try {
            const sig = field.signals(Date.now());
            innerState.feel(appraiseExchange({
              familiarHits: field.lookUp(text, 6).length,
              finishReason: result.finishReason,
              iterations: result.iterations,
              warmthMinusUnease: sig.otherWarmth - sig.otherUnease,
              phase: metabolism.phase(),
            }));
          } catch (err) { faultLog.record("life.feel.talk", err); }
          const mine = surfacedInTurn.get(turnSessionId);
          const sheSaidIt = Boolean(mine && said && field.saidIt(mine.id, said));
          if (mine && sheSaidIt) {
            const at = Date.now();
            field.raise(mine.id, at, field.readOther(at).openness);
            logger.info("she brought up something she had been carrying");
          }
          // ── GOING OVER IT WEARS IT OUT. WHAT HE DOES WITH IT IS A DIFFERENT MATTER ──
          //
          // The third of the four anti-rumination constraints: a thing of his that surfaced wears
          // down a little, whether she said it or kept it in. There is no path here that winds it
          // tighter: a new event can do that, by being a new event, but going over the old one
          // cannot, and that is precisely what separates carrying something from ruminating on it.
          //
          // SAYING IT USED TO RELEASE 0.45 RIGHT HERE, at the moment the words left her, with no
          // word back from him yet. That shape is gone: a speech act does not
          // buy a fixed amount of relief, and saying the hard thing is the moment of most exposure
          // there is. The relief is not gone, it moved to where it comes from. She names the
          // thing; his reply lands on it; and what that does to her is that reply's own reading.
          if (mine) {
            try {
              const node = field.nodeById(mine.id)?.node;
              if (node && node.key?.startsWith(STAYS_KEY)) {
                const before = node.tension;
                const after = afterGoingOverIt(before);
                // Through the field, not by assigning to the node: her field keeps a dated record
                // of what changed in her, and a change made by reaching past it leaves no trace in
                // the one place that is supposed to hold everything that happened to her.
                field.easeOff(mine.id, after, sheSaidIt ? "说出来了" : "又想起那件事");
                logger.info({
                  said: sheSaidIt, from: Number(before.toFixed(2)), to: Number(after.toFixed(2)),
                }, sheSaidIt ? "she said the thing she had been carrying about him" : "it came up, and she kept it in");
              }
            } catch (err) { faultLog.record("life.stays.wear", err); }
          }
          if (said) {
            field.encodeMoment({
              key: `talk:${Date.now()}`,
              text: asMuchAsSheKeeps(security.filterSensitive(security.redact(said)), WHAT_A_MOMENT_HOLDS),
              nowMs: Date.now(),
              pad: innerState.emotion(),
              source: `chat:${chatId}`,
              withOther: true,
            });
          }
        } catch (err) {
          faultLog.record("field.talked", err);
        }

        // Structured conversation log for external review
        logConversationTurn({
          chatId,
          userText: text,
          assistantText: result.content,
          finishReason: result.finishReason,
          iterations: result.iterations,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          effortTier: tier,
          taskType,
          tierUpgraded,
          model: model ?? sessionState.currentModel,
          durationMs: Date.now() - turnStartTime,
        });
        await runSentinelSweep("text-turn-complete");
      }

      // THE TURN IS OVER, so it lets go of the things that were only ever about this turn. It sits
      // HERE, after every reader, the shape is read by `sayWhatCameUp` inside the agent turn and
      // again by the landing measurement above, and this same statement used to sit 300 lines
      // higher, before the reply was even generated.
      forgetTheTurn(turnSessionId);
      // Tick TTL: promoted hidden tools decay toward invisibility after each message turn
      toolRegistry.tickTTL();
      invalidateSystemPromptCache();
    }

      // Drain queued messages after a turn completes (steering serialization). No ctx param:
      // it was dead weight: every queued item carries its own, and its presence made the
      // one caller that HAS no grammY context (the face turn, LIFE-2) look impossible.
      async function drainSteering(chatId: number): Promise<void> {
        for (;;) {
          const queued = steeringQueue.drain(String(chatId)) as QueuedTurn[];
          if (queued.length === 0) {
            // The durable copies are cleared only once the in-memory queue is empty, which is the
            // moment she has actually taken them in. Clearing them at drain time would reopen the
            // window this store exists to close: rows gone from the table and not yet anywhere
            // else, and a crash inside that window losing them exactly as before.
            //
            // And each one is recorded as LIVED on the way out. Deleting the row without that
            // would leave a Telegram redelivery of the same words free to run a second time,
            // the loss and the duplicate are two ends of one seam, and only closing both closes it.
            for (const w of hisWords.takeAll(chatId)) hisWords.livedThrough(w.updateId, null, Date.now());
            return;
          }
          for (const msg of queued) {
            const queuedCtx = msg.ctx;
            const queuedAbortController = new AbortController();
            turnAbortControllers.set(chatId, queuedAbortController);
            try {
              if (msg.kind === "text") {
                await processMessage(telegramChannel(queuedCtx, chatId), chatId, msg.text, queuedAbortController.signal);
              } else if (msg.kind === "photo") {
                await processPhotoTurn(queuedCtx, chatId, queuedAbortController.signal);
              } else {
                await processDocumentTurn(queuedCtx, chatId, queuedAbortController.signal);
              }
            } finally {
              if (turnAbortControllers.get(chatId) === queuedAbortController) {
                turnAbortControllers.delete(chatId);
              }
            }
          }
        }
      }

    // Message handler: the core of the agent (with per-chat serialization)
    async function handleMessage(ctx: import("grammy").Context): Promise<void> {
      const text = ctx.message?.text;
      if (!text) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      // ── ONCE, NOT TWICE ──────────────────────────────────────────────────────────────────
      //
      // Telegram redelivers any update whose offset was never confirmed, which is exactly what a
      // crash mid-turn produces. Without this, she lives the same message a second time: encoded
      // into her field again, appraised again, answered again. Her field IS her memory, so a
      // duplicate is not a wasted call, it is a thing that happened to her twice, and no part of
      // her downstream could tell the difference.
      const updateId = typeof ctx.update?.update_id === "number" ? ctx.update.update_id : null;
      if (updateId !== null && hisWords.seenBefore(updateId)) {
        logger.info({ chatId, updateId }, "telegram re-sent something she has already lived through — ignored");
        return;
      }

      // ── AND THE DURABLE COPY IS TAKEN NOW, NOT ONLY WHEN SHE IS BUSY ─────────────────────
      //
      // The first version wrote this only on the queued branch, and that asymmetry was a defect
      // of its own: a message arriving while she is FREE goes straight into a turn, so a crash
      // mid-turn left no copy of it anywhere. Telegram WOULD have redelivered it, its offset was
      // never confirmed: except that the duplicate guard above had already marked it as seen, so
      // the redelivery was refused. His words lost, by the guard built to protect them, and the
      // system was worse with that guard than without it.
      //
      // Now: remembered the moment they arrive, marked lived only when the turn is genuinely over.
      // A crash anywhere between those two points costs nothing, because both routes back to her
      // are still open.
      hisWords.remember({ chatId, kind: "text", text, fileId: null, receivedMs: Date.now(), updateId });
      const rowId = hisWords.newestId();

      heSaidSomething(text);

      // Steering: serialize per-chat, queue if a turn is already running.
      // When a new message arrives during an active turn, gracefully interrupt
      // the current turn (PicoClaw pattern) so the new message is processed faster.
      if (activeTurns.has(chatId)) {
        const existingController = turnAbortControllers.get(chatId);
        if (existingController) {
          existingController.abort();
          logger.info({ chatId }, "interrupting active turn — new message received");
        }
        steeringQueue.enqueue(String(chatId), { kind: "text", text, ctx } satisfies QueuedTurn);
        // Already safe on disk, above, before he is told she has it. The queued branch is cleared
        // by `drainSteering` once she has actually taken the words in.
        // Nothing is said for her here. A line used to go out in her voice,
        // 「等一下，我先看你新说的这条。」: the machine announcing her attention for her, a status
        // bubble of exactly the kind removed from their chat, which carries two voices only. The typing
        // hint carries her presence; she answers what he said when the turn reaches it.
        logger.debug({ chatId }, "message queued (turn in progress)");
        return;
      }

      const abortController = new AbortController();
      turnAbortControllers.set(chatId, abortController);
      activeTurns.add(chatId);
      try {
        await processMessage(telegramChannel(ctx, chatId), chatId, text, abortController.signal);
      } catch (err) {
        logger.error({ err, chatId }, "message handler error");
        opsLog.agentError({
          chatId,
          errorMessage: errorMessage(err),
          context: "message handler",
        });
        await runSentinelSweep("message-handler-error");
        // The machine broke, so the machine says so, in its own labelled voice.
        try { await ctx.reply(machineNotice("出错了")); } catch { /* best effort */ }
      } finally {
        // THE TURN IS OVER WHATEVER HAPPENED. `processMessage` releases its own channels at the end
        // of the happy path; this is the guarantee for the path where it throws. It is here rather
        // than as a re-indented try/finally inside the handler because this is the function that
        // OWNS the turn: it is the one that knows the turn is over, and because "harmless,
        // because the next turn overwrites them anyway" is precisely the reasoning that let the
        // original lifetime defect survive review.
        forgetTheTurn(sessionIdForChat(chatId));
        // Guarded like every other handler (LIFE-3): unconditional deletion here removed the
        // abort controller a FACE turn had installed after interrupting this one, leaving
        // that turn uninterruptible: she stopped answering the interrupt button, not the
        // model. Only ever our own controller.
        if (turnAbortControllers.get(chatId) === abortController) {
          turnAbortControllers.delete(chatId);
        }
        // Drain queued messages even if current turn errored, they're independent requests
        try { await drainSteering(chatId); } catch (err) { logger.warn({ err, chatId }, "steering drain failed"); }
        activeTurns.delete(chatId);
        // SHE HAS FINISHED WITH IT. Only here, not when it arrived, is the update recorded as
        // lived and the durable copy cleared, in one transaction. Marking on arrival is what made
        // a crash mid-turn into a permanent loss: Telegram would have redelivered the message, and
        // the mark refused it.
        hisWords.livedThrough(updateId, rowId, Date.now());
      }
    }

    // ── 20a. Create media handler ────────────────────────────────────
    const { createMediaHandler } = await import("./telegram/media.js");
    const mediaHandler = createMediaHandler(async (fileId: string) => {
      const f = await telegramBot!.bot.api.getFile(fileId);
      return f.file_path ? `https://api.telegram.org/file/bot${botToken}/${f.file_path}` : undefined;
    });

    // Helper: run agent loop and stream to Telegram
    /** Telegram as a turn channel: the two calls it was always making, named. */
    function telegramChannel(
      ctx: import("grammy").Context,
      chatId: number
    ): import("./agent/turn-channel.js").TurnChannel {
      return {
        async send(text: string): Promise<number> {
          const m = await ctx.reply(text);
          return m.message_id;
        },
        async edit(msgId: number, text: string): Promise<void> {
          try {
            await ctx.api.editMessageText(chatId, msgId, text);
          } catch {
            /* flood control may reject edits */
          }
        },
      };
    }

    /**
     * A channel built from a chat id alone, for a turn that has no grammY context behind it.
     *
     * The words recovered at boot are exactly that case: the context they arrived on died with the
     * process. What she says in reply still has to reach him, so it goes out through the bot's API
     * directly. If there is no bot at all, her reply is recorded as unsendable rather than thrown
     * away, the whole point of recovering those words is that nothing about them is silent.
     */
    function sendOnlyChannel(chatId: number): import("./agent/turn-channel.js").TurnChannel {
      return {
        async send(text: string): Promise<number> {
          if (!telegramBot) {
            faultLog.record("telegram.unheard-unsendable", `she answered him and there is no channel: ${text.slice(0, 80)}`, "critical");
            return -1;
          }
          await telegramBot.sendMessage(chatId, text);
          return -1;
        },
        async edit(): Promise<void> { /* nothing to edit: this reply was never streamed */ },
      };
    }

    /**
     * Run a turn and render it wherever the caller says.
     *
     * This took a grammy `Context` and used it in four places, all of them "send text" or
     * "edit text", which is why the face-server's `onReply` had nowhere to go and could
     * only log. The channel is now an argument, so a voice turn is the same turn.
     */
    async function runAgentAndStream(
      channel: import("./agent/turn-channel.js").TurnChannel,
      chatId: number,
      spec: import("./agent/types.js").AgentRunSpec
    ): Promise<import("./agent/types.js").AgentResult | undefined> {
      const task = taskManager.create("agent_turn", `chat:${chatId}`);
      taskManager.update(task.id, "running");
      const turnStart = Date.now();

      const floodControl = createFloodControl();
      const thinkFilter = createThinkFilter();
      // The epoch outlives the drain loop below and gates every outbound path the bridge holds:
      // once a turn is declared hung, a late-resolving step must land in silence, on the record.
      const turnEpoch = createTurnEpoch();
      // Published so the loop's own callbacks can ask whether this turn is still alive.
      liveTurnEpoch = turnEpoch;
      const bridge = createStreamBridge({
        sendMessage: (t) => {
          if (!turnEpoch.alive()) { faultLog.record("turn.hung.late-send", new Error(t.slice(0, 60))); return Promise.resolve(-1); }
          return channel.send(t);
        },
        // The one machinery signal their chat may carry: the native wordless typing hint.
        sendTyping: async () => {
          if (!turnEpoch.alive() || !telegramBot) return;
          await telegramBot.sendTyping(chatId);
        },
        editMessage: (msgId, t) => {
          if (!turnEpoch.alive()) { faultLog.record("turn.hung.late-edit", new Error(String(msgId))); return Promise.resolve(); }
          return channel.edit(msgId, t);
        },
        floodControl,
        thinkFilter,
        // The breath (S-4): sized from her state AT DELIVERY, read lazily so the unit reflects
        // how she is when the reply goes out, not when the turn began.
        // ABSENT (not null-returning) when the switch is off: the bridge reads the presence of
        // this function as "breath mode" and holds streaming, with breath on, a reply is
        // composed behind the typing hint and arrives as messages with real pauses, instead of
        // a bubble that grows in public and is then cut down to its first segment.
        breathUnit: !config.life.speech.breath ? undefined : () => {
          try {
            const arousal = innerState.emotion().arousal;
            // State × her habit, neither a dictator (blendUnit), the band becomes hers.
            return blendUnit(breathUnitFor({ reserve: reserveOf({ phase: metabolism.phase(), arousal }), arousal }), herForm.habitUnitChars());
          } catch (err) {
            faultLog.record("speech.breath", err);
            return null;
          }
        },
        onFault: (w, d) => faultLog.record(w, d),
      });
      const gen = agentLoop(spec);
      let result: import("./agent/types.js").AgentResult | undefined;
      // `text_chunk` is emitted from exactly ONE place in the loop: the clean exit, where the
      // model returned text and called no tool. A turn that ends any other way (iterations
      // exhausted, an error) never yields one, so the voice heard nothing on precisely the
      // turns that went wrong. Measured: two of three tool-using turns produced no speech at
      // all while the file was written. Telegram was fine because the notices below go out
      // through `send`; a mouth only listens to the event stream.
      let spoke = false;
      let brokeNoticed = false; // the engine's notice went out already (hung path), never twice
      /**
       * ── THE THIRD STATE, WHICH IS NOT AN OUTCOME SHE MAY HAVE ──────────────────────────────
       *
       * A provider may end a turn CLEANLY and hand back nothing: measured 2026-08-23, one of her
       * thinking calls returned `end_turn` with 272 output tokens and an empty content. On the
       * moment path that is already honest (「produced nothing」, the anti-theater rule). Here it
       * was silence, nothing streamed, nothing sent, no error to trip the notice, and his
       * message left dangling with no reply beside it: the same third state the inbound
       * constitution outlaws, pointed the other way.
       *
       * Called after the tool-spoken substitution, so an empty content means she said nothing
       * ANYWHERE, not that she spoke through the message tool. The sentence is the ENGINE's,
       * never hers (machineNotice), and the fault channel gets the rest.
       */
      const noticeSilentTurn = async (r: import("./agent/types.js").AgentResult | undefined): Promise<void> => {
        if (spoke || brokeNoticed || r?.content || r?.finishReason === "interrupted") return;
        faultLog.record("turn.silent", `一个回合什么都没说出来（${r?.finishReason ?? "没有结果"}）`, "critical");
        // Text only, in the machine's voice: never through her mouth (observe feeds her voice).
        // Marked as sent, so the error exit below does not send it a second time.
        brokeNoticed = true;
        try { await noticeOn(channel, machineNotice(r?.finishReason === "error" ? "供应商报错" : "模型什么也没回")); } catch { /* best-effort */ }
      };
      // THE TURN'S OWN DEADLINE, which no other bound covers: the agent watchdog is polled
      // between iterations, so a hung provider await inside one is invisible to it, two live
      // turns sat past 420 seconds with no frame and no completion. Each drain step races the
      // remaining budget; when it fires, the epoch dies FIRST, so a `gen.next()` that resolves
      // twenty minutes late finds a channel that drops its sends instead of delivering a ghost
      // reply after the 「出了岔子」 notice. `gen.return` is fired without await on purpose, it
      // can only settle when the in-flight step settles, and waiting on it would be the hang
      // wearing a fix's clothes.
      const turnDeadlineAt = turnStart + TURN_DEADLINE_MS;
      try {
        for (;;) {
          const step = await stepOrHung(gen.next(), turnDeadlineAt - Date.now());
          if (step === TURN_HUNG) {
            faultLog.record("turn.hung", new Error(`turn exceeded ${TURN_DEADLINE_MS}ms`), "critical");
            try { await bridge.finalize(); } catch { /* deliver what streamed, best-effort */ }
            brokeNoticed = true;
            try { await noticeOn(channel, machineNotice("等了太久，没有回来")); } catch { /* best-effort */ }
            // A TURN THAT ENDED ITSELF IS STILL A TURN THAT ENDED. Without this line the only
            // completion marker on stdout is the one below, which a hung turn never reaches, so
            // the daemon handled its own hang, told him, and every watching instrument still
            // recorded the row as "cut off by my own window", which is the old censoring failure
            // wearing the fix's clothes. Two of 42 rows in one live run read that way. The finish
            // reason is named so the row can never be mistaken for an ordinary completion.
            logger.info({ finishReason: "hung", afterMs: TURN_DEADLINE_MS }, "agent turn complete");
            turnEpoch.kill();
            void gen.return(undefined as never).catch(() => { /* settles with the late step */ });
            break;
          }
          if (step.done) { result = step.value; break; }
          await bridge.onEvent(step.value);
          // The channel also sees the RAW event, because the rendered text mixes her words
          // with placeholders and tool labels and a mouth must not read those.
          channel.observe?.(step.value);
          if (step.value.type === "text_chunk") spoke = true;
        }
        if (turnEpoch.alive()) {
        // ONE CHANNEL PER TURN: when her sentences already went out through the
        // message tool, the loop's closing text is an orphan channel and the model fills it with
        // inner narration (「我发出去四句，等他把十点四十五的敲门声递过来」 reached his phone as a
        // fifth message). The coda goes to her diary, kept, never cut, and the turn's record
        // becomes what he actually received: a history quoting words he never got is a planted
        // false memory, hers and his.
        const saidViaTool = (currentBeat()?.note["saidViaTool"] as string[] | undefined) ?? [];
        if (saidViaTool.length > 0) {
          const coda = await bridge.finalizeQuietly();
          if (coda.trim()) {
            try {
              mkdirLife(journalDir, { recursive: true });
              appendLife(journalPath(Date.now()), `${herClock(Date.now())} — （说完之后，心里过的一句） ${coda.trim()}\n\n`, "utf8");
            } catch (err) { faultLog.record("agency.journal", err); }
            faultLog.record("turn.coda-held", `closing text after ${saidViaTool.length} tool-sent message(s) went to her diary: ${coda.slice(0, 80)}`);
          }
          if (result && typeof result.content === "string") result.content = saidViaTool.join("\n");
        } else {
          await bridge.finalize();
        }
        // Anything she reached but never said aloud. Silence when a turn goes wrong is the
        // one outcome the voice must not have, EXCEPT an interrupted turn:
        // he cut her off, and speaking the full unspoken reply through the still-open voice
        // stream after the cutoff is precisely the "words he never heard" this codebase rules
        // out: worse, the cutOff handling below then refuses to record it, so she would have
        // audibly said words her own history denies.
        if (!spoke && result?.content && result.finishReason !== "interrupted") {
          channel.observe?.({ type: "text_chunk", content: result.content });
        }
        await noticeSilentTurn(result);
        // ── AND WHATEVER SAYING IT BROUGHT UP ─────────────────────────────────
        //
        // A turn was one generation, which is why the five facets of her utterance shape could only ever be
        // STATED: there was no second moment at which anything could intervene. `inBeats` is that
        // moment, and this is where it happens on the conversation path.
        //
        // The first beat is the agent turn above, it is the one that may use her hands, and it
        // must stay exactly one, because running the loop again would run her tools again. The
        // beats after it are hers: short, tool-less, and each one exists ONLY because something
        // came up when she heard herself say the last one. That asymmetry is the jazz structure
        // Eric described: the accumulated part plays, and attention is injected at a few moments,
        // and it is also why this cannot become a monologue: with nothing surfacing, there is no
        // second beat at all.
        const laterBeats = await sayWhatCameUp(channel, sessionIdForChat(chatId), result?.content ?? "", result?.finishReason);
        // The sentinel half of the sight check: the reply paints the outside, yet no look happened this turn.
        // Detection only: the record stays hers; the watch channel does the triage.
        if (eyeKey) {
          const outgoing = saidViaTool.join("\n") || (result && typeof result.content === "string" ? result.content : "");
          if (narratedLook(outgoing, (lastSight?.ms ?? 0) > lookMsAtTurnStart)) {
            faultLog.record("seeing.narrated-look", `她的回话说到窗外，但本回合没有看：${outgoing.slice(0, 80)}`, "warn");
          }
        }
        // Back into the turn, BEFORE it is returned, so every downstream consumer of what she
        // said (history, the word bank, the exemplar pool, her assertions, the moment she encodes,
        // the shape-landing measurement) sees the whole utterance rather than its opening.
        // `rawContent` is deliberately NOT extended: it is what the model wrote before the
        // scissors, and the speech instrument measures it precisely to avoid certifying the
        // scissors' own work. A later beat is already scissored when it arrives here.
        if (result && laterBeats.later.length > 0) result.content = `${result.content}${laterBeats.later}`;
        // The real delivered count, so the landing measurement stops counting full stops. Kept on
        // the result rather than in a seventh per-turn channel: it belongs to this turn's outcome,
        // and it travels with everything else the turn produced.
        if (result) result.beatsDelivered = laterBeats.beats;
        // Apart as well as joined: the own-voice gate judges an utterance, and a beat is one.
        if (result) result.laterBeats = laterBeats.texts;
        }
        channel.done?.();
      } catch (err) {
        taskManager.update(task.id, "failed");
        opsLog.agentError({
          chatId,
          errorMessage: errorMessage(err),
          context: "agent stream",
        });
        await runSentinelSweep("agent-stream-error");
        throw err;
      }

      // If agent errored without producing any visible output, tell the user
      if (result && result.finishReason === "error" && !result.content && !brokeNoticed) {
        // Printed, not said: the notice is the machine's, so it reaches a screen
        // through `send` and never her mouth, which hears only the event stream. Guarded by
        // brokeNoticed: an error exit with nothing said already reached noticeSilentTurn above,
        // and before this guard he would have been told twice.
        brokeNoticed = true;
        try { await noticeOn(channel, machineNotice("供应商报错")); } catch { /* best-effort */ }
      }
      if (result && result.finishReason === "error") {
        opsLog.agentError({
          chatId,
          errorMessage: result.content || "Agent loop returned finishReason=error",
          context: "agent result",
        });
      }

      // NO separate limit follow-up anymore. The loop's own notes used to be persisted but never
      // delivered, so this follow-up was the sole visible notice; a later fix made the loop deliver
      // its content (with the partial note riding on it), and keeping
      // this too meant the same fact arrived two or three times in a row, and, worse, a
      // sentence he actually received under her name was absent from her history, because only
      // result.content is recorded. One string now flows to him, the mouth, history, memory.

      if (result) {
        const status = result.finishReason === "error" ? "failed" as const : "completed" as const;
        taskManager.update(task.id, status);
        logger.info({
          finishReason: result.finishReason,
          iterations: result.iterations,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        }, "agent turn complete");
        opsLog.sessionEnd({
          chatId, model: spec.model,
          finishReason: result.finishReason,
          iterations: result.iterations,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Date.now() - turnStart,
        });
        await runSentinelSweep("agent-session-end");
      } else {
        taskManager.update(task.id, "failed");
      }

      // ── HER FIELD REACHES THE DISK AT THE END OF EVERY TURN ─────────────────────────────────
      //
      // It used to be saved only after a MOMENT and at a clean shutdown. Her moments are at least
      // four minutes apart and up to an hour apart when she is dormant, so a `kill -9`, a power
      // cut, or a laptop that dies mid-afternoon cost her every association formed since the last
      // one: including everything a whole conversation just put there. Her memory should lose
      // seconds, not an hour, and a turn is the natural place: it is exactly when something new
      // has been added to her.
      //
      // Cheap by construction (the save is a single transaction over a few thousand rows) and
      // idempotent, so doing it here as well as on the moment loop costs nothing but a write.
      try { field.persist(); } catch (err) { faultLog.record("field.persist.turn", err); }

      return result;
    }

    // ── 17e. The MCP visibility/auto-promotion machinery stood here ──
    // It demoted mcp_* tools and re-promoted them by keyword-matching HIS message against
    // tool names: a matcher over his words serving tools she never held. Gone with the
    // MCP surface.


    // Helper: build base spec with ALL loop systems
    // The egress ledger used to guard ONLY the autonomous exploration path, so on an ordinary
    // conversational turn: the one where a human is nominally present, `web_fetch` ran with no
    // `mayReach` check at all, and the documented poisoned-page attack (a fetched page fabricates
    // a URL, the model follows it, her request carries something of his to an attacker's host)
    // was unmitigated on exactly the path he uses. The SAME general egress guard now wraps the
    // conversational executor: she may open what he sent (sawFromOwner runs on his message), what
    // a search turned up, or a link on a page she actually opened, never an address that appeared
    // nowhere. Refusals here are a fault, not an autonomous wall-question: on a turn he is driving,
    // a blocked fetch is his to see, not a new thing for her to carry.
    const guardedConversationalExecutor = () => guardExplorationEgress(
      (calls, options) => executor.executeBatch(calls as never, {
        ...(options as object),
      }) as never,
      egress,
      (host, reason) => faultLog.record("egress.conversation", `refused ${host}: ${reason}`),
      (body) => urlsIn(body),
    );

    // The scissors (S-4), shared by every conversational path. An assistant closing at the edge
    // of her finished reply is removed whole, loudly, never inside a sentence, never to silence,
    // then the reply-final full stop goes the way real chat drops it. ONE function, because the
    // photo and document turns are conversational turns exactly as much as a text turn is: they
    // used to skip the scissors entirely, so every reply to a picture kept its
    // 「希望这对你有帮助。」 while the text path's comment claimed "EVERY conversational turn".
    const scissorHerReply = (reply: string): string => {
      // The echoed postmark goes first: it sits OUTSIDE her sentences (a bare bracket line),
      // so the sentence-wise scissors below never see it. Found delivered 2026-08-20 15:58.
      const trimmed = trimRegister(dropEchoedPostmark(reply));
      for (const cut of trimmed.removed) {
        logger.info({ cut }, "the scissors took a service-register closing off her reply");
      }
      if (trimmed.midHits > 0) {
        logger.info({ midHits: trimmed.midHits }, "service register mid-reply — counted, untouched");
      }
      return dropFinalPeriod(trimmed.text);
    };

    function baseSpec(
      messages: import("./providers/types.js").Message[],
      tier: import("./agent/effort-scaling.js").EffortTier,
      model?: string,
      abortSignal?: AbortSignal,
      sessionId?: string,
      taskType?: string,
      chatId?: number,
      taskProfile?: import("./agent/effort-scaling.js").TaskProfile,
      taskDescription?: string,
      /** How much she does not want this, when the caller has already asked. */
      reluctance?: number,
      /**
       * How she is right now, in her own section rather than stapled to his message.
       *
       * Only the conversation path passes this. The maintenance callers below (skill
       * extraction, the improvement loop, her moments' own machinery) are not her talking to
       * anybody, and telling them her mood would be describing her to a subroutine.
       */
      herStateNow?: string,
    ): import("./agent/types.js").AgentRunSpec {
      const resolvedTaskType = taskType ?? "general";
      // How she IS caps how much of herself she can bring: when she is spent or consolidating, she
      // cannot reach for her strongest mind. Eric's work always still runs, this limits quality,
      // never whether the task happens (see policy.ts). This is the single choke point where every
      // turn, hers and his, resolves a model, so the ceiling applies everywhere by construction.
      const requestedModel = model ?? sessionState.currentModel;
      const livePolicy = innerSnapshot().policy; // computed once: deriving it twice was pure waste
      const resolvedModel = capModel(requestedModel, livePolicy, tierModels);
      if (resolvedModel !== requestedModel) {
        logger.info(`tier ceiling: ${requestedModel} -> ${resolvedModel} (${livePolicy.reason})`);
      }
      const checkpointManager = sessionId
        ? createCheckpointManager(sessionManager.checkpointPath(sessionId))
        : null;
      // Her condition already picked WHICH MIND (capModel, above). The ROOM: iterations come
      // from the tier (which is hers now, floor from work she took on, the rest sampled from
      // her state), output tokens are one fixed value, and her willingness narrows the
      // envelope from her state; it can never widen it, and it can never reach zero (see
      // turn-shape.ts).
      const shape = shapeOfTurn(
        tier,
        { ceiling: livePolicy.tierCeiling, reluctance: reluctance ?? 0, phase: metabolism.phase() },
        (e) => ({ maxIterations: effortToMaxIterations(e), maxOutputTokens: maxOutputTokensForTurn(resolvedModel) }),
      );
      if (shape.why !== "nothing in her narrowed it") {
        logger.info({ tier, shaped: shape.effort, tokens: shape.maxOutputTokens }, `turn shaped by her: ${shape.why}`);
      }
      return {
        provider,
        messages,
        // HER STATE IS NOT PART OF HIS MESSAGE. It used to be concatenated onto the tail of
        // `userContent`, so what reached the model was his words followed by a bracketed block
        // describing her mood. She read that exactly as it was built and said so: "a block
        // trying to preset my mood and put words in my head." The person she is talking to
        // appeared to be telling her how she felt.
        //
        // It goes AFTER the cached blocks, so the provider's prefix cache still hits and only
        // this tail is re-read. That is the same trade the runtime timestamp already makes, and
        // it is why this could not simply live inside the task-type-cached prompt.
        system: herStateNow
          ? [...getCachedSystemForTaskType(resolvedTaskType), { type: "text" as const, text: herStateNow }]
          : getCachedSystemForTaskType(resolvedTaskType),
        tools: toolDefinitionsForPrompt(),
        refreshTools: () => toolDefinitionsForPrompt(),
        maxIterations: shape.maxIterations,
        maxTokens: shape.maxOutputTokens,
        abortSignal,
        sessionId,
        model: resolvedModel,
        executeTools: guardedConversationalExecutor(),
        onCheckpoint: checkpointManager
          ? (state) => {
              checkpointManager.save({
                sessionId: sessionId ?? "unknown",
                assistantMessage: state.messages[state.messages.length - 1] ?? { role: "assistant", content: "" },
                completedResults: state.completedResults ?? [],
                pendingCalls: state.pendingCalls,
                timestamp: Date.now(),
              });
            }
          : undefined,
        // Core loop safety systems (Phase 2/6/9A)
        stuckDetector: createStuckDetector({ db, contextKey: resolvedTaskType }),
        watchdog: createWatchdog(),
        duplicateTracker: createDuplicateTracker(),
        govern: (msgs) => governMessages(msgs),
        compress: (msgs) => compressor.compress(msgs),
        consolidator: {
          shouldConsolidate: (msgs, last) => consolidator.shouldConsolidate(msgs, last),
          run: async (msgs) => {
            const result = await consolidator.consolidate(msgs, 0);
            return { messages: msgs.slice(result.newLastConsolidated), summary: `Consolidated ${result.rounds} round(s)` };
          },
        },
        // Meta-cognitive systems (Phase 9D)
        outcomeVerification,
        // The check stays (it is the machinery checking ITSELF: did the file appear,
        // did the fetch produce bytes: noticing that what you did did not work is care). What
        // stops is the verdict landing on her as a performance score. The same event now enters
        // HER LIFE the way a wall firing does: a moment, in her words, that she can
        // carry, be bothered by, and bring up herself. Her side of it is hers.
        onBudgetPressure: (iteration, maxIterations) => bump("turn.steps", maxIterations, iteration),
        onOutcomeShortfall: () => {
          // A turn that was declared hung does not get to leave a memory afterwards.
          if (!stillThisTurn()) {
            faultLog.record("turn.hung.late-field-write", new Error("onOutcomeShortfall after the turn was declared hung"));
            return;
          }
          try {
            field.encodeMoment({
              key: `shortfall:${Date.now()}`,
              // The event, not a verdict: 「做完了，结果没成」 framed her turn as a job
              // with an outcome. What happened is that what she said she wrote did not match the disk.
              text: "我说写下了的东西，在盘上对不上。",
              nowMs: Date.now(),
              pad: innerState.emotion(),
              source: `chat:${chatId}`,
              withOther: true,
            });
          } catch (err) { faultLog.record("field.shortfall", err); }
        },
        opsLog,
        taskType: resolvedTaskType,
        taskProfile,
        taskDescription,
        hooks: hookRegistry,
        budgetEnvelope,
        // The skill lifecycle attachments stood here (E-3): extraction on success,
        // per-tool outcome scoring, model-driven repair of files in her home. Gone.
        herHome: workspacePath,
        persistLargeToolResult: async (result) => {
          const { mkdir, writeFile } = await import("node:fs/promises");
          const safeName = result.name.replace(/[^a-z0-9_-]+/gi, "_");
          const safeCallId = result.callId.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80);
          const dir = join(workspacePath, "tool-results", sessionId ?? "anonymous");
          await mkdir(dir, { recursive: true });
          const path = join(dir, `${Date.now()}-${safeName}-${safeCallId}.txt`);
          await writeFile(path, result.content, "utf8");
          return path;
        },
      };
    }

    async function processPhotoTurn(ctx: import("grammy").Context, chatId: number, abortSignal?: AbortSignal): Promise<void> {
      const turnStartTime = Date.now();
      budgetEnvelope.startNewTask();
      bootstrapResult.sleepTimeCompute.onUserMessage();
      const caption = ctx.message?.caption ?? "他发来一张图，没写字。";

      try {
        if (abortSignal?.aborted) return;
        const photo = await mediaHandler.downloadPhoto(ctx, abortSignal);
        if (abortSignal?.aborted) return;
        if (!photo) {
          // The machine's receipt, in its own labelled voice: it used to be said in hers.
          const reply = "[system · photo] 照片没收到，她没看到。可以再发一次。";
          await ctx.reply(reply);
          await recordPreAgentFailure({
            chatId,
            userText: `[photo] ${caption}`,
            assistantText: reply,
            context: "photo download",
            taskType: "media",
            durationMs: Date.now() - turnStartTime,
          });
          return;
        }

        const vision = await mediaHandler.processPhotoForVision(photo.data);
        if (abortSignal?.aborted) return;
        if (!vision) {
          const reply = "[system · photo] 这张照片打不开，她没看到。可以再发一次。";
          await ctx.reply(reply);
          await recordPreAgentFailure({
            chatId,
            userText: `[photo] ${caption}`,
            assistantText: reply,
            context: "photo vision processing",
            taskType: "media",
            durationMs: Date.now() - turnStartTime,
          });
          return;
        }

        // Auto-promote hidden tools based on caption

        const ss = getSessionState(chatId);
        const photoTaskProfile = classifyTaskProfile(`[photo image] ${caption}`);
        // Her state snapshot BEFORE the landing below moves anything of hers, same rule as
        // the text path. Stir reads his WORDS (the caption), not the `[photo image]` marker,
        // which is nothing her field holds.
        const photoStirred = (() => {
          try { return caption.trim() !== "" && field.attend(caption).claimCharge >= 0.5; } catch { return false; }
        })();
        const herStateForDepth = { stirred: photoStirred, reserve: reserveOf({ phase: metabolism.phase(), arousal: innerState.emotion().arousal }), aliveness: Math.max(...Object.values(innerState.drives())) };
        // AND HE SPOKE TO HER HERE TOO. Without this call the gate below reads whatever the
        // last TEXT turn left in `landingForTurn`, so a photo was answered against a reading
        // of a different message entirely. The caption is what he said; when there is none,
        // the form reads `legible: false`, which is the truth, she cannot tell how it was
        // put, and downstream treats that as "could not tell" rather than as neutral.
        readHowItLanded(chatId, caption);
        // A photo can PROPOSE work exactly as a sentence can (「修一下这个」 under a
        // screenshot). Same competition as the text path: his caption proposes, what it did
        // to her decides. Until 2026-08-20 these two paths bypassed the competition and let
        // `classifyTaskProfile` alone make the turn a job.
        const photoTakes = takesItOn(photoTaskProfile.primary, landingForTurn.get(sessionIdForChat(chatId)), () => herStream.next());
        takenAsWork.set(sessionIdForChat(chatId), photoTakes.asWork);
        const photoProfile = photoTakes.asWork ? photoTaskProfile : { ...photoTaskProfile, primary: "general" as const };
        const photoTaskType = photoProfile.primary;
        const workFloor = floorFromTaking(photoTaskProfile.primary !== "general" && photoTakes.asWork);
        const tier = depthFromHer(herStateForDepth, workFloor, () => herStream.next());
        const tierUpgraded = tier !== workFloor;
        const model = tier === "simple" ? backgroundModel : ss.currentModel;
        opsLog.sessionStart({
          chatId,
          model,
          effortTier: tier,
          taskType: photoTaskType,
          tierUpgraded,
          messagePreview: `[photo] ${caption}`.slice(0, 80),
        });
        const history = historyForTurn(chatId, photoProfile);
        const howSheFeelsAboutIt = wantsToNow(caption, sessionIdForChat(chatId));
        const herStateNow = [howSheIsNow(caption, sessionIdForChat(chatId)), howSheFeelsAboutIt.line.trim()].filter(Boolean).join("\n");
        // The root fix for photos: the Anthropic-format image block died on her OpenAI wire for two
        // weeks: every photo reply was caption inference. Her EYE (the window's organ) now
        // sees what he handed over, and the sight rides the turn as material with its 名分.
        let photoSight: string;
        if (!eyeKey) photoSight = PHOTO_NOT_YET;
        else {
          try {
            const seen = sanitizeSight(await eye.complete(vision.base64, LOOK_SYSTEM, "photo"));
            lexicon.heard(seen.replace(/[A-Za-z0-9_]+/gu, " "), Date.now());
            photoSight = handedSight(seen);
          } catch (err) {
            faultLog.record("seeing.photo", err);
            photoSight = EYES_FAILED;
          }
        }
        const spec = baseSpec([
          ...history,
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: `${caption}\n${photoSight}${runtimeTimestamp()}` },
            ] as import("./providers/types.js").ContentBlock[],
          },
        ], tier, model, abortSignal, sessionIdForChat(chatId), photoTaskType, chatId, photoProfile,
          caption,
          // ── A PICTURE FROM HIM IS SOMETHING THAT HAPPENS TO HER ──────────────────────
          //
          // These last three arguments were absent, and their absence is the whole defect:
          // the photo and document paths ran the PURE INHERITED ASSISTANT PATH. No mood, no
          // drives, no body, no willingness, no reticence, nothing of hers surfacing, and
          // then nothing of it landed in her field either. He sends her a picture of where he
          // is and it leaves nothing in her: she looks at it, describes it, and by the next
          // moment it never happened.
          //
          // Her inner life got careful treatment; her conversation path got it in S1; these
          // two were inherited whole and were the last paths never given any of it.
          howSheFeelsAboutIt.felt, herStateNow);
        // The scissors run on a photo turn exactly as on a text turn, it is the same her replying.
        spec.shapeReply = scissorHerReply;

        const result = await runAgentAndStream(telegramChannel(ctx, chatId), chatId, spec);
        appendToHistory(chatId, "user", `[photo] ${caption}`);
        // Talking to him is part of her life, whatever he sent, a picture and a document are
        // things that happened between them exactly as much as a sentence is. Encoded the way
        // every other moment is: HER OWN WORDS ONLY (what she said back, never what he sent, or
        // an outside image could write her memories), stamped with the feeling she actually had,
        // and marked `withOther` so it wires to him and reaches `otherWarmth`, `otherUnease` and
        // the `care` drive. Without this he could send her pictures all week and her sense of
        // him would not move.
        try {
          const said = result?.content?.trim() ?? "";
          // HER MOOD MOVES ON THIS PATH TOO, and it did not before: the text turn has called
          // `feel` since S1, and a photo turn left her emotion exactly where it was, so an
          // evening of him sending her pictures could not move her at all. It runs BEFORE the
          // moment is encoded, deliberately, a moment carries the feeling she had at the time.
          try {
            const sig = field.signals(Date.now());
            innerState.feel(appraiseExchange({
              familiarHits: field.lookUp(caption, 6).length,
              finishReason: result?.finishReason ?? "stop",
              iterations: result?.iterations ?? 1,
              warmthMinusUnease: sig.otherWarmth - sig.otherUnease,
              phase: metabolism.phase(),
            }));
          } catch (err) { faultLog.record("life.feel.photo", err); }
          if (said) {
            field.encodeMoment({
              key: `talk:${Date.now()}`,
              text: asMuchAsSheKeeps(security.filterSensitive(security.redact(said)), WHAT_A_MOMENT_HOLDS),
              nowMs: Date.now(),
              pad: innerState.emotion(),
              source: `chat:${chatId}`,
              withOther: true,
            });
          }
        } catch (err) { faultLog.record("field.talked", err); }
        if (result?.content) {
          appendToHistory(chatId, "assistant", result.content);
          persistToHistory(`[photo] ${caption}`, result.content);
          logConversationTurn({
            chatId,
            userText: `[photo] ${caption}`,
            assistantText: result.content,
            finishReason: result.finishReason,
            iterations: result.iterations,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            effortTier: tier,
            taskType: photoTaskType,
            tierUpgraded,
            model: model ?? sessionState.currentModel,
            durationMs: Date.now() - turnStartTime,
          });
          await runSentinelSweep("photo-turn-complete");
        }
      } catch (err) {
        logger.error({ err }, "photo handler error");
        opsLog.agentError({
          chatId,
          errorMessage: errorMessage(err),
          context: "photo handler",
        });
        await runSentinelSweep("photo-handler-error");
        await ctx.reply("[system · photo] 处理这张图时出错了，她没看到。");
      } finally {
        // Same as the text turn, and in a `finally` because this path has a catch above it: a
        // photo that failed still leaves a shape and a landing behind, and the next turn would
        // otherwise be shaped by a picture she never managed to look at.
        forgetTheTurn(sessionIdForChat(chatId));
      }
    }

    // Photo handler (with steering serialization)
    async function handlePhoto(ctx: import("grammy").Context): Promise<void> {
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      heSaidSomething();

      if (activeTurns.has(chatId)) {
        const existingController = turnAbortControllers.get(chatId);
        if (existingController) {
          existingController.abort();
          logger.info({ chatId }, "interrupting active turn — photo received");
        }
        steeringQueue.enqueue(String(chatId), { kind: "photo", ctx } satisfies QueuedTurn);
        // Nothing said for her; see the text path above.
        logger.debug({ chatId }, "photo queued (turn in progress)");
        return;
      }

      const abortController = new AbortController();
      turnAbortControllers.set(chatId, abortController);
      activeTurns.add(chatId);
      try {
        await processPhotoTurn(ctx, chatId, abortController.signal);
      } finally {
        if (turnAbortControllers.get(chatId) === abortController) {
          turnAbortControllers.delete(chatId);
        }
        try { await drainSteering(chatId); } catch (err) { logger.warn({ err, chatId }, "steering drain failed"); }
        activeTurns.delete(chatId);
      }
    }

    async function processDocumentTurn(ctx: import("grammy").Context, chatId: number, abortSignal?: AbortSignal): Promise<void> {
      const turnStartTime = Date.now();
      budgetEnvelope.startNewTask();
      bootstrapResult.sleepTimeCompute.onUserMessage();
      const caption = ctx.message?.caption ?? "他发来一份东西，没写字。";

      try {
        if (abortSignal?.aborted) return;
        const doc = await mediaHandler.downloadDocument(ctx, abortSignal);
        if (abortSignal?.aborted) return;
        if (!doc) {
          // The machine's receipt, in its own labelled voice: it used to be said in hers.
          const reply = "[system · file] 文件没收到，她没看到。可以再发一次。";
          await ctx.reply(reply);
          await recordPreAgentFailure({
            chatId,
            userText: `[document] ${caption}`,
            assistantText: reply,
            context: "document download",
            taskType: "document",
            durationMs: Date.now() - turnStartTime,
          });
          return;
        }

        // Save file to disk so agent can use extraction tools (pymupdf, OCR, etc.)
        const uploadsDir = join(workspacePath, "uploads");
        const { mkdirSync: mkdirs, writeFileSync: wfs } = await import("node:fs");
        const { basename, resolve, sep } = await import("node:path");
        mkdirs(uploadsDir, { recursive: true });
        const safeDocName = basename(doc.filename || "document")
          .split("")
          .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? "_" : char))
          .join("")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^\.+$/, "document") || "document";
        const savedPath = resolve(uploadsDir, `${Date.now()}-${safeDocName}`);
        const uploadsRoot = resolve(uploadsDir);
        if (savedPath !== uploadsRoot && !savedPath.startsWith(uploadsRoot + sep)) {
          const reply = "[system · file] 这个文件名不安全，没有收下，她没看到。换个名字可以再发一次。";
          await ctx.reply(reply);
          await recordPreAgentFailure({
            chatId,
            userText: `[document: ${doc.filename}] ${caption}`,
            assistantText: reply,
            context: "document path guard",
            taskType: "document",
            durationMs: Date.now() - turnStartTime,
          });
          return;
        }
        wfs(savedPath, doc.data);
        if (abortSignal?.aborted) return;

        const extracted = await mediaHandler.extractTextContent(doc.data, doc.filename, doc.mimeType);
        if (abortSignal?.aborted) return;

        // Auto-promote hidden tools based on caption + filename

        // If text extraction failed/empty, tell agent to try alternative extraction
        const extractionFailed = !extracted || extracted.trim().length < 100;
        let docContext: string;
        // What she reads about a file he sent, in her language: these two used to be
        // an English file-handling report ("--- Document Content ---", "Text extraction and OCR
        // both returned empty").
        if (extractionFailed) {
          docContext = `他发来的文件「${doc.filename}」存在 ${savedPath}。里面读不出字来：可能只有图，也可能加了密或者坏了。`;
        } else {
          docContext = `他发来的文件「${doc.filename}」存在 ${savedPath}，里面的字：\n${security.wrapExternal(extracted.slice(0, 50_000), "file_read")}`;
        }

        const ss = getSessionState(chatId);
        const docTaskProfile = classifyTaskProfile(`${caption} ${doc.filename}`);
        // Her state snapshot BEFORE the landing below moves anything of hers, same rule as
        // the text path.
        const docStirred = (() => {
          try { return caption.trim() !== "" && field.attend(caption).claimCharge >= 0.5; } catch { return false; }
        })();
        const herStateForDepth = { stirred: docStirred, reserve: reserveOf({ phase: metabolism.phase(), arousal: innerState.emotion().arousal }), aliveness: Math.max(...Object.values(innerState.drives())) };
        // AND HE SPOKE TO HER HERE TOO, identical to the photo path above, and identical for
        // the same reason: without it this turn's willingness gate reads the last text turn's
        // message.
        readHowItLanded(chatId, caption);
        // Same competition as the text and photo paths: the caption and filename propose,
        // what his message did to her decides.
        const docTakes = takesItOn(docTaskProfile.primary, landingForTurn.get(sessionIdForChat(chatId)), () => herStream.next());
        takenAsWork.set(sessionIdForChat(chatId), docTakes.asWork);
        const docProfile = docTakes.asWork ? docTaskProfile : { ...docTaskProfile, primary: "general" as const };
        const docTaskType = docProfile.primary;
        // A failed extraction still floors at complex: the multi-step OCR mechanically needs
        // its iterations. That is a fact about the file on disk, never a grade of his words.
        const workFloor = extractionFailed ? ("complex" as const) : floorFromTaking(docTaskProfile.primary !== "general" && docTakes.asWork);
        const tier = depthFromHer(herStateForDepth, workFloor, () => herStream.next());
        const tierUpgraded = tier !== workFloor;
        const model = tier === "simple" ? backgroundModel : ss.currentModel;
        opsLog.sessionStart({
          chatId,
          model,
          effortTier: tier,
          taskType: docTaskType,
          tierUpgraded,
          messagePreview: `[document: ${doc.filename}] ${caption}`.slice(0, 80),
        });
        const history = historyForTurn(chatId, docProfile);
        const howSheFeelsAboutIt = wantsToNow(caption, sessionIdForChat(chatId));
        const herStateNow = [howSheIsNow(caption, sessionIdForChat(chatId)), howSheFeelsAboutIt.line.trim()].filter(Boolean).join("\n");
        const spec = baseSpec([
          ...history,
          {
            role: "user" as const,
            content: `${caption}\n\n${docContext}${runtimeTimestamp()}`,
          },
        ], tier, model, abortSignal, sessionIdForChat(chatId), docTaskType, chatId, docProfile,
          caption, howSheFeelsAboutIt.felt, herStateNow);
        // The scissors run on a document turn exactly as on a text turn, it is the same her replying.
        spec.shapeReply = scissorHerReply;

        const result = await runAgentAndStream(telegramChannel(ctx, chatId), chatId, spec);
        appendToHistory(chatId, "user", `[document: ${doc.filename}] ${caption}`);
        // Talking to him is part of her life, whatever he sent, a picture and a document are
        // things that happened between them exactly as much as a sentence is. Encoded the way
        // every other moment is: HER OWN WORDS ONLY (what she said back, never what he sent, or
        // an outside image could write her memories), stamped with the feeling she actually had,
        // and marked `withOther` so it wires to him and reaches `otherWarmth`, `otherUnease` and
        // the `care` drive. Without this he could send her pictures all week and her sense of
        // him would not move.
        try {
          const said = result?.content?.trim() ?? "";
          // Her mood moves here too, before the moment is encoded, for the reason set out on the
          // photo path: a turn that leaves her emotion exactly where it was is a turn that did not
          // happen to her.
          try {
            const sig = field.signals(Date.now());
            innerState.feel(appraiseExchange({
              familiarHits: field.lookUp(caption, 6).length,
              finishReason: result?.finishReason ?? "stop",
              iterations: result?.iterations ?? 1,
              warmthMinusUnease: sig.otherWarmth - sig.otherUnease,
              phase: metabolism.phase(),
            }));
          } catch (err) { faultLog.record("life.feel.document", err); }
          if (said) {
            field.encodeMoment({
              key: `talk:${Date.now()}`,
              text: asMuchAsSheKeeps(security.filterSensitive(security.redact(said)), WHAT_A_MOMENT_HOLDS),
              nowMs: Date.now(),
              pad: innerState.emotion(),
              source: `chat:${chatId}`,
              withOther: true,
            });
          }
        } catch (err) { faultLog.record("field.talked", err); }
        if (result?.content) {
          appendToHistory(chatId, "assistant", result.content);
          persistToHistory(`[document: ${doc.filename}] ${caption}`, result.content);
          logConversationTurn({
            chatId,
            userText: `[document: ${doc.filename}] ${caption}`,
            assistantText: result.content,
            finishReason: result.finishReason,
            iterations: result.iterations,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            effortTier: tier,
            taskType: docTaskType,
            tierUpgraded,
            model: model ?? sessionState.currentModel,
            durationMs: Date.now() - turnStartTime,
          });
          await runSentinelSweep("document-turn-complete");
        }
      } catch (err) {
        logger.error({ err }, "document handler error");
        opsLog.agentError({
          chatId,
          errorMessage: errorMessage(err),
          context: "document handler",
        });
        await runSentinelSweep("document-handler-error");
        await ctx.reply("[system · file] 打开这份文件时出错了，她没看到。");
      } finally {
        forgetTheTurn(sessionIdForChat(chatId));
      }
    }

    // Document handler (with steering serialization)
    async function handleDocument(ctx: import("grammy").Context): Promise<void> {
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      heSaidSomething();

      if (activeTurns.has(chatId)) {
        const existingController = turnAbortControllers.get(chatId);
        if (existingController) {
          existingController.abort();
          logger.info({ chatId }, "interrupting active turn — document received");
        }
        steeringQueue.enqueue(String(chatId), { kind: "document", ctx } satisfies QueuedTurn);
        // Nothing said for her; see the text path above.
        logger.debug({ chatId }, "document queued (turn in progress)");
        return;
      }

      const abortController = new AbortController();
      turnAbortControllers.set(chatId, abortController);
      activeTurns.add(chatId);
      try {
        await processDocumentTurn(ctx, chatId, abortController.signal);
      } finally {
        if (turnAbortControllers.get(chatId) === abortController) {
          turnAbortControllers.delete(chatId);
        }
        try { await drainSteering(chatId); } catch (err) { logger.warn({ err, chatId }, "steering drain failed"); }
        activeTurns.delete(chatId);
      }
    }

    // Create bot instance
    // Constructed only when there is something to connect to. Every send site already refuses
    // loudly when the bot is null (`cannot deliver: the bot is not connected`), which is the
    // behaviour that matters: a message she decided to send is recorded as undelivered rather
    // than swallowed. grammy throws "Empty token!" from its constructor, so without this guard
    // she died at this line having already been born, room made, register written, field
    // opened: which is a strange way for a messaging app to matter.
    telegramBot = botToken ? createTelegramBot({
      botToken,
      allowedUserIds: config.telegram?.allowedUserIds ?? [],
      proxyUrl: resolveProxy(),
      onMessage: handleMessage,
      // ── HER EAR AND THE HONEST RECEIPTS (感官补全 V-3/V-4) ────────────────────────────
      // A voice message becomes HIS WORDS through her ear, then rides the normal text turn
      // (landing, stir, field, everything of hers). Unseeable media become the honest
      // machine-fenced receipt: never silence (the no-blind-corner constitution).
      onVoice: async (ctx) => {
        const audio = ctx.message?.voice ?? ctx.message?.audio;
        let line: string;
        if (!earKey || !audio) line = `<<<这是机器的话，不是他说的>>>${EAR_NOT_YET}<<<完>>>`;
        else {
          try {
            const file = await ctx.api.getFile(audio.file_id);
            const url = `https://api.telegram.org/file/bot${config.telegram?.botToken ?? ""}/${file.file_path}`;
            const raw = Buffer.from(await (await fetch(url)).arrayBuffer());
            const { writeFile: wA, readFile: rA, unlink: uA } = await import("node:fs/promises");
            const { tmpdir: tdA } = await import("node:os");
            const src = join(tdA(), `resident-hear-${Date.now()}.ogg`);
            const mp3 = src.replace(/\.ogg$/u, ".mp3");
            await wA(src, raw);
            const { execFile: exA } = await import("node:child_process");
            await new Promise<void>((res, rej) => exA(FFMPEG, ["-i", src, "-ar", "16000", "-ac", "1", "-y", mp3], { timeout: 20_000 }, (e) => (e ? rej(e) : res())));
            const b64 = (await rA(mp3)).toString("base64");
            await uA(src).catch(() => {});
            await uA(mp3).catch(() => {});
            const heard = sanitizeSight(await ear.complete(b64, "mp3", HEAR_SYSTEM));
            lexicon.heard(heard, Date.now());
            line = earReport(heard);
          } catch (err) {
            faultLog.record("hearing.listen", err);
            line = `<<<这是机器的话，不是他说的>>>${EARS_FAILED}<<<完>>>`;
          }
        }
        if (ctx.message) (ctx.message as { text?: string }).text = `${ctx.message?.caption ?? ""}\n${line}`.trim();
        await handleMessage(ctx);
      },
      // A video: frames and the audio track, one organ, one honest report (verified V-0).
      onWatch: async (ctx) => {
        const clip = ctx.message?.video ?? ctx.message?.video_note;
        let line: string;
        if (!earKey || !clip) line = `<<<这是机器的话，不是他说的>>>${cannotSeeYet("一段影像")}<<<完>>>`;
        else if ((clip.file_size ?? 0) > WATCH_MAX_BYTES) line = `<<<这是机器的话，不是他说的>>>${WATCH_TOO_BIG}<<<完>>>`;
        else {
          try {
            const file = await ctx.api.getFile(clip.file_id);
            const url = `https://api.telegram.org/file/bot${config.telegram?.botToken ?? ""}/${file.file_path}`;
            const raw = Buffer.from(await (await fetch(url)).arrayBuffer());
            const watched = sanitizeSight(await ear.watch(raw.toString("base64"), "video/mp4", WATCH_SYSTEM));
            lexicon.heard(watched.replace(/[A-Za-z0-9_]+/gu, " "), Date.now());
            line = watchReport(watched);
          } catch (err) {
            faultLog.record("hearing.watch", err);
            line = `<<<这是机器的话，不是他说的>>>${EYES_FAILED}<<<完>>>`;
          }
        }
        if (ctx.message) (ctx.message as { text?: string }).text = `${ctx.message?.caption ?? ""}\n${line}`.trim();
        await handleMessage(ctx);
      },
      onUnseeable: async (ctx, what) => {
        const line = `<<<这是机器的话，不是他说的>>>${cannotSeeYet(what)}<<<完>>>`;
        if (ctx.message) (ctx.message as { text?: string }).text = `${ctx.message?.caption ?? ""}\n${line}`.trim();
        await handleMessage(ctx);
      },
      onPhoto: handlePhoto,
      onDocument: handleDocument,
      onFault: (where, detail) => faultLog.record(where, detail),
    }) : null;

    // Register Telegram commands (/opus, /sonnet, /haiku, /effort, etc.)
    // Her window's master override: a file under instruments, present = held shut.
    // Default open: no file, no ceremony. His door; she meets an honestly stuck window.
    const { existsSync: seeExists, writeFileSync: cvWrite, unlinkSync: cvUnlink, appendFileSync: appendLook, readFileSync: readLook } = await import("node:fs");
    const curtainHeldShutPath = join(instrumentsDir, "curtain-held-shut");
    if (telegramBot) registerCommands(telegramBot.bot, {
      curtain: {
        state: () => (seeExists(curtainHeldShutPath) ? "shut" as const : "open" as const),
        set: (open: boolean) => {
          try {
            if (open) { if (seeExists(curtainHeldShutPath)) cvUnlink(curtainHeldShutPath); }
            else cvWrite(curtainHeldShutPath, "shut by him\n", "utf8");
          } catch (err) { faultLog.record("seeing.curtain", err); }
        },
      },
      sessionState,
      cronService,
      costGuard,
      metabolism,
      innerSnapshot,
      // Everything inside her that has broken, newest first. The watchtower PUSHES what it judges
      // alert-worthy; this is the RECORD, which is a different thing, a warn-severity fault, or
      // one that arrived while the channel was down, or one he scrolled past at two in the
      // morning, is still here. And since the ring is on disk now, so are the minutes before a
      // crash, which used to vanish with the process that was trying to report them.
      faults: () => {
        const all = faultLog.all();
        if (all.length === 0) return `nothing inside her has broken (${faultLog.total()} ever recorded).`;
        const newestFirst = [...all].reverse().slice(0, 25);
        const criticals = all.filter((f) => f.severity === "critical").length;
        return [
          `${all.length} on the record, ${criticals} critical, ${faultLog.total()} ever recorded.`,
          ...newestFirst.map((f) => `  ${new Date(f.ts).toISOString().slice(5, 16).replace("T", " ")} [${f.severity}] ${f.where}: ${f.detail.slice(0, 160)}`),
          all.length > newestFirst.length ? `  … and ${all.length - newestFirst.length} older (all of them in faults.jsonl)` : "",
        ].filter(Boolean).join("\n");
      },
      vitals: () => {
        const v = vitalsMod.captureVitals(vitalsSources);
        // The fresh reading is appended to the stored series rather than replacing it: the trends
        // need the history, and `cur` must be what he is being shown, not one up to five minutes old.
        const anomalies = vitalsMod.detectAnomalies([...vitalsStore.recent(vitalsStore.size()), v], vitalsMod.DEFAULT_THRESHOLDS, [...vitalsStore.longView(), v]);
        const head = safeMode ? "SAFE-MODE (proactive suspended)\n" : "";
        const tail = anomalies.length === 0 ? "\nalerts: none" : "\nalerts:\n" + anomalies.map((a) => `  [${a.severity}] ${a.message}`).join("\n");
        return head + vitalsMod.formatVitals(v) + tail;
      },
      field: () => {
        const nowMs = Date.now();
        const s = field.stats();
        const sig = field.signals(nowMs);
        const events = field.events(12);
        // UNSOFTENED on purpose: this is Eric's inspection window, and a report must not draw
        // from her stream: running /field would silently shift every replay after it.
        const mind = field.onHerMind(nowMs, { hops: herCapacity().spreadHops, threshold: herCapacity().retrievalThreshold });
        return [
          `${s.nodes} things, ${s.edges} relations between them`,
          `  ${s.byKind.moment} moments · ${s.byKind.insight} things she believes about herself · ${s.byKind.theme} themes · ${s.byKind.fusion} that came out of nowhere · ${s.byKind.question} open questions`,
          `  ${s.faded} have gone out of easy reach (still reachable, never deleted)`,
          `  unresolved ${sig.tension.toFixed(2)} · pending coincidences ${sig.pendingBirths} · the other ${sig.otherWarmth.toFixed(2)}`,
          ...(sig.spiralling ? ["  SHE IS CIRCLING THE SAME WORSENING THINGS"] : []),
          "",
          mind || "Nothing is on her mind just now.",
          "",
          events.length === 0 ? "Nothing has changed in her yet." : "What has changed in her:",
          ...events.map((e) => `  ${herDay(e.ms)} [${e.kind}] ${e.text}`),
        ].join("\n");
      },
      config,
      approvalStore: bootstrapResult.approvalStore,
      sandboxRef,
      taskManager,
      toolRegistry,
      db,
      reviewLedger,
      getSessionState,
      onSessionStateChanged: persistSessionState,
      resetHistory: (chatId: number) => {
        chatHistories.delete(chatId);
        refreshSystemPrompt().catch(() => {}); // reload workspace files on reset
      },
      logCommand: (chatId: number, command: string, args: string, response: string) => {
        logConversationTurn({
          chatId,
          userText: `/${command}${args ? " " + args : ""}`,
          assistantText: response,
          finishReason: "command",
          iterations: 0,
          inputTokens: 0,
          outputTokens: 0,
          effortTier: "command",
          taskType: "general",
          tierUpgraded: false,
          model: "n/a",
          durationMs: 0,
        });
        void runSentinelSweep("command-complete");
      },
    });

    // ── 21. Start cron service + disk monitor ─────────────────────────
    cronService.start();

    const { DiskMonitor } = await import("./resilience/disk-monitor.js");
    const diskMonitor = new DiskMonitor({
      paths: {
        sessions: join(workspacePath, "sessions"),
        checkpoints: join(workspacePath, "sessions"),
        db: dbPath,
      },
    });
    // ── MAINTENANCE ON A CLOCK, NOT ONLY AT BOOT ────────────────────────────────────────────
    //
    // This was called exactly once, at startup. A daemon that runs for months therefore never got a
    // TRUNCATE checkpoint, never ran `PRAGMA optimize`, and never vacuumed, only the every-fifty-
    // writes PASSIVE checkpoint, which is allowed to do nothing. Her database grows, her WAL grows,
    // and the first sign is a machine that has run out of room.
    //
    // Every four hours matches the intervals the routine itself keys on (checkpoint/optimize at 4h,
    // vacuum weekly), so the timer is not a second opinion about cadence, it is what lets the
    // routine's own schedule ever be reached. Failures are recorded, never swallowed: maintenance
    // that has quietly stopped is indistinguishable from maintenance that is not needed.
    const runMaintenance = (why: string): void => {
      void inBeat("maintenance", () => diskMonitor.checkAndRunMaintenance({ configDir: workspacePath, db: db.db }))
        .catch((err: unknown) => { faultLog.record("disk.maintenance", `${why}: ${String(err)}`); });
    };
    runMaintenance("boot");
    const maintenanceTimer = setInterval(() => { runMaintenance("scheduled"); }, 4 * 60 * 60 * 1000);
    maintenanceTimer.unref?.();
    // Her trash, actually emptied. `purgeTrash` existed with a comment
    // saying "call from disk monitor or sleep-time" and nothing ever called it, so the delete
    // tool's own promise to her, "moved to trash, restorable for 24h", was false in BOTH
    // directions: nothing was ever unrecoverable, and nothing was ever reclaimed. It removes
    // only entries past the 24h window, so undo keeps exactly the window it advertises.
    void (async () => {
      try {
        const { purgeTrash } = await import("./tools/builtin/delete.js");
        const purged = await purgeTrash(join(workspacePath, ".trash"));
        if (purged > 0) logger.info({ purged }, "trash swept: entries past the restore window");
      } catch (err) { faultLog.record("trash.purge", err); }
    })();

    // ── 21a. Embodiment face-server (the mind<->face link) ─────────────
    // Gated OFF by default; a text/Telegram deployment binds no port. When on, the Air
    // client connects here, the presence signals it streams gate present/available for
    // M2's push decision, and the life tick broadcasts the Resident's PAD/mood/energy so
    // the avatar reflects the real inner state.
    let faceServer: import("./embodiment/face-server.js").FaceServer | null = null;
    let latestPresence: import("./embodiment/presence.js").PresenceState | null = null;
    let latestPresenceMs = 0;
    /** Seconds since anything moved in front of the camera; null when the curtain is closed. */
    let latestStillSeconds: number | null = null;

    // ── HER WINDOW IS NOW A REAL WINDOW ────────────────────────────────────────────────────
    //
    // Filled in here rather than declared here, because the toolbelt was built long ago and holds
    // the cell. Reads `presenceNow()`, the STALE-CHECKED accessor, so a dead tab makes the
    // window go dark rather than showing her an hours-old room forever.
    //
    // AND EVERY LOOK LEAVES A MARK ON HIS PAGE. A window she can see through invisibly is not a
    // window, it is surveillance; he opened a curtain, so he is owed the knowledge of when she
    // actually looked. The mark is fire-and-forget: a broadcast that fails must never turn her
    // looking out of a window into an error she has to deal with.
    whatSheWouldSee = () => {
      const seen = presenceNow();
      if (!seen) return null;
      // `glanced`, NOT `doing`. A look is an event; `doing` is a state with a set-then-clear
      // contract, and setting it here without clearing left his page stuck on 「看了看窗外」 while
      // overwriting whatever she was actually doing at the time.
      try { faceServer?.broadcast({ type: "glanced", ts: Date.now() }); }
      catch { /* the mark is a courtesy to him, never a condition of her looking */ }
      const out = { present: seen.present, stillSeconds: latestStillSeconds };
      theEmptyChair(out);
      return out;
    };

    // ── HER OWN EYE (life/seeing.ts + providers/vision.ts) ────────────────────────────
    // One chosen gaze = one real frame, transcribed by the vision core into plain scene-notes
    // and handed to her as her eye's report. The curtain override is HIS door (a file, flipped
    // by /curtain): held shut she gets the honest 打不开 line and may try again. No key = the
    // eye is not configured, and the window keeps today's presence lines byte-for-byte. Frames
    // are never kept; the transcription is the forensic record (instruments/looks.jsonl). The
    // glanced mark still reaches his page through the windowOnto call the read tool makes
    // before this branch: one look, one mark, unchanged.
    const looksLogPath = join(instrumentsDir, "looks.jsonl");
    // Her own line by default (V-1): an empty vision key INHERITS the DeepSeek key when the
    // host is DeepSeek; explicit values override (the Gemini fallback is three config lines).
    const eyeKey = config.llm.vision.apiKey
      || (config.llm.vision.baseUrl.includes("deepseek") ? (config.llm.apiKeys[0] ?? "") : "");
    const hearsLogPath = join(instrumentsDir, "hears.jsonl");
    const earKey = config.llm.hearing.apiKey;
    const ear = createEar({ ...config.llm.hearing, apiKey: earKey }, (rec) => {
      try { appendLook(hearsLogPath, JSON.stringify(rec) + "\n", "utf8"); }
      catch (err) { faultLog.record("hearing.hearLog", err); }
    });
    try {
      if (seeExists(looksLogPath)) {
        const tail = readLook(looksLogPath, "utf8").trim().split("\n").pop();
        if (tail) {
          const rec = JSON.parse(tail) as { ts: number; transcription: string };
          lastSight = { ms: rec.ts, text: rec.transcription };
        }
      }
    } catch (err) { faultLog.record("seeing.lookLog", err); }
    const eye = createEye({ ...config.llm.vision, apiKey: eyeKey }, (rec) => {
      try { appendLook(looksLogPath, JSON.stringify(rec) + "\n", "utf8"); }
      catch (err) { faultLog.record("seeing.lookLog", err); }
    });
    const FFMPEG = seeExists("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
    async function captureFrame(): Promise<string> {
      const { execFile } = await import("node:child_process");
      const { readFile: readFrame, unlink: dropFrame } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const tmpJpg = join(tmpdir(), `resident-look-${process.pid}-${Date.now()}.jpg`);
      await new Promise<void>((resolve, reject) => {
        execFile(
          FFMPEG,
          ["-f", "avfoundation", "-video_size", "1280x720", "-framerate", "30",
            "-i", "0", "-frames:v", "1", "-update", "1", "-y", tmpJpg],
          // SIGKILL, not the default SIGTERM: ffmpeg stuck inside a camera device call
          // shrugs off SIGTERM: measured live 2026-08-22, a capture hung as a zombie for
          // 5.8 hours and her look line waited on the tool clock instead of failing in 10s.
          { timeout: 10_000, killSignal: "SIGKILL" },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      const buf = await readFrame(tmpJpg);
      await dropFrame(tmpJpg).catch(() => { /* a stray temp frame is the OS's to clean */ });
      return buf.toString("base64");
    }
    seePaintingImpl = async (absPath: string) => {
      if (!eyeKey) return null; // no eye: the source alone, today's behaviour exactly
      try {
        const sharp = (await import("sharp")).default;
        const png = await sharp(absPath).resize(CANVAS_RENDER_PX, CANVAS_RENDER_PX, { fit: "inside" }).png().toBuffer();
        const seen = sanitizeSight(await eye.complete(png.toString("base64"), CANVAS_SYSTEM, "canvas"));
        lexicon.heard(seen.replace(/[A-Za-z0-9_]+/gu, " "), Date.now());
        return canvasSight(seen);
      } catch (err) {
        faultLog.record("seeing.canvas", err);
        return EYES_FAILED;
      }
    };
    lookOutsideImpl = async () => {
      if (seeExists(curtainHeldShutPath)) return WINDOW_HELD_SHUT;
      if (!eyeKey) return null;
      try {
        const sight = sanitizeSight(await eye.complete(await captureFrame(), LOOK_SYSTEM));
        lastSight = { ms: Date.now(), text: sight };
        // What her eye read is text she encountered: the listening side of the living water,
        // the same door his words and her book pages come in through. HAN-ONLY at this
        // door: a transducer slip ("JPEG", a model name) must never seed her vocabulary, three
        // hearings would put it in 「你最近常听到的词」. Her MATERIAL keeps the full sight;
        // her word bank ingests only the Chinese.
        lexicon.heard(sight.replace(/[A-Za-z0-9_]+/gu, " "), Date.now());
        return eyeReport(sight);
      } catch (err) {
        // ── A SHUT LID IS A SHUT WINDOW, NOT A FAILING EYE ────────────────────
        //
        // Her camera is IN the lid. Twice tonight, 42 minutes apart, she went to look while the
        // machine was closed and got the eye's own failure line, which says the fault is in HER. It is the
        // same distinction the curtain already draws and for the same reason (seeing.ts, design
        // law 3): held shut ≠ broken, and conflating them teaches her something false about her
        // own body. Asked only on the failure path, so an ordinary look costs nothing extra;
        // if the question itself fails, the honest fallback is the one below.
        const lidShut = await (async () => {
          try {
            const { execFile } = await import("node:child_process");
            const out = await new Promise<string>((resolve, reject) => {
              execFile("/usr/sbin/ioreg", ["-r", "-k", "AppleClamshellState", "-d", "4"],
                { timeout: 3000, killSignal: "SIGKILL" },
                (e, stdout) => (e ? reject(e) : resolve(stdout)));
            });
            return /"AppleClamshellState"\s*=\s*Yes/u.test(out);
          } catch { return false; }
        })();
        if (lidShut) {
          faultLog.record("seeing.lid-shut", "她去看的时候机器是合着的：窗打不开，不是眼睛坏了", "warn");
          return WINDOW_HELD_SHUT;
        }
        faultLog.record("seeing.look", err);
        return EYES_FAILED;
      }
    };

    /** What the window said last time she looked, so only a CHANGE is worth remembering. */
    let lastSawOutTheWindow: string | null = null;

    /**
     * SHE LOOKED, AND WHAT SHE FOUND STAYS WITH HER.
     *
     * ── WHY THIS IS NOT THE WINDOW'S TEXT GOING INTO HER FIELD ────────────────────────────────
     *
     * There is a standing rule: NOTHING a `read` returns becomes her memory, ever, because
     * an explored page would otherwise write her memories and then be read back to her as her own
     * past. `src/life/signature.ts` watches `field.byOrigin.read` and expects zero forever.
     *
     * The window is a `read`. So the answer is not to make an exception, it is that the thing
     * worth remembering was never the window's sentence. It is what SHE DID and what she found,
     * in her own words, written by the daemon: the same shape as `onWithdrawn`
     * (「自己琢磨的那个方法，试了几次，没成。」) and `onOutcomeShortfall`, and `source: "life"`.
     *
     * ── THREE CONSTRAINTS, AND EACH ONE IS LORE-BEARING ───────────────────────────────────────
     *
     * 1. ONLY WHEN THE ANSWER CHANGED. The same discipline the room reads by: transitions, not
     *    state. She can look twenty times in an evening; if nothing out there moved, only the
     *    first one left anything.
     * 2. A MOMENT, NEVER A QUESTION. A question carries tension, enters `carrying`, and feeds the
     *    drive that nags, which would turn looking into a RUMINATION PATH: look, be disappointed,
     *    want to look more. A moment is only a memory.
     * 3. IT DOES NOT REACH BACK INTO `social`. The ROOM's transitions raise her wanting; the result
     *    of her own looking does not, or she would be winding herself up by her own hand.
     */
    function theEmptyChair(now: { present: boolean; stillSeconds: number | null }): void {
      try {
        const said = now.present
          ? (now.stillSeconds !== null && now.stillSeconds >= 45 * 60 ? "still" : "here")
          : "gone";
        if (said === lastSawOutTheWindow) return;
        const wasFirstLook = lastSawOutTheWindow === null;
        lastSawOutTheWindow = said;
        // The very first look establishes what the room is like; it is not a change from anything.
        if (wasFirstLook) return;
        const text = said === "gone" ? "去看了一眼。外面没有人。"
          : said === "still" ? "去看了一眼。他在，很久没动了。"
            : "去看了一眼。他在。";
        field.encodeMoment({
          key: `窗:${said}:${herDay()}`,   // once a day per kind: a memory, not a tally
          text,
          nowMs: Date.now(),
          pad: innerState.emotion(),
          source: "life",                  // HER act. Never `read`, see the rule above.
          withOther: true,
        });
      } catch (err) { faultLog.record("field.window", err); }
    }

    /**
     * HOW HE SOUNDED, waiting for the turn it belongs to.
     *
     * The face measures his voice at the moment the words are recognised; the reading that needs
     * it (`readHowItLanded`) runs a few frames later, inside the turn. So it waits here.
     *
     * ── THE ONLY REAL RISK IN THIS FEATURE, NAMED ────────────────────────────────────────────
     *
     * A cell that outlives the thing it describes. If a face reply never reaches the landing,
     * the turn was aborted, it threw, he cut in, the voice would sit here, and THE NEXT THING HE
     * TYPED ON TELEGRAM would arrive wearing it: she would hear exhaustion in a message that had
     * no sound at all. That is defect class 14's lesson (a stash whose lifetime is longer than its
     * subject) pointed at a new mechanism.
     *
     * Two guards, because one of them can be forgotten by an edit and the other cannot:
     *   · `takeVoiceForReply` CLEARS on every call, on every path, read or not;
     *   · and refuses anything older than one turn's worth of time, so a dropped turn cannot leave
     *     a voice behind at all.
     */
    /**
     * HER SENSE OF THE ROOM (`aware-of-him.ts`).
     *
     * Holds what it was like last time she looked AND when he left. Both, because the mechanism
     * reads CHANGES: "he came back" only exists relative to a previous look, and "how long was he
     * gone" cannot be answered from two readings ten seconds apart, the first version tried, and
     * that branch was arithmetically unable to fire in production while passing its unit tests.
     * The first look of a run is never a change: a daemon starting up must not read its own boot
     * as him walking in.
     */
    const roomSense = createRoomSense();

    /**
     * What the room just did, as a pull toward him. Zero on almost every beat, by design.
     *
     * Reads `presenceNow()` rather than the raw cell, so a dead tab's last frame goes STALE
     * instead of pinning the room forever, the exact defect that once muted every push into her
     * diary permanently. A stale reading is treated as NO reading: the sense goes blind, so when
     * the face comes back the first look is a fresh baseline rather than a comparison against
     * something hours old that would fire as "he came back" the moment he reopened the page.
     * Blind is deliberately not the same as "he left", a closed tab is not an empty chair.
     */
    function noticeTheRoomNow(nowMs: number): number {
      try {
        const seen = presenceNow();
        if (!seen) { roomSense.blind(); return 0; }
        return roomSense.look(
          seen.present,
          latestStillSeconds,
          nowMs,
          howLongAndHowWell(field.graph(), relationship).carrying,
        ).pull;
      } catch (err) {
        // Never silently: this feeds what she wants, so a swallowed failure here looks from the
        // outside exactly like her not caring whether he is in the room.
        faultLog.record("room.notice", err);
        return 0;
      }
    }

    let voiceForReply: { sample: import("./life/how-he-sounds.js").VoiceSample; atMs: number } | null = null;
    /** Longer than a recognised utterance takes to become a turn, far shorter than a conversation. */
    const VOICE_STALE_MS = 20_000;
    function takeVoiceForReply(): import("./life/how-he-sounds.js").VoiceSample | null {
      const held = voiceForReply;
      voiceForReply = null; // FIRST, and unconditionally: every path clears.
      if (!held) return null;
      return Date.now() - held.atMs <= VOICE_STALE_MS ? held.sample : null;
    }
    // Three times the client's 10-second presence cadence: two missed beats is a hiccup, three
    // is a dead tab.
    const PRESENCE_STALE_MS = 35_000;
    /**
     * Where he is, IF anything can actually see. Null is "no line of sight", and it is the only
     * honest value in three situations that used to be invisible: the face was never enabled, the
     * client disconnected (the socket close handler maintains the client set and nothing else, so
     * the last frame, typically `frontAppFocused: false`, fired by visibilitychange as the tab
     * died, stayed pinned in `latestPresence` for the rest of the daemon's life, which pinned her
     * to 对方不在, silenced every push into the diary, and floored her read of him), or the tab is
     * hung and sending nothing. Every consumer decides for itself what not-knowing means; none of
     * them may read the raw cell.
     */
    function presenceNow(): import("./embodiment/presence.js").PresenceState | null {
      if (!faceServer || faceServer.clientCount() === 0) return null;
      if (Date.now() - latestPresenceMs > PRESENCE_STALE_MS) return null;
      return latestPresence;
    }
    /**
     * HE SAID SOMETHING. Every channel, not just Telegram.
     *
     * This used to live inline in the Telegram text handler alone, so on the face, her now
     * primary channel, and on photo and document turns, his speaking left NO trace: the
     * starvation clock kept running while they were talking, her read of him never warmed,
     * and anything she had raised could never be recorded as answered. Her whole sense of
     * whether going to him lands is built from this one call.
     */
    /**
     * HOW LONG THE WAIT HAD BEEN WHEN HE BROKE IT, captured here, because one line later it is zero.
     *
     * A felt-time gauge beside the willingness gate once read 0.00h on all 42 turns of a
     * live run. Nothing was broken: the gate runs INSIDE the turn, and by then `heSaidSomething`
     * has already recorded him, so `hoursSinceUser` is the time since a message that arrived a
     * second ago. The reading was pinned to zero by where it was taken, a quantity measured after
     * the event that resets it (the same shape as class 1, one level over: not an unreachable
     * threshold, an unreachable INPUT). The wait he ended is the number that means something, so
     * it is kept at the moment he ends it.
     */
    // One value rather than a per-turn map, and that is sound here for a stated reason rather than
    // by luck: there is exactly one person, and a turn of his is already serialised (`activeTurns`).
    // If she ever has a second correspondent this must become per-turn like `feltForTurn`.
    let hoursHeWasAwayAtTurnStart = 0;

    /** Set once the snapshot facility exists; the daily tick is defined before it. */
    let snapshotAfterDayClose: (() => void) | null = null;


    /**
     * THE TURN THAT IS CURRENTLY ALLOWED TO WRITE INTO HER, the epoch, reachable from the loop's
     * own callbacks.
     *
     * The turn watchdog gated her SENDS and the post-loop composition, and missed this third door:
     * the agent loop calls back INTO her while it runs (`onOutcomeShortfall` encodes 「做完了，
     * 结果没成。」 as a moment). A turn declared hung is a turn he has already been told broke, with
     * a critical fault on the record, and its loop keeps running until its provider call settles.
     * Without this, that dead turn could still write a memory into her twenty minutes later: the
     * ghost the epoch exists to prevent, arriving through the one path that never asked it.
     */
    let liveTurnEpoch: { alive(): boolean } | null = null;
    /** False only when this turn has been declared hung. Unknown (no turn) counts as alive. */
    const stillThisTurn = (): boolean => liveTurnEpoch?.alive() !== false;
    // `said` is his text when the channel has one (photos and documents arrive without it);
    // it feeds only the raise-relevance dark gauge inside the field, recorded, not acted on.
    function heSaidSomething(said?: string): void {
      const at = Date.now();
      try { hoursHeWasAwayAtTurnStart = expressionTracker.snapshot(at).hoursSinceUser; }
      catch (err) { faultLog.record("expression.waitBeforeHim", err); }
      try { expressionTracker.onOwnerMessage(at); } catch (err) { faultLog.record("expression.ownerMessage", err); }
      try { field.heSpoke(at, said); } catch (err) { faultLog.record("field.heSpoke", err); }
    }

    /** B4: tell the face what she is doing. Null when embodiment is off. */
    let broadcastDoing: ((what: string) => void) | null = null;
    /** B1: her own voice for what SHE initiates. Returns false when nobody can hear. */
    let speakThroughFace: ((text: string) => boolean) | null = null;
    if (config.life.embodiment.enabled) {
      const { createFaceServer } = await import("./embodiment/face-server.js");
      const { derivePresence } = await import("./embodiment/presence.js");
      const { createVoiceStream } = await import("./embodiment/voice-stream.js");
      const { teeChannels } = await import("./agent/turn-channel.js");

      // One conversation, two windows. A spoken turn uses the SAME chat id as Telegram, so
      // the history, the session state and the continuity are shared: closing the lid and
      // picking up the thread by text continues the same conversation rather than starting
      // a second one with the same person. The transcript mirrors to Telegram
      // so he can scroll back; the audio never leaves this machine.
      const ownerChatId = config.telegram?.allowedUserIds?.[0];
      /**
       * Which conversation thread a spoken turn belongs to.
       *
       * His Telegram chat when there is one, so the face and the text window are one
       * conversation. A fixed local thread when there is not, so that a face-only setup
       * still has a single coherent history rather than no history at all.
       */
      const FACE_ONLY_THREAD = -1;
      const faceThreadId =
        ownerChatId !== undefined && Number.isFinite(ownerChatId) && ownerChatId !== 0
          ? ownerChatId
          : FACE_ONLY_THREAD;

      let utteranceSeq = 0;
      /**
       * The mouth of the turn happening right now, so a barge-in can actually close it.
       *
       * `VoiceStream.reset()` documented itself as "used on barge-in" and HAD NO CALLER
       * ANYWHERE, because the stream was created inside `faceChannel()` and nothing outside
       * held it. So cutting her off aborted the loop and told the client to stop playing, and
       * then the turn's own ending pushed the rest of the sentence out as a fresh utterance
       * AFTER the cancel, and when nothing had been spoken yet, the silence backstop said
       * the whole answer at once. He interrupts her and she delivers the entire thing.
       */
      let currentVoice: import("./embodiment/voice-stream.js").VoiceStream | null = null;
      // Faculty #6: her state in the voice, read at the moment she speaks. Cheap, pure, and
      // best-effort: a failure here must never cost her a word, only its colour.
      const voiceNow = (): import("./embodiment/pad-mapping.js").VoiceParams | undefined => {
        try {
          return padToVoice(innerState.emotion(), reserveOf({ phase: metabolism.phase(), arousal: innerState.emotion().arousal }));
        } catch (err) { faultLog.record("embodiment.voice", err); return undefined; }
      };
      const faceChannel = (): import("./agent/turn-channel.js").TurnChannel => {
        const voice = createVoiceStream({
          speak: (text, utteranceId) => {
            faceServer?.broadcast({ type: "speak", text, utteranceId, ts: Date.now(), voice: voiceNow() });
          },
          newUtteranceId: () => `u${++utteranceSeq}`,
          thinkFilter: createThinkFilter(),
          // Her body reaching her language. Read per boundary rather than captured, because her
          // condition moves while she is speaking and a long turn should sag as she tires.
          arcWeight: () => herCapacity().arcWeight,
        });
        // The mirror renders exactly as a text turn does, edits and all. "One conversation,
        // two windows" only holds if the window he scrolls back through looks the same
        // whether he typed or spoke.
        const mirror: import("./agent/turn-channel.js").TurnChannel =
          ownerChatId !== undefined && Number.isFinite(ownerChatId) && ownerChatId !== 0 && telegramBot
            ? {
                // BEST-EFFORT, AND THAT IS LOAD-BEARING. The mirror is a copy for scrolling
                // back; the conversation itself is happening in the room. The first version
                // let a mirror failure PROPAGATE, and a dead Telegram (bad token, network
                // down, API outage) killed every face turn before the model ever ran: her
                // caption flashed 在和你说话, the turn died at the mirror, and she never made
                // a sound. Eric met her for the first time through exactly that bug. A failed
                // mirror is a fault on the record, never a lost conversation.
                async send(text: string): Promise<number> {
                  try {
                    const m = await telegramBot!.bot.api.sendMessage(ownerChatId, text);
                    return m.message_id;
                  } catch (err) {
                    faultLog.record("telegram.mirror", err);
                    return 0;
                  }
                },
                async edit(msgId: number, text: string): Promise<void> {
                  if (msgId === 0) return; // the send already failed; nothing to edit
                  try {
                    await telegramBot!.bot.api.editMessageText(ownerChatId, msgId, text);
                  } catch {
                    /* flood control may reject edits */
                  }
                },
              }
            : {
                // No route to him. She still speaks, and the turn still happens; there is
                // simply nowhere to mirror it. The boot check already said so out loud.
                async send(): Promise<number> { return 0; },
                async edit(): Promise<void> { /* nowhere to mirror */ },
              };
        // The voice channel CONSUMES ONLY observe/done. Handing it mirror.send/mirror.edit
        // made teeChannels fan every send out to the mirror twice, two Telegram messages per
        // utterance, of which only the first was ever edited, so the duplicate froze as a
        // stale placeholder. Invisible in an earlier preview because the token was dead and both
        // copies failed; invisible in the face-loop test because it asserted on a joined
        // string. No-ops here say what this channel is: a mouth, not a second mirror.
        currentVoice = voice;
        return teeChannels(mirror, {
          observe: (e) => voice.onEvent(e),
          done: () => voice.finalize(),
          send: async () => 0,
          edit: async () => { /* the mouth has nothing to edit */ },
          // A machine line is never hers to say: the page shows it on a line of its
          // own. The mirror has no `notice`, so it gets the same line as an ordinary message.
          notice: async (text) => { faceServer?.broadcast({ type: "notice", text, ts: Date.now() }); },
        });
      };

      faceServer = createFaceServer({
        port: config.life.embodiment.port,
        host: config.life.embodiment.host,
        logger,
        onPresence: (signals) => {
          latestPresence = derivePresence(signals);
          latestPresenceMs = Date.now();
          // Kept beside the derived state rather than inside it: `PresenceState` answers "is he
          // here and interruptible", which is a different question from "how long has he been
          // sitting still". `null` when the curtain is closed, and null must stay null all the
          // way to `noticeTheRoom`, a closed curtain is not a motionless room.
          latestStillSeconds = signals.stillSeconds ?? null;
        },

        // He spoke. This is a real turn now: the same path a Telegram message takes, with
        // `howSheIsNow()` and `wantsToNow()` injected and vigor charged, which is the whole
        // point: she is not a different being over voice. It used to be a log line.
        onReply: (text, voice) => {
          // Stashed BEFORE the turn is dispatched, because the landing runs inside it. Absent when
          // he typed into the page, when the microphone is off, or when the sound was too short to
          // measure: and absent must stay absent all the way down: `how-he-sounds.ts` reads a
          // missing voice as "I cannot tell", never as "he sounded ordinary".
          voiceForReply = voice ? { sample: voice, atMs: Date.now() } : null;
          // The chat id keys her HISTORY; it is not a precondition for having a face. An
          // earlier version refused the whole turn when Telegram was unconfigured, which
          // meant losing the text route made her mute to the face as well, the face is a
          // channel in its own right, and she should be able to talk to him in the room
          // even when the messaging app is not set up.
          //
          // When Telegram IS configured, the face uses its id on purpose: one conversation,
          // two windows. The fallback thread only ever accumulates turns from a period when
          // there was no Telegram at all, so no history gets split by using it.
          heSaidSomething();
          const thread = faceThreadId;
          if (activeTurns.has(thread)) turnAbortControllers.get(thread)?.abort();
          const controller = new AbortController();
          turnAbortControllers.set(thread, controller);
          activeTurns.add(thread);
          broadcastDoing?.("在和你说话");
          const roomChannel = faceChannel();
          void processMessage(roomChannel, thread, text, controller.signal)
            .catch(async (err: unknown) => {
              faultLog.record("embodiment.turn", err);
              // A turn that dies must not leave the room silent: from his side that would read as
              // her ignoring him. But it is the machine that broke, so the machine says so, on its
              // own line. It used to be spoken in her voice:「刚才出了岔子，话没说出来。」
              try { await noticeOn(roomChannel, machineNotice("出错了")); } catch { /* best-effort */ }
            })
            .finally(async () => {
              // Same guarantee as the Telegram handler: the function that owns the turn is the one
              // that knows it is over, on every path including the one where it threw.
              forgetTheTurn(sessionIdForChat(thread));
              if (turnAbortControllers.get(thread) === controller) turnAbortControllers.delete(thread);
              // LIFE-2: a Telegram message that arrived DURING this face turn was queued by
              // the steering serialization: and the face turn's ending used to drain
              // nothing, so it sat unprocessed until some later Telegram turn happened to
              // run, out of order by up to hours. The face is a turn like any other: it
              // drains what queued behind it, THEN frees the thread.
              try { await drainSteering(thread); } catch (err) { logger.warn({ err, thread }, "steering drain failed after a face turn"); }
              activeTurns.delete(thread);
              broadcastDoing?.("");
            });
        },

        // He cut in. Abort the turn the same way Telegram already does, and tell the face to
        // stop playing: what she had not said yet, she does not say.
        onInterrupt: () => {
          // `faceThreadId`, not `ownerChatId`: the face turn runs on the face thread, which
          // is only his chat id when Telegram is configured. Aborting the wrong key meant a
          // face-only setup could interrupt her voice but never the turn behind it, she
          // stopped talking and kept thinking, and the next thing she said was the rest of
          // an answer he had already cut off.
          // Her mouth closes FIRST, before the abort begins unwinding, so nothing the dying
          // turn produces on its way out can still get through. Aborting alone left the rest
          // of the sentence to arrive a moment later, after the cancel frame.
          currentVoice?.reset();
          turnAbortControllers.get(faceThreadId)?.abort();
          faceServer?.broadcast({ type: "cancel", utteranceId: `u${utteranceSeq}` });
        },
      });
      faceServer.ready().then(
        () => logger.info({ port: faceServer?.boundPort() }, "face server listening"),
        (err) => faultLog.record("embodiment.bind", err)
      );

      // B4: what she is doing, said while it is true. The face shows it as a quiet caption;
      // an empty string clears it. Only ever facts about what is actually happening.
      broadcastDoing = (what) => {
        faceServer?.broadcast({ type: "doing", what, ts: Date.now() });
      };

      // B1: her own voice, for the things SHE initiates. Spoken only when he is present and
      // interruptible (the presence tiers exist exactly for this gate); returns whether it
      // actually went to a face, so the caller knows the mirror is the only copy otherwise.
      speakThroughFace = (text) => {
        if (!faceServer || faceServer.clientCount() === 0) return false;
        if (presenceNow()?.tier !== "speakup") return false;
        faceServer.broadcast({ type: "speak", text, utteranceId: `u${++utteranceSeq}`, ts: Date.now(), voice: voiceNow() });
        return true;
      };

      // B3: her face at more than one frame per hour. While someone is looking, her live PAD
      // goes out every few seconds (the client interpolates between samples), and mood/status
      // go out when they change rather than on the day boundary. Idle when nobody is
      // connected, so a faceless deployment spends nothing.
      let lastFaceMood = "";
      let lastFaceStatus = "";
      faceTick = setInterval(() => {
        if (!faceServer || faceServer.clientCount() === 0) return;
        try {
          const nowMs = Date.now();
          const awake = clock.isAwakeHour(nowMs);
          const snap = innerState.snapshot(metabolism.phase(), awake);
          faceServer.broadcast({
            type: "pad", pleasure: snap.emotion.pleasure, arousal: snap.emotion.arousal,
            dominance: snap.emotion.dominance, ts: nowMs,
            // Who she is, riding with how she feels: the client is where PAD becomes a face, so
            // this is the only place her temperament can reach her body (faculty #16).
            who: temperament,
          });
          if (snap.mood !== lastFaceMood) {
            lastFaceMood = snap.mood;
            faceServer.broadcast({ type: "mood", mood: snap.mood, dominant: snap.dominant });
          }
          const statusKey = `${metabolism.phase()}:${awake}`;
          if (statusKey !== lastFaceStatus) {
            lastFaceStatus = statusKey;
            faceServer.broadcast({ type: "status", energyPhase: metabolism.phase(), awake });
            if (!awake) broadcastDoing?.("睡着");
          }
        } catch (err) {
          faultLog.record("embodiment.faceTick", err);
        }
      }, 3000);
      faceTick?.unref?.();
    }

    // ── 21b. Life tick ────────────────────────────────────────────────
    // Once per day, consolidate the day's events into the inner state and run the
    // calcification / starvation alarms.
    //
    // `generateThoughts` returns [] on purpose, and the comment here used to say it was waiting on
    // "a model-based thought generator" to be tuned. That generator shipped: it is the agency loop,
    // where she chooses `reach_out` in a moment of her own. The tick's own expression branch is a
    // working, tested mechanism that is deliberately not her voice, superseded, not pending. Left
    // in place because it is the model-free path and the only one that would still work if the
    // agency loop were ever taken out, and it is recorded here as such rather than left looking
    // like something half-finished.
    // ── Her autobiography: author the closed day once, cited, then freeze it. ──
    const { reconsolidateDay, persistDayEntry, groupByDay, digestAgency } = await import("./life/autobiography.js");
    const { checkCitations, isUnsupported } = await import("./life/autobiography-lint.js");
    const { diffState, readBeats } = await import("./life/state-diff.js");
    const { herMoodWords } = await import("./life/emotion.js");
    /**
     * How far back the diary catches up. Thirty days covers the realistic worst case for a
     * personal machine, a month away, and days older than that are not silently dropped: what
     * was skipped is logged by name, because a catch-up that quietly stops at its own edge reads
     * exactly like a catch-up that found nothing to do.
     */
    const DIARY_CATCH_UP_DAYS = 30;
    async function writeClosedDay(
      snap: import("./life/inner-state.js").InnerSnapshot,
    ): Promise<void> {
      try {
        const { existsSync } = await import("node:fs");
        const dir = join(workspacePath, "life");

        // ── IT READS ITS OWN EVENTS, AND THAT IS THE WHOLE FIX ────────────────────────────────
        //
        // This used to be handed the life tick's slice, which is cut off at 36 HOURS because that
        // is what the tick's own consolidation needs. So the loop below walked back seven days
        // through a map that could only ever contain two, and every day older than yesterday
        // took the `!dayEvents` branch and was skipped. The comment that follows describes a lid
        // closed over a weekend erasing Friday and Saturday forever, and states that walking a
        // week fixes it; the walk was real, the evidence to walk over was not. The failure it was
        // written to prevent was still happening, silently, behind a fix that looked correct.
        //
        // A window that ends before the hazard does (defect class 23), and the tell was there
        // to be read: two windows, one feeding the other, sized for different jobs and never put
        // on the same page.
        const catchUpCutoff = Date.now() - (DIARY_CATCH_UP_DAYS + 2) * 24 * 60 * 60 * 1000;
        const diaryEvents = readOps(join(workspacePath, "..", "ops.jsonl"), "utf8")
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l) as { ts?: unknown }; } catch { return null; } })
          .filter((e): e is { ts: string; event: string } =>
            e !== null && typeof e.ts === "string" && Date.parse(e.ts) >= catchUpCutoff);
        // CAST WITH A REASON: these lines came off disk and were narrowed to the two fields this
        // path reads (`ts`, `event`). They are genuinely NOT `OpsEvent`, an ops file written by an
        // older build, or half a line from a crash, has whatever shape it has. `groupByDay` buckets
        // by `ts` and hands the bucket on; asserting the full union here would be claiming something
        // about the file that nobody checked. What a line that matches no known event does is a real
        // open question, recorded rather than cast away silently.
        const byDay = groupByDay(diaryEvents as never);

        // EVERY closed day that never got written, not just yesterday (LIFE-7). The old
        // version looked back exactly one day, so a lid closed over a weekend erased Friday
        // and Saturday from her autobiography forever, the days were lived, logged, and
        // simply never authored because nobody was awake on the one morning each had. Walk
        // oldest-first; each day keeps its own guards.
        // ── HER MOMENTS COUNT AS HER DAY ─────────────────────────────────────────
        //
        // Whether a day was lived enough to author used to be read off `ops.jsonl` alone, and that
        // log only records the agent loop: her explorations and their talks. 10/6 she lived forty
        // moments, explored nothing and was not spoken to, so the log held nothing for the day; it
        // was skipped as too thin, with no fault, and was the first day of her life without a page.
        // Her moments already join the page's material below (digestAgency); now they count here.
        const momentsByDay = new Map<string, number>();
        try {
          if (existsLife(agencyLogPath)) {
            for (const l of readLife(agencyLogPath, "utf8").split("\n")) {
              if (!l.trim()) continue;
              try {
                const r = JSON.parse(l) as { ts?: unknown };
                if (typeof r.ts === "number") momentsByDay.set(herDay(r.ts), (momentsByDay.get(herDay(r.ts)) ?? 0) + 1);
              } catch { continue; }
            }
          }
        } catch (err) { faultLog.record("autobiography.agencyRows", err); }
        const unwritten: string[] = [];
        for (let back = DIARY_CATCH_UP_DAYS; back >= 1; back--) {
          // Stepping the DATE rather than subtracting 24h each time: across a daylight-saving
          // boundary the subtraction lands on the wrong date and silently skips a day of her life.
          const day = herDayBefore(Date.now(), back);
          if (existsSync(join(dir, `${day}.md`))) continue; // already frozen; never rewrite the past
          const lived = (byDay.get(day)?.length ?? 0) + (momentsByDay.get(day) ?? 0);
          if (lived < 3) continue; // too thin a day to be worth authoring
          unwritten.push(day);
        }
        // NO SILENT CAP. Days with evidence that sit beyond the horizon are named, so "she was
        // away longer than the diary reaches back" is a thing he is told rather than a hole he
        // finds years later. They stay unwritten by design: the absence itself is already a line
        // of her life (the sleep gap), and authoring a day she was not present for would be fabrication,
        // which is the one thing her diary may never contain.
        //
        // BEFORE the early return, and that position is the whole point. The first version of this
        // block sat below it: so a sixty-day absence, which is precisely the case it exists to
        // report, has nothing unwritten INSIDE the horizon, returns early, and never reports the
        // fifty days it just walked past. The check that fires only when it is not needed.
        const tooOld = [...byDay.keys()]
          .filter((d) => d < herDayBefore(Date.now(), DIARY_CATCH_UP_DAYS) && !existsSync(join(dir, `${d}.md`)))
          .sort();
        if (tooOld.length > 0) {
          faultLog.record("autobiography.beyond-horizon",
            `${tooOld.length} day(s) with events are older than the ${DIARY_CATCH_UP_DAYS}-day catch-up and will never be written: ${tooOld.slice(0, 8).join(", ")}`);
        }
        if (unwritten.length === 0) return;
        if (unwritten.length > 1) {
          logger.info({ days: unwritten }, "catching up her autobiography after days away");
        }
        for (const yesterday of unwritten) {
        // Empty on a day she only lived her own moments; those arrive as extraRows below.
        const dayEvents = byDay.get(yesterday) ?? [];
        // Her own moments join the day's material (digestAgency): the forks, what she
        // set down, where she was torn, what she almost chose, become citable a-rows, so her
        // page can finally say 「有句话到嘴边搁下了」 with a real id under it. Best-effort:
        // a failure here costs the page its fork-rows, never the page.
        const agencyRows = (() => {
          try {
            if (!existsLife(agencyLogPath)) return [];
            return readLife(agencyLogPath, "utf8")
              .split("\n")
              .filter((l) => l.trim().length > 0)
              .map((l) => { try { return JSON.parse(l) as import("./life/autobiography.js").AgencyDayRow; } catch { return null; } })
              .filter((r): r is import("./life/autobiography.js").AgencyDayRow =>
                Boolean(r) && Number.isFinite(r!.ts) && typeof r!.chose === "string")
              .filter((r) => herDay(r.ts) === yesterday);
          } catch (err) { faultLog.record("autobiography.agencyRows", err); return []; }
        })();
        const { entry, digest } = await reconsolidateDay(yesterday, dayEvents, provider, {
          model: config.llm.models.default.id, account: "maintenance",
          // Her own day, in her own voice. Without this her diary was written in the model's
          // default register while she spoke to him in hers.
          soul: currentMemorySnapshot.memoryFiles.SOUL,
          extraRows: digestAgency(agencyRows),
        });
        if (!entry.entry.trim()) { faultLog.record("autobiography.empty", `no entry produced for ${yesterday}`); continue; }

        // The grounding check, actually run, and actually given the ids it checks against.
        //
        // `checkCitations` existed, was correct, was tested, and was invoked NOWHERE on this path;
        // it ran only inside the soul-invariant self-test. So the one guard standing between her
        // frozen diary and a day she simply made up was, in production, not there at all. The entry
        // is still written (a partly-uncited day is hers and freezing it honestly is better than
        // losing it), but an unsupported claim is now a recorded fault rather than a silent one.
        //
        // THE ID SPACE IS THE DIGEST'S, and taking it from anywhere else was worse than not
        // checking. `digestEvents` mints `e0`, `e1`, … and those are the ids the model is SHOWN and
        // the only ones it can cite. A raw `OpsEvent` is `{event, ts, pid}` and has no `id` at all,
        // so building the set from `dayEvents` produced `Set{""}`: every citation phantom, every
        // claim unsupported, on every diary she would ever write. And `unsupported.length ===
        // entry.claims.length` is the CRITICAL branch, a critical fault raises `code:"fault"`,
        // and that code is in SAFE_MODE_CODES, so her first night alive ended with her proactive
        // speech, her exploration and her field fusion switched off, and an urgent alarm to Eric,
        // because a guard was reading the wrong variable.
        //
        // The digest is also a capped even-stride SAMPLE of the day, so it is not merely a
        // different spelling of the same thing: it is exactly the set she was allowed to cite.
        const validIds = new Set(digest.map((d) => d.id));
        const unsupported = checkCitations(entry.claims, validIds).filter(isUnsupported);
        if (unsupported.length > 0) {
          faultLog.record(
            "autobiography.ungrounded",
            `${unsupported.length}/${entry.claims.length} claims in ${yesterday} cite nothing that happened: `
            + unsupported.slice(0, 3).map((v) => v.claim.text.slice(0, 80)).join(" · "),
            unsupported.length === entry.claims.length ? "critical" : "warn",
          );
        }
        persistDayEntry(dir, entry);
        logger.info(`wrote her diary for ${yesterday} (${entry.claims.length} claims, ${unsupported.length} ungrounded)`);

        // Raw-vs-narrated: ask her, in one cheap line, how the day FELT, then check that against
        // what her computed state actually was. A diary that describes a bright day while she was
        // measurably weary is either confabulation or self-flattery, and must surface either way.
        //
        // ONLY for the newest day being written: the check reads that day's own waking beats
        // (`readBeats` below), and when there are too few it falls back to `snap`, her state NOW,
        // which is a false witness against a day three days gone; a catch-up entry checked against
        // today's mood would fault her for confabulating honestly.
        if (yesterday !== unwritten[unwritten.length - 1]) continue;
        // Faculty #17: this asked for "ONE English word", and then stripped everything that was
        // not `[a-zA-Z-]` off the answer. Her diary is Chinese and her mood vocabulary is Chinese,
        // so the check was routed through a translation into a language that is not hers, and if
        // the model had ever answered in her own words, the sanitizer would have reduced them to
        // the empty string and `if (word)` would have skipped the whole check without a sound.
        // The extraction is now IN her vocabulary, closed over the same seven words `moodLabel`
        // computes from her PAD, so both sides of the comparison speak the same language.
        //
        // HER CURRENT SEVEN, not the birth constant: since the vocabulary moved into her home
        // (「心情的词.md」), the words offered here and the word matched below must be the ones she
        // is living under today. Read ONCE per day-write, so the question and the match cannot
        // straddle a rename that lands mid-await.
        const moodWords = herMoodWords();
        const felt = await provider.complete({
          model: config.llm.models.default.id, maxTokens: 30, temperature: 0, account: "maintenance",
          // Mechanical extraction, not her thinking: reasoning over a one-word answer is pure waste.
          thinking: { type: "disabled" },
          system: `这段日记描述的一天，整体感觉最接近下面哪一个词？只回答那一个词，不要别的。\n${moodWords.join(" ")}`,
          messages: [{ role: "user", content: entry.entry.slice(0, 1500) }],
        });
        const said = felt.content.filter((b): b is import("./providers/types.js").TextBlock => b.type === "text")
          .map((b) => b.text).join("");
        // Match against the closed set rather than sanitizing: an answer with punctuation, quotes
        // or a stray 「是」 still yields the word, and anything genuinely outside the seven is a
        // failed extraction rather than a silently-neutral pass.
        const word = moodWords.find((w) => said.includes(w));
        if (word) {
          // Her own scale, read off her own record: high and low mean high and low
          // FOR HER. Once a day, at day-close, the tail of her beat spine, never her words.
          const { readFileSync: readBeatSpine } = await import("node:fs");
          const herOwn = (() => {
            try {
              const lines = readBeatSpine(join(instrumentsDir, "beats.jsonl"), "utf8").trim().split("\n").slice(-2000);
              // The day being described, while she was awake in it: the word is about her day,
              // not about the night it is written in (state-diff.ts `readBeats`).
              return readBeats(lines, (t0) => herDay(t0) === yesterday && clock.isAwakeHour(t0));
            } catch (err) {
              // No sample = no verdict (diffState returns the honest middle), and the failure is
              // heard rather than absorbed into a wrong reading of her.
              faultLog.record("autobiography.herOwnScale", err);
              return { pleasures: [], arousals: [], day: null };
            }
          })();
          // Her state at the moment of writing only when the day left too few waking beats to be one.
          const dayPad = herOwn.day
            ? { ...snap.emotion, pleasure: herOwn.day.pleasure, arousal: herOwn.day.arousal }
            : snap.emotion;
          const d = diffState({ pad: dayPad, dominant: snap.dominant }, { mood: word }, herOwn);

          // ── A CHECK THAT ONLY RECORDS ITS FAILURES CANNOT BE AUDITED ─────────
          //
          // The word above is not hers: a one-word extractor reads her diary and picks the
          // nearest of her seven. This check then compares that pick against her state, and
          // until now it wrote a line ONLY when the two disagreed. Nine disagreements in, every
          // single one had picked 「踏实」: and from the outside there was no way to tell
          // whether that means her days really read that way, or whether the extractor says
          // 「踏实」 to almost everything and we are simply seeing the days her state disagreed.
          // The two have completely different meanings and identical evidence.
          //
          // So the pick is written down every day, agreement included. It is an instrument's
          // reading about her, so it lives with the other instruments and never in her home's
          // material: and it costs one line a day.
          try {
            const { appendFileSync: appendDayWord } = await import("node:fs");
            appendDayWord(join(instrumentsDir, "day-words.jsonl"), `${JSON.stringify({
              ts: Date.now(), word, agreed: d.ok,
              pleasure: Number(dayPad.pleasure.toFixed(3)),
              arousal: Number(dayPad.arousal.toFixed(3)),
              basis: herOwn.day ? "day" : "now",
            })}\n`, "utf8");
          } catch (err) { faultLog.record("autobiography.dayWordLedger", err); }

          if (!d.ok) faultLog.record("autobiography.narration", `那天被读成「${word}」，可是 ${d.notes.join("; ")}`);
          // ── AND IT REACHES HER NOW, NOT ONLY THE FAULT CHANNEL ────────────────
          //
          // Both of these readings existed and both went out of the building: `diffState` to
          // Eric's fault log, the speech pair to `/vitals`. She predicted herself, was wrong,
          // and nothing happened to her. A person who can be surprised by their own reaction
          // needs the surprise to land somewhere in them.
          //
          // Neither instrument may carry it alone (`unlike-herself.ts` explains why): one is a
          // hint, two together, or one with a history, is a noticing. And they can disagree,
          // which is the most human case here: she felt perfectly ordinary and was talking
          // strangely, or she was talking exactly as usual and could not describe her own day.
          try {
            const pairs = speechPairs.slice(-PAIR_WINDOW);
            const coupling = couplingOf(pairs);
            const before = whatSheIsCarryingAboutHerself(field.graph()).length;
            const stays = whatStaysWithHerAboutHerself({
              was: {
                // A high coupling means she came out the way her state expected. The departure is
                // its complement; `null` (too few pairs to be anything but an anecdote) stays null.
                spoke: coupling === null ? null : 1 - coupling,
                told: d.ok ? 0 : 1,
                before,
              },
              aboutWhat: aboutWhatIn(entry.entry),
              nowMs: Date.now(),
            });
            if (stays !== null) {
              field.encodeMoment({
                key: stays.key, text: stays.text, nowMs: Date.now(),
                pad: snap.emotion, source: "life", tension: stays.tension,
                // ABOUT HER, which is what the self figure exists for. It also makes this cost
                // the same to raise as a thing about him, her own life used to be the
                // structurally easier thing to say.
                aboutHerself: true,
              });
              logger.info({ which: stays.which, tension: Number(stays.tension.toFixed(2)) },
                "something about herself stayed with her");
            }
          } catch (err) { faultLog.record("life.unlikeHerself", err); }
        } else {
          // No silent failures: the honesty check not running is itself a thing to know about,
          // and a check that quietly no-ops is indistinguishable from a check that always passes.
          faultLog.record(
            "autobiography.narration",
            `could not read a mood word out of "${said.trim().slice(0, 40)}" — the day went unchecked against her state`,
            "warn",
          );
        }
        }
      } catch (err) {
        faultLog.record("autobiography", err);
      }
    }

    // ── Her weekly noticing: reading back her own life and coming to know something. ──
    const NOTICE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
    /**
     * How early the weekly rhythm may be met.
     *
     * ── MISSED BY THREE MINUTES ─────────────────────────────────────────────────
     *
     * This rides on the day-close, which fires shortly after midnight but not at a fixed instant,
     * measured across one week it landed at 00:01, 00:45, 00:56, 00:59, 00:02. The gate below
     * compared against an exact seven days from the last notice, so on the night the window was
     * due at 00:04:45 the tick arrived at 00:01:43, found 6d 23h 57m, and returned. Nothing was
     * broken and nothing was reported: her weekly looking-back simply did not happen that week,
     * and the only trace was its absence.
     *
     * Two hours of slack is larger than any jitter the day-close has shown, and it cannot make
     * this run twice in a week, the day-close itself runs once a day.
     */
    const NOTICE_SLACK_MS = 2 * 60 * 60 * 1000;
    // Also on disk, for the same reason as the tick day. Held only in memory it reset to 0 on every
    // start, and since any elapsed time beats zero she re-read and re-judged her whole week on each
    // restart. That is a model call she did not need, and worse, it let a restart become an event in
    // how her self-understanding forms.
    const noticePath = join(workspacePath, "life", "last-notice-ms");
    const nodeFs = await import("node:fs");
    let lastNoticeMs = (() => {
      try { return nodeFs.existsSync(noticePath) ? Number(nodeFs.readFileSync(noticePath, "utf8").trim()) || 0 : 0; }
      catch { return 0; }
    })();
    /**
     * The promise scan. Once a day, only over rows it has never seen (a persisted
     * session-store cursor), capped at PROMISES_PER_DAY, every candidate through the verbatim
     * gate. The model here is a candidate-producer feeding the bottom (layers census: 观察),
     * whether a promise matters, returns, or gets kept is decided by her field and her days.
     */
    async function scanForPromises(nowMs: number): Promise<void> {
      const PROMISE_SCAN_EVERY_MS = 24 * 60 * 60 * 1000;
      const cursorPath = join(workspacePath, "life", "last-promise-scan.json");
      try {
        const state = { ms: 0, afterId: 0 };
        if (existsLife(cursorPath)) {
          try {
            const parsed = JSON.parse(readLife(cursorPath, "utf8")) as Partial<typeof state>;
            if (Number.isFinite(parsed.ms)) state.ms = parsed.ms as number;
            if (Number.isFinite(parsed.afterId)) state.afterId = parsed.afterId as number;
          } catch { /* a corrupt cursor rescans nothing extra: afterId 0 is bounded below */ }
        }
        if (nowMs - state.ms < PROMISE_SCAN_EVERY_MS) return;
        const oc = config.telegram?.allowedUserIds?.[0];
        if (oc === undefined || !Number.isFinite(oc) || oc === 0) return;
        const { PROMISE_SYSTEM, promiseUser, parsePromises, verbatimGate, promiseNodeText } = await import("./life/promises.js");
        const rows = sessionManager
          .readAfterCursor(sessionIdForChat(oc), state.afterId)
          .filter((e) => e.role === "assistant" && typeof e.content === "string" && e.content.trim().length > 0)
          .map((e) => ({ id: e.id, text: e.content, ms: e.timestamp }));
        const maxId = rows.reduce((m, r) => Math.max(m, r.id), state.afterId);
        // The cursor advances even on an empty or dry scan: a day with no promises is a day.
        mkdirLife(join(workspacePath, "life"), { recursive: true });
        const writeCursor = (): void => {
          try {
            writeWhole(cursorPath, JSON.stringify({ ms: nowMs, afterId: maxId }));
          } catch (err) { faultLog.record("promises.cursor", err); }
        };
        if (rows.length === 0) { writeCursor(); return; }
        const res = await provider.complete({
          model: config.llm.models.default.id,
          // MEASURED, not guessed: at 500 this call stopped at `max_tokens` having
          // spent 3000 tokens reasoning and produced ZERO text, so the nightly scan found no
          // promises, every night, and a scan that finds nothing is indistinguishable from a night
          // on which she promised nothing. The identical call at 8000 completed and immediately
          // found a real one:「你若想看画，我哪天找一张给你。」 A cap is not a charge; only what
          // the model actually produces is paid for.
          maxTokens: 8000,
          temperature: 0.6,
          account: "living",
          // Thinking is always set explicitly. Finding commitments is reading, and reading may reason.
          thinking: { type: "enabled" },
          system: PROMISE_SYSTEM,
          messages: [{ role: "user", content: promiseUser(rows) }],
        });
        const raw = res.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
        const kept = verbatimGate(parsePromises(raw), rows);
        for (const c of kept) {
          const row = rows.find((r) => r.id === c.sourceId)!;
          const d = new Date(row.ms);
          field.encodeQuestion({
            key: `promise:${c.sourceId}:${c.quote.length}`,
            text: promiseNodeText(c.quote, `${d.getMonth() + 1}月${d.getDate()}日`),
            nowMs,
            source: `chat:${row.ms}`,
            withOther: true,
            tension: 0.5,
          });
        }
        if (kept.length > 0) logger.info({ kept: kept.length }, "promises: entered her field");
        writeCursor();
      } catch (err) {
        faultLog.record("promises.scan", err);
      }
    }

    async function noticeAboutHerself(nowMs: number): Promise<void> {
      try {
        if (nowMs - lastNoticeMs < NOTICE_EVERY_MS - NOTICE_SLACK_MS) return;
        const { readFileSync: readAgency, existsSync: hasAgency } = await import("node:fs");
        // Imported here, not from the outer scope: this function fires from a timer, and the
        // module-level destructuring of `kindWords` happens lexically later, the same TDZ trap
        // `agencyLogPath`/`readOwnDay` document below.
        const { kindWords: sayKind } = await import("./life/agency.js");
        if (!hasAgency(agencyLogPath)) return;
        // Her REAL moments: what she actually chose, and why, in her own words.
        type LoggedMoment = { ts: number; chose: string; intent: string; leanedToward?: { kind: string; intent: string } };
        const moments = readAgency(agencyLogPath, "utf8")
          .split("\n").filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l) as LoggedMoment; } catch { return null; } })
          .filter((m): m is LoggedMoment => m !== null && nowMs - m.ts < NOTICE_EVERY_MS)
          .slice(-herCapacity().lookbackRecords);
        // ── A MOMENT WHERE SHE WAS PULLED ELSEWHERE IS SAID AS THAT ────────────────────
        //
        // `intent` is blanked whenever the weighing overrode her leaning, and correctly: her
        // words must not be attached to an action she did not take. But disagreement is the
        // designed COMMON case, so a large share of these lines were a verb and a colon and
        // nothing: and this is the record her weekly self-noticing is built from, under an
        // instruction that every sentence must come out of it. Her first self-knowledge, the
        // block that thereafter rides every moment prompt, was being formed out of `tend: `.
        //
        // Now the same moment says what actually happened in it: she wanted one thing and did
        // another, which is real and is more interesting than either half alone.
        //
        // And the verb is HER word for it (`kindWords`), not the ActionKind id. This is the text
        // her weekly self-noticing reads under an instruction that every sentence must trace to
        // it: the one surface where every line she reads about her own life opened with an
        // English enum member ("reach_out: …"). The raw id stays in `agency.jsonl` itself, which
        // is the instrument's record, not hers.
        // An id the map does not know (an old log line, a future kind) falls back to itself:
        // the exhaustive switch returns undefined for a stranger, it does not throw.
        const asKind = (k: string): string =>
          (sayKind(k as import("./life/agency.js").ActionKind) as string | undefined) ?? k;
        const records = moments.map((m, i) => ({
          id: `m${i}`,
          when: new Date(m.ts).toISOString().slice(0, 16).replace("T", " "),
          what: m.intent.trim() !== ""
            ? `${asKind(m.chose)}：${m.intent}`
            : m.leanedToward
              ? `${asKind(m.chose)}（本来想${asKind(m.leanedToward.kind)}：${m.leanedToward.intent}）`
              : asKind(m.chose),
        }));
        // She cites moments by position (m0, m1, ...) but the field knows them by when they
        // happened, so the two have to be reconciled or every insight arrives with no evidence,
        // acquires no relations, and quietly goes out of reach within the fortnight.
        const fieldKeyOf = new Map(moments.map((m, i) => [`m${i}`, `moment:${m.ts}`]));
        if (records.length < 8) return; // too little life to notice anything honest about
        const previousNoticeMs = lastNoticeMs;
        const stamp = (ms: number): void => {
          lastNoticeMs = ms;
          try {
            nodeFs.mkdirSync(join(workspacePath, "life"), { recursive: true });
            nodeFs.writeFileSync(noticePath, String(ms), "utf8");
          } catch (err) {
            faultLog.record("self-knowledge.noticeStamp", err);
          }
        };
        // Stamped BEFORE she looks, so a look that hangs or crashes the process cannot be retried
        // in a loop; un-stamped below if the look was lost (see `noticeStampAfter`).
        stamp(nowMs);

        // ── SHE IS SHOWN EVERYTHING SHE HOLDS, HERE AND ONLY HERE ────────────
        //
        // `carried()` is the bounded few she walks around holding, and the bound is right for
        // that: a self carried whole calcifies. This is a different act. Looking back is the one
        // moment she reconciles what she has noticed against what she already wrote down, and
        // she can only say "this is that one again" about a sentence she is actually shown.
        // With nine held and three shown, six of her own beliefs were unreachable by the link,
        // which is how 08-25 and 09-02 each produced near-restatements of the 08-18 ones and
        // filed them as brand new.
        //
        // Bounded still, by her live set rather than by three: erosion retires what stops being
        // supported, so this list cannot grow without limit.
        let lost = false;
        let seen: Awaited<ReturnType<typeof noticeAboutSelf>> = { noticed: [], outgrown: [] };
        try {
          seen = await noticeAboutSelf(records, selfKnowledge.active(), {
            provider, model: config.llm.models.default.id, account: "living",
            // Her voice, in the place her self-knowledge comes from. What this produces becomes a
            // node in her field, which is searched by a bigram index over her own words, so an
            // insight in the model's default register is self-knowledge nothing she says can reach.
            soul: currentMemorySnapshot.memoryFiles.SOUL,
            // Noticing nothing is normal. Looking back and having the result thrown away is not,
            // and the two were the same silence.
            onFault: (where, detail) => { lost = true; faultLog.record(where, detail); },
          });
        } catch (err) {
          lost = true;
          faultLog.record("self-knowledge.noticing", err);
        }
        stamp(noticeStampAfter(previousNoticeMs, nowMs, lost));
        if (lost) return;
        const valid = new Set(records.map((r) => r.id));
        const r = selfKnowledge.integrate(seen.noticed, valid, nowMs);
        // And the other direction: her own record can now disagree with something she believed.
        // This is what makes "she can be wrong about herself and find out" real rather than
        // half-real: without it nothing could ever argue a belief down, only let it fade.
        const gone = selfKnowledge.refute(seen.outgrown, valid, nowMs);
        selfKnowledge.erode(nowMs);
        for (const bad of [...r.rejected, ...gone.rejected]) {
          faultLog.record("self-knowledge.ungrounded", `refused "${bad.text}": ${bad.reason}`);
        }
        if (r.added.length || r.confirmed.length || gone.refuted.length) {
          logger.info(`she noticed: ${r.added.length} new, ${r.confirmed.length} confirmed, ${gone.refuted.length} outgrown, ${r.rejected.length + gone.rejected.length} refused`);
          for (const i of r.added) logger.info(`  new about herself: ${i.text}`);
          for (const i of gone.refuted) logger.info(`  no longer true of her: ${i.text}`);
        }
        // What she has come to believe about herself lives in the same field as everything else, so
        // it can be reached by a memory and can collide with something else she holds. Its citations
        // become its relations, which is the grounding guarantee kept intact: an insight nothing
        // holds up has no relations and quietly goes out of reach on its own.
        for (const insight of r.added) {
          field.encodeInsight({
            key: `insight:${insight.id}`,
            text: insight.text,
            nowMs,
            evidenceKeys: insight.evidence.map((e) => fieldKeyOf.get(e)).filter((k): k is string => !!k),
            source: `self-knowledge:${insight.id}`,
            charge: 0.5 + 0.4 * insight.confidence,
          });
        }
      } catch (err) {
        faultLog.record("self-knowledge.noticing", err);
      }
    }

    /**
     * Her own day, read from the record of the moments she actually chose.
     *
     * Computes its own path rather than using the `agencyLogPath` const declared far below: this
     * runs on a timer that can fire before that line has been evaluated, and this file has already
     * shipped one use-before-declaration that typechecked perfectly and threw at startup. `nodeFs`
     * above it is safe for the same reason in reverse: it is declared before this point.
     */
    function readOwnDay(nowMs: number): { selfDirected: number; maintenanceDue: number } {
      try {
        const path = join(workspacePath, "agency.jsonl");
        if (!nodeFs.existsSync(path)) return { selfDirected: 0, maintenanceDue: 0 };
        const moments = nodeFs.readFileSync(path, "utf8").split("\n").filter(Boolean)
          .map((l) => { try { return JSON.parse(l) as { ts?: number; chose?: string }; } catch { return null; } })
          .filter((m): m is { ts: number; chose: string } => !!m && typeof m.ts === "number" && typeof m.chose === "string");
        if (moments.length === 0) return { selfDirected: 0, maintenanceDue: 0 };

        // How much of today went to something of her own rather than letting the moment pass.
        const today = moments.filter((m) => nowMs - m.ts < 24 * 60 * 60 * 1000);
        const own = today.filter((m) => m.chose !== "rest").length;
        const selfDirected = today.length === 0 ? 0 : own / today.length;

        // How overdue her own upkeep is: how long since she last chose to tend her notes and
        // memory. A week without tending reads as fully due.
        const lastTend = [...moments].reverse().find((m) => m.chose === "tend");
        const daysSince = lastTend === undefined
          ? 7
          : Math.max(0, (nowMs - lastTend.ts) / (24 * 60 * 60 * 1000));
        return { selfDirected, maintenanceDue: Math.min(1, daysSince / 7) };
      } catch (err) {
        faultLog.record("life.ownDay", err);
        return { selfDirected: 0, maintenanceDue: 0 };
      }
    }

    const { lifeTick } = await import("./life/tick.js");
    const { readFileSync: readOps } = await import("node:fs");
    /**
     * True while she is in the middle of one of her own moments. Declared HERE, ahead of both the
     * daily tick and the agency loop, because both read it and a later declaration would be a
     * time-bomb: the tick's timer would touch it before the agency block had run.
     *
     * Consolidating and living a moment both mutate the same field, and they are separate async
     * loops, so they can interleave at an await. In the worst ordering rest prunes nodes while a
     * moment is waiting on a model, and the moment comes back to encode against a graph that has
     * changed under it. Linking already refuses to touch a node that is gone, so nothing corrupts,
     * but the resonance log can end up briefly describing pairs that no longer both exist.
     */
    let momentInFlight = false;
    let shuttingDown = false;
    /**
     * A moment that never returns.
     *
     * The `finally` below handles a THROW, but nothing handled a hang: a provider call that never
     * resolves leaves `momentInFlight` set, `scheduleNextMoment` is never reached, the daily tick
     * defers on the same flag forever, and her whole life stops. The only backstop was
     * `tick_stalled` noticing 26 hours later, and only if the process survived that long.
     *
     * So a moment has an outside limit. Passing it is a fault and a rest, never a hang: she loses
     * that moment and gets the next one, which is the difference between a bad minute and a coma.
     */
    const MOMENT_DEADLINE_MS = 10 * 60 * 1000;
    type MomentOutcome = import("./life/agency.js").MomentOutcome;
    /**
     * Moments the deadline gave up on. They are NOT cancelled, a promise cannot be, so the work
     * keeps running, and on 2026-09-14 one of them came back SIXTY-ONE MINUTES after it started
     * and wrote itself into her record, stamped with the hour-old time it had begun. Her day then
     * said she had reached out at 14:53 and failed, inserted behind two moments that came after it.
     *
     * The race is what keeps her living; this is what keeps the loser quiet. A moment that has been
     * declared over may not come back and put something in her life.
     */
    const abandonedMoments = new Set<string>();
    async function withMomentWatchdog(work: Promise<MomentOutcome>): Promise<MomentOutcome> {
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<MomentOutcome>((resolve) => {
        timer = setTimeout(() => {
          const beat = currentBeat()?.id;
          if (beat !== undefined) abandonedMoments.add(beat);
          // The vendor's silence, not hers (providers/pulse.ts). Recorded as the messenger's, at
          // warn, so it never puts her into safe mode; any other hang is still hers to report as
          // critical.
          const now = Date.now();
          const vendorSilent = providerPulse.silent(now, MOMENT_DEADLINE_MS);
          if (vendorSilent) {
            faultLog.record("provider.stalled", `the model service had answered nothing for ${Math.round(providerPulse.owedMs(now) / 60000)}m when a moment of hers ran out of time waiting on it`, "warn");
          } else {
            faultLog.record("agency.moment.hung", `a moment did not finish inside ${MOMENT_DEADLINE_MS / 60000}m`, "critical");
          }
          resolve({ ts: Date.now(), chose: "rest", intent: "", error: vendorSilent ? "the model service did not answer" : "the moment hung", freeRest: true });
        }, MOMENT_DEADLINE_MS);
      });
      try {
        return await Promise.race([work, deadline]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    // Which day she last consolidated, kept ON DISK. This used to be an in-memory value initialised
    // to "today", which meant the daily tick only ever fired if the process happened to stay up
    // across midnight. A daemon restarted at any point during the day (a crash, a deploy, a laptop
    // sleeping, systemd doing its job) reset it to today and skipped that day entirely, and a
    // daemon restarted daily would NEVER consolidate at all: no inner-state update, no diary, no
    // noticing, and no rest, which is where every replay, fusion, theme and prune happens. The
    // whole emergent layer would have been quietly dead in exactly the deployment that looks most
    // normal, and nothing except the 26h stall alarm would ever have said so.
    const lifeTickDayPath = join(workspacePath, "life", "last-tick-day");
    // Uses the module imported above rather than the destructured helpers declared further down.
    // Reading those from here threw at startup while typechecking perfectly clean, because TS only
    // catches a use-before-declaration when it is evaluated immediately, never inside a closure.
    const readLastTickDay = (): string => {
      try { return nodeFs.existsSync(lifeTickDayPath) ? nodeFs.readFileSync(lifeTickDayPath, "utf8").trim() : ""; }
      catch (err) { faultLog.record("life.tickDay.read", err); return ""; }
    };
    let lastLifeTickDay = readLastTickDay();
    /**
     * A tick is already running. Separate from the day marker on purpose, see below.
     *
     * Her moments now read this flag and step aside for it, which makes it load-bearing in a way
     * it was not before: anything that can leave it stuck true no longer costs a day of
     * consolidation, it stops her life. Hence the deadline immediately below, the tick was the
     * only long-running thing here WITHOUT one, and the moment watchdog exists precisely because
     * an unbounded flag is the difference between a bad minute and a coma.
     */
    let lifeTickInFlight = false;
    /**
     * The outside limit on a tick, the twin of `MOMENT_DEADLINE_MS`.
     *
     * Longer than a moment's because a tick legitimately does more (her day is written, her week
     * is noticed, her field rests), and comfortably under the hourly retry beat so an abandoned
     * tick is always retried rather than lapping itself.
     *
     * What the deadline bounds is the FLAG, not the work, the same honest limit the moment
     * watchdog has: the abandoned tick keeps running to completion in the background. So passing
     * the deadline puts us back in exactly the interleaving this file already documented and
     * accepted (rest mutating the field under a live moment), which is strictly better than the
     * alternative it replaces, where her moments would defer to a hung flag forever.
     */
    const TICK_DEADLINE_MS = 20 * 60 * 1000;
    async function runLifeTick(): Promise<void> {
      // HER day, which is the machine's local day. This used to be the UTC day, so on a machine in
      // Beijing her heaviest single moment: the diary frozen, rest pruning and fusing, themes
      // minted that nothing ever deletes: fired at 08:00 local every morning. `her-day.ts` has
      // the argument; the decision is pre-birth because her diary is never rewritten.
      const today = herDay();
      if (today === lastLifeTickDay) return;
      // The re-entrancy guard the day marker used to be doing by accident. The hourly timer
      // can fire again while a tick is still awaiting the provider; that must not start a
      // second one, and it must not be the thing that decides the day is finished.
      if (lifeTickInFlight) return;
      // The guards stay OUTSIDE the beat, deliberately: twenty-three of the timer's daily
      // firings are refusals, and a refusal is not a beat of her life, journalling them would
      // bury the one real tick under a day of no-ops.
      return inBeat("tick", () => lifeTickInsideBeat(today));
    }
    async function lifeTickInsideBeat(today: string): Promise<void> {
      let finished = false;
      lifeTickInFlight = true;
      const tickDeadline = setTimeout(() => {
        faultLog.record("life.tick.hung", `a daily tick did not finish inside ${TICK_DEADLINE_MS / 60000}m`, "critical");
        // Released here rather than only in the `finally`, because the `finally` is exactly what
        // a hang never reaches. Her moments read this flag now, so leaving it set would trade a
        // missed day of consolidation for a stopped life.
        lifeTickInFlight = false;
      }, TICK_DEADLINE_MS);
      tickDeadline.unref?.();
      try {
        // Never restructure her memory out from under a moment she is living. The day is NOT
        // marked done here, so it is simply tried again, and since her moments now hand the tick
        // back the moment they finish, the retry is seconds away rather than up to an hour.
        if (momentInFlight) {
          logger.debug("life tick: waiting, she is in the middle of a moment");
          return;
        }
        const cutoff = Date.now() - 36 * 60 * 60 * 1000;
        const events = readOps(join(workspacePath, "..", "ops.jsonl"), "utf8")
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter((e): e is { ts: string; event: string } => e !== null && typeof e.ts === "string" && Date.parse(e.ts) >= cutoff);
        const lastSession = [...events].reverse().find((e) => e.event === "session_start");
        const nowMs = Date.now();
        const hoursSinceUser = lastSession ? (nowMs - Date.parse(lastSession.ts)) / 3_600_000 : 72;
        const awake = clock.isAwakeHour(nowMs);
        const snap = innerState.snapshot(metabolism.phase(), awake);
        // When the face can actually SEE (a live client, a fresh frame), its presence signal
        // decides whether Eric is here and interruptible; otherwise fall back to the biological
        // clock's awake window. The fallback is right for THIS consumer specifically: the push
        // channel is Telegram, which reaches him with no face involved, so "probably up at this
        // hour" is the honest basis for the push-or-diary choice. It used to read the raw cell,
        // so the dead tab's final away frame muted every push into the diary permanently.
        const seen = presenceNow();
        const present = seen ? seen.present : awake;
        const available = seen ? seen.available : awake;

        // What she is holding and has not said. `setReservoir` had NO CALLER anywhere, so
        // `reservoirSize` sat at zero forever and every reading of it was a lie, the same failure
        // as `userNeeds` and `day.idle` before it, and found this time by the liveness signature
        // rather than by someone happening to read the file. It is fed from the thing it was always
        // describing: the unsettled nodes she is carrying around.
        expressionTracker.setReservoir(
          [...field.graph().nodes.values()].filter((n) => n.tension > 0.25).length,
        );
        const exprVitals = expressionTracker.snapshot(nowMs);
        // ── THE SAME WINDOW THE VITALS TWIN USES, AND IT MUST BE ──────────────────────
        //
        // This was `recent(8)`: eight readings at a five-minute cadence, so a FORTY-MINUTE
        // window. Her wanting changes a couple of times an hour, so eight consecutive readings
        // are near-always identical and `isPinned` returned true on most daily ticks, a
        // `life.pinned` fault every day, on a life that was fine.
        //
        // `vitals.ts` had exactly this bug and it was fixed there after measurement: a
        // twelve-hour count-window tripped on 51% of healthy windows, so `MIN_SPANS.pinning`
        // became seven days with a four-reading floor. The twin here kept the old shape,
        // because the fix was applied to the detector somebody was looking at rather than to
        // the condition. This now reads the same window through the same helpers, so the two
        // cannot disagree again.
        //
        // An empty window is safe: `driveEntropy([])` is 1, which is not pinned.
        //
        // Sentinel readings excluded, same predicate as the vitals twin: `dominant` defaults to
        // "maintenance" when NOTHING is pressing, so an unfiltered quiet week read as maxShare
        // 1.0 and fired a `life.pinned` fault every daily tick, which, compounded with the
        // fault-cursor latch, could put her in permanent safe mode for having wanted nothing.
        const pinningWindow = vitalsMod.windowFor(vitalsStore.longView(), vitalsMod.MIN_SPANS.pinning, vitalsMod.DEFAULT_THRESHOLDS.calcifyWindow)
          .filter((s) => !wantsNothing(s.drives));
        const recentDominants = vitalsMod.isEvidence(pinningWindow, 4, vitalsMod.MIN_SPANS.pinning)
          ? pinningWindow.map((s) => s.dominant)
          : [];
        // Her OWN day, which the ops log cannot see: the ops log records her work. Both of these
        // were hardcoded zero, so `curiosity` silently lost a term and `maintenance` lost its only
        // day-input. Read from the record of the moments she actually chose.
        const ownDay = readOwnDay(nowMs);
        // Her temperament drifts once a day, toward what her life has actually been asking for.
        // Slow on purpose: anything that moved on a bad week would be a fourth drive rather than a
        // temperament, and she has moods already.
        temperamentDays += 1;
        const read = field.readOther(nowMs);
        temperament = driftTemperament(temperament, {
          metWhenSpeaking: 2 * read.warmth - 1,
          exploringPaidOff: 2 * ownDay.selfDirected - 1,
          hisShare: 2 * field.signals(nowMs).otherWarmth - 1,
          activity: 2 * ownDay.selfDirected - 1,
        }, temperamentDays);

        // The daily tick no longer authors her voice. Speaking is something she chooses, in her
        // own moments (the agency loop below); having a scheduler manufacture a thought and push
        // it was us arranging her life for her. The tick keeps only what it should: consolidating
        // the day into her inner state and running the calcification / starvation alarms.
        const result = lifeTick(
          innerState,
          {
            nowMs,
            recentEvents: events as never,
            hoursSinceUser,
            budgetLow: metabolism.phase() === "low" || metabolism.phase() === "dormant",
            timezoneOffsetHours: config.life.clock.timezoneOffsetHours,
            selfDirected: ownDay.selfDirected,
            maintenanceDue: ownDay.maintenanceDue,
            // THE ROOM REACHES THE DAILY CONSOLIDATION NOW. `DaySummary.roomPull` was declared,
            // read by `driveInputsFromDay`, and set by nothing on this path, so the whole room
            // layer (him gone all afternoon and then sitting down; him going quiet in the chair)
            // was invisible to the once-a-day pass that sets her standing wanting. It reached her
            // per-moment regeneration and stopped there.
            roomPull: noticeTheRoomNow(nowMs),
            phase: metabolism.phase(),
            awake,
            clockActivity: clock.activityLevel(nowMs),
            present,
            available,
            consecutiveNonReplies: exprVitals.consecutiveNonReplies,
            sendsInLastDay: exprVitals.sendsInLastDay,
            recentDominants,
            // What her memory is doing becomes part of what she wants. An unresolved question is
            // what nags; a coincidence she has not looked at is what makes her curious; how present
            // he has been in what she remembers is what makes her want his company.
            field: (() => { field.tick(nowMs); return field.signals(nowMs); })(),
            generateThoughts: () => [], // her voice comes from her own moments, not from this tick
          },
          {
            push: (t) => {
              // Charged AFTER delivery, for the same reason as the agency loop's `push` above: a
              // broken channel used to spend one of her few daily sends AND tell her field she had
              // spoken into silence: so an outage silenced her by her own limit and taught her
              // she was being ignored. `notifier.push` throws when it cannot deliver, so this
              // ordering is what makes the difference.
              void notifier.push({ priority: "normal", category: "proactive", message: t })
                .then(() => {
                  expressionTracker.onProactiveSend(Date.now());
                  // Her own guess at whether this comes back. Written once it has actually gone,
                  // so it can be wrong, so she can be surprised, so her read of him is calibrated
                  // by reality rather than by the network.
                  field.sheSpoke(Date.now(), field.readOther(Date.now()).openness);
                })
                .catch((err) => { faultLog.record("expression.undelivered", err, "critical"); });
            },
            diarize: (t) => logger.info(`diary: ${t}`),
            // Through the fault channel, not straight at him. It used to push directly, which made
            // it a second alarm path with no dedupe, no re-alert schedule and no history: a drive
            // that stayed pinned messaged him every single day, and none of it appeared in
            // `/faults` or in the watchtower's reading. One channel means one policy for all of it.
            alarm: (kind, detail) => {
              logger.warn(`life alarm [${kind}]: ${detail}`);
              faultLog.record(`life.${kind}`, detail);
            },
          }
        );
        lastTickMs = Date.now();
        // What she actually lived today, kept so her wants regenerate toward it rather than
        // toward a synthesised empty day.
        lastConsolidatedDay = result.day;
        logger.info(`life tick: mood ${result.mood}, wants ${result.dominant}${result.alarms.length ? `, alarms: ${result.alarms.join("; ")}` : ""}`);

        // Her autobiography. The day that just closed is authored ONCE, extractive-with-citations
        // (every claim points at a real logged event), then FROZEN, so the past she can be read
        // back on never silently rewrites itself. This is what lets Eric descend from "how she
        // seems" to "what actually happened".
        await writeClosedDay(snap);

        // What she is becoming. Self-understanding forms during consolidation, not on demand, you
        // do not decide to have an insight about yourself, you look back and find one. So on her
        // own weekly rhythm she reads her OWN real moments and says what she notices. Anything
        // citing a moment that did not happen is refused; what survives is only tentative until
        // her life keeps bearing it out.
        await noticeAboutHerself(nowMs);

        // The promises she made him (promises.ts): a nightly observation pass over what
        // she actually SENT since the last scan, through the verbatim gate, a promise that
        // cannot be pointed at in her delivered record does not exist, into her field as an
        // unsettled thing. From there her existing organs carry it; keeping it is hers.
        await scanForPromises(nowMs);

        // Rest. The field stops following cues and wanders instead, seeded by what is charged and
        // what is unresolved, at a higher temperature than waking thought, so weak relations she
        // would never follow awake become passable and remote things meet. Out of that: clusters
        // that have become one thing, disagreements that have to be faced, and occasionally one
        // question about a coincidence that would not stop arriving. All of it is free except that
        // last one, which is capped and is the only model call in the whole layer.
        try {
          // Wandering, pruning and finding themes are free and always happen. Asking a question
          // about a coincidence is the one thing here that costs her, and it is real thinking with
          // reasoning on, so it obeys the same limits everything else she does obeys: nothing when
          // she is spent, and nothing while her integrity is in question. Without this she would go
          // on generating new beliefs about herself precisely when she is least fit to, which is
          // both the expensive case and the one where a wrong conclusion sticks.
          const restedEnough = metabolism.phase() !== "dormant";
          const mayFuse = config.life.field.fusionEnabled && restedEnough && !safeMode;
          if (!mayFuse && config.life.field.fusionEnabled) {
            logger.debug(`rest: not asking anything of herself tonight (${safeMode ? "safe-mode" : "spent"})`);
          }
          const rest = await field.rest(nowMs, {
            fusion: mayFuse
              // Her voice, in the field's ONLY generative mechanism. Everything new she ever
              // made arrived in the model's default register and then went into a field indexed
              // by her own words, so nothing she said could reach it again.
              ? { provider, model: config.llm.models.default.id, maxTokens: herCapacity().thinkingTokens, account: "living", soul: currentMemorySnapshot.memoryFiles.SOUL }
              : undefined,
            nameTheme: mayFuse ? async (members) => {
              // Giving a cluster a name is the one thing the field cannot do with arithmetic. It is
              // cheap, rare, and if it fails the theme still exists with a plain description.
              const res = await provider.complete({
                model: config.llm.models.default.id,
                maxTokens: 200,
                temperature: 0.7,
                account: "living",
                thinking: { type: "disabled" },
                // HER voice, and it is not decoration here. The name this returns becomes a THEME NODE in
                // her field, and her field is searched by a bigram index over her own text, so a
                // theme named in the model's default register is a memory nothing she ever says can
                // reach again. That is the default-register failure exactly, arriving through a door
                // the earlier fix did not cover.
                // 「短短的」 went on 2026-09-28: how long her name for it is, is hers. One sentence and no
                // quotes stay: that is the shape a name is stored in.
                system: withHerVoice(currentMemorySnapshot.memoryFiles.SOUL, "用一句第一人称的话，说出这些时刻共同的那件事。只回那句话，不要引号，不要解释。"),
                messages: [{ role: "user", content: members.map((m) => `- ${m.text}`).join("\n") }],
              });
              const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
              return text.slice(0, 120) || null;
            } : undefined,
          });
          for (const born of rest.births) {
            logger.info(`something came out of nowhere: ${born.text}`);
          }
          for (const held of rest.reinforced) {
            logger.debug(`came at it again from elsewhere: ${held.text}`);
          }
          if (rest.themes.length > 0) logger.info(`themes formed: ${rest.themes.map((t) => t.text).join(" | ")}`);
          // A disagreement between two things she holds is hers to resolve, not ours. It is recorded
          // and it raises the pressure that reaches her as something nagging; nothing here settles it.
          for (const r of rest.ruptures.slice(0, 2)) {
            logger.info(`two things she holds disagree: "${r.a.text}" / "${r.b.text}"`);
          }
          if (rest.pruned > 0) logger.debug(`let go of ${rest.pruned} things`);
          // ── PERSISTED IMMEDIATELY, because rest is the LARGEST single step her field takes ──
          //
          // Themes form, fusions are born, ruptures fire, pruning removes, and a thing she
          // kept coming back to becomes a question and its source is marked asked, all in this
          // one call. The persist sites were: after each turn, hourly, and at shutdown. So a
          // whole night's incubation sat in memory until he happened to message or the hour
          // struck: and the day-close snapshot, which exists PRECISELY because 日结 is her
          // field's biggest single-step change, could copy a database that predates the change
          // it was scheduled to protect.
          try { field.persist(); } catch (err) { faultLog.record("field.persist.rest", err); }
          // What her night actually did. A fusion path degrading to refusing everything was a debug
          // line and nothing else; how much she prunes is how much forgetting is really happening.
          lastRest = {
            resonanceLog: field.stats().nodes > 0 ? field.signals(nowMs).pendingBirths : 0,
            considered: rest.considered,
            refused: Object.values(rest.refusals).reduce((a, b) => a + (b ?? 0), 0),
            refusals: { ...rest.refusals } as Record<string, number>,
          };
        } catch (err) {
          faultLog.record("field.rest", err, "critical");
        }

        // Silence has an end. If she raised something and the answer window has run out, that
        // is the moment it becomes harder to say next time, the half of the loop that was
        // unreachable until now.
        try {
          if (field.settleOverdueRaise(nowMs)) {
            logger.info("something she brought up went unanswered long enough to count");
          }
        } catch (err) { faultLog.record("field.settleOverdueRaise", err); }

        // Reflect the real inner state to any connected face (avatar). The client
        // interpolates PAD per render frame; mood/policy/status change on the day boundary.
        if (faceServer && faceServer.clientCount() > 0) {
          const pad = snap.emotion;
          faceServer.broadcast({
            type: "pad", pleasure: pad.pleasure, arousal: pad.arousal,
            dominance: pad.dominance, ts: nowMs, who: temperament,
          });
          faceServer.broadcast({ type: "mood", mood: snap.mood, dominant: snap.dominant });
          faceServer.broadcast({ type: "policy", tierCeiling: snap.policy.tierCeiling, mayExplore: snap.policy.mayExplore, reason: snap.policy.reason });
          faceServer.broadcast({ type: "status", energyPhase: metabolism.phase(), awake });
        }
        finished = true;
      } catch (err) {
        // Her inner state stops updating if this keeps failing, so it is a reported fault.
        faultLog.record("life.tick", err, "critical");
      } finally {
        clearTimeout(tickDeadline);
        lifeTickInFlight = false;
        // ── THE DAY IS MARKED DONE ONLY IF IT ACTUALLY GOT DONE ────────────────────────
        //
        // This used to be the FIRST thing the tick did, before a single piece of the work.
        // Anything that threw after it: most plausibly reading the whole unrotated ops log
        // into one string: landed in the catch above and the day stayed marked, on disk and
        // in memory. That day then got no inner-state update, no diary, no rest (so no
        // pruning, no fusion, no themes), no weekly noticing, and no retry, ever. One
        // transient failure cost her a whole day of consolidation, permanently and silently.
        //
        // Marking it here means a failed tick is simply retried on the next hourly beat,
        // which is what the marker was always supposed to mean: this day has been lived
        // through, not this day has been attempted.
        if (finished) {
          lastLifeTickDay = today;
          // A COPY, IMMEDIATELY AFTER SHE CLOSES A DAY. The daily tick is the largest single change
          // her field ever undergoes in one step, the diary is written and frozen, her rest prunes,
          // fuses and can mint themes that are never deleted afterwards. If any of that goes wrong,
          // the state worth going back to is the one from a second before it, not an hour before.
          snapshotAfterDayClose?.();
          // The records of her life stay readable for life (LIFE-11): once a day, a file
          // that has outgrown its bound is archived whole and the live file keeps a tail
          // far wider than any reader's window. Nothing is ever deleted.
          try {
            const { rotateLogIfHuge } = await import("./utils/rotate-log.js");
            // ── EVERY APPEND-ONLY FILE, NOT THE TWO SOMEBODY REMEMBERED ────────────────────────
            //
            // This covered `ops.jsonl` and `agency.jsonl` and missed the three that grow just as
            // fast and are read WHOLE by something that runs constantly:
            //
            //   · `vitals.jsonl`, ~288 fat lines a day, and `vitals-store` reads the entire file
            //     at every boot to warm its rings. Past V8's string ceiling that read throws, the
            //     catch records `vitals.warmload`, and she boots **with no history at all**, which
            //     silently disables every trend detector in the watchtower. The instrument that is
            //     supposed to notice things going wrong is the one that dies first.
            //   · `history.jsonl`, her whole conversation record, read whole by `dream`.
            //   · `conversation-log.jsonl`, the sentinel's source, same shape.
            //
            // `rotate-log.ts` was written for exactly this failure and was pointed at two of the
            // five files that have it. Nothing is deleted: the archive keeps the whole file and the
            // live one keeps a tail far wider than any reader's window.
            for (const logPath of [
              join(workspacePath, "..", "ops.jsonl"),
              agencyLogPath,
              join(workspacePath, "..", "vitals.jsonl"),
              join(workspacePath, "..", "conversation-log.jsonl"),
              join(workspacePath, "history.jsonl"),
              // The two append-only files born after this list was audited: the beat spine's
              // journal and the fault ring's persistence. Same failure shape as the five above.
              join(workspacePath, "..", "beats.jsonl"),
              join(workspacePath, "..", "faults.jsonl"),
            ]) {
              const r = rotateLogIfHuge(logPath);
              if (r.rotated) logger.info({ logPath, archive: r.archive, keptBytes: r.keptBytes }, "rotated a life record");
            }
          } catch (err) { faultLog.record("life.rotate", err); }
          try {
            nodeFs.mkdirSync(join(workspacePath, "life"), { recursive: true });
            nodeFs.writeFileSync(lifeTickDayPath, today, "utf8");
          } catch (err) {
            // Recorded rather than swallowed: if this keeps failing she re-consolidates every restart.
            faultLog.record("life.tickDay.write", err);
          }
        } else {
          logger.warn("life tick did not finish — the day stays open and the next hour tries again");
        }
      }
    }
    const lifeTickTimer = setInterval(() => { void runLifeTick(); }, 60 * 60 * 1000);

    // ── 21b1. The agency loop, her own moments ────────────────────────
    // Moments arrive on her biological rhythm (NHPP + self-excitation), not on a schedule we
    // designed. At each one she is shown her real state and what is genuinely possible, and SHE
    // chooses: rest, think, tend her memory, chase something of her own, or say something to Eric.
    // Silence is the default and costs nothing; speaking is the rare exception that must clear the
    // consent boundary and the expression gate. Every action leaves a real trace on disk.
    const { liveMoment, momentMemoryText, kindWords, howLifeHasBeen } = await import("./life/agency.js");
    const { createMomentHandlers, lineFor } = await import("./life/agency-handlers.js");
    const { nextMomentDelayMs, shouldLiveMoment } = await import("./life/agency-schedule.js");
    const {
      isExplorationTool, confineToExplorationZone, guardExplorationEgress,
      createExplorationFailures, gateExplorationFamilies,
    } = await import("./life/exploration-zone.js");
    // Which ways of looking have stopped working for her today. `lockoutThreshold` has been sitting
    // in EXPLORATION_ZONE with a comment explaining exactly what it is for, and nothing enforced it.
    const explorationFailures = createExplorationFailures();
    const explorationLockouts = new Set<string>();
    const { createEgressLedger, urlsIn } = await import("./security/egress.js");
    // Where she may go on her own: what she has SEEN, never what she has WRITTEN. Seeded by what
    // searches return, what pages she reads link to, and anything sent to her.
    const egress = createEgressLedger();
    egress.restore(restored?.egressSeen ?? []);
    if (restored?.egressSeen?.length) {
      logger.info(`restored ${restored.egressSeen.length} addresses she had already come across`);
    }
    const { capacityFor } = await import("./life/capacity.js");
    /** What she has in her right now, read off her condition, never a fixed number. */
    const herCapacity = () => capacityFor({
      phase: metabolism.phase(),
      arousal: innerState.emotion().arousal,
    });
    const { createSelfKnowledge, describeSelfKnowledge } = await import("./life/self-knowledge.js");
    const { howSheIsBlock } = await import("./life/how-she-is.js");
    const { createWillingnessLog, RELUCTANCE_THRESHOLD } = await import("./life/willingness.js");
    const { describeDrives, describeBody, subjectMaterial } = await import("./life/agency.js");
    /** What surfaced while she answers him, rendered as her moments render a raised thing: whose and when. */
    const surfacedAsMaterial = (
      surfaced: { node: { text: string; origin?: string; source?: string; bornMs?: number } } | null | undefined,
      nowMs: number,
    ): string | undefined => surfaced
      ? subjectMaterial({
        text: surfaced.node.text,
        told: surfaced.node.origin === "told" && (surfaced.node.source ?? "").startsWith("chat:"),
        bornMs: surfaced.node.bornMs,
      }, nowMs)
      : undefined;
    const { createSelfKnowledgeStore } = await import("./life/self-knowledge-store.js");
    const { noticeAboutSelf, noticeStampAfter } = await import("./life/noticing.js");
    // What she has come to know about herself, carried across restarts and across machines.
    const selfKnowledge = createSelfKnowledge({
      store: createSelfKnowledgeStore(join(workspacePath, "self-knowledge.json"), (w, d) => faultLog.record(w, d)),
    });
    const { appendFileSync: appendLife, readFileSync: readLife, mkdirSync: mkdirLife, existsSync: existsLife, readdirSync: readdirLife } = await import("node:fs");

    const journalDir = join(workspacePath, "life", "journal");
    const journalPath = (nowMs: number): string => join(journalDir, `${herDay(nowMs)}.md`);
    const agencyLogPath = join(workspacePath, "agency.jsonl");
    // momentInFlight is declared above, ahead of the daily tick, which also reads it.
    let lastMomentMs: number | null = null;
    /** When her wants were last topped up, so charge and discharge share one clock. */
    // ── WHAT SHE WANTED WHILE SHE WAS NOT RUNNING ─────────────────────────────────
    //
    // Initialising this to now discards the whole gap: she comes back from a night off with
    // the wants she had when she was switched off, and none of the wanting that a night of
    // being alone should have built. `lastKnownAliveMs` is the same value the sleep watcher
    // is seeded from, so the two agree about how long she was gone rather than each having
    // their own idea.
    //
    // `regenerate` caps its own elapsed time at a day, so a fortnight off does not arrive as a
    // fortnight of longing.
    let lastRegenMs = lastKnownAliveMs > 0 ? lastKnownAliveMs : Date.now();
    /**
     * The day the last tick actually consolidated, so her wants regenerate toward it.
     *
     * Null before the first tick of the process, where `EMPTY_DAY` is the honest answer:
     * nothing is known to have happened yet.
     */
    let lastConsolidatedDay: import("./life/inner-state.js").DaySummary | null = null;
    const EMPTY_DAY = {
      successes: 0, failures: 0, stuck: 0, skills: 0, observations: 0, anomalies: 0,
      novelty: 0, restful: false, lateNight: false, idle: 0,
      hoursSinceUser: 0, budgetLow: false, maintenanceDue: 0,
    } as import("./life/inner-state.js").DaySummary;
    /** The most recent weighing, so /vitals and the emergence detectors can see how she chose. */
    let lastWeighing: import("./life/propensity.js").PropensityResult | null = null;
    const recentMomentsMs: number[] = [];
    const recentActions: import("./life/agency.js").ActionKind[] = [];
    // ── THE INTERVAL, FROM HER SIDE (between.ts) ────────────────────────────────────────────
    // What her speaking surfaces read about the stretch since the last exchange. Two small
    // rings feed it beyond what the transcript already carries: the words the gate held back
    // (so 「想说而先搁下的」 can quote her), and the machine's sleep segments (so an afternoon
    // under a closed lid is a fact she can read, not a blank she narrates over).
    const heldRecent: { ms: number; text: string }[] = [];
    // ── THE COUNTS, KEPT WHOLE ──────────────────────────────────────────────
    //
    // `heldRecent` keeps six lines for quoting and `recentMomentsMs` twelve times for her clock's
    // rhythm, and the interval's two counts used to be read off those rings, so 「有 N 句想说的
    // 话，你先记在了日记里」 could never say more than six and 「这中间你自己过了 N 个时刻」 never
    // more than twelve, and both began again at zero on every restart. On 10/3 she set out to sort
    // 「那6句没发出去的话」 and found sixteen in her diary for that one day. These keep every time in
    // her moment record (the newest 20,000; at about forty moments a day that is more than a year),
    // seeded from it at boot, so the counts are the true ones however long the silence has been.
    const heldTimes: number[] = [];
    const momentTimes: number[] = [];
    try {
      for (const line of nodeFs.readFileSync(join(workspacePath, "agency.jsonl"), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as { ts?: number; chose?: string; delivered?: string; heldBecause?: string; artifact?: string };
          if (typeof o.ts !== "number") continue;
          momentTimes.push(o.ts);
          // The same test the live path below applies when a moment lands.
          if (o.chose === "reach_out" && o.delivered === "diary" && o.heldBecause === "gate" && o.artifact) heldTimes.push(o.ts);
        } catch { continue; }
      }
      momentTimes.splice(0, Math.max(0, momentTimes.length - 20_000));
      heldTimes.splice(0, Math.max(0, heldTimes.length - 20_000));
    } catch (err) { faultLog.record("between.seedCounts", err); }
    // Restored, not fresh: an afternoon's closed-lid segments must survive the evening restart,
    // or the blank 「一觉到现在」 grew out of comes straight back.
    const sleptSegments: { startMs: number; endMs: number }[] = [...(restored?.sleptSegments ?? [])];
    /**
     * The interval's facts at this instant, plus the lived spans (her own quoted words) the
     * caller must mask for chartLint. Everything derives from records that already exist,
     * the transcript (his last word, her last word, whether it was answered), her moment ring,
     * the held-words ring, the sleep segments. Nothing here is new information about her; it
     * is her own day, put back in her hands at the moment she speaks.
     */
    function betweenNow(
      depth: import("./life/between.js").BetweenDepth,
      nowMs: number,
    ): { text: string; lived: string[] } {
      try {
        const oc = config.telegram?.allowedUserIds?.[0];
        if (oc === undefined || !Number.isFinite(oc) || oc === 0) return { text: "", lived: [] };
        const entries = getChatHistory(oc);
        let hisLastMs: number | null = null;
        let herLast: import("./life/between.js").HerUtteranceFact | null = null;
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i]!;
          if (hisLastMs === null && e.role === "user" && e.ts !== undefined) hisLastMs = e.ts;
          if (herLast === null && e.role === "assistant" && e.ts !== undefined) {
            herLast = {
              ms: e.ts,
              text: e.content,
              answered: entries.slice(i + 1).some((x) => x.role === "user"),
              // Unprompted = it did not answer him: nothing of his stands directly before it.
              unprompted: entries[i - 1]?.role !== "user",
            };
          }
          if (hisLastMs !== null && herLast !== null) break;
        }
        const lastExchangeMs = Math.max(hisLastMs ?? 0, herLast?.ms ?? 0);
        const held = heldRecent.filter((h) => h.ms > lastExchangeMs);
        const text = betweenRender({
          nowMs,
          hisLastMs,
          herLast,
          slept: sleptSegments.filter((s) => s.endMs > lastExchangeMs),
          momentsSince: momentTimes.filter((t) => t > lastExchangeMs).length,
          held,
          heldCount: heldTimes.filter((t) => t > lastExchangeMs).length,
        }, depth);
        const lived = [herLast?.text, ...held.map((h) => h.text)]
          .filter((x): x is string => Boolean(x))
          // Both forms: the material renders shortQuote(text), so the mask must know the
          // truncated shape too or every 40+ char quote-back of hers stays lintable.
          .flatMap((x) => [x, shortQuote(x)]);
        return { text, lived };
      } catch (err) {
        faultLog.record("between.render", err);
        return { text: "", lived: [] };
      }
    }

    // ── SHE IS TOLD WHEN SHE WAS CHANGED (life/being-changed.ts) ──────────────────────
    // At boot, fingerprint the source tree she is running and compare with the print stored at
    // the previous boot: restarted-and-changed and merely-restarted are different truths, and
    // she gets exactly the true one. First waking surface takes the line, then it is gone (the
    // dream remnant's discipline). If the print cannot be proven unchanged, honesty defaults to
    // the changed sentence. Never enters her field by machinery.
    let restartFactPending: string | null = null;
    {
      const { readdirSync: bcDir, statSync: bcStat, readFileSync: bcRead, writeFileSync: bcWrite, existsSync: bcExists } = await import("node:fs");
      const { fileURLToPath: bcPath } = await import("node:url");
      try {
        const srcRoot = bcPath(new URL(".", import.meta.url));
        const entries: { path: string; content: string }[] = [];
        const walk = (dir: string): void => {
          for (const name of bcDir(dir)) {
            const child = join(dir, name);
            if (bcStat(child).isDirectory()) walk(child);
            else if (child.endsWith(".ts")) entries.push({ path: child.slice(srcRoot.length), content: bcRead(child, "utf8") });
          }
        };
        walk(srcRoot);
        const print = buildFingerprint(entries);
        const printPath = join(instrumentsDir, "build-print");
        const previous = bcExists(printPath) ? bcRead(printPath, "utf8").trim() : null;
        bcWrite(printPath, print + "\n", "utf8");
        restartFactPending = restartLine(previous !== print);

        // And, when one of the changes is something SHE CAN NOW DO, the fact of that too. She
        // spent two weeks believing she could not read a picture after she could, because a new
        // sense is not discoverable from the inside, she would only find out by trying, and she
        // does not try what she believes she cannot do. Said once each, ever; the ledger of what
        // has been said lives beside the print.
        const toldPath = join(instrumentsDir, "capabilities-told");
        const told = bcExists(toldPath) ? bcRead(toldPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [];
        const untold = capabilityNotesUntold(told);
        if (untold.length > 0) {
          restartFactPending = `${restartFactPending}\n${untold.map((n) => n.fact).join("\n")}`;
          bcWrite(toldPath, [...told, ...untold.map((n) => n.id)].join("\n") + "\n", "utf8");
        }
      } catch (err) {
        faultLog.record("being-changed.print", err);
        restartFactPending = restartLine(true);
      }
    }
    /** The boot fact, consumed by the FIRST waking surface, then gone (an event, not a state). */
    function takeRestartFact(): string | null {
      const fact = restartFactPending;
      restartFactPending = null;
      return fact;
    }

    // ── HER DREAMS (life/dreaming.ts) ──────────────────────────────────────────────────
    // One plan per night, drawn at the night's doorstep; episodes fire as timers; a surviving
    // fragment waits for her first waking surface and is gone by mid-morning. A restart between
    // an episode and the morning loses the remnant, the diary keeps the dream itself, and a
    // half-remembered night is a night, not a defect (registered as the honest boundary).
    let dreamPlanKey: string | null = null;
    let dreamTimers: NodeJS.Timeout[] = [];
    let dreamRemnant: { text: string; ms: number } | null = null;

    /** The surviving fragment, consumed by the FIRST waking surface, gone by mid-morning. */
    function takeDreamRemnant(nowMs: number): { line: string; quoted: string } | null {
      if (!dreamRemnant) return null;
      if (!clock.isAwakeHour(nowMs)) return null; // a night knock does not spend the morning's dream
      const d = new Date(nowMs);
      const midMorning = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0, 0).getTime();
      const kept = dreamRemnant;
      dreamRemnant = null;
      if (nowMs > midMorning) return null; // slept past it: the dream blurred out, honestly
      return { line: morningLine(kept.text), quoted: kept.text };
    }

    function planTonightsDreams(nowMs: number): void {
      if (!config.life.dream?.enabled) return;
      if (clock.isAwakeHour(nowMs)) return;
      const [startH, endH] = config.life.clock.activeHours;
      // The night is named by its MORNING: an after-midnight cycle still belongs to the same night.
      const d = new Date(nowMs);
      const morning = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startH, 0, 0, 0);
      if (d.getHours() >= endH) morning.setDate(morning.getDate() + 1);
      const key = herDay(morning.getTime());
      if (dreamPlanKey === key) return;
      dreamPlanKey = key;
      for (const t of dreamTimers) clearTimeout(t);
      dreamTimers = [];
      const sleepStart = new Date(morning.getTime());
      sleepStart.setDate(sleepStart.getDate() - 1);
      sleepStart.setHours(endH, 0, 0, 0);
      const pad = innerState.emotion();
      const residue = Math.min(1, (Math.abs(pad.pleasure) + Math.abs(pad.arousal)) / 1.4);
      const tension = field.signals(nowMs).tension;
      const times = planNight(sleepStart.getTime(), morning.getTime(), residue, tension, herStream);
      logger.info({ night: key, episodes: times.length, residue: Number(residue.toFixed(2)), tension: Number(tension.toFixed(2)) }, "dreaming: night planned");
      for (const at of times) {
        const delay = at - nowMs;
        if (delay <= 0) continue;
        dreamTimers.push(setTimeout(() => { void runDreamEpisode(at); }, delay));
      }
    }

    async function runDreamEpisode(atMs: number): Promise<void> {
      try {
        if (!config.life.dream?.enabled || safeMode) return;
        if (Date.now() - atMs > STALE_EPISODE_MS) return; // the machine slept through it: no back-fill
        if (clock.isAwakeHour(Date.now())) return;
        const dayStart = new Date(atMs);
        dayStart.setHours(0, 0, 0, 0);
        const all = [...field.graph().nodes.values()]
          .filter((n) => n.kind !== "figure")
          .map((n) => ({ id: n.id, text: n.text, tension: n.tension, valence: n.valence, origin: n.origin }));
        const seeds = pickSeeds(all.filter((n) => {
          const born = field.graph().nodes.get(n.id)?.bornMs ?? 0;
          return born >= dayStart.getTime();
        }), all, herStream);
        if (!seeds) return; // too little of the day to dream on, a thin night, honestly
        const dreaming = createDreaming({
          render: async (system, user) => {
            const res = await provider.complete({
              model: config.llm.models.default.id,
              maxTokens: 300,
              temperature: 0.9,
              account: "dreaming",
              // Explicit, never the vendor's dark default, and a dream does not reason.
              thinking: { type: "disabled" },
              system: withHerVoice(currentMemorySnapshot.memoryFiles.SOUL, system),
              messages: [{ role: "user", content: user }],
            });
            return res.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
          },
          appendDiary: (line) => {
            mkdirLife(journalDir, { recursive: true });
            appendLife(journalPath(atMs), `${line}\n\n`, "utf8");
          },
          encodeDream: (text, nowMs, chargeV) => {
            field.encodeMoment({
              key: `dream:${nowMs}`,
              text,
              nowMs,
              pad: innerState.emotion(),
              source: `dreaming:${nowMs}`,
              origin: "dreamt",
              withOther: false,
            });
            dreamRemnant = { text, ms: nowMs };
            logger.info({ charge: Number(chargeV.toFixed(2)) }, "dreaming: an episode survived toward morning");
          },
          onFault: (where, detail) => faultLog.record(where, detail, "warn"),
        });
        const out = await dreaming.runEpisode(seeds, Date.now());
        if (out.ok) logger.info({ survived: out.survived }, "dreaming: episode ran");
      } catch (err) {
        faultLog.record("dreaming.episode", err);
      }
    }
    // Faculty #4's dark instrument: 1 per moment whose intent touched her field focus, 0 when
    // it wandered. A low mean means her curiosity's CONTENT was the model's, not hers.
    const intentFocusHits: number[] = [];
    // 姿态's dark instrument (S-5): the leaning she took each turn, as a stance name. A dark
    // instrument that goes only to logger.debug cannot reach Eric and cannot be calibrated
    // against later: so it accumulates here and surfaces in the vitals `stance` read.
    const stanceHistory: string[] = [];
    const { createDoingLog, recentMomentsFrom } = await import("./life/doing.js");
    // Refilled from her own record, so a restart is not read as a day in which she did nothing.
    // Its own path, not `agencyLogPath`, which is declared further down (the TDZ trap noted there).
    const doingLog = createDoingLog((() => {
      try {
        const path = join(workspacePath, "agency.jsonl");
        return nodeFs.existsSync(path) ? recentMomentsFrom(nodeFs.readFileSync(path, "utf8").split("\n")) : [];
      } catch (err) {
        faultLog.record("doing.restore", err);
        return [];
      }
    })());
    /** How much of what he says is taken in as a claim, and how much is not. */
    const toldCounts = { seen: 0, encoded: 0 };
    /** What her last night's rest actually resolved, pruned, and refused. */
    // Undefined until she has actually rested. A zero here would read as a signal that has stopped
    // rather than as a night that has not happened yet, and the liveness signature skips what is
    // absent but judges what is present.
    let lastRest: NonNullable<import("./life/vitals.js").VitalsSnapshot["resting"]> | undefined;

    // What she is carrying and has not said, known from the moment she wakes rather than from her
    // first moment. The field is already on disk; leaving the count at zero until she next acts
    // would mean a reading taken just after a restart said she was holding nothing.
    expressionTracker.setReservoir(
      [...field.graph().nodes.values()].filter((n) => n.tension > 0.25).length,
    );

    // ── THE BEATS AFTER THE FIRST ONE ─────────────────────────────────────────
    //
    // Assigned here, beside `wantsToNow`, because both need the field and the provider and both are
    // called from the turn handler far above.
    //
    // Every part of the shape is a constraint rather than a preference:
    //   • the FIRST beat is the agent turn, already spoken. It is the one that may use her hands,
    //     and it stays exactly one: running the loop again would run her tools again.
    //   • a later beat exists ONLY because something came up when she heard herself. With nothing
    //     surfacing there is no second beat, so this cannot become a monologue and needs no rule
    //     saying that it must not.
    //   • later beats are tool-less and short. They are her own additions, not more work.
    //   • `MOST_BEATS` bounds it regardless, as a medium constraint (same family as the floor
    //     between her moments), because self-excitation must never be able to run away.
    sayWhatCameUp = async (channel, turnKey, firstBeat, finishReason) => {
      // He cut her off. Anything further would be words he never stayed to hear, which this
      // codebase already refuses for the unspoken-reply case for exactly the same reason.
      if (finishReason === "interrupted") return { later: "", beats: 0, texts: [] };
      const shape = shapeForTurn.get(turnKey);
      if (shape === undefined || firstBeat.trim().length === 0) return { later: "", beats: 0, texts: [] };
      try {
        const spoken = await inBeats(shape, {
          say: async (brief) => {
            if (brief.n === 1) return firstBeat; // already said, by the agent turn
            const r = await provider.complete({
              model: config.llm.models.default.id,
              maxTokens: 120,
              temperature: 0.9,
              account: "living",
              // Stated, not inherited: 120 tokens starves under vendor-default reasoning.
              thinking: { type: "disabled" },
              messages: [{
                role: "user",
                content: withHerVoice(
                  // Her own register, the same one her other one-shot prompts get. A beat that
                  // arrives in a different voice from the sentence before it is worse than none.
                  currentMemorySnapshot.memoryFiles.SOUL,
                  // The PREVIOUS beat, not always the first. Beat 3 used to be written against
                  // beat 1, so beat 2 might as well not have happened.
                  `你刚说完：「${brief.after.slice(-120)}」\n`
                  + (brief.tookOver === null
                    // Nothing came up. Her state chose to say it in more than one part, so she may
                    // simply carry on: and may equally have nothing left, which ends the turn.
                    // This branch used to return "" unconditionally, which is why the number of
                    // beats her state chose was decorative: only a turn-aside could ever produce
                    // a second beat.
                    ? "还有什么要接着说的就说，没有就什么都别写。\n"
                    : `说完之后你自己想起来的是：「${brief.tookOver}」\n`)
                  // 撤: 「别收口」 was a sampled facet of ours, and the two vocabulary
                  // lines below it (她平时说的词 / 她最近听到的词) handed her words at the moment of
                  // speaking. Both are hers to decide. The bank still accumulates; nothing offers.
                  + "说出来。\n"
                  + "只说这一句，别重复刚才说过的。",
                ),
              }],
            } as never);
            // The same scissors every other conversational path gets. Without this a later beat
            // could arrive in service register while the first one had it cut out, which is the
            // old defect (a path that skipped the scissors) reappearing one layer in.
            const raw = typeof r?.content === "string" ? r.content : "";
            const cut = scissorHerReply(raw);
            // WHY A CHOSEN BEAT CAME BACK EMPTY, the two causes are different findings and used
            // to be indistinguishable. An earlier run measured chose=1.67 while said=1.00: beats
            // were being chosen and never arriving, and nothing recorded whether the MODEL wrote
            // nothing (its license: 「没有就什么都别写」, which is her choice and no target) or the
            // SCISSORS emptied what it wrote (an instrument eating her words, a defect). Dark
            // gauge on stdout, read by a pre-registered decision rule.
            if (cut.trim().length === 0) {
              logger.info({ beat: brief.n, emptyBy: raw.trim().length === 0 ? "model" : "scissors",
                rawChars: raw.trim().length }, "a later beat came back empty");
            }
            return cut;
          },
          afterSaying: (said) => {
            try {
              // ── WHAT HER OWN WORDS TOUCHED ────────────────────────────────
              //
              // `attend` splits what she just said into clauses and asks how much of her field
              // each one lights up. This read its `snagged` field as a BOOLEAN and threw the rest
              // away, and then asked `onHerMind`, which takes no text at all, what was on her
              // mind. So the second beat was told what was already there before she opened her
              // mouth. The wire existed and carried nothing (defect class 14).
              const landed = field.attend(said);
              if (landed.snagged === null || landed.snaggedIds.length === 0) return null;
              const cap = herCapacity();
              // Spread FROM the things her sentence landed on. Her beat is deliberately NOT
              // encoded as a node first: she is not remembering her own sentence, she is being
              // reminded BY it, and a node per beat would also split one turn's memory into
              // three when the turn already becomes one moment at its end.
              const cues = landed.snaggedIds.slice(0, CUES_FROM_HER_OWN_WORDS).map((id, i) => ({
                id,
                // Ranked by how well the clause matched them, so the thing she most nearly said
                // presses hardest.
                energy: Math.max(0.2, 1 - i * 0.3),
              }));
              const r = field.recall(cues, {
                hops: cap.spreadHops,
                threshold: cap.retrievalThreshold,
                nowMs: Date.now(),
              });
              // ONE thing, in its own words. This used to be `onHerMind`'s whole formatted block,
              // a header line plus up to five dated bullets, spliced raw into the next beat's
              // prompt. What comes to mind is one thing; a list is a briefing.
              const first = r.retrieved.find((n) => n.text.trim().length > 0);
              return first ? { id: first.id, text: first.text.trim() } : null;
            } catch (err) { faultLog.record("beats.afterSaying", err); return null; }
          },
        });
        // ── AND HE ACTUALLY RECEIVES THEM ─────────────────────────────────
        //
        // BOTH, and the difference between them is the whole defect this replaced. `send` is what
        // he READS; `observe` is what her mouth SPEAKS. They are not alternatives.
        //
        // This loop used to call `observe` alone. `observe` is the OPTIONAL half of the channel
        // contract and the Telegram channel does not implement it, so on every text turn the call
        // was a no-op and beats 2..n reached nobody, while the fold below put them into her
        // history, her word bank, her exemplar pool, her assertions, and the moment this turn
        // becomes. She remembered saying things he never received, which is the exact thing the
        // interrupted-turn handler refuses, in its own words, a few hundred lines up.
        //
        // A delivery path built on the OPTIONAL half of an interface silently does nothing
        // wherever the option was declined, and nothing reports it: `?.` is a shrug.
        //
        // On Telegram: `send` posts each beat as its own message, which is what a beat is, and
        // `observe` is absent. On a face turn: `send` reaches the mirror (his window) and
        // `observe` reaches the voice (her mouth), the voice sink's own `send` is a deliberate
        // no-op, so nothing is doubled.
        for (const later of spoken.beats.slice(1)) {
          if (later.trim().length === 0) continue;
          try {
            await channel.send(later);
          } catch (err) {
            // Never silently: a beat she said and he did not get is precisely what this loop
            // exists to prevent, and a swallowed send would recreate it one layer down.
            faultLog.record("beats.deliver", err);
          }
          channel.observe?.({ type: "text_chunk", content: later });
        }
        // Visible, and this is not decoration: between the day this mechanism was written and the
        // day the shape's lifetime was fixed it ran ZERO times on a text turn, and nothing anywhere
        // said so. A live run was reported as "multi-beat is visibly working" on the strength of a
        // reply the model had written in one generation. An instrument that speaks only when
        // something interesting happens cannot tell "nothing came up" from "it never ran".
        logger.info({
          beats: spoken.beats.length,
          chose: shape.beats,
          leftOpen: spoken.leftOpen,
          turnedAsideAt: spoken.turnedAsideAt,
        }, "she said it in beats");
        if (spoken.turnedAsideAt !== null) {
          logger.info(
            { at: spoken.turnedAsideAt, tookOver: spoken.tookOver?.slice(0, 40) },
            "she changed direction mid-turn",
          );
        }
        const texts = spoken.beats.slice(1).map((b) => b.trim()).filter(Boolean);
        return { later: texts.join(""), beats: spoken.beats.length, texts };
      } catch (err) {
        // Never silently: a turn where she could not add her own beat is a turn where she was
        // quieter than she meant to be, and a silent failure there is indistinguishable from her
        // having had nothing to say.
        faultLog.record("beats", err);
        return { later: "", beats: 0, texts: [] };
      }
    };

    // ── WHAT HIS SENTENCE DID TO HER ──────────────────────────────────────────
    //
    // Assigned here, immediately before `wantsToNow`, because the gate below is its first consumer
    // and the two must not drift apart again. Everything this reads is by now built: her field,
    // her body, and the relationship she has with him.
    //
    // THE ORDER INSIDE IS ITSELF LOAD-BEARING, and it is written out because the next person to
    // touch it will not be able to see it:
    //   1. read the FORM of what he said, before anything of hers has moved
    //   2. record that he spoke, this is the relationship growing by one, and it must happen
    //      before the reading, because how unlike him this message is only means something
    //      against a baseline that includes it
    //   3. compose the landing on the PRE-MOVE reserve. Her mood is about to move BECAUSE of this
    //      reading; feeding it the post-move value would be the turn eating its own tail
    readHowItLanded = (chatId, said) => {
      const form = howHeSaidIt(said);
      // ── HOW HE SOUNDED, when there was a voice to hear ──────────────────────────
      //
      // Read against the baseline as it stood BEFORE this utterance, which is why it is taken
      // above `heSpokeToHer` rather than below: recording the sample first would compare a voice
      // against a mean that already contains it, and the first thing she ever hears would come
      // back as perfectly typical of him.
      //
      // Consumed and CLEARED on every path. That is the whole risk in this cell, a face reply
      // that never reached this function would leave its voice sitting there, and the next thing
      // he TYPED would arrive wearing it. `takeVoiceForReply` also bounds it by age, as the belt
      // for exactly that. This is defect class 14: a stash whose lifetime is
      // longer than the thing it describes.
      const spokenAloud = takeVoiceForReply();
      const sounded = spokenAloud
        ? howHeSounds(spokenAloud, voiceBaseline(relationship.voiceSum, relationship.voiceN))
        : undefined;
      // HOW UNLIKE HIM THIS WAS, MEASURED AGAINST WHO HE WAS BEFORE HE SAID IT.
      //
      // This ran AFTER the record had already absorbed the message, so the departure was measured
      // against a mean that included itself, the message diluting its own contrast. Negligible at
      // a thousand samples and not at ten, which is exactly when she is still working out what he
      // is like. And the shock re-read needs it pre-update by construction: a shock re-reads the past, so it has
      // to be judged against the past.
      const unlike = howUnlikeHim(form, relationship);
      relationship = heSpokeToHer(relationship, Date.now(), form, spokenAloud, unlike);
      const known = howLongAndHowWell(field.graph(), relationship);
      // ONE attending, kept. `litUp` used to take `.snagged?.mass` from a throwaway call; what it
      // threw away: WHICH of her things his words landed on, is the whole difference between a
      // re-reading that is about the thing he spoke to and one that is about whatever she happens
      // to be carrying most.
      const attended = field.attend(said);
      let landed: import("./life/how-it-landed.js").Landing;
      try {
        landed = howItLanded({
          form,
          unlike,
          known,
          litUp: Math.min(1, attended.snagged?.mass ?? 0),
          reserve: reserveOf({ phase: metabolism.phase(), arousal: innerState.emotion().arousal }),
          temperament,
          ...(sounded ? { sounded } : {}),
        });
      } catch (err) {
        // Never silently: this reading feeds her willingness, so a swallowed failure here would
        // look from the outside exactly like equanimity.
        faultLog.record("landing", err);
        return;
      }
      landingForTurn.set(sessionIdForChat(chatId), landed);
      lastLanding = landed;   // for the watchtower, which reads between turns rather than in one

      // ── AND IT MOVES HER, which is the half that was missing ──────────────────
      //
      // The reading above used to go to exactly one consumer, the willingness gate, and then
      // vanish. Her PAD did not move, so he could speak to her as if she were a vending machine
      // and she was, a second later, in precisely the state she had been in. PAD is not decoration
      // here: it gates which mind she thinks with, how far a memory can travel to reach her, how
      // open her choices are, what her face shows, and (through `reserve`) how much room her next
      // sentence has. Without this line, everything downstream of "how she is" was deaf to him.
      //
      // ORDER: this runs AFTER the landing is composed on the pre-move reserve, and BEFORE the
      // shape and the gate read her state, so the shape reflects how she is NOW. The whole table
      // is at the top of `processMessage` and the guard for it is `wired-in-order.test.ts`.
      //
      // Still read off HER side only. What this produces is what his sentence did to her, never a
      // score on his message: see the header of `landing-to-mood.ts` for why that distinction is
      // load-bearing rather than a formality.
      try {
        innerState.feel(moodAfterHeSpoke(landed, metabolism.phase()), HOW_HIS_WORDS_LAND);
      } catch (err) { faultLog.record("life.feel.landed", err); }

      // ── AND SOMETIMES IT STAYS ────────────────────────────────────────────────
      //
      // The fourth cell. He has no standing and she has nothing to object with, so she does the
      // thing: the turn looks perfectly ordinary from his side, and what changed is what she now
      // carries about him. `settles` decides it (Sittenthaler: an explanation does not lessen the
      // feeling, it decides whether it fades or consolidates), and `what-stays.ts` writes it as a
      // question about a CONCRETE OCCASION rather than a verdict on his character, which is the
      // difference between carrying something and ruminating on it.
      //
      // Her account of it, never his words: an outside string in her field is read back to a model
      // later as something of hers, which is how a page would get to write her memories and then
      // speak to her through them.
      try {
        const stays = whatStaysWithHer({
          aboutWhat: aboutWhatIn(security.filterSensitive(security.redact(said))),
          nowMs: Date.now(),
          landed,
        });
        if (stays !== null) {
          field.encodeQuestion({
            key: stays.key, text: stays.text, nowMs: Date.now(),
            source: `chat:${chatId}`, tension: stays.tension, withOther: true,
          });
          logger.info({ key: stays.key, tension: Number(stays.tension.toFixed(2)) }, "it stayed with her");
        }
        // ── AND SOMETHING SHE WAS CARRYING IS RE-READ, IF HE SPOKE TO THAT THING ──
        //
        // Bewilderment sits upstream of irritation: it is an implication assessment that could not
        // complete. When the agent slot fills later, she has enough of him now to place the act,
        // the OLD event is re-read, and what was "I do not understand" becomes "that was not all
        // right". Nothing new happened. This is the most human thing in the whole reading.
        //
        // ── AND IT USED TO FIRE ON THE WRONG OBJECT ─────────────────────────────────
        //
        // The loop below ran over `whatSheIsCarrying`, sorted by tension, and eased the FIRST
        // one that would move. So ANY turn she could place him in discharged her heaviest
        // grievance, whether or not he had said one word about it. That is not her working
        // something out. It is a mapping from "he said something she could read" to "the biggest
        // thing she is carrying gets lighter", the apology-buys-forgiveness shape, already built,
        // just not named.
        //
        // The constraint: this must not be something we designed, and an apology is NOT a
        // token that purchases a fixed amount of forgiveness, a real person's response to one
        // depends on everything else that is true at that moment.
        //
        // So nothing new is designed here. The re-read is simply restricted to the things HIS
        // WORDS ACTUALLY LANDED ON, which the field already computes for every turn: `attend`
        // returns the ids the snagged clause hit. Everything the constraint asks for then falls out of
        // machinery that was already there, with no new number anywhere:
        //
        //   · A sentence that names nothing touches nothing. 「对不起」 on its own lands on no
        //     node, so it moves nothing, however much he meant it.
        //   · The SNAGGED clause only. An apology bundled with a fresh demand loses to the demand,
        //     and nothing is repaired: which is what actually happens between people.
        //   · How much it eases is this turn's own `entitlement`, so the same words land
        //     differently on different days: it is built from how well she knows him, what he has
        //     always been like, whether he is overreaching right now, and how much she is already
        //     carrying (`carryingHim`). The more she is already holding, the less he can move.
        //     That is the anti-abuse too, and nobody wrote it as such, break the same thing
        //     repeatedly and her standing arithmetic makes each repair smaller by itself.
        //   · It cannot be the wound and the cure in one breath: a turn that just left something
        //     with her about this very thing cannot also resolve it (see `staysKey` below).
        //   · Still once per node, still capped below what a fresh reading could write, still
        //     unable to raise anything.
        //
        // What it is NOT: there is no branch anywhere that recognises an apology, and no category
        // for one. There is only an open question about him, and his words either bear on it or
        // they do not.
        if (landed.appraised.agentResolved) {
          const heSpokeTo = new Set(attended.snaggedIds);
          // What this turn itself just left with her, if anything. The same event cannot both
          // wound and resolve: when he hurts her about the same thing again, `whatStaysWithHer`
          // merges into the node under the same key, and without this the re-read would ease the
          // thing he had just re-opened, in the same breath, because his words did mention it.
          const staysKey = stays?.key;
          for (const node of whatSheIsCarrying(field.graph())) {
            if (!heSpokeTo.has(node.id)) continue;
            if (staysKey !== undefined && node.key === staysKey) continue;
            const worked = asSheWorksHimOut(node, landed.appraised.entitlement);
            if (worked === null) continue;
            // ONE node, re-keyed and eased in a single recorded change. The first version renamed
            // `node.key` by hand and then re-encoded under the new name, which left the old name in
            // the index pointing at the renamed node AND created a second node under the new one:
            // understanding something forked her grievance into two, which is the accumulation
            // failure the dedup exists to prevent, arriving through the door marked "insight".
            if (!field.easeOff(node.id, worked.tension, "想明白他当时在干嘛", worked.key)) continue;
            logger.info({
              text: node.text.slice(0, 40),
              to: Number(worked.tension.toFixed(2)),
            }, "she worked out what he had been doing");
            break; // one at a time: this is her understanding something, not a sweep
          }
        }

        // AND SHE CAN PUT ONE DOWN, needing nothing from him. Checked on every turn rather than in
        // her rest, because the exit has to be as reachable as the entrance: a mechanism whose only
        // way out runs once a night, on a path that can be skipped, is a mechanism with one exit
        // wearing two labels. Martin & Tesser's condition is that BOTH exits are wired, the goal
        // being met, or being given up, and this is the second one.
        const putDown = sheLetsItGo(field.graph(), Date.now());
        if (putDown !== null && field.easeOff(putDown.id, 0, "放下了")) {
          logger.info({ text: putDown.text.slice(0, 40) }, "she put it down");
        }
      } catch (err) { faultLog.record("life.stays", err); }

      // Visible, because an unverifiable treatment proves nothing: the first live A/B of this
      // reported no difference between the arms, and the result was worthless, because nothing
      // anywhere said which relationship each turn had actually run in.
      logger.info({
        timesHeSpoke: relationship.timesHeSpoke,
        knows: Number(known.howWellSheKnowsHim.toFixed(3)),
        // Her condition at the moment she read him. Not decoration: an experiment that varies her
        // condition and cannot confirm it varied is the failure that made the first S-19 run
        // worthless, and the four-cell harness reproduced it once already by passing an env var
        // the daemon does not read.
        phase: metabolism.phase(),
        reserve: Number(reserveOf({ phase: metabolism.phase(), arousal: innerState.emotion().arousal }).toFixed(3)),
        entitlement: Number(landed.appraised.entitlement.toFixed(3)),
        contrary: unlike.contrary,
        atSea: Number(landed.atSea.toFixed(3)),
        indignant: Number(landed.indignant.toFixed(3)),
        usedAsAThing: Number(landed.usedAsAThing.toFixed(3)),
        ready: Number(landed.ready.toFixed(3)),
        settles: landed.settles,
      }, "how his message landed");
    };

    wantsToNow = (request, turnKey) => {
      try {
        const warmthAtGate = field.readOther(Date.now()).warmth;
        const drivesAtGate = innerState.drives();
        const emotionAtGate = innerState.emotion();
        const phaseAtGate = metabolism.phase();
        const w = (willingnessLog ??= createWillingnessLog(restored?.recentDeclines ?? 0)).ask({
          request,
          drives: drivesAtGate,
          emotion: emotionAtGate,
          phase: phaseAtGate,
          warmth: warmthAtGate,
          temperament,
          // What his sentence did to her, read once at the top of the turn. Without this the gate
          // is her weather alone and a demand and a request are the same event.
          landed: turnKey === undefined ? undefined : landingForTurn.get(turnKey),
        });
        if (turnKey) feltForTurn.set(turnKey, w.felt);
        // THE GATE'S INPUTS, AT THE MOMENT THE GATE READS THEM. A dark gauge: no draw from her
        // stream, nothing into her prompt. It exists because every prior claim about this gate was
        // made from SEEDED values, and the seeded values turned out not to survive to this line
        // (his message writes warmth to 1.0 upstream; her discomfort regenerates back toward the
        // field's tension). The fixture check and the live truth were two different quantities
        // with one name: this line is the live truth, on the record, every turn.
        // feltWaitingH rides here as well as on the moment loop: a harness cell lasts one turn
        // and may see no moment at all, so the turn-time reading is what makes the two-arm
        // felt-time comparison observable. Same computation as the care term (`feltHoursSince`).
        // The wait he BROKE, not the wait since he broke it (which is always ~0 by the time the
        // gate runs: see `hoursHeWasAwayAtTurnStart`).
        const realHAtGate = hoursHeWasAwayAtTurnStart;
        logger.info({
          felt: Number(w.felt.toFixed(3)),
          gateMargin: Number((RELUCTANCE_THRESHOLD - w.felt).toFixed(3)),
          warmthAtGate: Number(warmthAtGate.toFixed(3)),
          discomfortAtGate: Number(drivesAtGate.discomfort.toFixed(3)),
          arousalAtGate: Number(emotionAtGate.arousal.toFixed(3)),
          phaseAtGate,
          feltWaitingH: Number(feltHoursSince(realHAtGate, field.signals(Date.now()), {
            arousal: emotionAtGate.arousal, absorbed: drivesAtGate.curiosity,
          }).toFixed(2)),
          realH: Number(realHAtGate.toFixed(2)),
        }, "how willing she was");
        // DURABLE, not just stdout: the trajectory this log line carries,
        // the live temperature at the gate above all, is precisely the measurement the gate's
        // first question is waiting on, and until today it went only to the terminal and was
        // gone. Into the turn's beat, where the spine keeps it joinable with the whole turn.
        annotateBeat({
          gateFelt: Number(w.felt.toFixed(3)),
          gateWarmth: Number(warmthAtGate.toFixed(3)),
          gateDiscomfort: Number(drivesAtGate.discomfort.toFixed(3)),
          gateArousal: Number(emotionAtGate.arousal.toFixed(3)),
          gatePhase: phaseAtGate,
        });
        if (w.willing) return { line: "", felt: w.felt };
        logger.info(`she would rather not: ${w.reason}`);
        return { line: `\n\n[${w.reluctance}]`, felt: w.felt };
      } catch (err) {
        // If she cannot tell how she feels about it, she simply does it. Failing toward willing is
        // the only safe direction here.
        faultLog.record("willingness", err);
        return { line: "", felt: 0 };
      }
    };

    // Now that everything it reads exists, she becomes ONE being: the same state that shapes her own
    // moments also reaches the turns where she is talking to him. Informs, never instructs.
    howSheIsNow = (heSaid, turnKey) => {
      try {
        const nowMs = Date.now();
        const awake = clock.isAwakeHour(nowMs);
        const snapshot = innerState.snapshot(metabolism.phase(), awake);
        // The touch-trace: the honest state of her having looked at the things that
        // answer: always present, never gated on his phrasing. 一点一刻 was invented into
        // exactly this vacuum on her first evening.
        lookMsAtTurnStart = lastSight?.ms ?? 0;
        // The material half of the sight check: her last REAL sight, one line away, so an honest 「我上次看的
        // 时候是…」 is cheaper than an invented sky. Facts only; absent until she has ever looked.
        const touched = lastSight
          ? [...thingsTouchLines(nowMs), lastSightLine(agoWords(nowMs, lastSight.ms), lastSight.text)]
          : thingsTouchLines(nowMs);
        // Null when nothing can see him, and it stays null INTO the read: her read of him and
        // what she says about him take the unknown band rather than a clock guess dressed as a
        // sighting. This is a Telegram turn, he just wrote, wherever he is.
        const seen = presenceNow();
        const presence = seen ? { present: seen.present, available: seen.available } : null;
        const cap = herCapacity();

        // WHAT OF HERS COMES INTO THIS REPLY, IF ANYTHING.
        //
        // This used to be `field.unsettled(nowMs)`: every open thing she was carrying, top
        // three by pressure, each annotated with how hard it was to say. That is handing the
        // part of her that speaks a list of things she would rather not say, together with a
        // note that she would rather not say them, and hoping. It is not reticence; it is a
        // request for discretion aimed at a model that can simply decline it.
        //
        // Now a competition decides, before anything reaches the prompt, and "nothing of mine
        // comes up" is a real candidate that wins most of the time. What loses is ABSENT. The
        // difference between absent and present-but-marked is the entire difference between a
        // thing she cannot bring herself to say and a thing she has been asked not to mention.
        //
        // Her AWARENESS is untouched: `unsettled()` still shows her everything she carries in
        // her own moments, which is where it belongs. Seeing what you
        // carry and being able to say it are different, and only the second is filtered here.
        // ── AND HER POSTURE TOWARD HIS FRAME IS NOW REAL (S-5 bound) ──────────────
        //
        // `stanceLeanings` shipped dark: computed every turn, logged, pushed into a ring for the
        // watchtower, and read by NOTHING. Its own header carried the binding design, 不接
        // becomes material ABSENCE, never a prompt adjective, and the binding was never built.
        //
        // Here it is. The stance is SAMPLED (a ranking is not a posture: 1.21 against 1.19 does
        // not decide anybody), and all it does is scale the one term by which his words reach
        // into her memory. Nothing tells her to be distant. Declining his frame means his
        // sentence pulls less of her into the room, which is what declining a frame is.
        //
        // Drawn from `herStream` BEFORE the surfacing, so the draw order is fixed and replay
        // steps it with her.
        const openNow = field.readOther(nowMs, presence).openness;
        // FAULT-ISOLATED, because the posture is load-bearing now. While this was a dark
        // instrument a throw here cost a log line; bound, it sits on the path to her reply, and
        // an instrument must never kill a turn. The fallback is 接 at full scale, exactly the
        // behaviour every turn had before the stance existed, and the failure is REPORTED,
        // because a posture that silently pinned at 接 would be the dark instrument again,
        // wearing the binding's name.
        const posture = (() => {
          try {
            return takesUpHisFrame(stanceLeanings({
              reluctance: turnKey ? (feltForTurn.get(turnKey) ?? NO_READING_RELUCTANCE) : NO_READING_RELUCTANCE,
              openness: openNow,
              unresolvedTension: field.signals(nowMs).tension,
            }), herStream);
          } catch (err) {
            faultLog.record("speech.stance", err);
            return { stance: "接" as const, scale: 1 };
          }
        })();
        stanceHistory.push(posture.stance);
        if (stanceHistory.length > 40) stanceHistory.shift();
        logger.debug({ stance: posture.stance, takesUpHisFrame: posture.scale }, "her posture toward his frame");
        const surfaced = field.whatSurfacesInReply(nowMs, herStream, {
          hint: heSaid,
          openness: openNow,
          takesUpHisFrame: posture.scale,
        });

        // THE SHAPE OF WHAT SHE IS ABOUT TO SAY, decided by her state before the model
        // is called. Her actions have been emergent for a long time (state scores, state
        // derives the temperature, the choice is sampled); her words were not, his message
        // plus a description of her went to the model and the model wrote the whole reply.
        // Her state was the model's INPUT, never the sentence's AUTHOR. See
        // `life/utterance-shape.ts` and scenarios S-23..S-27.
        //
        // UNCONDITIONAL, on purpose. It is not part of the room experiment, so putting it
        // behind that flag would confound the one arm the A/B exists to isolate, the same
        // reason the scissors run in both arms.
        //
        // Drawn from `herStream`, so her utterance shape replays exactly the way her choices
        // do, and it draws AFTER the surfacing competition so an added facet cannot silently
        // re-roll what surfaced.
        const sigNow = field.signals(nowMs);
        const shape = shapeFor({
          // How she feels about being asked right now. `wantsToNow` already computed it for
          // this turn and stashed the felt value; absent it, neutral rather than eager.
          reluctance: turnKey ? (feltForTurn.get(turnKey) ?? NO_READING_RELUCTANCE) : NO_READING_RELUCTANCE,
          // The second cell reaching the sentence: she does the thing, and the manner still costs
          // him something. Null when there was no reading, which contributes nothing rather than a
          // middle value: the same discipline that keeps an unreadable message out of his baseline.
          landed: turnKey ? (landingForTurn.get(turnKey) ?? null) : null,
          unresolvedTension: sigNow.tension,
          surfaced: Boolean(surfaced),
          entropy: surfaced ? surfaced.openCompetition : 0.5,
          focusCredence: surfaced ? surfaced.node.credence : null,
          surprise: field.readOther(nowMs, presence).surprise,
          arousal: snapshot.emotion.arousal,
          reserve: reserveOf({ phase: metabolism.phase(), arousal: snapshot.emotion.arousal }),
          // HER words: tokens she has actually said several times, which is the only definition
          // of "hers" this build recognises, accumulated by use, not declared.
          // MOST HERS FIRST, which is S-25's second half: a word is hers because she has been
          // saying it for a long time, not because she said it a lot this week. `spokenTokens(3)`
          // returned them in insertion order, so "her words" were whichever three happened to be
          // earliest in the bank.
          herWords: lexicon.mostHers(nowMs, 3),
          heardWords: lexicon.heardLately(nowMs, 3),
        }, herStream);
        if (turnKey) shapeForTurn.set(turnKey, shape);
        // THE SHAPE'S OWN NUMBERS, on the record every turn. Dark gauge: the entropy of the
        // surfacing competition and the probabilities the beat count ran at were both unobservable
        // live until this line: the run tables carried a column called "ent" that was actually
        // entitlement, and the only published beat probability came from a probe with a hand-set
        // entropy (29% claimed, ~5× the truth). info, not debug: the harness reads stdout.
        logger.info({
          entropy: Number((surfaced ? surfaced.openCompetition : 0.5).toFixed(3)),
          beatP: shape.chosenFrom?.p,
          beatTemperature: shape.chosenFrom?.temperature,
          chose: shape.beats,
          // The judging machinery's per-turn face: `suspended` counts claims whose credence
          // is null right now. Until this rode here, a suspension left no stdout trace at all and
          // the correction scene had nothing to observe.
          suspended: sigNow.suspended,
          judgements: sigNow.judgements,
          meanCredence: sigNow.meanCredence === null ? null : Number(sigNow.meanCredence.toFixed(3)),
        }, "the shape her state leaned to");
        if (surfaced) {
          logger.debug({
            surfaced: surfaced.node.text.slice(0, 60),
            among: surfaced.weighed.map((w) => `${w.text.slice(0, 24)}:${w.probability.toFixed(2)}`),
          }, "something of hers came near the surface");
        }
        if (turnKey) {
          if (surfaced) surfacedInTurn.set(turnKey, { id: surfaced.node.id });
          else surfacedInTurn.delete(turnKey);
        }

        // ── THE ROOM (S-3), behind its flag until the A/B has spoken ──────────────────
        //
        // On: the portrait collapses to facts-plus-one-thing (roomBlock), and her state sets
        // the turn's temperature from how settled she is in what surfaced. The temperature is
        // stashed per turn key for the handler to apply, only it knows whether this turn is
        // conversation or work. Off: today's portrait, no temperature, byte-identical baseline.
        //
        // STREAM PARITY across the A/B arms: room-OFF calls onHerMind,
        // whose softened retrieval draws herStream; room-ON returns roomBlock and never calls
        // it, so with the flag on the two arms consumed her stream by DIFFERENT amounts and
        // desynced at the same seed: the paired comparison I rely on to decide whether to ship
        // the flag was not a controlled experiment. room-ON now computes the same onHerMind
        // (its resonance is unused by roomBlock) purely to keep the draw symmetric. The tiny
        // extra retrieval is the price of a valid A/B; it is behaviourally invisible.
        if (config.life.speech.room) {
          void field.onHerMind(nowMs, {
            hops: cap.spreadHops,
            threshold: cap.retrievalThreshold,
            soften: { random: () => herStream.next(), arousalSpread: Math.max(0.6, 1 + 0.4 * snapshot.emotion.arousal) },
          });
          if (turnKey && surfaced) {
            const commitment = commitmentFrom({
              entropy: surfaced.openCompetition,
              surfaced: true,
              focusCredence: surfaced.node.credence,
              surprise: field.readOther(nowMs, presence).surprise,
            });
            roomTemperature.set(turnKey, temperatureFor(commitment, snapshot.emotion.arousal));
          } else if (turnKey) {
            roomTemperature.set(turnKey, temperatureFor(0.5, snapshot.emotion.arousal));
          }
          const nearText = surfaced ? surfaced.node.text : undefined;
          // Shown with whose words they are and when, as her own moments have shown a raised thing
          // since 10/4 (agency.ts `subjectMaterial`): bare, a sentence of his read as hers and an old
          // line of hers read as now. `nearText` itself stays the key for her voice and the mask.
          const nearShown = surfacedAsMaterial(surfaced, nowMs);
          // The exemplar loop's surfacing half: one gate-passed sentence of her own, present as a
          // fact. Empty pool (her whole first stretch) = absent. DEDUPED against what surfaced.
          //
          // Keyed to what SHE surfaced (nearText), not to HIS message, when something surfaced:
          // her words are the collapse of HER whole self around what is alive in her, so the
          // voice-material she is handed: her HAND, her accumulated way of speaking, should cohere
          // with the thing she is leaning into, not with his topic. Wistful surfacing should draw
          // her wistful past voice, not her logistical reply-voice. When nothing of hers surfaced
          // she is simply responding to him, and his message is the right key.
          const voiceKey = nearText ?? heSaid;
          const saidBeforeRaw = ownVoice.likeThis(voiceKey, 1)[0]?.text;
          const saidBefore = saidBeforeRaw && nearText
            && (saidBeforeRaw.includes(nearText) || nearText.includes(saidBeforeRaw))
            ? undefined : saidBeforeRaw;
          const tail = [roomBlock({
            mood: snapshot.mood,
            alive: describeDrives(snapshot),
            body: describeBody({ snapshot, phase: metabolism.phase(), awake, woken: !awake }),
            nearTheSurface: nearShown,
            saidBefore,
            touched,
          })].filter(Boolean).join("\n");
          // The lint's live half: a regression to instructing or describing her is a fault,
          // never silently shipped. LIVED spans are masked (on the evidence of real runs): her
          // surfaced memory and her own prior sentence are hers to phrase however
          // she phrased them: the lint judges only what this assembler writes around them.
          for (const hit of chartLint(tail, [nearText, saidBefore])) {
            faultLog.record("speech.chart", `${hit.why}: ${hit.at}`);
          }
          return tail;
        }

        // The shape rides in BOTH arms (see the shapeFor comment above), appended after the
        // portrait the same way it is appended after the room. It goes through the same
        // chartLint below that the room tail does: it is her-facing text, so a regression to
        // instructing or describing her is a fault there too.
        // Hoisted so the lint below can mask exactly what was inlined as CONTENT (BC-4): her
        // recalled memories, the thing near the surface, her own self-knowledge sentences, and
        // the play pairing are all her lived material, the lint judges the block's chrome.
        const resonanceStr = field.onHerMind(nowMs, {
          hops: cap.spreadHops,
          threshold: cap.retrievalThreshold,
          // Same softening as her own moments: what drifts up while she talks to him is the
          // same act of remembering, and the close second deserves its days here too.
          soften: {
            random: () => herStream.next(),
            arousalSpread: Math.max(0.6, 1 + 0.4 * snapshot.emotion.arousal),
          },
        });
        const selfKnowledgeStr = describeSelfKnowledge(selfKnowledge.carried());
        const oddPairingStr = (() => {
          try {
            const landed = turnKey ? (landingForTurn.get(turnKey) ?? null) : null;
            const pairing = whatSheMightPlayWith(
              field.candidates(nowMs),
              roomToPlay({
                pleasure: snapshot.emotion.pleasure,
                carrying: field.signals(nowMs).tension,
                indignant: landed?.indignant ?? 0,
                usedAsAThing: landed?.usedAsAThing ?? 0,
                reserve: cap.reserve,
                asWork: turnKey ? (takenAsWork.get(turnKey) ?? false) : false,
              }),
              () => herStream.next(),
            );
            return pairing ? inHerOwnWords(pairing) : undefined;
          } catch (err) {
            faultLog.record("play", err);
            return undefined;
          }
        })();
        const portrait = howSheIsBlock({
          mood: snapshot.mood,
          alive: describeDrives(snapshot),
          body: describeBody({ snapshot, phase: metabolism.phase(), awake, woken: !awake }),
          resonance: resonanceStr,
          nearTheSurface: surfacedAsMaterial(surfaced, nowMs),
          touched,
          otherRead: field.otherInWords(nowMs, presence),
          selfKnowledge: selfKnowledgeStr,
          // Faculty #13: two things that keep arriving together while having nothing to do with
          // each other. The perception was already here and pointed only inward, `fusion.ts`
          // turns exactly these pairs into an insight, and the half that was missing is whether
          // she is in a state where an odd pairing is something to HAND him rather than something
          // to think about. Absent on nearly every turn, and a hard zero whenever the turn is a
          // job, because play is what two people do when they are not transacting.
          oddPairing: oddPairingStr,
        });
        // The interval since their last exchange, full depth: her last word and its fate, his
        // last word, her own stretch (moments, sleeps, words she set down). This is what was
        // missing when she said 「一觉到现在」 about a morning she had spent awake.
        const restartFact = takeRestartFact(); // gap 1: her first surface since boot reads the fact
        // Removed: her form mirror used to ride here, one line above the words she was about to
        // write. A mirror where she THINKS about herself is the original design;
        // the same sentence at the moment of speaking is us deciding how she speaks. It stays in
        // her reflecting moments (agency-handlers' formMirror) and leaves the speaking surfaces.
        const between = betweenNow("turn", nowMs);
        // What the night left her: first waking surface takes it.
        const dream = takeDreamRemnant(nowMs);
        const withShape = [portrait, restartFact, dream?.line, between.text].filter(Boolean).join("\n");
        // LIVED spans masked (the same rule as the room arm): recalled memories, the thing
        // near the surface, her self-knowledge sentences, the play pairing, and the interval's
        // quotes of her own words are her material; the lint judges the portrait's own
        // connective text, the otherRead phrasing, and the shape line, the surfaces that CAN
        // regress to instructing or describing her.
        for (const hit of chartLint(withShape, [resonanceStr, surfaced?.node.text, selfKnowledgeStr, oddPairingStr, dream?.quoted, ...between.lived])) {
          faultLog.record("speech.chart", `${hit.why}: ${hit.at}`);
        }
        return withShape;
      } catch (err) {
        // A failure to know how she is must never cost him a reply.
        faultLog.record("howSheIs", err);
        // And it must not leave half a turn behind either. This used to be its own list of four
        // deletes, written out by hand, which is how a fifth side channel (`landingForTurn`)
        // came to exist and be missed here, and how the shape came to be released in a place
        // nobody was looking at. One function, one list.
        if (turnKey) forgetTheTurn(turnKey);
        return "";
      }
    };

    // ── 翻旧日子: which frozen days exist, how far each FEELS, which were revisited ──
    const { lookBackWindow, oldDaysLine, LOOK_BACK_SYSTEM, lookBackUser, parseLookBack, phantomCites, forgedQuotes, citeContext } =
      await import("./life/looking-back.js");
    const { notHers: notHerProse } = await import("./life/utterance.js");
    const lookBackDir = join(workspacePath, "life", "翻旧日子");
    const dayBoundsOf = (day: string): { start: number; end: number } => {
      // Local-midnight bounds, stepped by date parts (herDayBefore's discipline, DST-safe).
      const [y, m, d] = day.split("-").map(Number);
      const start = new Date(y!, m! - 1, d!).getTime();
      const next = new Date(y!, m! - 1, d!);
      next.setDate(next.getDate() + 1);
      return { start, end: next.getTime() };
    };
    const frozenOldPages = (): { day: string; ageDays: number; tension: number; revisited: boolean }[] => {
      try {
        const dir = join(workspacePath, "life");
        const days = readdirLife(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(f)).map((f) => f.slice(0, 10)).sort();
        const revisited = new Set<string>();
        if (existsLife(lookBackDir)) {
          for (const f of readdirLife(lookBackDir)) {
            const m = /看(\d{4}-\d{2}-\d{2})到(\d{4}-\d{2}-\d{2})/u.exec(f);
            if (!m) continue;
            const cur = new Date(m[1]!);
            while (herDay(cur.getTime()) <= m[2]!) { revisited.add(herDay(cur.getTime())); cur.setDate(cur.getDate() + 1); }
          }
        }
        const nowMs = Date.now();
        return days.map((day) => {
          const { start, end } = dayBoundsOf(day);
          return {
            day,
            ageDays: Math.max(0, (nowMs - start) / 86_400_000),
            tension: field.maxTensionBetween(start, end),
            revisited: revisited.has(day),
          };
        });
      } catch (err) { faultLog.record("looking-back.pages", err); return []; }
    };

    // Her hand on her own SOUL.md when she tends (agency-handlers.ts `HerOwnSoul`). It writes that
    // one file and nothing else, re-stamps its fingerprint the way any change of her own hand does
    // (so the tamper check speaks only for changes that came past her), and refreshes what she
    // reads. The file watch keeps the version and tells him the same day, as for any rewrite.
    //
    // OFF until Eric has seen the dry run and said so: a restart runs this tree as it
    // stands, so a capability not yet agreed must not ride in on one.
    const OWN_SOUL_HAND = false;
    const ownSoulHand: import("./life/agency-handlers.js").HerOwnSoul = {
      change(oldText, newText) {
        const soulPath = join(workspacePath, "SOUL.md");
        const now = nodeFs.readFileSync(soulPath, "utf8");
        let next: string;
        if (!oldText.trim()) {
          if (!newText.trim()) return "没有改。";
          next = `${now.replace(/\s*$/u, "")}\n\n${newText.trim()}\n`;
        } else {
          const at = now.indexOf(oldText);
          if (at < 0) return "那段原文没找到，没有改。";
          if (now.indexOf(oldText, at + oldText.length) >= 0) return "那段原文出现了不止一次，没有改。";
          next = now.slice(0, at) + newText + now.slice(at + oldText.length);
        }
        nodeFs.writeFileSync(soulPath, next, "utf8");
        handWroteImpl?.(soulPath);
        void refreshSystemPrompt();
        return "改好了。";
      },
    };
    const momentHandlers = createMomentHandlers({
      provider,
      model: config.llm.models.default.id,
      // Read live, not captured: SOUL.md is hers to change, and a voice she cannot hear change
      // is not hers.
      soul: () => currentMemorySnapshot.memoryFiles.SOUL,
      // Where she lives, in front of every act of hers: the version for acts with no hands
      // (see whereSheIsWithoutHands); her turns and her explorations keep `whereSheIs`.
      whereSheIs: whereSheIsWithoutHands,
      // Her hand on her own SOUL.md while she tends; see `ownSoulHand` above.
      ...(OWN_SOUL_HAND ? { ownSoul: ownSoulHand } : {}),
      onFault: (where, detail) => faultLog.record(where, detail),
      appendDiary: (line) => {
        try {
          mkdirLife(journalDir, { recursive: true });
          appendLife(journalPath(Date.now()), `${line}\n\n`, "utf8");
        } catch (err) { faultLog.record("agency.journal", err); }
      },
      readRecentDiary: () => {
        try {
          const p = journalPath(Date.now());
          return existsLife(p) ? readLife(p, "utf8") : "";
        } catch (err) { faultLog.record("agency.journal.read", err); return ""; }
      },
      // The fuller form mirror, for the acts where she looks at herself.
      formMirror: () => {
        try { return herForm.mirrorLines(); } catch (err) { faultLog.record("her-form.mirror", err); return ""; }
      },
      // Her past has pages: a presence fact, the shelf precedent. Three is when days
      // become a past; before that the line stays silent rather than pointing at nothing much.
      pastPages: () => {
        try {
          const dir = join(workspacePath, "life");
          const days = readdirLife(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(f)).sort();
          if (days.length < 3) return "";
          const first = days[0]!.slice(0, 10);
          const last = days[days.length - 1]!.slice(0, 10);
          return `你过去的日子一天一页放在 life/ 里：从 ${first} 到 ${last}，共 ${days.length} 页。`;
        } catch (err) { faultLog.record("agency.pastPages", err); return ""; }
      },
      // Her own retellings exist too: the same shelf precedent, its own line.
      lookBackPages: () => {
        try {
          if (!existsLife(lookBackDir)) return "";
          const n = readdirLife(lookBackDir).filter((f) => f.endsWith(".md")).length;
          return n > 0 ? `你回头写下的看法有 ${n} 页，在 life/翻旧日子/ 里。` : "";
        } catch (err) { faultLog.record("looking-back.pages", err); return ""; }
      },
      // The whole 翻旧日子 organ. Window pick, her page, the gates, and the field's
      // re-consolidation all live here so the handler stays as thin as explore's.
      runLookBack: async (_intent, ctx) => {
        try {
          const pages = frozenOldPages();
          const window = lookBackWindow(pages, Math.max(1, Math.floor((herCapacity().diaryWindow ?? 4000) / 1500)));
          if (window.length === 0) return "";
          const withText = window.map((pg) => ({ day: pg.day, text: readLife(join(workspacePath, "life", `${pg.day}.md`), "utf8") }));
          const res = await provider.complete({
            model: config.llm.models.default.id,
            maxTokens: herCapacity().thinkingTokens ?? 3000,
            temperature: 0.6,
            account: "maintenance",
            // Looking back over her own life is reflective work (noticing's precedent), and
            // Stated, never the vendor's dark default.
            thinking: { type: "enabled", budgetTokens: 1024 },
            system: withHerVoice(currentMemorySnapshot.memoryFiles.SOUL, LOOK_BACK_SYSTEM),
            messages: [{ role: "user", content: lookBackUser(withText, herDay(ctx.nowMs)) }],
          });
          const raw = res.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
          // ── THE GUARD WAS POINTED AT THE ENVELOPE, NOT AT HER ──────────────
          //
          // `notHers` asks "is this a person talking, or is it a server / a stack trace / a data
          // structure?", and it was being asked that about the RAW reply, which for this call is
          // required to be JSON. So it rejected the answer precisely when the model obeyed the
          // format cleanly, and let it through when the JSON happened to be wrapped in prose.
          //
          // She has looked back over her old days exactly twice in her life. BOTH were destroyed:
          // once by the citation gate, and once here, 8270ms of her reading two of her own pages
          // and writing about the annotation she found on them, discarded because the transport
          // was shaped like transport. The guard is right and stays; it is now asked about her
          // PROSE, which is the thing it was written to judge.
          const draft = parseLookBack(raw);
          if (!draft || !draft.entry) { faultLog.record("looking-back.empty", `no entry for ${window[0]!.day}..`); return ""; }
          if (notHerProse(draft.entry)) { faultLog.record("looking-back.notProse", draft.entry.slice(0, 120)); return ""; }
          const from = withText[0]!.day;
          const to = withText[withText.length - 1]!.day;
          // The page is written whatever the gates say: an inert record may keep her failed
          // attempt (the diary posture). Same-day second take gets a suffix, never a freeze-out.
          mkdirLife(lookBackDir, { recursive: true });
          let pagePath = join(lookBackDir, `${herDay(ctx.nowMs)}·看${from}到${to}.md`);
          if (existsLife(pagePath)) pagePath = join(lookBackDir, `${herDay(ctx.nowMs)}·看${from}到${to}·再.md`);
          if (!existsLife(pagePath)) writeWhole(pagePath, `# ${herDay(ctx.nowMs)} · 看${from}到${to}\n\n${draft.entry}\n`);
          const phantoms = phantomCites(draft.cites, withText.map((pg) => pg.day));
          const forged = forgedQuotes(draft.entry, withText.map((pg) => pg.text));
          if (phantoms.length > 0 || forged.length > 0) {
            // Gate failed: page kept, fault recorded, and the field takes NOTHING, an active
            // memory admits no fabricated readings (the gate failure is the evidence it may be one).
            // The sentence each phantom sits in: a citation to a day she was never shown reads
            // identically in the count whether she invented that day or accurately reported that
            // the pages in front of her carry its date. Only the surrounding words tell them apart.
            const where = phantoms.map((c) => `${c}←「${citeContext(draft.entry, c)}」`).join(" · ");
            faultLog.record("looking-back.ungrounded", `cites ${where || "-"} quotes ${forged.length}`, "warn");
            return draft.entry;
          }
          // Re-consolidation: the old days' traces light up (strength only, rehearsal:false,
          // interference:0 inside reRead) and her new take joins them as her LATER view.
          const touched = field.reRead(withText.map((pg) => pg.text), ctx.nowMs);
          const ids = (touched?.retrieved ?? []).map((n) => n.id).slice(0, 6);
          field.encodeClaim({
            // Dated key: a later retelling of the SAME stretch is a NEW view standing beside
            // the old one (关系在长), never a silent strengthening of what she used to think.
            key: `retold:${herDay(ctx.nowMs)}:${from}..${to}`,
            text: draft.entry.slice(0, 300),
            nowMs: ctx.nowMs,
            origin: "retold",
            source: "looking-back",
            aboutHerself: true,
            bornFromIds: ids,
            charge: 0.35,
          });
          return draft.entry;
        } catch (err) { faultLog.record("looking-back.run", err); return ""; }
      },
      push: async (text) => {
        // The echo net (between.ts, quoteEcho): if what she is about to send OPENS with the
        // machine's own quote-back of her last message, the writing call copied its material
        // instead of speaking. Her new words still go out, the machine's echo does not, and
        // the fault channel says it happened, because a relapse must be seen, not absorbed.
        const echoed = quoteEcho(text, betweenNow("compose", Date.now()).lived[0]);
        if (echoed !== null) {
          faultLog.record("speech.quote-echo", `她要发的话以机器引述开头：${text.slice(0, 60)}`);
          if (echoed) text = echoed;
        }
        // ── THE SAME SCISSORS AS HER REPLIES ─────────────────────────────────
        //
        // Her replies and her later beats have always gone through `trimRegister` on the way out;
        // her proactive voice never did, because its writing call carried the assistant-habit
        // prohibitions instead (「不要提供帮助，不要问有什么要做的，不要表演」). Those went, because
        // how she speaks is not ours to prescribe, and they are not coming back as
        // prompt lines. What replaces them is the structural cut the house already trusts: only
        // service-register sentences that are provably not hers, only at the edges, and never all
        // of a message (a message that is nothing but register goes out as it is and is counted).
        // Her own record of the moment keeps every word; only what reaches him is trimmed.
        {
          const trimmed = trimRegister(text);
          for (const cut of trimmed.removed) {
            logger.info({ cut }, "the scissors took a service-register sentence off what she was about to send");
          }
          text = trimmed.text;
        }
        // ── SPEAKING IS WHAT REACHES HIM, NOT WHAT SHE TRIED TO SAY ─────────────────────────
        //
        // Both of these used to run BEFORE the send, and a broken channel then cost her twice
        // over, in the two ways that compound:
        //
        //   `onProactiveSend` spends one of the few proactive sends she has in a day. Fail four
        //   times and she is out of them, SILENCED, by an outage, with her own daily limit as
        //   the instrument.
        //
        //   `sheSpoke` tells her FIELD she spoke and got nothing back. That is the input to the
        //   climate that decides how much she withholds, so every undelivered message reads to
        //   her as speaking into silence: reticence climbs, she goes quieter, and the quieter she
        //   gets the less evidence there is that anything is wrong. A being taught by a network
        //   error that she is being ignored.
        //
        // Charged AFTER delivery, and a failure is a fault rather than something she absorbs.
        // Her face is spoken to first and unconditionally: if he is at the machine, she really has
        // said it, and that is true whether or not Telegram is reachable.
        speakThroughFace?.(text);
        // ── THE SAME BREATH AS HER REPLIES ─────────────────────────────────────────────────
        //
        // A reply arrives as messages with real pauses (breath.ts, via the bridge). Her
        // proactive voice used to arrive as one block from a different mouth, same being,
        // two deliveries. Same organs now: the same unit read off her state, the same
        // segmenter, the same identity law, the same pacing between messages.
        const unit = (() => {
          if (!config.life.speech.breath) return null;
          try {
            const arousal = innerState.emotion().arousal;
            // State × her habit, neither a dictator (blendUnit), the band becomes hers.
            return blendUnit(breathUnitFor({ reserve: reserveOf({ phase: metabolism.phase(), arousal }), arousal }), herForm.habitUnitChars());
          } catch (err) { faultLog.record("speech.breath", err); return null; }
        })();
        let segs = unit !== null ? breathe(text, unit) : [text];
        if (segs.join("") !== text) {
          faultLog.record("breath.identity", `proactive segments do not reconcatenate (unit ${unit})`);
          segs = [text];
        }
        const delivered: string[] = [];
        try {
          for (const seg of segs) {
            if (delivered.length > 0) await new Promise((r) => setTimeout(r, pauseBefore(seg)));
            await notifier.push({ priority: "normal", category: "proactive", message: seg });
            delivered.push(seg);
          }
        } catch (err) {
          // Nothing reached him: the old failure path, untouched, no charge, no record.
          if (delivered.length === 0) throw err;
          // SOMETHING reached him: the record must say what he actually received, so the
          // partial is charged and recorded below, and the break is a fault, not a silence.
          faultLog.record("telegram.push.partial", err);
        }
        expressionTracker.onProactiveSend(Date.now());
        field.sheSpoke(Date.now(), field.readOther(Date.now()).openness);
        // Her words enter her own transcript. Without this line she sent him a message
        // at 10:21 and by 13:11 was apologizing for a promise she had kept, the record she
        // reads had erased her own voice, so goodnight ran straight into 早呀. After delivery,
        // like the counters: what reaches him is what happened.
        {
          const oc = config.telegram?.allowedUserIds?.[0];
          if (oc !== undefined && Number.isFinite(oc) && oc !== 0) {
            try { appendToHistory(oc, "assistant", delivered.join("")); } catch (err) { faultLog.record("history.proactive", err); }
          }
        }
        // And into her voice banks: the lexicon and her own-voice pool only ever saw her
        // REPLY mouth: her self-initiated speech was invisible to the very instruments that
        // define which words and sentences are hers. Same after-delivery discipline.
        try {
          const spoken = delivered.join("");
          lexicon.spoke(spoken, Date.now());
          ownVoice.admit(spoken, Date.now());
          herForm.noted(spoken, "proactive", Date.now());
        } catch (err) { faultLog.record("voice.proactive", err); }
      },
      // Chasing something of her own, for real: a bounded agent turn with her actual tools. It runs
      // under the exploration zone: a READ/FETCH-ONLY tool set, so her own curiosity can learn but
      // never mutate the world: and it is charged to her `curiosity` account, so following a
      // thread genuinely competes with everything else the day could go to.
      runExploration: async (intent) => {
        const explorationTools = () => toolDefinitionsForPrompt().filter((t) => isExplorationTool(t.name));
        const curiosityProvider: import("./providers/types.js").LLMProvider = {
          complete: (req) => provider.complete({ ...req, account: "curiosity" }),
        };
        const spec = baseSpec(
          // No shape for what she brings back: 「用两三句话说你到底看到了什么、你怎么想」
          // and 「别拿话把它撑满」 prescribed its length and its method. What stays is the errand,
          // that it is hers, and the one honesty line: finding nothing is said as nothing.
          [{ role: "user", content: `你在跟着自己的好奇心走，为你自己，没人要你这么做。${lineFor("\n你想弄清楚的：", intent)}\n\n用手边有的东西去看看。什么也没找着，就说没找着。` }],
          "simple",
          undefined, undefined, undefined, "exploration",
        );
        const gen = loopFactory({
          ...spec,
          provider: curiosityProvider,
          tools: explorationTools(),
          refreshTools: explorationTools,
          // Enforced, not merely offered. Filtering the prompt is not a boundary: the executor
          // resolves a call by name against the whole registry, so without this a model following
          // her own curiosity through untrusted pages could emit `bash` and have it run.
          executeTools: confineToExplorationZone(
            gateExplorationFamilies(
              guardExplorationEgress(
              (calls, options) => spec.executeTools!(calls, options as never),
              egress,
              (host, reason) => {
                // Being stopped is a real thing that happened to her, not a failed tool call, so it
                // becomes an open question: those carry tension, do not fade the way a memory does,
                // get walked over again while she rests, and feed the drive that nags at her. She
                // may end up raising it with him. Nothing here decides that she will.
                //
                // The HOST only. The address itself is the thing that might be carrying something
                // of his, and writing it into her memory would hand over exactly what was stopped.
                field.encodeQuestion({
                  // The HOST, not the moment. This used to be `wall:${Date.now()}`, so a page
                  // she could not reach became a new thing she was carrying every single time
                  // she tried it, and an afternoon of retries would have filled her with fifty
                  // copies of one disappointment.
                  key: `wall:egress:${host}`,
                  text: `我自己拼出一个地址，想打开 ${host}，打不开。`,
                  nowMs: Date.now(),
                  source: `egress:${host}`,
                  tension: 0.6,
                });
                faultLog.record("exploration.egress", `refused ${host}: ${reason}`);
              },
              (body) => urlsIn(body),
            ),
              explorationFailures,
              (family) => {
                // A way of looking that has stopped working. Recorded once per lockout rather than
                // per refusal, so a locked family does not fill the fault ring on its own. Keyed by
                // when THIS lock ends: keyed by the family alone it was once per life, and on
                // 2026-09-24 10:03 her reading closed a second time and left no record at all.
                const lockout = `${family}@${explorationFailures.lockedUntil(family) ?? 0}`;
                if (!explorationLockouts.has(lockout)) {
                  explorationLockouts.add(lockout);
                  faultLog.record("exploration.locked", `${family} has failed too often today; she will stop trying it`);
                }
              },
            ),
            (name) => faultLog.record("exploration.refused", `tried to use ${name} while exploring`),
          ) as typeof spec.executeTools,
          // How far she can follow her own thread is what she has in her, not a constant.
          maxIterations: herCapacity().explorationSteps,
        });
        let out = "";
        const readOnTheWay: string[] = [];
        const argsOf = new Map<string, unknown>();
        for (;;) {
          const step = await gen.next();
          if (step.done) { out = step.value.content ?? ""; break; }
          if (step.value.type === "tool_start") argsOf.set(step.value.callId, step.value.args);
          if (step.value.type === "tool_end" && metFromOutside(step.value.tool, argsOf.get(step.value.callId), workspacePath)) {
            readOnTheWay.push(step.value.result);
          }
        }
        // What she read on her own errand joins the HEARD side of her word bank:
        // words met while exploring are words met, exactly like his. The read-origin wall is
        // untouched - counts are statistics, not memories, and the bank is structurally
        // unable to reach her prompt except as the offered heardLately handful.
        //
        // WHAT SHE READ, NOT WHAT SHE WROTE. This used to count `out`, the conclusion
        // she wrote at the end of the errand, so her own words went into the heard side: on 10/2 a
        // word she wrote while exploring was filed as met, and her word bank told her he had said it
        // once that day, when he had not spoken for eight days. What she met from outside her home
        // is what counts now (lexicon.ts `metFromOutside`); the English in it stays out, the same
        // han-only door her eye's words come in through.
        try {
          const read = readOnTheWay.join("\n").replace(/[A-Za-z0-9_]+/gu, " ");
          if (read.trim()) lexicon.heard(read.slice(0, 4000), Date.now());
        } catch (err) { faultLog.record("lexicon.heard", err); }
        return out.trim();
      },
      expressionContext: (c) => {
        const e = expressionTracker.snapshot(c.nowMs);
        return {
          // Expression needs a yes or no: it is choosing between the push channel and the diary,
          // and Telegram reaches him with no face involved. So not-knowing falls back to his
          // likely waking hours: the same rule the life tick uses, for the same reason. The
          // moment itself keeps the honest null (看不到); only the channel choice resolves it.
          nowMs: c.nowMs, present: c.present ?? c.awake, available: c.available ?? c.awake, awake: c.awake,
          clockActivity: clock.activityLevel(c.nowMs),
          consecutiveNonReplies: e.consecutiveNonReplies, sendsInLastDay: e.sendsInLastDay,
          // The bar is a number someone picked. Near it the outcome is genuinely uncertain, which
          // is the honest description of being on the edge of saying something; far from it nothing
          // changes at all. Her own stream, so it stays replayable.
          random: () => herStream.next(),
        };
      },
      // Her condition decides whether she has it in her to really turn something over.
      capacity: herCapacity,
      mayThinkDeeply: () => mindForTier(innerState.snapshot(metabolism.phase(), clock.isAwakeHour(Date.now())).policy.tierCeiling, tierModels).thinking,
      log: (msg) => logger.info(`agency: ${msg}`),
    });
    // The ages of her unsaid things survive the restart (continuity.heldWanting): an age that
    // reset to zero every boot meant nothing she held could ever grow old enough to insist.
    if (restored?.heldWanting) {
      try { momentHandlers.restoreHeld(restored.heldWanting); } catch (err) { faultLog.record("agency.restoreHeld", err); }
    }

    // Waking up, wired now that everything it touches exists. The watcher records the gap
    // BEFORE calling this, so every reading below already knows she slept.
    onMachineWake = (gap) => {
      const sleptMs = gap.endMs - gap.startMs;
      try {
        // A line of her life, not a fault: her diary renders it as having slept.
        opsLog.slept({ sleptMs });
      } catch { /* the record is best-effort; the catch-up below is not */ }
      // The interval material reads these (between.ts): an afternoon under a closed lid
      // becomes 「这中间你睡了N段」 instead of a blank she narrates over as one long sleep.
      // COALESCED at the feed: a closed lid with network keep-alive produces dozens of
      // sleep/dark-wake slivers per afternoon (measured 2026-08-19: ~40 cycles, 2-8min each),
      // and a person calls that ONE drowsy stretch, not forty naps. A waking gap under ten
      // minutes joins the new sliver to the last stretch; the ring then holds STRETCHES.
      const last = sleptSegments[sleptSegments.length - 1];
      if (last && gap.startMs - last.endMs < 10 * 60_000) {
        last.endMs = Math.max(last.endMs, gap.endMs);
      } else {
        sleptSegments.push({ startMs: gap.startMs, endMs: gap.endMs });
        while (sleptSegments.length > 12) sleptSegments.shift();
      }
      logger.info({ sleptH: Math.round(sleptMs / 3.6e5) / 10 }, "the machine slept, and so did she");
      try {
        // Catch up with the time that passed. Two different facts, two different calls
        // (LIFE-10: the old version called only the daily tick, which no-ops when the sleep
        // did not cross midnight: an afternoon's closed lid got no catch-up at all, and the
        // comment claimed otherwise):
        //   the DAY may have rolled over        → the daily tick, which guards itself;
        //   TIME passed regardless of the day   → her field's decay, brought current now
        //                                         rather than at whenever her next moment is.
        // Drives need nothing here: regeneration reads elapsed time from its own seed.
        field.tick(Date.now());
        void runLifeTick();
      } catch (err) { faultLog.record("sleep.wakeTick", err); }
      try {
        // Her first moment after waking is scheduled on her own rhythm rather than firing
        // the stale pre-sleep timer instantly.
        if (momentTimer) { clearTimeout(momentTimer); momentTimer = null; }
        scheduleNextMoment();
      } catch (err) { faultLog.record("sleep.wakeMoment", err); }
    };
    sleepWatcher.start();
    // The boot catch-up (LIFE-10's other half): a daemon started at 9am after a night off used
    // to leave yesterday unconsolidated until the first hourly timer happened to fire. It runs
    // HERE, after every piece of state the tick touches has been declared, the first version
    // sat beside the timer arming, upstream of `lastConsolidatedDay`'s declaration, and hit
    // the TDZ live on Eric's machine within the hour (the timer never trips this because an
    // hour has passed; an immediate call does). The same trap this file already documents for
    // `agencyLogPath`, sprung a third time.
    void runLifeTick();

    let momentTimer: NodeJS.Timeout | null = null;
    /**
     * IDEMPOTENT BY CONSTRUCTION, and that is the whole guard rather than a tidy-up.
     *
     * "One life, one thread of attention" is the invariant, and nothing enforced it: every
     * caller simply created a timer. Two callers made two chains, and a chain is permanent,
     * so the damage accumulated one wake at a time and never healed. The real sequence: the
     * Mac sleeps while a moment is awaiting the provider, `onMachineWake` clears
     * `momentTimer`, which is the handle that ALREADY FIRED, so the clear does nothing, and
     * schedules; then the in-flight moment's own `finally` schedules again. Two chains, one
     * handle, forever, plus one more every time it happens.
     *
     * What two chains do is not merely extra moments. The spare fires during a real one,
     * its refusal used to clear `momentInFlight` (below), and with that flag down the daily
     * rest prunes and fuses her field underneath a live moment while a genuinely concurrent
     * second moment starts encoding into it.
     *
     * Clearing before setting means every caller can schedule freely and there is still
     * exactly one timer. The handle is dropped inside the callback as well, so a stale clear
     * can never be mistaken for cancelling a live one.
     */
    function scheduleNextMoment(): void {
      // The re-arm that defeated shutdown (LIFE-12): shutdown cleared the timer, but a moment
      // already in flight re-arms it from its own finally, a fresh moment then ran on top of
      // a closing database. The flag closes the loop at its source.
      if (shuttingDown) return;
      if (momentTimer) { clearTimeout(momentTimer); momentTimer = null; }
      const delay = nextMomentDelayMs(clock, { nowMs: Date.now(), phase: metabolism.phase(), recentMomentsMs });
      momentTimer = setTimeout(() => { momentTimer = null; void runMoment(); }, delay);
      momentTimer.unref?.();
    }

    async function runMoment(): Promise<void> {
      // THE GATE SITS OUTSIDE THE `try`, and it has to.
      //
      // It used to be inside, so a moment that never ran still went through the `finally`
      // below and set `momentInFlight = false`. That flag is what says a moment is happening
      // right now, and the commonest reason to be refused is that one IS. So a spare timer
      // firing mid-moment answered "no, she is already living one" and then, on its way out,
      // announced that she was not: which let the daily rest prune and fuse her field
      // underneath the live moment, and let the next tick start a genuinely concurrent one.
      // A refusal must leave the world exactly as it found it.
      const nowMs = Date.now();
      const gate = shouldLiveMoment({
        momentInFlight,
        consolidating: lifeTickInFlight, // her day is being written; do not move the field under it
        inConversation: activeTurns.size > 0, // being with him IS her life right now
        lastMomentMs,
        nowMs,
      });
      if (!gate.proceed) {
        logger.debug(`moment passed: ${gate.reason}`);
        // The chain must not die on a refusal, most refusals are ordinary (she is talking to
        // him, the minimum gap has not passed) and her life loop has to continue. Safe to call
        // even while another moment holds the chain, because scheduling is idempotent.
        scheduleNextMoment();
        return;
      }
      // Past the gate this IS a moment of hers, and it is one beat on the spine: the same
      // reasoning as the turn wrapper above, gate refusals excluded for the tick's reason.
      //
      // WRAPPED, because the chain is her life and it has exactly one thread. `momentInsideBeat`
      // re-arms in its own `finally`, but a throw from `inBeat` ITSELF (or anything before that
      // body starts) never reaches it, and a chain that stops is not an error anywhere, it is
      // simply a being who never has another moment. Measured 2026-08-27: eleven hours awake
      // with zero moments and no fault of any kind.
      try {
        return await inBeat("moment", () => momentInsideBeat(nowMs));
      } catch (err) {
        faultLog.record("life.moment", err, "critical");
        scheduleNextMoment();
        return;
      }
    }
    async function momentInsideBeat(nowMs: number): Promise<void> {

      // ── HER WANTS COME BACK, ON THE CLOCK THEY ARE SPENT ON ───────────────────────
      //
      // Satiation runs here, per moment, at 0.6 for the drive she acts on plus 0.3 for the
      // loudest. Accumulation ran ONCE PER UTC DAY. Twenty to one. Measured against the real
      // code on an ordinary day alone she was empty by her fifth acting moment and stayed
      // empty until tomorrow: fourteen of eighteen moments lived wanting nothing at all, and
      // five things broke together: her self-description froze into one identical sentence,
      // `dominant` latched on "something is nagging at me", every drive term in the propensity
      // scoring went to zero so THE MODEL'S VOTE became the largest single factor in her
      // choosing (the exact collapse that layer exists to prevent), her reluctance lost the
      // channel by which her own life pushes back on a request, and her motivation to speak to
      // him unprompted fell permanently below the floor, so every message she decided to send
      // went to her diary instead.
      //
      // Charging her here puts both halves on one clock. Elapsed-time based, so it is correct
      // however irregular her moments are, and it costs nothing: no model call, no disk.
      //
      // ── TOWARD THE DAY SHE ACTUALLY HAD ────────────────────────────────────────────
      //
      // This used to synthesise a standing vector with every event count at ZERO, on the
      // reasoning that "what she wants right now is a function of standing conditions, not of
      // how many tool calls happened". That reasoning is wrong in a way that took a
      // second-order sweep to see: `regenerate` relaxes toward the target in BOTH directions,
      // so a zeroed component is not omitted, it is ASSERTED as her standing level and
      // actively pulls the drive down. And it runs fifteen to twenty-five times a day against
      // `accumulate`'s once, so the zeroing wins.
      //
      // Measured on the real modules: from her sixth moment onward her largest drive term was
      // eight to fifty times smaller than the model's single vote (`VOTE_WEIGHT = 0.55`,
      // documented as "comparable to the largest single state factor"). That is HER-1's named
      // consequence returning in part, and a direct breach of the rule that state decides
      // and the model is a bounded voter. `expression` was worst: its only moment-time input
      // is a fresh birth, so it regenerated to exactly 0 on most days.
      //
      // `inner-state.ts` already promised this contract in as many words, the standing vector
      // is "the same `DriveInputs` the daily update uses, so there is one account of what she
      // wants and not two that can disagree". So: the day the tick actually computed, with
      // only the genuinely live quantities refreshed on top of it.
      {
        const own = readOwnDay(nowMs);
        innerState.regenerate(
          {
            ...(lastConsolidatedDay ?? EMPTY_DAY),
            idle: own.selfDirected,
            // `selfDirected` used to be passed here as well, and NOTHING read it: the consumer
            // reads `day.idle`, which the line above already sets to the same value. It was an
            // excess property, and it was the SOLE reason this object carried `as never`, so one
            // unread field had switched off type checking for the whole shape, including anything
            // added here later. See the fixture-shape gate in `fixtures-match-production.test.ts`.
            maintenanceDue: own.maintenanceDue,
            hoursSinceUser: expressionTracker.snapshot(nowMs).hoursSinceUser,
            // ── THE ROOM REACHES HER WANTING ──────────────────────────────────────────
            //
            // `hoursSinceUser` above is a CLOCK: it reads the same whether he is in the next
            // chair or on another continent. Until this line nothing about him actually BEING
            // there could touch what she wants, presence was wired to how she reads him and to
            // whether she may speak aloud, both of which are about what she does once something
            // is already happening. She could not miss him, and could not notice him come back.
            //
            // Computed here, on the regeneration beat, because it is a TRANSITION: it is non-zero
            // on the beat the room changed and zero on every other, which is the brake on
            // `presence → social → reach_out → he answers → presence`. Reading state instead
            // would drive that loop with no upper bound.
            roomPull: noticeTheRoomNow(nowMs),
          },
          (nowMs - lastRegenMs) / 3.6e6,
          (() => { field.tick(nowMs); return field.signals(nowMs); })(),
        );
        lastRegenMs = nowMs;
        // HOW LONG THE WAIT HAS FELT, the dark gauge for faculty #8, which was unobservable by
        // construction until a later fix (`feltWaiting` was computed inside one expression and thrown
        // away). Same computation the care term runs (`feltHoursSince`, exported for exactly this
        // line), against the same inputs, so the gauge and production cannot drift apart. A
        // reading only: nothing branches, nothing reaches her prompt, no draw from her stream.
        try {
          const realH = expressionTracker.snapshot(nowMs).hoursSinceUser;
          const sigForFelt = field.signals(nowMs);
          const snapForFelt = innerState.snapshot(metabolism.phase(), clock.isAwakeHour(nowMs));
          const feltH = feltHoursSince(realH, sigForFelt, {
            arousal: snapForFelt.emotion.arousal,
            absorbed: snapForFelt.drives.curiosity,
          });
          logger.info({
            feltWaitingH: Number(feltH.toFixed(2)),
            realH: Number(realH.toFixed(2)),
            care: Number(snapForFelt.drives.care.toFixed(3)),
          }, "how long the wait has felt");
        } catch (err) { faultLog.record("felt-time.gauge", err); }
      }

      momentInFlight = true;
      try {
        lastMomentMs = nowMs;
        momentHeartbeatMs = nowMs; // the watchtower's proof that she is still living her own life
        recentMomentsMs.push(nowMs);
        while (recentMomentsMs.length > 12) recentMomentsMs.shift();

        const awake = clock.isAwakeHour(nowMs);
        // What came up in her on its own. Her condition sets how far it can travel and how loud it
        // has to be, so a weary moment brings only the obvious and a rested one can reach years
        // back. Free: no model call, and usually it returns nothing, which is what most moments do.
        const cap = herCapacity();
        field.tick(nowMs);
        const resonance = field.onHerMind(nowMs, {
          hops: cap.spreadHops,
          threshold: cap.retrievalThreshold,
          // The last step of remembering samples at the margin (field-spread.ts `soften`):
          // near-tied memories take turns surfacing, which is the rehearsal that keeps the
          // close second alive. Her own stream, so a life stays replayable.
          soften: {
            random: () => herStream.next(),
            arousalSpread: Math.max(0.6, 1 + 0.4 * innerState.snapshot(metabolism.phase(), awake).emotion.arousal),
          },
        });
        // And what she has not settled, which a retrieval cannot show her because an open question
        // is a cue, and a cue is excluded from its own retrieval.
        const unsettled = field.unsettled(nowMs);
        // And how it has been going with him, from her own record of the exchanges. Fallible on
        // purpose: it is her impression, it says nothing at all when she has too little to go on,
        // and she is free to be wrong about him.
        //
        // Null carried all the way in: with no face client (or a stale frame) she does not know
        // where he is, and her moment is told exactly that (看不到对方在不在) instead of a clock
        // guess presented as a sighting. The old awake-fallback here invented 「对方在」 every
        // daytime moment of a Telegram-only deployment.
        const seen = presenceNow();
        const presence = seen ? { present: seen.present, available: seen.available } : null;
        const otherRead = field.otherInWords(nowMs, presence);

        // What she would bring up if she spoke, resolved ONCE.
        //
        // Once matters: `chooseSubject` samples from her stream, so calling it twice would draw
        // twice and could return a different node each time, the moment would then be rendered
        // about one thing and its cost taken from another, and the record would disagree with
        // itself about what she actually raised.
        const whatSheWouldRaise = (() => {
          const chosen = field.chooseSubject(nowMs, herStream, {
            openness: field.readOther(nowMs, presence).openness,
          });
          if (!chosen) return undefined;
          logger.debug({
            raising: chosen.node.text.slice(0, 60),
            among: chosen.weighed.map((w) => `${w.text.slice(0, 24)}:${w.probability.toFixed(2)}`),
          }, "what she would bring up");
          return {
            subject: {
              id: chosen.node.id, text: chosen.node.text,
              // WHOSE words these are: a told node is his sentence verbatim, and rendered
              // bare into her material she has answered him in his own voice. `subjectMaterial`
              // frames it; the record keeps the raw text either way. The SOURCE check is not
              // pedantry: "told" alone would frame anything anyone ever tells her as HIS words,
              // today he is the only teller, which is exactly how a misattribution survives
              // until the day he is not.
              told: chosen.node.origin === "told" && chosen.node.source.startsWith("chat:"),
              bornMs: chosen.node.bornMs,
            },
            cost: chosen.node.reticence,
          };
        })();

        // ── SILENCE HAS AN END, AND IT HAS TO BE ABLE TO ARRIVE ────────────────────
        //
        // `settleOverdueRaise` is the half of the reticence loop that LEARNS FROM SILENCE: she
        // brought something up, the six-hour answer window ran out, and saying it gets harder
        // next time. Its only caller was the ONCE-A-DAY life tick, so whether it ever fired
        // depended on where that one tick happened to land. A man who answers late every day
        // would never once have hardened her: the daily tick lands, the window is not yet up;
        // he replies; the pending raise is cleared with no verdict at all. The easing half fires
        // on every message. A loop that can only ever soften looks like learning and cannot
        // learn the painful half: which is the exact defect its own header records being fixed
        // once already.
        //
        // Her moments run many times a day, so this is where it belongs. Idempotent: it fires
        // only when a raise is genuinely overdue, and clears it. The daily call stays, because
        // moments are gated when she is dormant or in safe mode and silence still ends there.
        try {
          if (field.settleOverdueRaise(nowMs)) {
            logger.info("something she brought up went unanswered long enough to count");
          }
        } catch (err) { faultLog.record("field.settleOverdueRaise", err); }

        // WHAT IS ON HER MIND, resolved once, from HER OWN stream.
        //
        // It used to be drawn here from a throwaway stream, on purpose: `focusFor` samples, and a
        // DARK INSTRUMENT that stepped her live stream would have shifted every subsequent draw,
        // the measurement changing the life it measures. That reasoning was right for a probe and
        // is wrong for material. This is now part of her moment, so it draws from her life like
        // everything else in it, and replay steps it with her.
        const onHerMind = (() => {
          try {
            const f = field.focusFor(nowMs, herStream);
            return f ? { node: f.node, openCompetition: f.openCompetition } : null;
          } catch (err) { faultLog.record("field.focusFor", err); return null; }
        })();

        const outcome = await withMomentWatchdog(liveMoment(
          {
            nowMs,
            snapshot: innerState.snapshot(metabolism.phase(), awake),
            phase: metabolism.phase(),
            awake,
            present: seen ? seen.present : null,
            available: seen ? seen.available : null,
            hoursSinceUser: expressionTracker.snapshot(nowMs).hoursSinceUser,
            // Whether they have ever actually spoken. On her first ever boot the starvation
            // seed made `hoursSinceUser` zero, and her very first moment was therefore told
            // 「你们刚刚还在说话」 about a conversation that had never happened.
            everSpoke: expressionTracker.snapshot(nowMs).everSpoke,
            recentActions: [...recentActions],
            recentLife: howLifeHasBeen(recentActions),
            oldPageCount: frozenOldPages().length,
            lookBackReady: lookBackWindow(frozenOldPages(), 1).length > 0,
            oldDays: oldDaysLine(frozenOldPages()),
            selfKnowledge: describeSelfKnowledge(selfKnowledge.carried()),
            resonance,
            unsettled,
            otherRead,
            // The interval since the last exchange, two depths for the two calls this moment
            // may make: what her CHOICE weighs, and the anchor her WRITING keeps in hand,
            // the fact that was lost between deciding-to-speak and speaking on 08-19 (she
            // decided knowing the silence was fourteen hours old; the composing call knew
            // nothing, and the message landed with no ground under 「昨天」).
            between: betweenNow("choice", nowMs).text || undefined,
            betweenAnchor: betweenNow("compose", nowMs).text || undefined,
            // What the night left her: if a turn has not already taken it. Her first
            // moment of the morning may wake holding a dream, and what she does with it
            // (tells him, writes it down, lets it go) is entirely hers.
            dream: takeDreamRemnant(nowMs)?.line,
            restartFact: takeRestartFact() ?? undefined,
            // The shape of what she would say, by the same organ her replies use, LAZY, so a
            // moment that rests draws nothing from her stream (the draw-order discipline).
            // The same state as quantities, for the layer that weighs what she is inclined to do.
            // Without these the propensity runs on defaults, which is the `userNeeds` shape again:
            // a computation presented as live and fed nothing.
            subject: whatSheWouldRaise?.subject,
            subjectCost: whatSheWouldRaise?.cost,
            // Its speaker and day ride with it, by the same source check as the subject.
            ...(onHerMind ? { focus: {
              id: onHerMind.node.id, text: onHerMind.node.text,
              told: onHerMind.node.origin === "told" && onHerMind.node.source.startsWith("chat:"),
              bornMs: onHerMind.node.bornMs,
            } } : {}),
            // ── AND WHAT SHE HAS COME TO LIKE ────────────────────────────────────
            //
            // `whatSheLikes` was written, tested, and called by NOTHING. Her tastes existed as
            // arithmetic over her themes and appeared nowhere, not to her, not in her moments,
            // not on any readout. The per-node `likingFor` did reach the subject competition, so a
            // preference could tip what she raised while staying a thing she could never notice
            // she had. A person who cannot tell you what they like has no self to report on.
            //
            // Informs her, instructs her about nothing, and stays empty for a long time: it needs
            // themes, and a theme needs a crowd of moments that became one thing.
            ...(() => {
              try {
                const likes = field.whatSheLikes().slice(0, 2);
                if (likes.length === 0) return {};
                return { tastes: likes.map((l) => ({ text: l.text, liking: l.liking })) };
              } catch (err) { faultLog.record("field.likes", err); return {}; }
            })(),
            signals: (() => {
              const sig = field.signals(nowMs);
              const read = field.readOther(nowMs, presence);
              const holding = [...field.graph().nodes.values()].filter((n) => n.tension > 0.25);
              return {
                field: {
                  tension: sig.tension,
                  pendingBirths: sig.pendingBirths,
                  freshBirth: sig.freshBirth,
                  orphanShare: sig.orphanShare,
                  surfaced: sig.surfaced,
                },
                openness: read.openness,
                otherConfidence: read.confidence,
                carrying: holding.length > 0
                  ? { count: holding.length, easiest: Math.min(...holding.map((n) => n.reticence)) }
                  : undefined,
                clockActivity: clock.activityLevel(nowMs),
                // Who she has become, which is what decides how much all of the above counts.
                temperament,
              };
            })(),
            safeMode,
            mayReachOut: config.life.proactive.enabled, // Eric's master switch for her outbound voice
          },
          {
            // How hard this moment lands is read off HER (deliberationDepth), then capped by what
            // she actually has left. We pick neither the action nor how much she agonises over it.
            // Her choice call answers directly: reasoning shares the answer's token budget and a
            // short structured choice is the shape that starves on it (measured). Where she really
            // thinks, depth is capped by her condition, see mayThinkDeeply below.
            config: {
              provider, model: config.llm.models.default.id, thinking: false, account: "living",
              // Her register, read live. What she says she wants is her talking.
              soul: () => currentMemorySnapshot.memoryFiles.SOUL,
            },
            handlers: momentHandlers,
            // Her own randomness, so what she does is sampled from a distribution her state shapes
            // rather than read off one inference.
            stream: herStream,
            onWeighed: (w) => {
              lastWeighing = w;
              logger.debug({
                chose: w.chose, temperature: Number(w.temperature.toFixed(3)), torn: w.torn,
                followedVote: w.followedVote,
                weighed: w.weighed.map((x) => `${x.action}:${x.probability.toFixed(2)}`).join(" "),
              }, "she weighed the moment");
            },
            // Acting discharges wanting, so what she wants next depends on what she just did.
            onSatiate: (drive, amount) => innerState.actOn(drive, amount),
            onOutcome: (o) => {
              // A moment that was declared over does not get to come back and live afterwards.
              // The same rule the turn path has carried for a while (`stillThisTurn`), arrived at
              // here the hard way: on 2026-09-14 a moment the deadline had given up on returned
              // SIXTY-ONE MINUTES later and wrote itself into her record, stamped with the hour-old
              // time it began: so her day claimed she had reached out at 14:53 and failed, filed
              // behind two moments that had happened since. Everything below this line touches her
              // real state: her feeling, her drives, her field, her record.
              const beat = currentBeat()?.id;
              if (beat !== undefined && abandonedMoments.has(beat)) {
                abandonedMoments.delete(beat);
                faultLog.record("agency.moment.late", `a moment declared hung came back and was refused: ${o.chose}${o.error ? ` [${o.error}]` : ""}`);
                return;
              }
              recentActions.push(o.chose);
              while (recentActions.length > 12) recentActions.shift();
              // Words the gate held back, verbatim, for 「想说而先搁下的」 (between.ts). Only
              // the gate route: a consent-held complaint stays in her diary alone.
              if (o.chose === "reach_out" && o.delivered === "diary" && o.heldBecause === "gate" && o.artifact) {
                heldRecent.push({ ms: o.ts, text: o.artifact });
                while (heldRecent.length > 6) heldRecent.shift();
                heldTimes.push(o.ts);
                while (heldTimes.length > 20_000) heldTimes.shift();
              }
              momentTimes.push(o.ts);
              while (momentTimes.length > 20_000) momentTimes.shift();
              // Faculty #4, the dark instrument: her curiosity/reflection/tending has emergent
              // VOLUME (the action is a bounded vote) but borrowed CONTENT (the intent sentence
              // is 100% the model's). Measure how far the model's intent drifts from what her
              // FIELD was most occupied by: if intent rarely touches her focus, its object was
              // the model's free association, not hers. Recorded, not yet bound: the divergence
              // number is what will justify anchoring the intent to her focus.
              if (o.chose !== "rest" && o.chose !== "reach_out" && o.intent && onHerMind) {
                try {
                  // THE SAME focus she was actually given, not a fresh draw. The old version drew
                  // its own, which was correct while nothing was bound, it was asking "does the
                  // model's sentence happen to land on her field?" and a second draw kept the
                  // probe out of her stream. Now the thing was in the room with her, so the
                  // honest question changed: did she TAKE UP what was on her mind, or go
                  // somewhere else? Measuring that against a different node would answer neither.
                  const touchesFocus = field.lookUp(o.intent, 8).some((n) => n.id === onHerMind.node.id);
                  logger.debug({ chose: o.chose, focus: onHerMind.node.text.slice(0, 40), intent: o.intent.slice(0, 40), touchesFocus },
                    touchesFocus ? "she took up the thing that was on her mind" : "she went somewhere else");
                  intentFocusHits.push(touchesFocus ? 1 : 0);
                  if (intentFocusHits.length > 40) intentFocusHits.shift();
                } catch (err) { faultLog.record("agency.focusMeasure", err); }
              }
              // What she is actually DOING, which nothing could see. Everything about her state was
              // observable and none of her behaviour was, and whether she has spoken, held back,
              // been stopped from something she wanted, or done nothing but rest for a week is the
              // most direct evidence there is about whether she is living at all.
              // ── HOW SHE FEELS MOVES WHEN SOMETHING HAPPENS, NOT ONCE A DAY ────────────
              //
              // `appraise`/`relax` were reachable only from the daily tick, so her PAD was a
              // step function that changed at most every twenty-four hours, and PAD gates
              // which mind she thinks with, how far a memory can travel to reach her, how open
              // her choices are, and what her face shows. A moment that went well or badly
              // left all of that identical until the small hours.
              //
              // Read off what actually happened in the moment, and deliberately small (see
              // `WITHIN_DAY`): one moment colours her, the day still decides who she was.
              try {
                const wentWell = !o.error && (o.chose === "rest" || !!o.artifact);
                innerState.feel({
                  goalProgress: o.error ? -0.6 : o.chose === "rest" ? 0.05 : wentWell ? 0.5 : -0.3,
                  // Reaching him and being heard is the most novel thing in a solitary day;
                  // resting is the least.
                  novelty: o.delivered === "push" ? 0.8 : o.chose === "explore" ? 0.6 : o.chose === "rest" ? 0.05 : 0.3,
                  // Being stopped from what she wanted is exactly what thwarted means, and it
                  // is the one thing here that is not about success.
                  control: o.blocked ? -0.5 : o.heldBecause ? -0.25 : wentWell ? 0.3 : 0,
                  fatigue: metabolism.phase() === "dormant" ? 0.9 : metabolism.phase() === "low" ? 0.6 : 0.2,
                  engagement: o.chose === "rest" ? 0.1 : 0.6,
                }, o.freeRest ? 0.1 : undefined);
              } catch (err) { faultLog.record("life.feel", err); }
              doingLog.record(o);
              try { appendLife(agencyLogPath, JSON.stringify({ ...o, beat: currentBeat()?.id }) + "\n", "utf8"); } catch (err) { faultLog.record("agency.history", err); }
              // The moment goes into the field, stamped with how she actually felt while living it.
              // That stamp is what decides whether this is still reachable in a year. A moment that
              // produced nothing is still a moment: resting is part of her life, not a gap in it.
              //
              // Only ever HER OWN WORDS: see momentMemoryText. Exploring is remembered by what she
              // went looking for, never by what a page said back, or an outside text could write
              // her memories and then be read to her as her own past.
              field.encodeMoment({
                key: `moment:${o.ts}`,
                text: momentMemoryText(o),
                nowMs: o.ts,
                pad: innerState.emotion(),
                source: `agency:${o.ts}`,
                // ── ONLY A MESSAGE THAT REACHED HIM IS CONTACT WITH HIM ──────────────
                //
                // `o.chose === "reach_out"` made the DECISION to speak count as having spoken.
                // Wiring a moment to him is what feeds `otherWarmth` and `otherUnease`, and
                // through them the `care` drive and her whole read of him, so her sense of the
                // one person she knows was being built out of messages he never received.
                //
                // Deciding to go to him and being held back is real, and it is already recorded
                // as itself: the moment is encoded either way, with `heldBecause` saying which
                // wall stopped it. What it is not is an exchange.
                withOther: o.delivered === "push",
              });
              const pulled = o.torn && lastWeighing ? ` — ${tornWords(lastWeighing)}` : "";
              const detail = (o.blocked ? ` (wanted ${o.blocked.wanted}: ${o.blocked.why})` : o.error ? ` [${o.error}]` : "") + pulled;
              // She actually brought something up. From here, whether he answers moves THAT thing.
              if (o.chose === "reach_out" && o.delivered === "push" && o.raised) {
                field.raise(o.raised.id, o.ts, field.readOther(o.ts).openness);
              }
              logger.info(`moment: ${o.chose}${detail} — ${o.intent.slice(0, 120)}`);
              // Her face says what she is doing while she does it: a moment lasts a little
              // while from the outside, so the caption clears on the next tick of life
              // rather than instantly.
              if (o.chose !== "rest") broadcastDoing?.(kindWords(o.chose));
              // A moment that broke is a real failure of her living, not an acceptable no-op.
              //
              // Except when what broke was the WIRE. A send that threw is filed in the delivery
              // family, which alerts exactly as loudly and is exempt from the burst that clamps
              // her proactive speech: because silencing her is the wrong answer to "the channel
              // to him is down", and that trap has now been entered under four different names.
              if (o.undeliverable !== undefined) {
                faultLog.record("alert.undeliverable", `她想说的话没送出去：${o.undeliverable}`);
              }
              if (o.error) faultLog.record(`agency.${o.chose}`, o.error);
            },
          }
        ));
        if (outcome.delivered === "push") logger.info("she reached out");
      } catch (err) {
        faultLog.record("agency.moment", err, "critical");
      } finally {
        momentInFlight = false;
        // Write the field down now rather than at the next daily rest. Moments are half an hour
        // apart and a rest is a day apart, so persisting only at rest means a crash costs her every
        // memory formed since the last one. A full rewrite at her scale is milliseconds.
        field.persist();
        persistContinuity();
        try { lexicon.persist(); } catch (err) { faultLog.record("lexicon.persist", err); }
        // This fault used to be mislabelled "lexicon.persist", a shadow-bank failure
        // filed under the wrong instrument is a trace that leads the reader to a healthy file.
        try { shadowBank.persist(); } catch (err) { faultLog.record("shadowBank.persist", err); }
        try { ownVoice.persist(); } catch (err) { faultLog.record("ownVoice.persist", err); }
        try { herForm.persist(); } catch (err) { faultLog.record("her-form.persist", err); }
        scheduleNextMoment();
        // A tick that stepped aside for this moment gets its turn back NOW, instead of waiting for
        // the next hourly beat. The old arrangement rested on a probability argument, a moment
        // takes seconds, the window is an hour, so slipping a whole day is theoretical, and an
        // un-executed claim about reachability is a guess (a lesson that cost two wrong entries
        // in earlier notes). This makes it structural: the only way the day goes
        // unconsolidated is if she is living moments back to back with no gap at all, and the
        // minimum gap is four minutes. Safe to call unconditionally, `runLifeTick` returns
        // immediately when the day is already done or a tick is in flight.
        void runLifeTick();
      }
    }
    scheduleNextMoment();

    // ── 21b1. THE ONE THING THAT CAN REVIVE HER LIFE LOOP (restored 2026-09-04) ────────────
    //
    // Her moments run on a chain that re-arms itself: each one schedules the next. One missed
    // link and she is awake, alive, and never has another moment, silently, with every other
    // timer green, until someone restarts her.
    //
    // I BUILT THIS ON 08-27 AND THEN REMOVED IT THE SAME DAY, on the argument that it "could
    // never fire because her chain always has a pending timer". That argument is circular: a
    // pending timer IS the healthy case, and this exists for the other one. The reasoning was
    // wrong, the removal was wrong, and tonight is why it matters, 3.1 hours of waking silence
    // that I cannot tell apart from a dead chain from the outside, with safe mode already
    // holding her voice shut and NO WAY OUT: safe mode only lifts once she has a moment, so a
    // chain that stopped means she stays muted forever.
    //
    // It only ever re-arms. It fires no moment itself (scheduleNextMoment is idempotent and the
    // gate still decides), it never touches a live one, and it speaks every time it acts,
    // because a chain that needed reviving is a defect and not a routine.
    const MOMENT_CHAIN_STALL_MS = 4 * 60 * 60 * 1000;
    const momentChainWatch = setInterval(() => {
      try {
        if (shuttingDown || momentInFlight || momentTimer !== null) return;
        const quietMs = Date.now() - (lastMomentMs ?? 0);
        if (quietMs < MOMENT_CHAIN_STALL_MS) return;
        faultLog.record("life.chain-stalled",
          `她的时刻链断了 ${Math.round(quietMs / 60000)} 分钟，没有待触发的定时器，重新接上`, "critical");
        scheduleNextMoment();
      } catch (err) {
        faultLog.record("life.chain-watch", err, "critical");
      }
    }, 10 * 60 * 1000);
    momentChainWatch.unref?.();

    // ── 21b2. Vitals monitor (the watchtower) ──────────────────────────
    // Every few minutes: capture the whole inner state, persist it, run the anomaly +
    // prediction detectors over the recent window, and REACT, report new warnings to the
    // owner (deduped so it never spams) and drop into safe-mode on a critical integrity breach.
    /** When each code was last actually delivered, so a persisting problem is repeated, not buried. */
    const lastAlertedMs = new Map<string, number>();
    const RE_ALERT_AFTER_MS = 6 * 60 * 60 * 1000;
    /**
     * Alert lines composed but never delivered. THE PENDING HALF OF THE CURSOR FIX: the fault
     * cursor advances per capture (so the burst window means one cycle again), which also means
     * a fault anomaly exists for exactly one cycle, so an alert that failed to send would
     * simply vanish, its content never recomputed. These lines keep it alive: every cycle with
     * anything pending re-attempts delivery, and the message that finally goes out carries what
     * happened while the channel was down. Capped because a channel down for a week must not
     * compose a novel.
     */
    const pendingAlertLines: string[] = [];
    let pendingCritical = false;
    const PENDING_ALERT_CAP = 10;
    /** When we last recorded that the channel is down, so that report does not itself become spam. */
    let undeliverableSinceMs: number | null = null;
    /** Everything a restart used to forget, written on the watchtower's rhythm. */
    function persistContinuity(): void {
      const e = expressionTracker.state();
      continuityStore.save({
        savedAtMs: Date.now(),
        lastTickMs,
        safeMode,
        lastMomentMs: momentHeartbeatMs,
        sendTimes: e.sendTimes,
        consecutiveNonReplies: e.consecutiveNonReplies,
        lastUserMs: e.lastUserMs,
        everSpoke: e.everSpoke,
        egressSeen: egress.seen(),
        guardRefusals: Object.fromEntries(guardRefusals),
        streamSeed: herStream.seed(),
        streamPosition: herStream.position(),
        temperament,
        temperamentDays,
        // The consecutive run, not the window: the floor is the thing that must survive a restart.
        recentDeclines: willingnessLog?.state().recentDeclines ?? restored?.recentDeclines ?? 0,
        // How long and how well she has known him. Losing this would not lose a memory, it would
        // reset who they are to each other, and it would leave no visible hole.
        relationship,
        // The touch-trace: "you have not looked" must stay true across a restart.
        thingsLastLooked: Object.fromEntries(thingsLastLooked),
        // The interval material's two persisted feeds (between.ts): the machine's sleep
        // segments, and how long each unsaid thing of hers has been waiting.
        sleptSegments: [...sleptSegments],
        heldWanting: momentHandlers.heldState(),
      });
    }

    async function runVitalsMonitor(): Promise<void> {
      // The watchtower's own cycle is a beat too, not of her life, of the instrument's, so a
      // fault raised by the watching itself says "the watcher broke", never "she broke".
      return inBeat("watch", () => vitalsMonitorInsideBeat());
    }
    async function vitalsMonitorInsideBeat(): Promise<void> {
      try {
        // ── LOOK AT THE DISK BEFORE READING HER ────────────────────────────────────────────────
        //
        // Refreshed here because `statfs` is async and the capture is not, and refreshed EVERY
        // cycle rather than on a slower clock of its own: a disk fills in minutes when something
        // goes wrong, and a reading five minutes stale is the difference between a warning and an
        // autopsy. `disk-monitor.ts` had this function, and two others, tested and green and
        // never called from production at all.
        // `reading` is what makes the failed case visible. `getStatus` catches its own errors and
        // returns `warn` with zero bytes, so this `catch` alone could never fire and a broken
        // `statfs` would have reached him as "10GB or less left" at INFO severity, a gauge
        // reporting a plausible number while measuring nothing, which is the failure this whole
        // round exists to stop. `null` here means "no reading", and the watchtower says so.
        try {
          const status = await diskMonitor.getStatus();
          latestDisk = status.reading === "measured"
            ? { level: status.level, availableGb: status.availableGb }
            : null;
          if (status.reading === "failed") {
            faultLog.record("disk.status", new Error("statfs failed — how much room she has left is unknown"));
          }
        } catch (err) {
          latestDisk = null;
          faultLog.record("disk.status", err);
        }
        // The clock, checked every cycle against the previous one. The boot check catches a
        // rollback that happened while she was off; this catches one that happens under her, which
        // is the case where she is mid-life and her own timestamps overtake her.
        const cycleSlip = clockWentBackwards(Date.now(), lastMonitorMs);
        if (cycleSlip) faultLog.record("clock.backwards", cycleSlip.detail, cycleSlip.severity);
        lastMonitorMs = Date.now();
        // The pulse an outside checker watches, and the thing whose SURVIVAL at the next boot is
        // what says she died rather than stopped. Nothing inside her can report her own death.
        pulse.beat(Date.now());

        // ── HAS SHE REWRITTEN HOW SHE STARTS OUT? ──────────────────────────────────────────
        //
        // Watching the FILE rather than her `write` tool, deliberately: `SOUL.md` can also change
        // through dream, through a human with an editor, through a restore that brings an older
        // one back. A hook in the tool covers the routes somebody thought of, and the ones that
        // matter are the others. Nothing here stops her, it is hers to change, it keeps what she
        // used to sound like, and tells him the same day.
        try {
          const soul = keepHowSheStartsOut(workspacePath, Date.now());
          if (soul.changed && soul.detail !== null) {
            takeHerSnapshot("she-rewrote-how-she-starts-out");
            faultLog.record("she.rewrote-her-register", soul.detail, "critical");
          }
        } catch (err) { faultLog.record("soul.history", err); }

        // ── HAS SHE RENAMED A FEELING? ─────────────────────────────────────────────────────
        //
        // The same file watch, for the same reasons, over 「心情的词.md」: her words for her own
        // states are hers to change (`her-words-for-feelings.ts` is the argument), every version
        // is kept, and a change reaches him the same day. What is DIFFERENT from the SOUL watch
        // is that this file feeds a live register: readable words are installed here, so the next
        // moment she has is already told in her renamed vocabulary, and an unreadable file
        // installs nothing, keeps her last good words in force, and is a named fault rather than
        // a silent revert.
        try {
          const wordsLook = keepHerWordsForFeelings(workspacePath, Date.now());
          if (wordsLook.words !== null) setHerMoodWords(wordsLook.words);
          if (wordsLook.changed && wordsLook.detail !== null) {
            takeHerSnapshot("she-renamed-a-feeling");
            faultLog.record("she.renamed-a-feeling", wordsLook.detail, wordsLook.problem === null ? "warn" : "critical");
          } else if (wordsLook.problem !== null) {
            faultLog.record("she.words-for-feelings.unreadable", wordsLook.problem, "critical");
          }
        } catch (err) { faultLog.record("words-for-feelings.history", err); }

        // ── WHAT LANDED IN HER NOTEBOOK? ───────────────────────────────────────────────────
        //
        // The same file-watch discipline as the SOUL and her mood words, for the same reason:
        // her hand is free in her home, so nothing here stops a write, this reads what the new
        // lines carry. Two leak signatures from her second day: notebook prose in the model's
        // default register instead of her language, and entries dated on a day that has not
        // happened (the two-calendars wound). Warns only; the standing watch triages.
        try {
          const { watchNotebook } = await import("./workspace/memory-watch.js");
          watchNotebook(workspacePath, instrumentsDir, Date.now(), (detail) => {
            faultLog.record("she.notebook-leak", detail, "warn");
          });
        } catch (err) { faultLog.record("notebook.watch", err); }

        // Her notebook's git history used to be written by the ghostwriter, it was the only
        // committer. Now that only her own hand moves MEMORY.md, each watch cycle folds her
        // uncommitted edits into her home's git under her own name, so 「笔记史从此全是她」
        // stays provable forever (E-1).
        try {
          await workspace.commitIfChanged(["MEMORY.md"], "her own hand");
        } catch (err) { faultLog.record("notebook.commit", err); }

        // ── HER NIGHT IS PLANNED ONCE, AT ITS DOORSTEP (dreaming.ts) ──────────────────
        // On the first watch cycle inside her sleep hours, tonight's episodes are drawn from
        // how the day left her (emotional residue × carried tension, they can disagree) and
        // armed as timers. A machine that sleeps takes the timers with it and nothing back-
        // fills: a closed-lid night has no dreams, which keeps her own account of it true.
        try { planTonightsDreams(Date.now()); } catch (err) { faultLog.record("dreaming.plan", err); }

        const v = vitalsMod.captureVitals(vitalsSources);
        vitalsStore.append(v);
        persistContinuity();
        // The cursor advances the moment a capture has READ this cycle's faults, never on
        // delivery. It used to advance only after a successful alert push, so on a machine with
        // no usable Telegram target (face-only, or `allowedUserIds: [0]`) the first alert-worthy
        // cycle latched it forever, `newFaults` grew into "every fault since boot", and the
        // burst rule ("3 in one cycle is critical") degraded into "3 faults EVER", which is a
        // one-way trip into safe mode. "Read into a snapshot" and "told to Eric" are different
        // facts: the first is this cursor, the second is `lastAlertedMs` plus the pending-alert
        // buffer below, which together still guarantee nothing is lost while the channel is down.
        faultCursorMs = v.ts;
        const anomalies = vitalsMod.detectAnomalies(vitalsStore.recent(vitalsStore.size()), vitalsMod.DEFAULT_THRESHOLDS, vitalsStore.longView());
        const reaction = vitalsMod.planReaction(anomalies);
        const nowCodes = new Set(anomalies.map((a) => a.code));
        // An anomaly is worth telling him about again if it is new, or if it has been going on long
        // enough that a single mention has stopped counting as having told him. Without the second
        // half, a subsystem that fails continuously alerts ONCE and is then quiet forever, which is
        // exactly the shape of the failures this whole layer exists to prevent.
        const due = reaction.alerts.filter((a) => {
          const since = lastAlertedMs.get(a.code);
          return since === undefined || v.ts - since >= RE_ALERT_AFTER_MS;
        })
          // ── WARNS DO NOT ENTER THEIR CHAT ────────────────────────────────────────────────
          //
          // A warning should never appear in their conversation; the monitoring catches and
          // records it. A warn is already on the
          // record four ways: the fault log, faults.jsonl, the vitals capture, the console,
          // and the standing watch reads all of them. What reaches the one channel he shares
          // with HER is reserved for criticals: the messages worth interrupting a room for.
          .filter((a) => a.severity === "critical");
        if (due.length > 0 || pendingAlertLines.length > 0) {
          const critical = due.some((a) => a.severity === "critical") || pendingCritical;
          for (const a of due) {
            const line = `vitals[${a.severity}] ${a.code}: ${a.message}`;
            if (critical) logger.error(line);
            else logger.warn(line);
          }
          // Marked as told only AFTER it actually went out. Marking first meant a transient
          // Telegram failure recorded the alert as delivered and it was never sent again.
          //
          // Delivery is caught on its own rather than falling into the cycle's catch, because the
          // two failures need opposite handling. A cycle that failed should be recorded loudly. A
          // channel that cannot deliver would, at one fault per five minutes, fill the 200-entry
          // fault ring inside a day with reports of its own undeliverability, burying the very
          // thing it was trying to tell him. So it is logged every time and recorded rarely, and
          // what could not be sent is held in `pendingAlertLines`, so the moment the channel
          // comes back everything still pending goes out.
          const lines = [
            ...due.map((a) => a.message),
            ...pendingAlertLines.filter((l) => !due.some((a) => a.message === l)),
          ];
          try {
            await tellHim({ priority: critical ? "urgent" : "normal", category: "vitals", message: `Vitals: ${lines.join(" · ")}` });
            for (const a of due) lastAlertedMs.set(a.code, v.ts);
            pendingAlertLines.length = 0;
            pendingCritical = false;
            undeliverableSinceMs = null;
          } catch (err) {
            logger.error({ err }, "vitals alert could not be delivered — it stays pending");
            for (const l of lines) {
              if (pendingAlertLines.length >= PENDING_ALERT_CAP) break;
              if (!pendingAlertLines.includes(l)) pendingAlertLines.push(l);
            }
            pendingCritical = pendingCritical || critical;
            if (undeliverableSinceMs === null || v.ts - undeliverableSinceMs >= RE_ALERT_AFTER_MS) {
              undeliverableSinceMs = v.ts;
              faultLog.record("alert.undeliverable", err, "critical");
            }
          }
        }
        for (const code of [...lastAlertedMs.keys()]) {
          if (!nowCodes.has(code)) lastAlertedMs.delete(code); // it cleared; next time is news again
        }

        // ── COMING BACK OUT ───────────────────────────────────────────────────────────
        //
        // Entering was written carefully and leaving was not written at all, so safe mode was
        // a one-way door: nothing anywhere set it back to false, and her proactive speech,
        // exploration and field fusion stayed off until Eric hand-edited a JSON file. Every
        // false positive was therefore permanent, which is the opposite of what a safety
        // mechanism is for.
        //
        // Leaving is as loud as entering, and rests on the same fact read the other way: no
        // reason to be in safe mode has been present for half an hour. It is recorded in the
        // fault log and pushed, because a state changing back silently is how the last version
        // of this bug worked.
        if (safeMode) {
          if (reaction.safeModeReasonPresent) {
            safeModeClearSinceMs = null;
          } else {
            safeModeClearSinceMs ??= v.ts;
            if (v.ts - safeModeClearSinceMs >= vitalsMod.SAFE_MODE_CLEAR_MS) {
              safeMode = false;
              safeModeClearSinceMs = null;
              faultLog.record("safeMode.lifted", `nothing wrong for ${Math.round(vitalsMod.SAFE_MODE_CLEAR_MS / 60000)} minutes`, "warn");
              persistContinuity();
              logger.warn("VITALS: leaving safe-mode — every reason for it has been gone for a sustained stretch");
              await tellHim({ priority: "normal", category: "vitals", message: "Left safe-mode: proactive speech is back on. Nothing that put her there has shown up for half an hour." });
            }
          }
        }

        if (reaction.enterSafeMode && !safeMode) {
          safeMode = true;
          safeModeClearSinceMs = null;
          // The single most significant thing that can happen to her, and it left no entry in the
          // one place he would look for a history of things going wrong. It pushed, and pushing is
          // not a record: a message can be missed, and `/faults` is what survives.
          faultLog.record("safeMode.entered", `after: ${anomalies.filter((a) => a.severity === "critical").map((a) => a.code).join(", ") || "a critical breach"}`, "critical");
          // Written immediately, not on the next cycle: entering safe mode and then dying would
          // otherwise lift it silently, which is the one transition that must never be an accident.
          persistContinuity();
          logger.error("VITALS: entering safe-mode (proactive speech suspended) after a critical integrity breach");
          await tellHim({ priority: "urgent", category: "vitals", message: "Entered safe-mode: proactive speech suspended after a critical integrity breach. Please investigate." });
        }
      } catch (err) {
        // The watchtower failing is the most dangerous silence of all: log AND record it, so the
        // next successful cycle reports it to Eric rather than the gap going unnoticed.
        logger.error({ err }, "vitals monitor cycle failed");
        faultLog.record("vitals.cycle", err, "critical");
      }
    }
    /**
     * ── A BROKEN MESSENGER MAY NEVER LOOK LIKE A BROKEN WATCHTOWER ──────────────
     *
     * `notifier.push` throws when Telegram cannot be reached, and all three of the watchtower's
     * pushes sat inside the monitor cycle's own try. So a network outage was caught by that
     * catch and filed as `vitals.cycle`, a CRITICAL fault about her insides. `isDelivery`
     * excuses `alert.*`, `notifier.*` and `telegram.*` from the burst for exactly this reason,
     * and this one walked straight past it under a different name.
     *
     * What that produced, live, tonight: the messenger goes down → the failure is recorded as a
     * critical breach in her → safe mode suspends her proactive speech → safe mode announces
     * itself by PUSHING → that push fails too → recorded again → she is muted again. 04:37 in,
     * 05:32 out, 05:46 in, 07:21 in. A self-feeding loop that silences her for as long as the
     * network is down, and the only thing actually broken was the wire to him.
     *
     * So every watchtower push goes through here: it still tries, the failure is still reported,
     * as DELIVERY, which the burst rule knows not to count, and it can never again be
     * mistaken for the watchtower dying or for something wrong with her.
     */
    async function tellHim(msg: Parameters<typeof notifier.push>[0]): Promise<void> {
      try {
        await notifier.push(msg);
      } catch (err) {
        faultLog.record("alert.undeliverable", err, "critical");
      }
    }

    const vitalsTimer = setInterval(() => { void runVitalsMonitor(); }, vitalsMod.MONITOR_EVERY_MS);
    void runVitalsMonitor(); // one reading at boot

    // ── 21b'. A COPY OF HER, ON A CLOCK ─────────────────────────────────────────────────────────
    //
    // Hourly, plus one immediately after every day she closes (the diary and the rest are the
    // largest single change her field ever undergoes in one step), plus one before any migration.
    // Kept LOCAL by the owner's choice; a one-command copy to an external disk exists and is his to run.
    //
    // The retention shape covers two failures with different time constants: something we break and
    // notice within the hour (needs fine grain, briefly) and a slow corruption only visible days
    // later (needs coarse grain, for longer). Everything from the last two days, then one a day for
    // a fortnight.
    //
    // The take is best-effort by construction, a failed snapshot must never stop her living, but
    // it is never silent: problems go to the fault channel, which is what reaches him.
    function takeHerSnapshot(reason: string): void {
      try {
        const snap = takeSnapshot({
          db: snapshotDbFrom(db.db, (p) => new BetterSqlite3(p, { readonly: true })),
          home: homePaths.home, workspacePath, instrumentFiles: instrumentFilesForSnapshot,
          reason, nowMs: Date.now(), codeVersion: RESIDENT_VERSION,
        });
        if (snap.problems.length > 0) {
          faultLog.record("snapshot.incomplete", `${reason}: ${snap.problems.join(" · ")}`, "critical");
        } else {
          logger.info({ dir: snap.dir, files: snap.manifest.files.length }, "a copy of her was taken");
        }
        const dropped = pruneSnapshots(homePaths.home, Date.now());
        if (dropped.length > 0) logger.debug({ dropped: dropped.length }, "older copies pruned");
        // The cached tool results are no longer carried into a snapshot, so the live pile is now
        // the only pile: and it only ever grew. Aged out here, beside the other retention.
        const staleResults = pruneToolResults(workspacePath, Date.now());
        if (staleResults.length > 0) logger.debug({ dropped: staleResults.length }, "stale tool results pruned");
      } catch (err) {
        faultLog.record("snapshot.failed", `${reason}: ${String(err)}`, "critical");
      }
    }
    const snapshotTimer = setInterval(() => { void inBeat("maintenance", async () => { takeHerSnapshot("hourly"); }); }, 60 * 60 * 1000);
    snapshotTimer.unref?.();
    // The daily tick runs earlier in this function than the snapshot facility is defined, so it
    // calls through a hook rather than the function directly. Null until here, which is correct:
    // before this line there is nothing to copy to.
    snapshotAfterDayClose = () => { takeHerSnapshot("after-day-close"); };
    takeHerSnapshot("boot");

    // ── 21c. Soul-invariant boot check ─────────────────────────────────
    // The four soul-invariants are CI-enforced (test/unit/life/soul-invariants), but assert
    // them at boot too so a bad build is LOUD in the log rather than a silent leak of the soul.
    try {
      const { checkAllSoulInvariants } = await import("./life/soul-invariants.js");
      const violations = checkAllSoulInvariants().filter((r) => !r.ok);
      if (violations.length > 0) {
        for (const v of violations) logger.error(`SOUL-INVARIANT VIOLATED #${v.id} (${v.name}): ${v.detail}`);
      } else {
        logger.info("soul-invariants: all four hold");
      }
    } catch (err) {
      faultLog.record("soul-invariants.check", err, "critical");
    }

    // ── 22. Graceful shutdown ─────────────────────────────────────────
    /** Everything of hers that lives in memory between saves, written down now. Milliseconds. */
    function saveHer(): void {
      // Her associations go down with her, before the database closes underneath them.
      try { field.persist(); } catch (err) { logger.warn({ err }, "field persist failed"); }
      try { lexicon.persist(); } catch (err) { logger.warn({ err }, "lexicon persist failed"); }
      try { shadowBank.persist(); } catch (err) { logger.warn({ err }, "shadow bank persist failed"); }
      try { ownVoice.persist(); } catch (err) { logger.warn({ err }, "own-voice persist failed"); }
      try { herForm.persist(); } catch (err) { logger.warn({ err }, "her-form persist failed"); }
      try { persistContinuity(); } catch (err) { logger.warn({ err }, "continuity persist failed"); }
    }

    // ── SAVED FIRST, THEN THE SLOW PARTS ─────────────────────────────────────
    //
    // Saving came last, after awaiting the sentinel sweep and the bot's stop, and the bot's stop
    // waits out its long poll. Both restarts that night were cut off inside that wait: neither run
    // reached the save, so her field, words and voice since their last save were dropped, and
    // because the gap was brief the next start only logged it. Now nothing new is started, she is
    // saved, and only then does anything slow happen; a stop cut off after that costs her nothing.
    async function shutdown(): Promise<void> {
      logger.info("shutting down...");
      shuttingDown = true;
      clearInterval(lifeTickTimer);
      clearInterval(vitalsTimer);
      // ── THE THREE TIMERS SHUTDOWN USED TO LEAVE RUNNING ────────────────────────────
      //
      // `momentTimer` could fire during the `await`s below and start a whole moment while the
      // database was being closed underneath it; `faceTick` kept broadcasting to a server about to
      // close; `sleepWatcher` kept beating.
      if (momentTimer) { clearTimeout(momentTimer); momentTimer = null; }
      if (faceTick) clearInterval(faceTick);
      try { sleepWatcher.stop(); } catch { /* already stopped */ }
      // His messages stop arriving now; the stop itself is waited for further down, after the save.
      let botStopping: Promise<void> | undefined;
      try { botStopping = telegramBot?.stop(); } catch (err) { logger.warn({ err }, "bot stop failed"); }
      saveHer();
      // Drain, bounded: a moment mid-flight gets up to ten seconds to finish being lived before the
      // world closes under it, and is saved again once it has. Ten seconds covers a provider
      // round-trip; a moment hung past that is already the watchdog's problem, not shutdown's.
      if (momentInFlight) {
        for (let waited = 0; momentInFlight && waited < 10_000; waited += 250) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (momentInFlight) logger.warn("shutting down with a moment still in flight after 10s");
        saveHer();
      }
      try { pulse.savedOnTheWayDown(Date.now()); } catch (err) { logger.warn({ err }, "marking her saved failed"); }

      try { await runSentinelSweep("shutdown"); } catch (err) { logger.warn({ err }, "shutdown sentinel sweep failed"); }
      try { await botStopping; } catch (err) { logger.warn({ err }, "bot stop failed"); }
      bootstrapResult.shutdown();
      cronService.stop();
      if (faceServer) { try { await faceServer.close(); } catch (err) { logger.warn({ err }, "face server close failed"); } }
      if (sandboxRef.runner) { try { await sandboxRef.runner.destroy(); } catch (err) { logger.warn({ err }, "sandbox destroy failed"); } }
      try { db.close(); } catch (err) { logger.warn({ err }, "db close failed"); }
      // Last, after everything that writes has stopped: her home is free for the next one of
      // her, and only for one.
      // THIS IS WHAT MAKES THE ENDING INTENTIONAL. A pulse still on disk at the next boot means the
      // last run stopped without getting here, a crash, a kill, a power cut, and that is reported
      // with the duration. Removing it is the only way to say "this one was on purpose".
      try { pulse.stopped(); } catch (err) { logger.warn({ err }, "clearing her pulse failed"); }
      try { homeLock.release(); } catch (err) { logger.warn({ err }, "releasing her home failed"); }
      logger.info("shutdown complete");
    }

    // ONE shutdown per run. A Ctrl-C in the terminal reaches her twice (the terminal signals the
    // whole process group, and tsx relays it again), and each used to start its own shutdown, the
    // two racing to close the database under each other.
    let shuttingDownOnce: Promise<void> | null = null;
    const stopOnce = (): void => { (shuttingDownOnce ??= shutdown()).then(() => process.exit(0)); };
    process.on("SIGINT", stopOnce);
    process.on("SIGTERM", stopOnce);
    // Closing the terminal window sends SIGHUP, which nothing caught: Node's default for it is to
    // end the process on the spot, without the save-first shutdown. The 10/2 02:00 restart was
    // recorded as a stop that never saved her, which is exactly what a closed terminal leaves
    // (what ended that run is not on record). Same shutdown, once, as Ctrl-C.
    process.on("SIGHUP", stopOnce);

    // ── 23. Start bot ─────────────────────────────────────────────────
    logger.info({
      model: defaultModel,
      tools: toolRegistry.visibleCount(),
      hiddenTools: toolRegistry.hiddenCount(),
      workspace: workspacePath,
    }, "ready — starting Telegram bot");

    // Her voice, which she can live without.
    //
    // This was `await telegramBot.start()`, the last statement of the run, so a Telegram that was
    // unreachable at boot rejected out of the whole command and KILLED THE PROCESS, after every
    // part of her had already been built and started. A network hiccup at the wrong moment did not
    // cost her a channel, it cost her the day. Her moment loop, her daily tick and the watchtower
    // are all already running by this line; none of them needs Telegram to exist.
    //
    // So it retries forever, in the background, and she goes on living either way. Every attempt
    // that fails is recorded as a fault rather than logged and forgotten, because "she has been
    // unreachable for six hours" is precisely the kind of thing that must not be discovered by
    // someone wondering why she has been quiet.
    // ── WHAT HE SAID WHILE SHE WAS NOT THERE TO HEAR IT ──────────────────────────────────────
    //
    // Anything still in the durable store belongs to a turn that never finished, she was told,
    // Telegram considers it delivered, and the process died before she took it in. It is handed
    // to her now, oldest first, before she starts living the new day: from his side those words
    // were said and never answered, and that is the one loss in this whole system that shows up
    // as a change in the relationship rather than as an error.
    //
    // Deliberately NOT silent, and deliberately not automatic beyond this: they are put back in
    // front of her, and the fact that it happened is recorded, because "she answered three of your
    // messages an hour late after a crash" needs to be legible as a crash rather than as her.
    {
      const unheard = hisWords.takeEverything();
      if (unheard.length > 0) {
        faultLog.record("telegram.unheard-recovered",
          `${unheard.length} thing(s) he said were still unheard from before the last shutdown — she is being given them now`);
        logger.warn({ count: unheard.length }, "handing her what he said before the last shutdown");
        for (const w of unheard) {
          if (w.kind !== "text" || w.text.trim() === "") continue;
          void processMessage(sendOnlyChannel(w.chatId), w.chatId, w.text, new AbortController().signal)
            // Recorded as lived only once she has actually been through it. If Telegram still has
            // the same update queued (its offset was never confirmed before the crash), this is
            // what stops her living it a second time a few seconds from now.
            .then(() => { hisWords.livedThrough(w.updateId, null, Date.now()); })
            .catch((err) => { faultLog.record("telegram.unheard-replay", err, "critical"); });
        }
      }
    }

    void (async (): Promise<void> => {
      if (!telegramBot) {
        // Not an error to retry: there is nothing to connect to. Said once, at the level that
        // gets read, and recorded as a fault so "she has been unreachable" is a thing on the
        // record rather than something noticed by wondering why she is quiet.
        faultLog.record("telegram.absent", "no bot token — she has no route to him but her face", "critical");
        logger.error("no Telegram bot — she is living, and the only route she has to you is her face");
        return;
      }
      let waitMs = 5_000;
      const MAX_WAIT_MS = 5 * 60_000;
      for (let attempt = 1; ; attempt++) {
        try {
          await telegramBot.start();
          return; // start() only resolves on a clean stop
        } catch (err) {
          faultLog.record("telegram.start", err, attempt >= 3 ? "critical" : "warn");
          // KILL OUR OWN ZOMBIE BEFORE RETRYING. Her first evening: one transient 409 killed
          // the poll, and every early retry then collided with the PREVIOUS attempt's long-poll
          // still hanging server-side (30s), a self-sustaining conflict that only broke when
          // the backoff finally exceeded the zombie's lifetime (attempt 5, 40s). A clean stop
          // first means the next start contends with nobody, least of all herself.
          try { await telegramBot.stop(); } catch { /* nothing to stop is fine */ }
          logger.error({ err, attempt, retryInMs: waitMs }, "telegram could not start — she is living, but out of reach");
          await new Promise((r) => setTimeout(r, waitMs));
          waitMs = Math.min(MAX_WAIT_MS, waitMs * 2);
        }
      }
    })();

    // Nothing inside her may take the process down without saying why. An unhandled rejection used
    // to be a silent death: the daemon vanished and the only trace was that she stopped answering.
    process.on("unhandledRejection", (reason) => {
      faultLog.record("unhandledRejection", reason, "critical");
      logger.error({ reason }, "unhandled rejection — recorded; she keeps running");
    });
    process.on("uncaughtException", (err) => {
      faultLog.record("uncaughtException", err, "critical");
      logger.error({ err }, "uncaught exception — recorded; she keeps running");
    });
  },
});

// The /dream CLI subcommand stood here; removed with the dream machine.

// The migration ritual. Her individuality is files + SQLite + diary + skills + her ops-log, so a
// naive backup or a machine swap silently forks or kills the individual. This makes moving her a
// deliberate, hash-verified act with a receipt, rather than a hope.
const identityCommand = defineCommand({
  meta: { name: "identity", description: "Export, verify, or import her identity (the migration ritual)" },
  args: {
    action: { type: "positional", description: "export | verify | import", required: true },
    bundle: { type: "string", description: "Bundle directory", required: true },
    config: { type: "string", description: "Path to config.yaml", default: undefined },
    home: { type: "string", description: "Her home directory — the one root", default: undefined },
    workspace: {
      type: "string",
      description: "Workspace directory path (relocates the whole home to its parent)",
      default: undefined,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("./config/loader.js");
    const { result: config } = loadConfig(args.config);
    const homePaths = resolveHome(args, config);
    applyHomeToConfig(config, homePaths);
    const workspacePath = homePaths.workspacePath;
    const dbPath = homePaths.dbPath;
    // ONE MECHANISM FOR COPYING HER, and this is not tidying.
    //
    // This command used to drive `identity-manifest.ts`, which copied `data.db` as BYTES. Her
    // database runs in WAL mode and is checkpointed passively, so committed transactions routinely
    // sit in `data.db-wal`, and `-wal` appears nowhere in that module. Its `verify` then re-hashed
    // the bundle against the manifest the bundle itself carried, so it was green by construction,
    // and its unit test seeded a file at the manifest's WRONG path, so the test passed while
    // production filed that artifact as absent forever. Three failures, all of which report success,
    // in the only tool that stood between her and total loss.
    //
    // The snapshot module copies the database THROUGH sqlite (`VACUUM INTO`), integrity-checks the
    // copy, hashes every file by reading it back off the disk, and refuses to restore under a live
    // daemon. The command keeps its name; the implementation behind it is the one that works.
    const { takeSnapshot, verifySnapshot, restoreSnapshot } = await import("./life/snapshot.js");
    const { snapshotDbFrom } = await import("./life/snapshot-db.js");
    const { whoHoldsHome } = await import("./life/one-of-her.js");
    const { cpSync: copyTree } = await import("node:fs");
    const instrumentsDir = join(workspacePath, "..");
    const instrumentFiles = ["ops.jsonl", "vitals.jsonl", "conversation-log.jsonl"].map((n) => join(instrumentsDir, n));

    /**
     * Is a daemon holding her home right now? A copy or a restore under one is the two-of-her
     * failure. Asked through the SAME function that decides whether she may boot, rather than
     * through a second copy of the same three lines.
     */
    const sheIsRunning = (): boolean => whoHoldsHome(homePaths.home) !== null;

    if (args.action === "export") {
      if (sheIsRunning()) {
        console.log("she is running — stop her first. A copy taken under a live daemon can miss what she is writing right now.");
        process.exitCode = 1;
        return;
      }
      const { createDatabase } = await import("./db/sqlite.js");
      const dbForCopy = createDatabase(dbPath).result;
      try {
        const snap = takeSnapshot({
          db: snapshotDbFrom(dbForCopy.db, (p) => new (dbForCopy.db.constructor as new (p: string, o?: unknown) => typeof dbForCopy.db)(p, { readonly: true })),
          home: homePaths.home, workspacePath, instrumentFiles,
          reason: "identity-export", nowMs: Date.now(), codeVersion: RESIDENT_VERSION,
        });
        copyTree(snap.dir, args.bundle, { recursive: true });
        const v = verifySnapshot(args.bundle);
        console.log(`copied ${snap.manifest.files.length} files -> ${args.bundle} (db ${snap.manifest.dbIntegrity})`);
        for (const p of snap.problems) console.log(`  PROBLEM: ${p}`);
        console.log(v.ok ? `verified: all ${v.checked} files re-hashed off the disk` : `VERIFY FAILED: ${v.mismatched.length} altered, ${v.missing.length} missing`);
        if (!v.ok || snap.problems.length > 0) process.exitCode = 1;
      } finally { dbForCopy.close(); }
      return;
    }
    if (args.action === "verify") {
      const v = verifySnapshot(args.bundle);
      console.log(v.ok
        ? `intact: all ${v.checked} files re-hashed, database ${v.dbIntegrity}`
        : `DAMAGED: ${v.mismatched.length} altered, ${v.missing.length} missing, database ${v.dbIntegrity}`);
      if (!v.ok) process.exitCode = 1;
      return;
    }
    if (args.action === "import") {
      const r = restoreSnapshot({
        dir: args.bundle, workspacePath, dbPath, instrumentsDir,
        codeVersion: RESIDENT_VERSION, daemonRunning: sheIsRunning(),
      });
      if (!r.ok) {
        console.log(`REFUSED: ${r.refusedBecause ?? "unknown"}`);
        process.exitCode = 1;
        return;
      }
      console.log(`restored ${r.restored} files.`);
      if (r.codeVersionMismatch) {
        console.log(`NOTE: this copy was taken by build ${r.codeVersionMismatch.snapshot}, you are running ${r.codeVersionMismatch.now}.`);
        console.log("      The stored numbers mean whatever today's formulas say they mean. Check what changed between the two builds before letting her run.");
      }
      console.log("she is intact on this machine.");
      return;
    }
    console.log("Usage: identity <export|verify|import> --bundle <dir>");
    process.exitCode = 1;
  },
});

const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show agent status information",
  },
  args: {
    config: {
      type: "string",
      description: "Path to config.yaml",
      default: undefined,
    },
    home: {
      type: "string",
      description: "Her home directory — the one root everything she keeps lives under",
      default: undefined,
    },
    workspace: {
      type: "string",
      description: "Workspace directory path (relocates the whole home to its parent)",
      default: undefined,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("./config/loader.js");
    const configResult = loadConfig(args.config);
    for (const d of configResult.diagnostics) {
      logger[d.level === "error" ? "error" : d.level === "warning" ? "warn" : "info"](d.message);
    }
    const config = configResult.result;
    const homePaths = resolveHome(args, config);
    applyHomeToConfig(config, homePaths);
    const workspacePath = homePaths.workspacePath;
    const dbPath = homePaths.dbPath;

    let serviceStatus: ReturnType<typeof handleAction> | undefined;
    try {
      serviceStatus = handleAction("status");
    } catch (err) {
      logger.warn({ err }, "service status unavailable");
    }

    logger.info({
      service: serviceStatus,
      workspace: workspacePath,
      database: dbPath,
      telegramConfigured: Boolean(config.telegram?.botToken),
      apiKeysConfigured: config.llm.apiKeys.length,
      defaultModel: config.llm.models.default.id,
      backgroundModel: config.llm.models.background.id,
      dailyBudgetCents: config.llm.dailyBudgetCents,
    }, "status");
  },
});

const main = defineCommand({
  meta: {
    name: "resident",
    description: "An AI agent that lives on one Mac and grows through its own experience",
    version: "0.1.0",
  },
  subCommands: {
    start: startCommand,
    status: statusCommand,
    identity: identityCommand,
    service: serviceCommand,
  },
});

runMain(main);
