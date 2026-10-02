import { AppError } from '../helpers/appError.js';

/** Errors the content services throw; the central error handler renders them. */

export const entryNotFound = (id: string) => new AppError(404, 'ENTRY_NOT_FOUND', `No entry ${id}`, { id });

export const entryLocaleNotFound = (id: string, locale: string, locales: readonly string[]) =>
  new AppError(404, 'ENTRY_LOCALE_NOT_FOUND', `Entry ${id} has no "${locale}" version yet`, {
    id,
    locale,
    locales,
  });

export const contentVersionConflict = (expectedVersion: number | null, currentVersion: number | null) =>
  new AppError(
    409,
    'CONTENT_VERSION_CONFLICT',
    'The entry changed since you loaded it. Reload it, reapply your edit and save again.',
    { expectedVersion, currentVersion },
  );

/** The model (or a component it embeds) was activated in a new version after this request pinned its schema. */
export const schemaChanged = () =>
  new AppError(
    409,
    'SCHEMA_CHANGED',
    'The content model changed while saving. Reload the form and save again.',
  );

export const unknownLocale = (locale: string) =>
  new AppError(422, 'LOCALE_NOT_FOUND', `Locale "${locale}" does not exist`, { locale });

export const singletonExists = (modelKey: string) =>
  new AppError(409, 'SINGLETON_EXISTS', `"${modelKey}" is a single type and already has its entry`, {
    modelKey,
  });

export const entryReferenced = (referrers: readonly unknown[]) =>
  new AppError(
    409,
    'ENTRY_REFERENCED',
    'Other entries still point at this entry. Remove those references first.',
    {
      referrers,
    },
  );

export const publishingDisabled = (modelKey: string) =>
  new AppError(422, 'PUBLISHING_DISABLED', `"${modelKey}" has no draft state: every save is published`, {
    modelKey,
  });

export const revisionNotFound = (id: string) =>
  new AppError(404, 'REVISION_NOT_FOUND', `No revision ${id}`, { id });

export const snapshotInvalid = (requested: number, current: number) =>
  new AppError(400, 'SNAPSHOT_INVALID', `Snapshot ${requested} does not exist yet (latest is ${current})`, {
    requested,
    current,
  });
