export interface OndcError extends Error {
  message: string;
  code?: string;
  response?: {
    data?: unknown;
    status?: number;
  };
  stack?: string;
}

export function isOndcError(error: unknown): error is OndcError {
  return error instanceof Error && 'message' in error;
}

export function getErrorMessage(error: unknown): string {
  if (isOndcError(error)) {
    return error.message;
  }
  return String(error);
}

export function getErrorCode(error: unknown): string | undefined {
  if (isOndcError(error) && 'code' in error) {
    return error.code;
  }
  return undefined;
}
