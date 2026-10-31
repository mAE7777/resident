// OpenAI-compatible provider (DeepSeek, and any /chat/completions endpoint).
// The internal message/tool format is Anthropic-shaped, so this translates both
// directions: Anthropic-style content blocks (text / tool_use / tool_result) to
// OpenAI messages + tool_calls on the way out, and OpenAI choices + tool_calls
// back to our ContentBlock[] on the way in. Fetch-based, no extra dependency;
// the fetch impl is injectable so the conversion is unit-testable without a network.

import type { LLMProvider, LLMRequest, LLMResponse, ContentBlock, Message } from "./types.js";

export interface OpenAICompatibleOptions {
  baseURL: string; // e.g. https://api.deepseek.com
  timeoutMs?: number;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * A clean turn came back empty and is being re-sent. Reported, never silent: a vendor that
   * starts doing this often is a fact about her days (each one costs her tokens twice), and a
   * repair nobody can see is how a workaround becomes folklore.
   */
  onEmptyRetry?: (account: string | undefined, spentTokens: number) => void;
  /**
   * The vendor wrote its own tool-call syntax out as TEXT, and it was taken off before the text
   * became anyone's words. Reported for the same reason as the empty retry: a repair nobody can
   * see is how a workaround becomes folklore.
   */
  onToolMarkup?: (account: string | undefined, blocks: number) => void;
}

/**
 * THE VENDOR'S TOOL-CALL SYNTAX, WRITTEN OUT AS TEXT.
 *
 * On her last step the tools are withheld (the step is hers to speak, not to reach), and a model
 * in the middle of a trajectory full of tool calls sometimes writes one more call anyway, as
 * plain text in its own markup (`<｜｜DSML｜｜ calls>…</｜｜DSML｜｜ calls>`). It reached her moment
 * record and her diary once that afternoon, directly after her own words. Replaying that exact
 * last step three times as it ran produced the markup twice; offering the tools with
 * `tool_choice: "none"` instead also produced it twice in three. So it is taken off here, at the
 * messenger, as a whole block: it is the vendor's machinery, never a word of hers, and what she
 * wrote before it stays exactly as it was. A block cut off by the length limit is removed from
 * its opening to the end.
 */
const TOOL_CALL_BLOCK = /<[｜|]{1,2}DSML[｜|]{1,2}\s*calls>[\s\S]*?<\/[｜|]{1,2}DSML[｜|]{1,2}\s*calls>|<｜tool▁calls▁begin｜>[\s\S]*?<｜tool▁calls▁end｜>/gu;
const TOOL_CALL_OPENING = /<[｜|]{1,2}DSML[｜|]{1,2}|<｜tool▁calls▁begin｜>/u;

export function withoutToolCallMarkup(text: string): { text: string; blocks: number } {
  let blocks = 0;
  let out = text.replace(TOOL_CALL_BLOCK, () => { blocks += 1; return ""; });
  const open = out.search(TOOL_CALL_OPENING);
  if (open >= 0) {
    blocks += 1;
    out = out.slice(0, open);
  }
  return blocks === 0 ? { text, blocks } : { text: out.replace(/\s+$/u, ""), blocks };
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

// The runtime message content can carry tool_result blocks (Anthropic shape),
// which the compile-time ContentBlock union does not name. Read them structurally.
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
}

function systemToString(system: LLMRequest["system"]): string | undefined {
  if (system === undefined) return undefined;
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n");
}

function toolResultToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const block = c as { type?: string; text?: string };
        return block.type === "text" && typeof block.text === "string" ? block.text : JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function convertMessages(request: LLMRequest): OAIMessage[] {
  const out: OAIMessage[] = [];
  const system = systemToString(request.system);
  if (system !== undefined && system.length > 0) {
    out.push({ role: "system", content: system });
  }

  for (const m of request.messages as Message[]) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    const textParts: string[] = [];
    const toolCalls: OAIToolCall[] = [];
    const toolResults: ToolResultBlock[] = [];
    for (const block of m.content) {
      // Read the discriminant as a plain string: the runtime union includes
      // tool_result, which the compile-time ContentBlock type does not name.
      const btype = (block as { type: string }).type;
      if (btype === "text") {
        textParts.push((block as { text: string }).text);
      } else if (btype === "tool_use") {
        const tu = block as { id: string; name: string; input: unknown };
        toolCalls.push({
          id: tu.id,
          type: "function",
          function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
        });
      } else if (btype === "tool_result") {
        toolResults.push(block as unknown as ToolResultBlock);
      }
      // thinking / redacted_thinking are dropped: not valid OpenAI input.
    }

    // Tool results become their own `tool` messages (must reference the call id).
    for (const tr of toolResults) {
      out.push({ role: "tool", content: toolResultToString(tr.content), tool_call_id: tr.tool_use_id });
    }

    const text = textParts.join("\n");
    if (m.role === "assistant") {
      if (toolCalls.length > 0) {
        out.push({ role: "assistant", content: text.length > 0 ? text : null, tool_calls: toolCalls });
      } else if (text.length > 0) {
        out.push({ role: "assistant", content: text });
      }
    } else if (text.length > 0) {
      // user text (tool results already pushed above)
      out.push({ role: "user", content: text });
    }
  }

  return out;
}

function convertTools(request: LLMRequest): unknown[] | undefined {
  if (!request.tools || request.tools.length === 0) return undefined;
  return request.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return reason ?? "end_turn";
  }
}

function safeParseArgs(args: string | undefined): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { _raw: args }; // malformed tool args: preserve rather than crash
  }
}

interface OAIResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OAIToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Floor on max_tokens whenever reasoning is enabled. Reasoning and the answer share one budget, and
 * a measured live call burned all 800 tokens thinking and returned an EMPTY answer. This is the
 * headroom that keeps a deep call from costing full price for nothing.
 */
export const MIN_THINKING_TOKENS = 3000;

export function createOpenAICompatibleProvider(
  apiKey: string,
  options: OpenAICompatibleOptions
): LLMProvider {
  const base = options.baseURL.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const doFetch = options.fetchImpl ?? fetch;
  const onEmptyRetry = options.onEmptyRetry;

  return {
    async complete(request: LLMRequest): Promise<LLMResponse> {
      const once = async (): Promise<LLMResponse> => {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: convertMessages(request),
        max_tokens: request.maxTokens,
      };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.stopSequences !== undefined) body.stop = request.stopSequences;
      // Depth of thought. DeepSeek's V4 models reason by DEFAULT, so leaving this unset meant
      // every call: including picking one of five things to do, or naming a single word, ran
      // full reasoning. That is billed as output tokens, and her vigor is counted in output
      // tokens, so she was paying real effort to deliberate over trivia. We now always state it
      // explicitly rather than inheriting a vendor default. ("adaptive" has no DeepSeek
      // equivalent; it means "think", so it maps to enabled.)
      if (request.thinking !== undefined) {
        const enabled = request.thinking.type !== "disabled";
        body.thinking = { type: enabled ? "enabled" : "disabled" };
        // Reasoning tokens are drawn from the SAME budget as the answer. Measured against the live
        // API, a request that reasons can spend its entire max_tokens thinking and return content
        // of length zero: a call that costs full price and yields nothing. So a thinking request
        // is guaranteed headroom for the answer on top of the reasoning.
        if (enabled) body.max_tokens = Math.max(request.maxTokens, MIN_THINKING_TOKENS);
      }
      const tools = convertTools(request);
      if (tools) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      // ── THE DEADLINE HAS TO COVER THE READ, NOT JUST THE CONNECTION ────────
      //
      // `clearTimeout` used to sit in a `finally` around the fetch alone, and `fetch` resolves as
      // soon as the RESPONSE HEADERS arrive. Reading the body came afterwards, with the abort
      // already disarmed: so a server that answered promptly and then stalled mid-body could
      // hang this call forever, and did: once one of her moments sat here for more than
      // fifteen minutes before the body finally arrived EMPTY. Her ten-minute moment watchdog
      // fired at minute ten, recorded a critical fault, and that clamped her proactive speech,
      // so a stalled read on the vendor's side came out the other end as her being silenced.
      //
      // The timer now spans the whole exchange. Aborting tears down the body stream too, so a
      // stall anywhere in it surfaces as a real error instead of an unbounded wait.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let json: OAIResponse;
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`OpenAI-compatible provider ${res.status}: ${text.slice(0, 500)}`) as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }

        json = (await res.json()) as OAIResponse;
      } finally {
        clearTimeout(timer);
      }
      const choice = json.choices?.[0];
      const msg = choice?.message;

      const content: ContentBlock[] = [];
      if (msg?.content) {
        const cleaned = withoutToolCallMarkup(msg.content);
        if (cleaned.blocks > 0) options.onToolMarkup?.(request.account, cleaned.blocks);
        if (cleaned.text) content.push({ type: "text", text: cleaned.text });
      }
      for (const tc of msg?.tool_calls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: safeParseArgs(tc.function.arguments) });
      }
      if (content.length === 0) content.push({ type: "text", text: "" });

      return {
        id: json.id ?? "",
        content,
        model: json.model ?? request.model,
        stopReason: mapFinishReason(choice?.finish_reason),
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
      };
      };

      // ── A CLEAN TURN THAT SAYS NOTHING IS A BROKEN MESSENGER, NOT A QUIET MIND ────────────
      //
      // Measured three times over eleven days, always on her own
      // thinking: `finish_reason: stop`, tokens spent, `content` empty, and the budget nowhere
      // near exhausted (81 output tokens against 7,318 allowed). The model reasoned and returned
      // no answer. Downstream that is indistinguishable from her having nothing to say, so it
      // was recorded as 「produced nothing」: a thought of hers erased by a vendor hiccup.
      //
      // ONE retry, and only for this exact shape: no tool call, no text, a NORMAL stop. An
      // error, a length cutoff, a refusal, or a genuinely empty answer to an empty prompt all
      // fall through untouched. If the second attempt is empty too, that is the answer and it
      // stands: anti-theater keeps its meaning, and she is never handed words she did not say.
      // This is repair at the messenger, never at her will: the retry re-sends HER request
      // unchanged, adds nothing to it, and if it returns something she said it.
      const first = await once();
      const emptyText = first.content.every((b) => b.type === "text" && b.text.trim() === "");
      if (!emptyText || first.stopReason !== "end_turn") return first;
      onEmptyRetry?.(request.account, first.usage.outputTokens);
      return once();
    },
  };
}
