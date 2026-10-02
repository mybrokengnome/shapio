import type { AfterHook } from 'shapio/config';

/**
 * Runs after a publish committed, once per publish (it is a job: retried on error, never undoing the
 * publish). Call external systems here, passing `idempotencyKey` so a retry is harmless.
 */
export const logPublish: AfterHook = ({ model, entry, principal, idempotencyKey, logger }) => {
  logger.info(
    { model: model.apiKey, entryId: entry.id, locale: entry.locale, by: principal.kind, idempotencyKey },
    'published',
  );
};
