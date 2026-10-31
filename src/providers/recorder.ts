// Layer 7: Recording, writes {ISO-timestamp}_{model}_{hash}.json to traces dir.
// Dev-only: skipped when env !== "development".

import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { LLMRequest, LLMResponse, ProviderLayer } from "./types.js";
import { redact } from "../security/redact.js";

const MAX_TRACE_FILES = 100;

async function rotateTraces(tracesDir: string): Promise<void> {
  const entries = await readdir(tracesDir);
  const jsonFiles = entries.filter((f) => f.endsWith(".json")).sort();
  const excess = jsonFiles.length - MAX_TRACE_FILES;
  if (excess <= 0) return;
  const toDelete = jsonFiles.slice(0, excess);
  for (const f of toDelete) {
    unlink(join(tracesDir, f)).catch(() => {});
  }
}

export interface RecorderOptions {
  tracesDir: string;
  env?: string;
}

export function createRecorderLayer(options: RecorderOptions): ProviderLayer {
  const { tracesDir, env = "development" } = options;

  return {
    async call(request: LLMRequest, next: (req: LLMRequest) => Promise<LLMResponse>) {
      const response = await next(request);

      if (env !== "development") {
        return response;
      }

      // Fire-and-forget: never block the caller on I/O
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const hash = createHash("sha256")
        .update(response.id)
        .digest("hex")
        .slice(0, 8);
      const filename = `${timestamp}_${request.model}_${hash}.json`;

      const redactedRequest = {
        ...request,
        messages: request.messages.map((m) => ({
          ...m,
          content: typeof m.content === "string"
            ? redact(m.content)
            : Array.isArray(m.content)
              ? m.content.map((b) => "text" in b ? { ...b, text: redact(b.text) } : b)
              : m.content,
        })),
      };
      const redactedResponse = {
        ...response,
        content: response.content.map((b) => b.type === "text" ? { ...b, text: redact(b.text) } : b),
      };

      const trace = {
        timestamp: new Date().toISOString(),
        request: redactedRequest,
        response: redactedResponse,
      };

      mkdir(tracesDir, { recursive: true })
        .then(() => rotateTraces(tracesDir))
        .then(() => writeFile(join(tracesDir, filename), JSON.stringify(trace, null, 2)))
        .catch(() => {
          // Recording failures are non-fatal
        });

      return response;
    },
  };
}
