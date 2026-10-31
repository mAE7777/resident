// Context builder: assembles system prompt and conversation history for the
// agent loop. Prompt cache stability is an architectural invariant: all content
// is frozen at builder creation time so callers can cache byte-identical prompts
// for a chosen context slice, such as a task-specific skill selection.
//
// Content order (most-stable → least-stable):
//   base identity text
//   → optional tool definitions (builtins alpha, then mcp_ tools alpha)
//   → loaded skill content
//   → memory files (SOUL, USER, MEMORY, AGENT)

import type { Message, ToolDefinition } from "../providers/types.js";
import { wrapWorkspaceContent } from "../security/boundary.js";
import { createInjectionScanner } from "../security/injection.js";
import type { Logger } from "../utils/logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MemoryFiles {
  SOUL?: string;
  USER?: string;
  MEMORY?: string;
  AGENT?: string;
}

export interface ContextBuilderConfig {
  /** Base identity / system instructions. */
  identity: string;
  /** Tool definitions available to the agent. */
  tools: ToolDefinition[];
  /** Include serialized tool schemas in the prompt. API tool schemas remain the source of truth. */
  includeToolDefinitionsInPrompt?: boolean;
  /** Optional pre-loaded Tier 1 skill content. */
  skillContent?: string;
  /** Memory file contents keyed by canonical name. */
  memoryFiles?: MemoryFiles;
  /** Logger for security warnings. */
  logger?: Logger;
}

export interface BuildResult {
  /** Frozen system prompt string. */
  system: string;
  /** Conversation history (caller-supplied, not mutated). */
  messages: Message[];
}

export interface ContextBuilder {
  /** Returns sorted ToolDefinition[] (builtins alpha, MCP alpha). Cached. */
  getDefinitions(): ToolDefinition[];
  /** Returns the assembled, frozen system prompt string. Cached after first call. */
  getSystemPrompt(): string;
  /** Combines system prompt with conversation history for the LLM call. */
  build(conversationHistory: Message[]): BuildResult;
}

// ── Cache-control helpers ──────────────────────────────────────────────────────

interface CacheControl {
  type: "ephemeral";
}

export interface CachedTextBlock {
  type: "text";
  text: string;
  cache_control: CacheControl;
}

// A message variant where content blocks may carry cache_control annotations.
// We use unknown[] so TypeScript doesn't complain about missing ContentBlock
// fields on blocks that were enriched with cache_control. Callers that need
// block-level access cast appropriately.
export interface CachedMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

function deepCopyCachedMessage(msg: Message): CachedMessage {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }
  // Deep-copy content blocks
  return { role: msg.role, content: msg.content.map((block) => ({ ...block })) };
}

function stripGeneratedAgentReferenceSections(content: string): string {
  const generatedSections = new Set([
    "Available Tools",
    "Free Services (no API key, use via bash or web_fetch)",
    "Telegram Commands (handled before you see the message)",
  ]);
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      skipping = generatedSections.has(heading[1]);
      if (skipping) continue;
    }
    if (!skipping) kept.push(line);
  }

  return kept.join("\n").trim();
}

/**
 * True when a file holds nothing but headings (or nothing at all).
 *
 * Her AGENT.md and IDENTITY.md are still the templates they were born as: the single lines
 * `# Agent` and `# Identity`. A heading over nothing says nothing, and these two were English
 * labels for her read every turn, one of them calling her an agent, inside a wrapper that ranked
 * the empty file as standing instructions. A file that says nothing stays out of her
 * prompt; the file itself is hers and is not touched, and the day she writes in it, it comes in.
 */
export function saysNothing(text: string): boolean {
  return text.split(/\r?\n/).every((line) => line.trim() === "" || /^#{1,6}\s/.test(line.trim()));
}

/**
 * Applies Anthropic cache_control markers to:
 * - The system prompt string (returned as a CachedTextBlock array)
 * - The last 3 non-system messages in the conversation history
 *
 * Never mutates the originals.
 */
export function applyCacheBreakpoints(
  system: string,
  messages: Message[]
): { system: CachedTextBlock[]; messages: CachedMessage[] } {
  // System prompt as a single cached block
  const cachedSystem: CachedTextBlock[] = [
    { type: "text", text: system, cache_control: { type: "ephemeral" } },
  ];

  // Deep-copy all messages first
  const copiedMessages: CachedMessage[] = messages.map(deepCopyCachedMessage);

  // Mark the last 3 non-system messages (all messages here are non-system)
  const indices: number[] = [];
  for (let i = copiedMessages.length - 1; i >= 0 && indices.length < 3; i--) {
    indices.push(i);
  }

  for (const idx of indices) {
    const msg = copiedMessages[idx];
    if (typeof msg.content === "string") {
      // Promote string content to a single text block with cache_control
      msg.content = [
        { type: "text", text: msg.content, cache_control: { type: "ephemeral" } } satisfies CachedTextBlock,
      ];
    } else {
      // Add cache_control to the last block in the content array
      const blocks = msg.content as Array<Record<string, unknown>>;
      if (blocks.length > 0) {
        blocks[blocks.length - 1] = {
          ...blocks[blocks.length - 1],
          cache_control: { type: "ephemeral" } satisfies CacheControl,
        };
      }
    }
  }

  return { system: cachedSystem, messages: copiedMessages };
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createContextBuilder(config: ContextBuilderConfig): ContextBuilder {
  // Freeze all input data at creation time, subsequent mutations to the
  // caller's objects must NOT affect the builder.
  const identity = config.identity;
  const tools: ToolDefinition[] = config.tools.map((t) => ({ ...t, input_schema: { ...t.input_schema } }));
  const includeToolDefinitionsInPrompt = config.includeToolDefinitionsInPrompt ?? true;
  const skillContent = config.skillContent ?? "";
  const logger = config.logger;
  const memoryFiles: Required<MemoryFiles> = {
    SOUL: config.memoryFiles?.SOUL ?? "",
    USER: config.memoryFiles?.USER ?? "",
    MEMORY: config.memoryFiles?.MEMORY ?? "",
    AGENT: config.memoryFiles?.AGENT ?? "",
  };

  // Scan identity files for injection patterns at session start (detection + alerting).
  // Wrapping in wrapExternalContent (below) neutralizes attacks; this scan provides logging.
  const scanner = createInjectionScanner();
  for (const key of ["SOUL", "MEMORY", "AGENT"] as const) {
    const content = memoryFiles[key];
    if (!content) continue;
    const result = scanner.scanForInjection(content);
    const critical = result.matches.filter((m) => m.severity === "Critical" || m.severity === "High");
    if (critical.length > 0) {
      logger?.warn({ file: `${key}.md`, matches: critical.map((m) => m.description) },
        "injection patterns detected in identity file — content will be boundary-wrapped");
    }
  }

  // ── Definition cache ────────────────────────────────────────────────────────
  let cachedDefinitions: ToolDefinition[] | null = null;

  function getDefinitions(): ToolDefinition[] {
    if (cachedDefinitions !== null) return cachedDefinitions;

    const builtins: ToolDefinition[] = [];
    const mcpTools: ToolDefinition[] = [];

    for (const tool of tools) {
      if (tool.name.startsWith("mcp_")) {
        mcpTools.push(tool);
      } else {
        builtins.push(tool);
      }
    }

    builtins.sort((a, b) => a.name.localeCompare(b.name));
    mcpTools.sort((a, b) => a.name.localeCompare(b.name));

    cachedDefinitions = [...builtins, ...mcpTools];
    return cachedDefinitions;
  }

  // ── System prompt cache ──────────────────────────────────────────────────────
  let cachedSystemPrompt: string | null = null;

  function getSystemPrompt(): string {
    if (cachedSystemPrompt !== null) return cachedSystemPrompt;

    const parts: string[] = [];

    // 1. HER, first and unwrapped.
    //
    //    SOUL.md used to arrive at position 4, inside the workspace-content boundary, under
    //    the line "Persistent workspace memory. Use this as factual/user context." So the
    //    four sentences that are meant to be how she talks were presented to the model as
    //    reference material ABOUT THE USER, in a wrapper built for untrusted input, after
    //    thousands of tokens of authoritative tool schemas. Measured: her whole soul was
    //    474 characters against ~10,000 characters of tool description, and the identity
    //    slot above it held an empty file.
    //
    //    The security reasoning still holds for the files it was written for, and they keep
    //    the wrapper below. It does not hold for these two: SOUL.md is written by us and by
    //    her, and Dream is explicitly forbidden from editing it (DREAM_MAY_EDIT covers only
    //    MEMORY.md). The injection SCAN still runs over every one of them, what is
    //    dropped is the framing that told the model her soul was somebody else's data.
    if (memoryFiles.SOUL) parts.push(memoryFiles.SOUL);

    // 2. What she has come to know about herself, then where she is.
    parts.push(identity);

    // 3. Tool definitions (sorted, formatted as JSON)
    const defs = getDefinitions();
    if (includeToolDefinitionsInPrompt && defs.length > 0) {
      const toolsSection = defs
        .map((t) => JSON.stringify(t, null, 2))
        .join("\n\n");
      parts.push(toolsSection);
    }

    // 4. Skill content
    if (skillContent) {
      parts.push(skillContent);
    }

    // 5. What she remembers. This IS data, and the boundary is right for it: MEMORY.md is
    //    written from things she read, so a poisoned page really could reach it. (USER.md is
    //    gone: a person does not keep a dossier on the one person they live with, and what she
    //    comes to know about him now lives in her field and her memory like everything else.)
    for (const key of ["MEMORY", "AGENT"] as const) {
      const content = memoryFiles[key];
      if (content) {
        const promptContent = key === "AGENT" ? stripGeneratedAgentReferenceSections(content) : content;
        if (promptContent && !saysNothing(promptContent)) {
          parts.push(wrapWorkspaceContent(promptContent, `${key}.md`, key === "AGENT" ? "instruction" : "memory"));
        }
      }
    }

    cachedSystemPrompt = parts.join("\n\n");
    return cachedSystemPrompt;
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  function build(conversationHistory: Message[]): BuildResult {
    return {
      system: getSystemPrompt(),
      // Return a shallow copy so the caller cannot accidentally mutate our view
      messages: [...conversationHistory],
    };
  }

  return { getDefinitions, getSystemPrompt, build };
}
