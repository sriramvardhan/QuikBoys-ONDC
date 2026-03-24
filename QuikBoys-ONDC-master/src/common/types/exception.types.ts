import { HttpException } from '@nestjs/common';

export interface PrismaError extends Error {
  code: string;
  meta?: {
    target?: string[];
    cause?: string;
    field_name?: string;
    model_name?: string;
  };
}

export interface ValidationErrorItem {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorItem[];
}

export interface HttpExceptionResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface ErrorDetails {
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  meta?: unknown;
}

export type AppException = Error | HttpException | PrismaError;

export function isHttpException(error: unknown): error is HttpException {
  return error instanceof HttpException;
}

export function isPrismaError(error: unknown): error is PrismaError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string' &&
    (error as Record<string, unknown>).code?.toString().startsWith('P')
  );
}

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}
