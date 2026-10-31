export interface Diagnostic {
  level: "info" | "warning" | "error";
  message: string;
  source: string;
}

export interface DiagnosticResult<T> {
  result: T;
  diagnostics: Diagnostic[];
}
