import { ShapioApiError } from '@shapio/client';
import { i18next } from '@/app/i18n';
import { describeError, knownErrorMessage } from './describeError';

/**
 * The inline message for a failed assist request: the per-actor limit gets its own sentence (the shared
 * RATE_LIMITED one is about sign-in attempts); every ASSIST_* code has a translation under
 * `errors.codes`; anything else falls back to the server's message (describeError).
 */
export const describeAssistError = (error: unknown): string =>
  error instanceof ShapioApiError && error.status === 429
    ? i18next.t('assist.errors.rateLimited')
    : describeError(error);

/** A failed background run reports only its error code: its translated sentence, or a generic one. */
export const describeAssistErrorCode = (code: string): string =>
  knownErrorMessage(code) ?? i18next.t('assist.errors.runFailed');
