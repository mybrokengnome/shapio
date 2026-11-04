import { AppError } from '../../helpers/appError.js';

/** A finding a content-ops run left alone, and why (an error code or a reason such as `publishesOnSave`). */
export type Skipped = {
  key: string;
  entryId?: string;
  assetId?: string;
  locale?: string;
  reason: string;
  detail?: unknown;
};

export const reasonOf = (error: unknown) => (error instanceof AppError ? error.code : 'INTERNAL_ERROR');

/** Errors that end the whole run: every further item would fail the same way. */
export const isRunFatal = (error: unknown) =>
  error instanceof AppError &&
  ['ASSIST_VISION_UNSUPPORTED', 'ASSIST_PROVIDER_AUTH', 'ACTOR_UNAVAILABLE'].includes(error.code);
