import { createLogger } from "../utils/logger.js";

const logger = createLogger("rule-of-two");

export type Decision = "auto" | "confirm" | "block";

export type ClassificationResult = {
  decision: Decision;
  properties: [boolean, boolean, boolean, boolean];
  reason: string;
};

export type OperationProperties = {
  isUntrusted: boolean;
  isSensitive: boolean;
  isStateChange: boolean;
  isReversible?: boolean;
};

export function classify(op: OperationProperties): ClassificationResult {
  const { isUntrusted, isSensitive, isStateChange } = op;
  const isReversible = op.isReversible ?? true;
  const properties: [boolean, boolean, boolean, boolean] = [isUntrusted, isSensitive, isStateChange, isReversible];

  let decision: Decision;
  let reason: string;

  if (isUntrusted && isSensitive && isStateChange) {
    decision = "block";
    reason = "All three risk properties present: untrusted input + sensitive access + state change";
  } else if (isSensitive && isStateChange) {
    decision = "confirm";
    reason = "User-initiated destructive operation on a sensitive resource requires confirmation";
  } else if (isUntrusted && isSensitive) {
    decision = "auto";
    reason = "Reading untrusted data from a sensitive source (2 of 3 — no state change)";
  } else if (isUntrusted && isStateChange) {
    decision = "auto";
    reason = "State change from untrusted source, but not sensitive (2 of 3 — no sensitive access)";
  } else {
    decision = "auto";
    reason = "One or zero risk properties — proceed automatically";
  }

  // Escalation modifier: irreversible state change escalates decision one level
  if (!isReversible && isStateChange && decision !== "block") {
    const prev = decision;
    decision = decision === "auto" ? "confirm" : "block";
    reason += ` [escalated ${prev}→${decision}: irreversible state change]`;
  }

  return { decision, properties, reason };
}

export function describeDecision(result: ClassificationResult): string {
  const [untrusted, sensitive, stateChange, reversible] = result.properties;
  const flags = [
    untrusted ? "untrusted" : null,
    sensitive ? "sensitive" : null,
    stateChange ? "state-change" : null,
    !reversible ? "irreversible" : null,
  ]
    .filter(Boolean)
    .join(", ") || "none";

  const description = `[rule-of-two] decision=${result.decision} flags=[${flags}] reason="${result.reason}"`;
  logger.debug({ decision: result.decision, properties: result.properties }, description);
  return description;
}
