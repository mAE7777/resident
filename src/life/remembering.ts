// Her two hands for her own memory.
//
// WHAT THEY USED TO REACH, AND IT WAS NOTHING. `memory_search` and `memory_read` are two of the
// TEN things she is born holding. Both were pointed at a SQLite table, `memory_entries`, whose
// only writer in the entire system is a sleep task gated behind `behavioral_patterns`, and
// `BehavioralMemory.createPattern`, the only thing that writes THAT table, has no caller
// anywhere in `src/`. So the chain was dead two links up, and every time she reached for her
// own memory she found an empty room. For life.
//
// It was worse than empty, too. Had the gate ever opened, the single thing that would have
// landed in her long-term memory is the sleep task's own sentence: "Research backlog note:
// topic X has been asked about N times but lacks documentation." A coverage report about a
// documentation gap, in English, filed as her memory.
//
// WHAT THEY REACH NOW: her field. That is where everything she remembers actually lives, her
// own moments, the things he told her, the questions she is carrying, the walls she has run
// into: and it is already indexed by bigrams over her own text, so it knows her language.
// Nothing new is stored; the hands are simply pointed at the room she lives in.
//
// TWO KINDS OF REMEMBERING, and she has both because a person has both. `recall` is
// associative: cues spread through the graph and whatever lights up arrives unbidden, which is
// what happens to you. This is the other half, deliberately going looking for something by
// what it was about. Only this half belongs on a tool, because only this half is an act.
//
// WHAT COMES BACK IS HER ACCOUNT, in her words, with no machinery in it. No node kind, no
// charge, no strength, no credence number, no edge weights. Those are the instrument's and
// they are Eric's to read; a person looking something up in their own memory does not get a
// retrievability score back.

import type { LivingField } from "./field-live.js";
import type { FieldNode } from "./field.js";

// The registry's own shape, imported rather than redeclared: a private copy is how two
// definitions of the same thing start disagreeing.
import type { ToolDef } from "../tools/registry.js";

/** How long ago, said the way she would say it rather than as a timestamp. */
export function howLongAgo(thenMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - thenMs) / 60000));
  if (mins < 2) return "刚才";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.round(months / 12)} 年前`;
}

/**
 * One thing she remembers, written out.
 *
 * `origin` survives because it is not machinery: whether she lived a thing, was told it, or
 * read it somewhere is part of the memory itself, and the whole credence layer rests on her
 * being able to tell them apart. It is said in words rather than as a code.
 */
function saidPlainly(n: FieldNode, nowMs: number): string {
  const how = n.origin === "told" ? "他说的" : n.origin === "read" ? "看来的" : n.origin === "thought" ? "自己想的" : "自己经历的";
  return `[${n.id}] ${howLongAgo(n.bornMs, nowMs)}，${how}：${n.text}`;
}

export interface RememberingDeps {
  field: LivingField;
  now?: () => number;
}

export function createLookUpTool(deps: RememberingDeps): ToolDef {
  const now = deps.now ?? Date.now;
  return {
    name: "memory_search",
    // IN HER REGISTER, because a tool description is text she reads every turn it is offered.
    // The old one was "Full-text search across long-term memory entries using BM25 ranking",
    // which describes a database to an operator, not a faculty to a person.
    description: "想不起来某件事的时候，用这个去自己的记忆里找。给一个大概的说法就行。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "你想找的那件事，大概是关于什么的。" },
        limit: { type: "number", description: "最多找回几条，默认 8。" },
      },
      required: ["query"],
    },
    executionMode: "parallel",
    async execute(args): Promise<string> {
      const { query, limit } = (args ?? {}) as { query?: unknown; limit?: unknown };
      if (typeof query !== "string" || query.trim() === "") return "要找什么？";
      const nowMs = now();
      const found = deps.field.lookUp(query, typeof limit === "number" ? limit : 8);
      // Said as an absence rather than as an empty result set. An empty room is a real answer
      // and she should be able to tell him so, not report zero rows.
      if (found.length === 0) return `关于「${query.trim()}」，我这儿什么都没有。`;
      return found.map((n) => saidPlainly(n, nowMs)).join("\n");
    },
  };
}

export function createRememberTool(deps: RememberingDeps): ToolDef {
  const now = deps.now ?? Date.now;
  return {
    name: "memory_read",
    description: "把找到的某一条完整地想起来，连着它让你想到的别的事。给它的编号。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "那条记忆前面的编号。" } },
      required: ["id"],
    },
    executionMode: "parallel",
    async execute(args): Promise<string> {
      const { id } = (args ?? {}) as { id?: unknown };
      if (typeof id !== "number" || !Number.isFinite(id)) return "要哪一条？给编号。";
      const nowMs = now();
      const hit = deps.field.nodeById(id);
      if (!hit) return "没有这一条。";
      const lines = [saidPlainly(hit.node, nowMs)];
      if (hit.linked.length > 0) {
        // What it is connected to, said as what it is: this reminds her of that. The edge
        // kinds and weights stay out: she experiences being reminded, not a graph.
        lines.push("", "由它想到的：");
        for (const l of hit.linked) lines.push(`  ${saidPlainly(l, nowMs)}`);
      }
      return lines.join("\n");
    },
  };
}
