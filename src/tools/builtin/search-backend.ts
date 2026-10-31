// search-backend: pluggable search backend interface + Brave Search implementation.
// Only Brave is implemented; the interface exists for future extensibility.

import { createLogger } from "../../utils/logger.js";

const logger = createLogger("search-backend");

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchBackend {
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

export interface SearchConfig {
  apiKey: string;
}

// ── Brave Search ─────────────────────────────────────────────────────────────

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

// ── DuckDuckGo (HTML scraping, no API key) ──────────────────────────────────

const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";

// Regex patterns ported from PicoClaw's DuckDuckGoSearchProvider
const RE_DDG_LINK = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const RE_DDG_SNIPPET = /<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
}

function extractDdgUrl(raw: string): string {
  // DDG wraps URLs in a redirect: //duckduckgo.com/l/?uddg=ENCODED_URL&...
  const uddgMatch = raw.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try { return decodeURIComponent(uddgMatch[1]); } catch { /* fall through */ }
  }
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

export function createDuckDuckGoBackend(): SearchBackend {
  return {
    async search(query: string, maxResults: number): Promise<SearchResult[]> {
      const params = new URLSearchParams({ q: query });
      const url = `${DDG_ENDPOINT}?${params.toString()}`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        logger.warn({ err }, "duckduckgo search request failed");
        throw new Error("DuckDuckGo search failed — check network connectivity.");
      }

      if (!response.ok) {
        logger.warn({ status: response.status }, "duckduckgo returned non-OK");
        throw new Error("DuckDuckGo search returned an error.");
      }

      const html = await response.text();

      // Extract links (title + URL)
      const links: Array<{ url: string; title: string }> = [];
      let linkMatch;
      RE_DDG_LINK.lastIndex = 0;
      while ((linkMatch = RE_DDG_LINK.exec(html)) !== null) {
        links.push({
          url: extractDdgUrl(linkMatch[1]),
          title: stripHtmlTags(linkMatch[2]),
        });
      }

      // Extract snippets
      const snippets: string[] = [];
      let snippetMatch;
      RE_DDG_SNIPPET.lastIndex = 0;
      while ((snippetMatch = RE_DDG_SNIPPET.exec(html)) !== null) {
        snippets.push(stripHtmlTags(snippetMatch[1]));
      }

      return links.slice(0, maxResults).map((link, i) => ({
        title: link.title,
        url: link.url,
        snippet: snippets[i] ?? "",
      }));
    },
  };
}

// ── Brave Search (API key required) ─────────────────────────────────────────

export function createBraveSearchBackend(config: SearchConfig): SearchBackend {
  const { apiKey } = config;

  return {
    async search(query: string, maxResults: number): Promise<SearchResult[]> {
      const params = new URLSearchParams({
        q: query,
        count: String(maxResults),
      });

      const url = `${BRAVE_ENDPOINT}?${params.toString()}`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        logger.warn({ err }, "brave search request failed");
        throw new Error("Search request failed — check network connectivity.");
      }

      if (!response.ok) {
        logger.warn(
          { status: response.status, statusText: response.statusText },
          "brave search returned non-OK status"
        );
        throw new Error("Search service returned an error. Please try again later.");
      }

      let body: BraveSearchResponse;
      try {
        body = (await response.json()) as BraveSearchResponse;
      } catch (err) {
        logger.warn({ err }, "failed to parse brave search response");
        throw new Error("Search service returned an invalid response.");
      }

      const webResults = body.web?.results ?? [];

      return webResults
        .filter(
          (r): r is Required<Pick<BraveWebResult, "title" | "url" | "description">> & BraveWebResult =>
            typeof r.title === "string" && typeof r.url === "string" && typeof r.description === "string"
        )
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));
    },
  };
}
