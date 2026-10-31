import type { ToolResult } from "./types.js";

export function isToolResultError(result: Pick<ToolResult, "content" | "isError">): boolean {
  return result.isError === true || result.content.trimStart().startsWith("Error:");
}

export function toolResultSucceeded(result: Pick<ToolResult, "content" | "isError">): boolean {
  return !isToolResultError(result);
}

export function extractArtifactPaths(content: string): string[] {
  const paths: string[] = [];
  const patterns = [
    /^Saved:\s+(.+)$/gim,
    /^Output directory:\s+(.+)$/gim,
    /^Extracted ZIP:\s+(.+)$/gim,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) paths.push(value);
    }
  }
  return Array.from(new Set(paths));
}

export function inferToolResultMetadata(result: ToolResult): ToolResult {
  const lower = result.content.toLowerCase();
  const authGate = /\b(?:auth_gate|login|sign in|captcha|cloudflare|cookies?|forbidden|unauthorized|access denied)\b/i.test(result.content);
  const retryable = isToolResultError(result) && !authGate && !/\b(?:do not retry|already failed|not configured|missing)\b/i.test(lower);
  const artifactPaths = result.artifactPaths?.length ? result.artifactPaths : extractArtifactPaths(result.content);
  return {
    ...result,
    ...(artifactPaths.length > 0 ? { artifactPaths } : {}),
    ...(authGate ? { authGate: true } : {}),
    ...(result.retryable === undefined ? { retryable } : {}),
  };
}
