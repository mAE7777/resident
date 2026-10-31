// web tools: web_search (Brave Search) and web_fetch with SSRF protection.
// executionMode: "sequential", external I/O, Zone 1 but treated with care.

import type { ToolDef } from "../registry.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SecurityLayer } from "../../security/index.js";
import type { SearchBackend } from "./search-backend.js";
import { safeFetch, SSRFError } from "../../security/ssrf.js";
import { checkOutbound } from "../../security/outbound-guard.js";
import { createBraveSearchBackend, createDuckDuckGoBackend } from "./search-backend.js";
import { createLogger } from "../../utils/logger.js";
import { resolveToolPath, validatePath } from "./path-guard.js";

const logger = createLogger("web-tools");

interface WebFetchArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  save_path?: string;
}

interface WebSearchArgs {
  query: string;
}

export function createWebFetchTool(security: SecurityLayer, workspacePath?: string, cwd?: string): ToolDef {
  return {
    name: "web_fetch",
    description:
      "Fetch text, HTML, JSON, or small raw responses from a URL. Use artifact_fetch instead for user-facing downloads, archives, videos, or Telegram delivery. If you only need to save a simple raw response, provide save_path to save it inside the workspace. SSRF protection blocks requests to private/internal IPs.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        method: { type: "string", description: "HTTP method (default GET)" },
        headers: { type: "object", description: "HTTP headers" },
        body: { type: "string", description: "HTTP body (for POST/PUT)" },
        save_path: { type: "string", description: "Optional workspace file path to save the raw response bytes for downloads" },
      },
      required: ["url"],
    },
    executionMode: "sequential",
    async execute(args, context) {
      const { url, method, headers, body, save_path } = args as WebFetchArgs;

      // Outbound guard: block POST/PUT/DELETE/PATCH to sensitive domains
      const outboundCheck = checkOutbound(url, method ?? "GET");
      if (!outboundCheck.allowed) {
        return `Error: ${outboundCheck.reason}`;
      }

      try {
        const response = await safeFetch(url, { method, headers, body, signal: context?.signal });
        if (response.status < 200 || response.status >= 300) {
          const snippet = response.body.slice(0, 500);
          return `Error: HTTP ${response.status}${snippet ? `\n${security.wrapExternal(snippet, "web_fetch")}` : ""}`;
        }
        if (save_path) {
          const resolved = resolveToolPath(save_path, workspacePath, cwd);
          const pathError = validatePath(resolved, workspacePath, cwd);
          if (pathError) return `Error: ${pathError}`;
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, response.bodyBuffer);
          return `HTTP ${response.status}\nSaved ${response.bodyBuffer.length} bytes to ${resolved}`;
        }
        const wrapped = security.wrapExternal(response.body, "web_fetch");
        return `HTTP ${response.status}\n${wrapped}`;
      } catch (err) {
        if (err instanceof SSRFError) {
          return `Error: SSRF protection blocked request: ${err.message}`;
        }
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    },
  };
}

const MAX_RESULTS = 5;

export interface WebSearchToolDeps {
  security: SecurityLayer;
  searchApiKey?: string;
}

export function createWebSearchTool(deps: WebSearchToolDeps): ToolDef {
  const { security, searchApiKey } = deps;

  const braveBackend: SearchBackend | null = searchApiKey
    ? createBraveSearchBackend({ apiKey: searchApiKey })
    : null;
  const ddgBackend = createDuckDuckGoBackend();

  return {
    name: "web_search",
    description: "Search the web for information. Uses Brave Search (API) with DuckDuckGo fallback.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    executionMode: "sequential",
    async execute(args) {
      const { query } = args as WebSearchArgs;

      // Try Brave first (higher quality), fall back to DDG (free, no key)
      let results: import("./search-backend.js").SearchResult[] = [];

      if (braveBackend) {
        try {
          results = await braveBackend.search(query, MAX_RESULTS);
        } catch (err) {
          logger.warn({ err }, "brave search failed — falling back to DuckDuckGo");
        }
      }

      if (results.length === 0) {
        try {
          results = await ddgBackend.search(query, MAX_RESULTS);
        } catch (err) {
          logger.warn({ err }, "duckduckgo search also failed");
          return "Web search failed (both Brave and DuckDuckGo). Check network connectivity.";
        }
      }

      if (results.length === 0) {
        return security.wrapExternal(`No results found for: ${query}`, "web_search");
      }

      const formatted = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");

      return security.wrapExternal(formatted, "web_search");
    },
  };
}
