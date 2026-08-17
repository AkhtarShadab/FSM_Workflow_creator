/** gRPC status codes used by the G1 bridge (stringly typed; no @grpc/grpc-js yet). */
export const GrpcStatus = {
  OK: "OK",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  DEADLINE_EXCEEDED: "DEADLINE_EXCEEDED",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
  FAILED_PRECONDITION: "FAILED_PRECONDITION",
  ABORTED: "ABORTED",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  UNIMPLEMENTED: "UNIMPLEMENTED",
  INTERNAL: "INTERNAL",
  UNAVAILABLE: "UNAVAILABLE",
  DATA_LOSS: "DATA_LOSS",
  UNAUTHENTICATED: "UNAUTHENTICATED",
} as const;

export type GrpcStatusCode = (typeof GrpcStatus)[keyof typeof GrpcStatus];

const RETRYABLE: ReadonlySet<string> = new Set([
  GrpcStatus.UNAVAILABLE,
  GrpcStatus.DEADLINE_EXCEEDED,
  GrpcStatus.RESOURCE_EXHAUSTED,
  GrpcStatus.ABORTED,
]);

export class GrpcStatusError extends Error {
  readonly code: GrpcStatusCode;

  constructor(code: GrpcStatusCode, message: string) {
    super(message);
    this.name = "GrpcStatusError";
    this.code = code;
  }
}

export interface ClassifiedGrpcError {
  code: string;
  retryable: boolean;
}

function codeFromUnknown(err: unknown): string {
  if (err instanceof GrpcStatusError) return err.code;
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return GrpcStatus.CANCELLED;
  }
  return GrpcStatus.UNKNOWN;
}

/** Classify a bridge/gRPC failure. UNAVAILABLE is retryable; INVALID_ARGUMENT is not. */
export function classifyGrpcError(err: unknown): ClassifiedGrpcError {
  const code = codeFromUnknown(err);
  return { code, retryable: RETRYABLE.has(code) };
}
