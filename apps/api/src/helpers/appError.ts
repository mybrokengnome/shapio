/**
 * An error with a stable machine-readable code, rendered by the central error handler as
 * `{ error: { code, message, details? } }`. Services throw these; they carry no HTTP objects.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
