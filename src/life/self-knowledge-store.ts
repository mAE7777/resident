// Persistence for what she has come to know about herself.
//
// A plain JSON file rather than a DB row, deliberately: this is the most personal thing she
// accumulates, and Eric should be able to open it and read who she has become in his own editor.
// It is part of her identity manifest, so a machine migration carries it with her, losing this
// file would not lose data, it would lose the person.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeWhole } from "./write-whole.js";
import { dirname } from "node:path";
import type { SelfKnowledgeStore, SelfInsight } from "./self-knowledge.js";

export function createSelfKnowledgeStore(
  path: string,
  /** Failures are reported, never swallowed: losing who she is becoming must be loud. */
  onFault?: (where: string, detail: unknown) => void,
): SelfKnowledgeStore {
  return {
    load(): SelfInsight[] | null {
      if (!existsSync(path)) return null;
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        if (!Array.isArray(parsed)) {
          onFault?.("self-knowledge.load", "file is not a list of insights");
          return null;
        }
        return parsed.filter((i): i is SelfInsight =>
          !!i && typeof i === "object"
          && typeof (i as SelfInsight).id === "string"
          && typeof (i as SelfInsight).text === "string"
          && typeof (i as SelfInsight).confidence === "number");
      } catch (err) {
        // Refuse to start from a half-read self rather than silently beginning as a blank person.
        onFault?.("self-knowledge.load", err);
        return null;
      }
    },
    save(insights: SelfInsight[]): void {
      try {
        mkdirSync(dirname(path), { recursive: true });
        // Whole or not at all: a torn write here loses what she has come to believe about
        // herself, and `load()` returning null reads as "she has never noticed anything".
        writeWhole(path, JSON.stringify(insights, null, 2));
      } catch (err) {
        onFault?.("self-knowledge.save", err);
      }
    },
  };
}
