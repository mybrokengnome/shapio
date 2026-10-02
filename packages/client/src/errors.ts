/** The body every Shapio endpoint returns on failure. */
export type ShapioErrorBody = { error: { code: string; message: string; details?: unknown } };

const isErrorBody = (value: unknown): value is ShapioErrorBody => {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
};

/** Thrown for any non-2xx response. `code` is Shapio's error code, or `HTTP_<status>` if the body had none. */
export class ShapioApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: unknown) {
    const parsed = isErrorBody(body) ? body.error : undefined;
    super(parsed?.message ?? `Request failed with status ${status}`);
    this.name = 'ShapioApiError';
    this.status = status;
    this.code = parsed?.code ?? `HTTP_${status}`;
    this.details = parsed?.details;
  }
}
