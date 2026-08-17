export class ProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    status: number,
    opts?: { retryable?: boolean; message?: string }
  ) {
    super(opts?.message ?? code);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.retryable = opts?.retryable ?? false;
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}
