import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(name: string): Logger {
  const level = process.env["RESIDENT__LOG_LEVEL"] ?? "info";
  return pino({ name, level });
}
