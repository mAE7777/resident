// read tool: reads file content with optional offset/limit (line numbers).
// executionMode: "parallel", safe read-only, Zone 1.

import { readFile, realpath } from "node:fs/promises";
import { basename } from "node:path";
import type { ToolDef } from "../registry.js";
import { resolveToolPath, validatePath } from "./path-guard.js";
import { lookAt, WINDOW, type WhatSheSees } from "../../workspace/things.js";
import { machineRecordAt, recordLinesInHerWords } from "../../workspace/records.js";

interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

/**
 * @param windowOnto What she would see out of the window RIGHT NOW, or null when she cannot see.
 *   A getter rather than a value, because a thing in her room answers with this moment; a snapshot
 *   captured when the tool was built would be a window painted shut. Absent entirely on every path
 *   that has no face (tests, Telegram-only), and absent means the curtain is closed, never that
 *   the room is empty.
 */
export function createReadTool(
  workspacePath?: string,
  cwd?: string,
  windowOnto?: () => WhatSheSees | null,
  /** The touch-trace: called when a thing in her room actually answered her look. */
  onLooked?: (thing: string, nowMs: number) => void,
  /**
   * Her own eye (life/seeing.ts): a real look out of the window, one frame, transcribed.
   * Resolves null when the eye is not configured, and the window falls back to the presence
   * lines below, byte-for-byte the old behaviour.
   */
  lookOutside?: () => Promise<string | null>,
  /**
   * The canvas loop (S-64): her own .svg painting, rendered and seen through her own eye.
   * She could not see her drawing while she drew it; this closes the draw→look→adjust loop. null = eye
   * not configured; the source alone comes back, byte-for-byte today's behaviour.
   */
  seePainting?: (absPath: string) => Promise<string | null>,
): ToolDef {
  return {
    name: "read",
    description: "打开一份东西来看。可以只看其中一段：offset 说从第几行起，limit 说最多看几行。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要看的东西的路径" },
        offset: { type: "number", description: "从第几行看起（第一行是 1），不填就从头看" },
        limit: { type: "number", description: "最多看多少行，不填就尽量都给你" },
      },
      required: ["path"],
    },
    executionMode: "parallel",
    async execute(args) {
      const { path, offset, limit } = args as ReadArgs;
      const resolved = resolveToolPath(path, workspacePath, cwd);
      const real = await realpath(resolved).catch(() => resolved);
      const pathError = validatePath(real, workspacePath, cwd);
      if (pathError) return `Error: ${pathError}`;
      // Things in her room that answer when she looks at them, the clock, and whatever is put
      // there later. Checked AFTER the boundary, so a live thing can never be a way around it.
      // `workspace/things.ts` carries the argument for why this is a thing in her home rather
      // than a line pushed into her prompt.
      const nowMs = Date.now();
      const answers = lookAt(real, workspacePath, nowMs, windowOnto?.() ?? null);
      if (answers !== null) {
        // A real look, recorded: the touch-trace is what lets the material say honestly
        // whether she has seen a thing, instead of leaving a vacuum for a reading nobody took.
        try { onLooked?.(basename(real), nowMs); } catch { /* the trace never breaks the look */ }
        // Her own eye: the WINDOW, and only the window, may yield a real sight, the
        // held-shut door, the transcribed frame, or the honest failure. null = eye not
        // configured, and the presence lines above stay exactly what they were.
        if (basename(real) === WINDOW && lookOutside) {
          const sight = await lookOutside();
          if (sight !== null) return sight;
        }
        return answers;
      }
      const content = await readFile(real, "utf8");
      // The machine's records of her life come back in her words (workspace/records.ts); every
      // other file, byte for byte. Her home is resolved the same way as the path, so the two agree.
      const home = workspacePath ? await realpath(workspacePath).catch(() => workspacePath) : undefined;
      const record = machineRecordAt(real, home);
      const shown = record ? recordLinesInHerWords(record, content) : null;

      if (offset === undefined && limit === undefined) {
        if (seePainting && workspacePath && real.startsWith(workspacePath) && real.endsWith(".svg")) {
          const sight = await seePainting(real);
          if (sight !== null) return `${content}\n\n${sight}`;
        }
        return shown ? shown.join("\n") : content;
      }

      // Offset and limit count lines as she sees them: for the line records that is still the
      // file's own line, one entry to a line; for the three kept as one document, one entry each.
      const lines = shown ?? content.split("\n");
      const start = offset !== undefined ? Math.max(0, offset - 1) : 0;
      const end = limit !== undefined ? start + limit : lines.length;
      return lines.slice(start, end).join("\n");
    },
  };
}
