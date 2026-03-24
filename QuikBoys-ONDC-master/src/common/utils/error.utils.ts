/**
 * Error utility functions — standalone copy for ONDC module.
 */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  return undefined;
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(getErrorMessage(error));
}

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function hasMessage(
  value: unknown,
): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

export function getErrorDetails(error: unknown): {
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  meta?: unknown;
} {
  const message = getErrorMessage(error);
  const stack = getErrorStack(error);
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as Record<string, unknown>).code)
      : undefined;
  const statusCode =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as Record<string, unknown>).statusCode)
      : undefined;

  return { message, stack, code, statusCode };
}
