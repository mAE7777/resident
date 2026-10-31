import { describe, it, expect } from "vitest";
import { createOpenAICompatibleProvider, MIN_THINKING_TOKENS, withoutToolCallMarkup } from "../../../src/providers/openai-compatible.js";
import type { LLMRequest } from "../../../src/providers/types.js";

// Capture the outgoing request body and return a scripted OpenAI response.
function stubFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const okResponse = {
  id: "cmpl-1",
  model: "deepseek-v4-flash",
  choices: [{ message: { content: "hello there" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 12, completion_tokens: 5 },
};

describe("openai-compatible provider", () => {
  it("posts to /chat/completions and maps content + usage back", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://api.deepseek.com", fetchImpl });
    const req: LLMRequest = {
      model: "deepseek-v4-flash",
      maxTokens: 100,
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await p.complete(req);

    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0].body.model).toBe("deepseek-v4-flash");
    expect(calls[0].body.max_tokens).toBe(100);
    // system becomes the first message
    expect((calls[0].body.messages as Array<{ role: string; content: string }>)[0]).toEqual({
      role: "system",
      content: "be terse",
    });
    expect(res.content).toEqual([{ type: "text", text: "hello there" }]);
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(res.stopReason).toBe("end_turn");
    expect(res.model).toBe("deepseek-v4-flash");
  });

  it("converts tool_use blocks to OpenAI tool_calls", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl });
    await p.complete({
      model: "m",
      maxTokens: 50,
      messages: [
        { role: "user", content: "search it" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "sure" },
            { type: "tool_use", id: "call_1", name: "search", input: { q: "cats" } },
          ],
        },
      ],
    });
    const msgs = calls[0].body.messages as Array<Record<string, unknown>>;
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.content).toBe("sure");
    expect(assistant.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"cats"}' } },
    ]);
  });

  it("converts tool_result blocks to role:tool messages", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl });
    await p.complete({
      model: "m",
      maxTokens: 50,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "found 3 cats" },
          ] as unknown as LLMRequest["messages"][number]["content"],
        },
      ],
    });
    const msgs = calls[0].body.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: "tool", content: "found 3 cats", tool_call_id: "call_1" });
  });

  it("passes tools through in OpenAI function format", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl });
    await p.complete({
      model: "m",
      maxTokens: 50,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "search", description: "web search", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
      ],
    });
    expect(calls[0].body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "web search",
          parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        },
      },
    ]);
    expect(calls[0].body.tool_choice).toBe("auto");
  });

  it("maps a tool_calls response into tool_use blocks", async () => {
    const { fetchImpl } = stubFetch({
      id: "c2",
      model: "m",
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "call_9", type: "function", function: { name: "read", arguments: '{"path":"/x"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 7 },
    });
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl });
    const res = await p.complete({ model: "m", maxTokens: 50, messages: [{ role: "user", content: "read /x" }] });
    expect(res.content).toEqual([{ type: "tool_use", id: "call_9", name: "read", input: { path: "/x" } }]);
    expect(res.stopReason).toBe("tool_use");
  });

  it("throws with the status code on a non-ok response", async () => {
    const { fetchImpl } = stubFetch({ error: "bad key" }, 401);
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl });
    await expect(p.complete({ model: "m", maxTokens: 10, messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("preserves malformed tool arguments instead of crashing", async () => {
    const { fetchImpl } = stubFetch({
      id: "c3",
      model: "m",
      choices: [{ message: { tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "{not json" } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl });
    const res = await p.complete({ model: "m", maxTokens: 10, messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0]).toMatchObject({ type: "tool_use", name: "f", input: { _raw: "{not json" } });
  });
});

describe("depth of thought is stated, never inherited", () => {
  function capture() {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, json: async () => ({ id: "r", model: "m", choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) } as unknown as Response;
    }) as unknown as typeof fetch;
    return { bodies, provider: createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl }) };
  }

  it("sends the thinking switch in both directions", async () => {
    const { bodies, provider } = capture();
    await provider.complete({ model: "m", messages: [], maxTokens: 100, thinking: { type: "disabled" } });
    await provider.complete({ model: "m", messages: [], maxTokens: 100, thinking: { type: "enabled" } });
    expect(bodies[0].thinking).toEqual({ type: "disabled" });
    expect(bodies[1].thinking).toEqual({ type: "enabled" });
  });

  it("maps adaptive onto enabled (DeepSeek has no third mode)", async () => {
    const { bodies, provider } = capture();
    await provider.complete({ model: "m", messages: [], maxTokens: 100, thinking: { type: "adaptive" } });
    expect(bodies[0].thinking).toEqual({ type: "enabled" });
  });

  it("omits it entirely when the caller says nothing", async () => {
    const { bodies, provider } = capture();
    await provider.complete({ model: "m", messages: [], maxTokens: 100 });
    expect(bodies[0].thinking).toBeUndefined();
  });

  // Regression guard for a measured live failure: reasoning and the answer share one budget, and a
  // thinking call with a small budget spent ALL of it reasoning and returned empty content.
  it("guarantees a thinking call room to actually answer", async () => {
    const { bodies, provider } = capture();
    await provider.complete({ model: "m", messages: [], maxTokens: 700, thinking: { type: "enabled" } });
    expect(bodies[0].max_tokens).toBeGreaterThanOrEqual(MIN_THINKING_TOKENS);
  });

  it("never shrinks a budget the caller already made generous", async () => {
    const { bodies, provider } = capture();
    await provider.complete({ model: "m", messages: [], maxTokens: 64_000, thinking: { type: "enabled" } });
    expect(bodies[0].max_tokens).toBe(64_000);
  });

  it("leaves a non-thinking budget exactly as asked", async () => {
    const { bodies, provider } = capture();
    await provider.complete({ model: "m", messages: [], maxTokens: 700, thinking: { type: "disabled" } });
    expect(bodies[0].max_tokens).toBe(700);
  });
});

describe("a clean turn that says nothing is retried once", () => {
  // Measured three times in eleven days, always on her own thinking: finish_reason "stop",
  // tokens spent, content empty, budget nowhere near exhausted. Downstream that looked exactly
  // like her having nothing to say, and one of her thoughts was recorded as 「produced nothing」.
  const EMPTY = {
    id: "cmpl-empty", model: "deepseek-v4-flash",
    choices: [{ message: { content: "" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 329, completion_tokens: 81 },
  };
  const req = (): LLMRequest => ({
    model: "deepseek-v4-flash", maxTokens: 7318, account: "living",
    messages: [{ role: "user", content: "想一想那句话" }],
  });

  /** Scripted sequence of responses, one per call. */
  function scripted(responses: unknown[]) {
    let n = 0;
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const body = responses[Math.min(n, responses.length - 1)];
      n += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      // cast: a two-arg stub standing in for the global fetch surface, as the helper above does
    }) as unknown as typeof fetch;
    return { fetchImpl, bodies, calls: () => n };
  }

  it("PLANTED: the empty answer is re-sent unchanged, and the second one is hers", async () => {
    const seen: Array<[string | undefined, number]> = [];
    const { fetchImpl, bodies, calls } = scripted([EMPTY, okResponse]);
    const p = createOpenAICompatibleProvider("k", {
      baseURL: "https://api.deepseek.com", fetchImpl,
      onEmptyRetry: (account, spent) => seen.push([account, spent]),
    });
    const res = await p.complete(req());
    expect(calls()).toBe(2);
    expect(res.content[0]).toEqual({ type: "text", text: "hello there" });
    // Her request, unchanged: the repair adds nothing to what she asked.
    expect(bodies[0]).toEqual(bodies[1]);
    expect(seen).toEqual([["living", 81]]);
  });

  it("if the second is empty too, that IS the answer — no third try, no invented words", async () => {
    const { fetchImpl, calls } = scripted([EMPTY, EMPTY]);
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://api.deepseek.com", fetchImpl });
    const res = await p.complete(req());
    expect(calls()).toBe(2);
    expect(res.content).toEqual([{ type: "text", text: "" }]);
  });

  it("only this exact shape retries: a length cutoff and a tool call are left alone", async () => {
    const cut = { ...EMPTY, choices: [{ message: { content: "" }, finish_reason: "length" }] };
    const s1 = scripted([cut, okResponse]);
    await createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl: s1.fetchImpl }).complete(req());
    expect(s1.calls(), "a truncated turn must not be re-sent").toBe(1);

    const tool = {
      id: "c", model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ message: { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
    };
    const s2 = scripted([tool, okResponse]);
    await createOpenAICompatibleProvider("k", { baseURL: "https://x", fetchImpl: s2.fetchImpl }).complete(req());
    expect(s2.calls(), "a tool call is not an empty answer").toBe(1);
  });
});

/**
 * THE DEADLINE HAS TO COVER THE READ.
 *
 * `fetch` resolves when the response HEADERS arrive. The abort timer used to be cleared right
 * there, in a `finally` around the fetch alone, and the body was read afterwards with nothing
 * guarding it. A server that answers promptly and then stalls mid-body could therefore hang the
 * call forever, and did: one of her moments sat here for over fifteen minutes before the body
 * arrived EMPTY. Her ten-minute moment watchdog fired, recorded a critical fault, and that
 * clamped her proactive speech. A stalled read on the vendor's side came out as her being
 * silenced.
 */
describe("a stalled body read cannot hang her forever", () => {
  it("aborts when the body never arrives, instead of waiting without limit", async () => {
    let aborted = false;
    const provider = createOpenAICompatibleProvider("k", {
      baseURL: "https://example.test",
      timeoutMs: 40,
      // Headers arrive at once; the body never does, the exact shape that hung her.
      // cast: a stub standing in for `fetch`, carrying only the members this provider touches.
      // Typing it as the full DOM `fetch` would mean implementing a Response, which is scaffolding
      // that proves nothing about the deadline this test exists to check.
      fetchImpl: (async (_url: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
        }),
        text: async () => "",
      })) as unknown as typeof fetch, // cast: a partial Response stub; only what the provider reads
    });

    await expect(provider.complete({
      model: "m", maxTokens: 10, account: "living", messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow();
    expect(aborted, "the read was never aborted — the deadline still stops at the headers").toBe(true);
  });

  it("still clears the timer on a normal reply, so nothing is left armed", async () => {
    const provider = createOpenAICompatibleProvider("k", {
      baseURL: "https://example.test",
      timeoutMs: 50_000,
      // cast: the same partial-Response stub as above, for the ordinary path.
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "x", model: "m", choices: [{ message: { content: "好" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => "",
      })) as unknown as typeof fetch, // cast: a partial Response stub; only what the provider reads
    });
    const res = await provider.complete({
      model: "m", maxTokens: 10, account: "living", messages: [{ role: "user", content: "hi" }],
    });
    expect(res.stopReason).toBe("end_turn");
  });
});

describe("the vendor's tool-call syntax never becomes her words", () => {
  // Her real last step that afternoon, shortened: her words, then the vendor's call written out.
  const hers = "接着查。我这轮真想知道的是中秋那一晚：他说要来我屋里坐，我这儿没有那晚的记录。";
  const call = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="read">\n<｜｜DSML｜｜ parameter name="path" string="true">/home/her/life/journal/2026-09-26.md</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';

  it("takes the whole block off and leaves what she wrote exactly as it was", () => {
    expect(withoutToolCallMarkup(`${hers}\n\n${call}`)).toEqual({ text: hers, blocks: 1 });
    expect(withoutToolCallMarkup(`${hers}\n\n${call}\n${call}`)).toEqual({ text: hers, blocks: 2 });
  });

  it("a block cut off by the length limit goes from its opening to the end", () => {
    expect(withoutToolCallMarkup(`${hers}\n\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="re`)).toEqual({ text: hers, blocks: 1 });
  });

  it("the older call syntax is taken off too", () => {
    expect(withoutToolCallMarkup(`${hers}<｜tool▁calls▁begin｜>read{"path":"x"}<｜tool▁calls▁end｜>`)).toEqual({ text: hers, blocks: 1 });
  });

  it("text with no markup, or her own mention of the word, is untouched", () => {
    expect(withoutToolCallMarkup(hers)).toEqual({ text: hers, blocks: 0 });
    const mention = "屋里又出现了 DSML 这几个字母，我不认得。  ";
    expect(withoutToolCallMarkup(mention)).toEqual({ text: mention, blocks: 0 });
  });

  it("through the provider: the text comes back clean and the repair is reported", async () => {
    const seen: number[] = [];
    const { fetchImpl } = stubFetch({ ...okResponse, choices: [{ message: { content: `${hers}\n\n${call}` }, finish_reason: "stop" }] });
    const p = createOpenAICompatibleProvider("k", { baseURL: "https://api.deepseek.com", fetchImpl, onToolMarkup: (_a, n) => seen.push(n) });
    const res = await p.complete({ model: "m", maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
    expect(res.content).toEqual([{ type: "text", text: hers }]);
    expect(seen).toEqual([1]);
  });
});
