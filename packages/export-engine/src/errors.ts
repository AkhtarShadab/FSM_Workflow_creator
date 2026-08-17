export class ExportEngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExportEngineError";
    this.code = code;
  }
}
