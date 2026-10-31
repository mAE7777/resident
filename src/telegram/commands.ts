// Command router: grammY command handlers for model switching, Dream control,
// status display, and memory inspection.
//
// Commands are processed by the bot directly, they do NOT pass through
// the agent loop. Runtime can supply per-chat durable session state.

import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Bot, Context } from "grammy";
import type { CronService } from "../autonomy/cron.js";
import type { AppConfig } from "../config/schema.js";
import type { ApprovalStore } from "../security/approval-store.js";
import { checkCapabilityDependencies, type CapabilitySummary } from "../tools/capabilities.js";
import type { DatabaseWrapper } from "../db/sqlite.js";
import type { ReviewLedger, ReviewStatus } from "../self-improvement/review-ledger.js";

// ── Session state ─────────────────────────────────────────────────────────────

export interface SessionState {
  currentModel: string;
}

export function createSessionState(defaultModel: string): SessionState {
  return {
    currentModel: defaultModel,
  };
}

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface CommandDeps {
  sessionState: SessionState;
  cronService?: CronService;
  costGuard?: { getDailySpentCents(): number };
  metabolism?: {
    ownerSnapshot(): { phase: string; cap: number; spent: number; remaining: number };
  };
  innerSnapshot?: () => { mood: string; dominant: string; policy: { tierCeiling: string; mayExplore: boolean; reason: string } };
  /** Full vitals readout (energy, mood, integrity, current anomalies) for /vitals. */
  vitals?: () => string;
  /** What is in her associative field, and what has changed in her, for /field. */
  field?: () => string;
  /** Everything inside her that has broken, newest first, for /faults. */
  faults?: () => string;
  /** Her window's master override: his door, not hers. */
  curtain?: { state(): "open" | "shut"; set(open: boolean): void };
  config: AppConfig;
  approvalStore?: ApprovalStore;
  resetHistory?: (chatId: number) => void;
  sandboxRef?: { runner: unknown; enabled: boolean } | null;
  taskManager?: { list(): Array<{ id: string; type: string; status: string; message: string }> };
  toolRegistry?: { visibleCount(): number; hiddenCount(): number; getCapabilityManifests?(): CapabilitySummary[] };
  db?: DatabaseWrapper;
  reviewLedger?: ReviewLedger;
  getSessionState?: (chatId: number) => SessionState;
  onSessionStateChanged?: (chatId: number, state: SessionState) => void;
  /** Log command invocations to conversation log for full observability. */
  logCommand?: (chatId: number, command: string, args: string, response: string) => void;
  /** Owner review of quarantined skills, the ONE sanctioned un-quarantine flow. */
  skillReview?: {
    listQuarantined(): Array<{ path: string }>;
    restore(path: string): { ok: boolean; message: string };
  };
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0.00";
  return cents < 1 ? `${cents.toFixed(3)}¢` : `$${(cents / 100).toFixed(2)}`;
}

function commandSession(ctx: Context, deps: CommandDeps): SessionState {
  const chatId = ctx.chat?.id;
  if (chatId !== undefined && deps.getSessionState) {
    return deps.getSessionState(chatId);
  }
  return deps.sessionState;
}

function persistCommandSession(ctx: Context, deps: CommandDeps, state: SessionState): void {
  const chatId = ctx.chat?.id;
  if (chatId !== undefined) {
    deps.onSessionStateChanged?.(chatId, state);
  }
}

// ── Command logging helper ────────────────────────────────────────────────────

function logCmd(ctx: Context, deps: CommandDeps, command: string, args: string, response: string): void {
  const chatId = ctx.chat?.id;
  if (chatId !== undefined && deps.logCommand) {
    try { deps.logCommand(chatId, command, args, response); } catch { /* best-effort */ }
  }
}

// ── Command registration ──────────────────────────────────────────────────────

export function registerCommands(bot: Bot, deps: CommandDeps): void {
  const { costGuard, config, approvalStore } = deps;
  const { models } = config.llm;

  // /opus: switch to upgrade model
  // Wrap bot.command to auto-log every command invocation to conversation log.
  // This avoids middleware ordering issues with test mocks.
  const originalBotCommand = bot.command.bind(bot);
  const loggedCommand = (command: string, handler: (ctx: Context) => Promise<void>) => {
    originalBotCommand(command, async (ctx: Context) => {
      const args = (ctx.message?.text ?? "").replace(new RegExp(`^/${command}\\s*`), "").trim();
      type ReplyFn = Context["reply"];
      const originalReply = ctx.reply.bind(ctx) as ReplyFn;
      let lastReply = "";
      ctx.reply = (async (...replyArgs: Parameters<ReplyFn>) => {
        const [text] = replyArgs;
        if (typeof text === "string") lastReply = text;
        return originalReply(...replyArgs);
      }) as ReplyFn;
      await handler(ctx);
      logCmd(ctx, deps, command, args, lastReply.slice(0, 2000));
    });
  };
  // Override for remaining commands (opus/sonnet already use bot.command directly, kept for backward compat)
  const cmd = loggedCommand;

  // /opus: switch to upgrade model
  cmd("opus", async (ctx) => {
    const state = commandSession(ctx, deps);
    state.currentModel = models.upgrade.id;
    persistCommandSession(ctx, deps, state);
    await ctx.reply(`Model switched to ${models.upgrade.id}`);
  });

  // /curtain: her window's master override. Bare: show state; open/shut: flip it.
  // Default is OPEN (she chooses her own looks); shut is his override, and she finds an
  // honestly stuck window, never an error.
  cmd("curtain", async (ctx) => {
    const c = deps.curtain;
    if (!c) { await ctx.reply("curtain control not wired"); return; }
    const arg = (ctx.message?.text ?? "").replace(/^\/curtain\s*/u, "").trim().toLowerCase();
    if (arg === "shut" || arg === "close") c.set(false);
    else if (arg === "open") c.set(true);
    await ctx.reply(`curtain: ${c.state()}${arg === "" ? " (usage: /curtain open|shut)" : ""}`);
  });

  // /sonnet: switch to default model
  cmd("sonnet", async (ctx) => {
    const state = commandSession(ctx, deps);
    state.currentModel = models.default.id;
    persistCommandSession(ctx, deps, state);
    await ctx.reply(`Model switched to ${models.default.id}`);
  });

  // /haiku: switch to background model
  cmd("haiku", async (ctx) => {
    const state = commandSession(ctx, deps);
    state.currentModel = models.background.id;
    persistCommandSession(ctx, deps, state);
    await ctx.reply(`Model switched to ${models.background.id}`);
  });

  // /status: show system status
  cmd("status", async (ctx) => {
    const state = commandSession(ctx, deps);
    const model = state.currentModel;
    const dailyCents = costGuard ? costGuard.getDailySpentCents() : 0;

    const lines = [
      "Status",
      `Model: ${model}`,
      `Daily cost: ${formatCost(dailyCents)}`,
    ];

    if (deps.metabolism) {
      // Her energy is effort (vigor), not money, the daily cost above is Eric's wallet, which is
      // a separate concern and deliberately does not shape her.
      const snap = deps.metabolism.ownerSnapshot();
      lines.push(
        `Energy: ${snap.phase} (${Math.round(snap.remaining)} of ${snap.cap} vigor left)`
      );
    }

    if (deps.innerSnapshot) {
      const inner = deps.innerSnapshot();
      lines.push(`Mood: ${inner.mood} · wants: ${inner.dominant}`);
      lines.push(`Doing: up to ${inner.policy.tierCeiling}${inner.policy.mayExplore ? ", may explore" : ", focused"} (${inner.policy.reason})`);
    }

    if (deps.toolRegistry) {
      const visible = deps.toolRegistry.visibleCount();
      const hidden = deps.toolRegistry.hiddenCount();
      lines.push(`Tools: ${visible} active${hidden > 0 ? `, ${hidden} hidden` : ""}`);
    }

    // Show active tasks if TaskManager is available
    if (deps.taskManager) {
      const tasks = deps.taskManager.list();
      const running = tasks.filter(t => t.status === "running" || t.status === "pending");
      if (running.length > 0) {
        lines.push(`Active tasks: ${running.length}`);
        for (const t of running.slice(0, 5)) {
          lines.push(`  ${t.id} [${t.status}] ${t.message}`);
        }
      }
    }

    await ctx.reply(lines.join("\n"));
  });

  // /vitals: the full watchtower readout: energy, mood, integrity, and current anomalies.
  cmd("vitals", async (ctx) => {
    if (!deps.vitals) {
      await ctx.reply("Vitals monitor is not available.");
      return;
    }
    try {
      await ctx.reply(deps.vitals());
    } catch {
      await ctx.reply("Failed to read vitals.");
    }
  });

  // /faults: everything inside her that has broken, and when.
  //
  // The watchtower pushes what it judges alert-worthy; this is the RECORD, which is a different
  // thing. A fault that was warn-severity, or that arrived while the channel was down, or that he
  // scrolled past at two in the morning, is still on the list, and after a crash the list now
  // survives, so the minutes before it are readable rather than gone.
  cmd("faults", async (ctx) => {
    if (!deps.faults) {
      await ctx.reply("The fault channel is not available.");
      return;
    }
    try {
      await ctx.reply(deps.faults());
    } catch {
      await ctx.reply("Failed to read the fault log.");
    }
  });

  // /help: everything that exists. Until now nothing listed the commands anywhere, so /vitals and
  // /field worked perfectly and were invisible unless you already knew to type them. A watchtower
  // nobody can find is not a watchtower.
  cmd("help", async (ctx) => {
    await ctx.reply([
      "Her own life:",
      "  /field      what her associations are doing, and what has changed in her",
      "  /faults     everything inside her that has broken, and when",
      "  /vitals     the full watchtower readout: energy, mood, integrity, alerts",
      "  /status     the short version",
      "  /memory     show MEMORY.md",
      "",
      "Controls:",
      "  /approvals  pending things waiting on you",
      "  /opus /sonnet /haiku   pin the model tier for this chat (强/默认/轻的别名，历史命名)",
      "  /reset      clear this chat's history",
      "",
      "Upkeep:",
      "  /todo          the review inbox",
      "  /sandbox       sandbox state",
      "  /doctor        diagnose the install",
    ].join("\n"));
  });

  // /field: what her associations are doing: what is on her mind right now, what has become one
  // thing, what came out of nowhere, and what she has let go of. The whole point of this readout is
  // that emergence is easy to fake, so it has to be inspectable rather than asserted.
  cmd("field", async (ctx) => {
    if (!deps.field) {
      await ctx.reply("Her associative field is not available.");
      return;
    }
    try {
      await ctx.reply(deps.field());
    } catch {
      await ctx.reply("Failed to read the field.");
    }
  });

  // /memory: show MEMORY.md (truncated to 2000 chars)
  cmd("memory", async (ctx) => {
    const memoryPath = join(config.workspace.path, "MEMORY.md");
    if (!existsSync(memoryPath)) {
      await ctx.reply("MEMORY.md not found.");
      return;
    }
    try {
      const content = readFileSync(memoryPath, "utf8");
      const truncated = content.length > 2000 ? content.slice(0, 2000) + "\n\n[truncated]" : content;
      await ctx.reply(truncated);
    } catch {
      await ctx.reply("Failed to read MEMORY.md.");
    }
  });


  // /approvals [remove <id>]: list or remove persisted approvals
  cmd("approvals", async (ctx) => {
    if (!approvalStore) {
      await ctx.reply("Approval store not available.");
      return;
    }
    const arg = String(ctx.match ?? "").trim() ?? "";
    if (arg.startsWith("remove ")) {
      const idStr = arg.slice("remove ".length).trim();
      const id = Number(idStr);
      if (!Number.isInteger(id) || id <= 0) {
        await ctx.reply("Usage: /approvals remove <id>");
        return;
      }
      approvalStore.remove(id);
      await ctx.reply(`Approval #${id} removed.`);
      return;
    }
    const entries = approvalStore.loadAll();
    if (entries.length === 0) {
      await ctx.reply("No stored approvals.");
      return;
    }
    const lines = entries.map((e) => {
      const exp = new Date(e.expiresAt).toISOString().slice(0, 10);
      return `#${e.id} ${e.toolName} [${e.pattern}] → ${e.decision} (expires ${exp})`;
    });
    await ctx.reply(lines.join("\n"));
  });

  // /skill [quarantined|restore <path>]: owner review of quarantined skills.
  // Until this existed, the boot alarm said "resolve via owner review" while NO sanctioned flow
  // could clear a quarantine: the critical alarm re-fired every boot forever, resolvable only by
  // hand-editing the database. Restore adopts the CURRENT bytes' hash as the new baseline, the
  // owner is asserting he has actually looked at the file.
  cmd("skill", async (ctx) => {
    const review = deps.skillReview;
    if (!review) {
      await ctx.reply("Skill review not available.");
      return;
    }
    const arg = String(ctx.match ?? "").trim();
    const [action, ...rest] = arg.split(/\s+/).filter(Boolean);
    if (action === "restore") {
      const path = rest.join(" ");
      if (!path) {
        await ctx.reply("Usage: /skill restore <path>");
        return;
      }
      const result = review.restore(path);
      await ctx.reply(result.message);
      return;
    }
    const rows = review.listQuarantined();
    if (rows.length === 0) {
      await ctx.reply("No quarantined skills.");
      return;
    }
    const lines = ["Quarantined skills (review the file, then /skill restore <path>):"];
    for (const r of rows) lines.push(`- ${r.path}`);
    await ctx.reply(lines.join("\n").slice(0, 3900));
  });

  // /todo [list|signals|clear-signals|approve|reject|implemented|supersede|stale|quarantine <id>]
  // Filesystem-backed source of truth in {workspace}/review-queue.
  cmd("todo", async (ctx) => {
    const ledger = deps.reviewLedger;
    if (!ledger) {
      await ctx.reply("Review todo ledger not available.");
      return;
    }
    const arg = String(ctx.match ?? "").trim();
    const [actionRaw, ...rest] = arg.split(/\s+/).filter(Boolean);
    const id = rest[0];
    const reason = rest.slice(1).join(" ");
    const action = actionRaw || "list";
    const statusActions: Record<string, ReviewStatus> = {
      approve: "approved",
      reject: "rejected",
      implemented: "implemented",
      supersede: "superseded",
      stale: "stale",
      quarantine: "quarantined",
    };
    if (action in statusActions) {
      if (!id) {
        await ctx.reply(`Usage: /todo ${action} <proposal-id>`);
        return;
      }
      const status = statusActions[action]!;
      const updated = ledger.updateProposalStatus(id, status, reason);
      await ctx.reply(updated ? `Todo proposal ${id} marked ${status}.` : `Todo proposal not found: ${id}`);
      return;
    }
    if (action === "clear-signals") {
      ledger.clearRecentSignals(rest.join(" ") || "Manual recent-signal baseline reset from Telegram.");
      await ctx.reply("Recent todo signals cleared. Append-only signal logs were preserved.");
      return;
    }
    if (action === "signals") {
      const signals = ledger.listRecentSignals(12);
      if (signals.length === 0) {
        await ctx.reply("No sentinel signals recorded.");
        return;
      }
      const lines = ["Recent sentinel signals"];
      for (const signal of signals) {
        lines.push(
          `#${signal.id} [${signal.severity}/${signal.category}] ${signal.title}`,
          `Source: ${signal.source}`,
          signal.detail,
          ""
        );
      }
      await ctx.reply(lines.join("\n").slice(0, 3900));
      return;
    }
    if (action && action !== "list" && action !== "open") {
      await ctx.reply("Usage: /todo [list|signals|clear-signals|approve <id>|reject <id>|implemented <id>|supersede <id>|stale <id>|quarantine <id>]");
      return;
    }

    const proposals = ledger.listProposals("open", 10);
    if (proposals.length === 0) {
      await ctx.reply(`No open todo proposals.\nLedger: ${ledger.rootDir}`);
      return;
    }
    const lines = [`Open todo proposals`, `Ledger: ${ledger.rootDir}`, ""];
    for (const proposal of proposals) {
      lines.push(
        `#${proposal.id} [${proposal.severity}/${proposal.domain}] ${proposal.title}`,
        `Status: ${proposal.status} | Occurrences: ${proposal.occurrences}`,
        proposal.proposedChange.split("\n").slice(0, 6).join("\n"),
        ""
      );
    }
    await ctx.reply(lines.join("\n").slice(0, 3900));
  });

  // /sandbox on|off: toggle Docker sandbox for bash commands
  const sandboxRef = deps.sandboxRef;
  cmd("sandbox", async (ctx) => {
    if (!sandboxRef) {
      await ctx.reply("Docker is not available — sandbox cannot be used.");
      return;
    }
    const arg = String(ctx.match ?? "").trim().toLowerCase();
    if (arg === "on") {
      if (!sandboxRef.runner) {
        await ctx.reply("Docker is not available — cannot enable sandbox.");
        return;
      }
      sandboxRef.enabled = true;
      await ctx.reply("Sandbox enabled. Bash commands will run in Docker.");
    } else if (arg === "off") {
      sandboxRef.enabled = false;
      await ctx.reply("Sandbox disabled. Bash commands will run directly.");
    } else {
      const state = sandboxRef.enabled ? "on" : "off";
      const docker = sandboxRef.runner ? "available" : "unavailable";
      await ctx.reply(`Sandbox: ${state}\nDocker: ${docker}\nUsage: /sandbox <on|off>`);
    }
  });

  // /reset: clear conversation history for this chat
  cmd("reset", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId && deps.resetHistory) {
      deps.resetHistory(chatId);
      await ctx.reply("Conversation history cleared. Starting fresh.");
    } else {
      await ctx.reply("Reset not available.");
    }
  });

  // /doctor: system health diagnostics
  cmd("doctor", async (ctx) => {
    const checks: string[] = ["Diagnostics"];
    const pass = (label: string, detail?: string) => checks.push(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
    const fail = (label: string, detail?: string) => checks.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    const state = commandSession(ctx, deps);

    // 1. Provider
    pass("Provider", state.currentModel);

    // 2. API key
    const hasKey = !!(process.env.RESIDENT__LLM__API_KEYS || process.env.ANTHROPIC_API_KEY);
    if (hasKey) {
      pass("API key", "present");
    } else {
      fail("API key", "RESIDENT__LLM__API_KEYS not set");
    }

    // 3. Database
    if (deps.db) {
      try {
        const result = deps.db.db.pragma("integrity_check") as { integrity_check: string }[];
        const ok = Array.isArray(result) && result[0]?.integrity_check === "ok";
        if (ok) {
          pass("Database", "integrity OK");
        } else {
          fail("Database", "integrity check failed");
        }
      } catch {
        fail("Database", "query failed");
      }
    } else {
      fail("Database", "not available");
    }


    // 5. Tools
    if (deps.toolRegistry) {
      const v = deps.toolRegistry.visibleCount();
      const h = deps.toolRegistry.hiddenCount();
      pass("Tools", `${v} active, ${h} hidden`);
      if (deps.toolRegistry.getCapabilityManifests) {
        const capabilities = deps.toolRegistry.getCapabilityManifests();
        pass("Capability manifests", `${capabilities.length} declared`);
        const health = capabilities.flatMap((summary) =>
          checkCapabilityDependencies(summary.tool, summary.manifest)
        );
        const requiredMissing = health.filter((item) => !item.ok && item.dependency.required);
        const optionalMissing = health.filter((item) => !item.ok && !item.dependency.required);
        if (requiredMissing.length > 0) {
          for (const item of requiredMissing.slice(0, 8)) {
            fail(`${item.tool}:${item.dependency.name}`, item.dependency.purpose ?? item.detail);
          }
          if (requiredMissing.length > 8) checks.push(`— ${requiredMissing.length - 8} more required capability dependencies missing`);
        }
        const readyWithDeps = new Set(health.filter((item) => item.ok).map((item) => item.tool));
        if (readyWithDeps.size > 0) {
          pass("Dependency-gated capabilities", `${readyWithDeps.size} with available dependencies`);
        }
        if (optionalMissing.length > 0) {
          checks.push(`— Optional capability deps missing: ${optionalMissing.slice(0, 8).map((item) => `${item.tool}:${item.dependency.name}`).join(", ")}${optionalMissing.length > 8 ? " ..." : ""}`);
        }
      }
    } else {
      fail("Tools", "registry unavailable");
    }

    // 7. Cost
    if (costGuard) {
      const cents = costGuard.getDailySpentCents();
      pass("Daily cost", formatCost(cents));
    }

    // 8. Docker
    if (deps.sandboxRef) {
      if (deps.sandboxRef.runner) {
        pass("Docker", deps.sandboxRef.enabled ? "sandbox ON" : "available, host-direct bash");
      } else {
        fail("Docker", "unavailable");
      }
    }

    // 9. Workspace
    if (existsSync(config.workspace.path)) {
      pass("Workspace", config.workspace.path);
    } else {
      fail("Workspace", "missing");
    }

    // 10. Her identity files: what she reads about herself every turn
    for (const name of ["SOUL.md", "MEMORY.md"]) {
      const f = join(config.workspace.path, name);
      if (existsSync(f)) {
        try { pass(name, `${(statSync(f).size / 1024).toFixed(1)}KB`); } catch { pass(name, "exists"); }
      } else {
        fail(name, "missing");
      }
    }
    // 12. Cron
    if (deps.cronService) {
      pass("Cron", "active");
    }


    await ctx.reply(checks.join("\n"));
  });
}
