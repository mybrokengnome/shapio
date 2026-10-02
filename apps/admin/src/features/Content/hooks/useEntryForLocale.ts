import { ShapioApiError } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useEntry } from '@/api/content';
import { isRecord } from '@/fields/helpers/values';
import type { EntryMode } from '../Entry/types';

/** The locales an entry has, from a 404 ENTRY_LOCALE_NOT_FOUND answer. */
const existingLocalesOf = (error: unknown): string[] => {
  if (
    !(error instanceof ShapioApiError) ||
    error.code !== 'ENTRY_LOCALE_NOT_FOUND' ||
    !isRecord(error.details)
  ) {
    return [];
  }
  const locales = error.details.locales;
  return Array.isArray(locales) ? locales.filter((code): code is string => typeof code === 'string') : [];
};

/**
 * The entry in the requested locale, or, when it has no version in that locale yet, another locale's
 * version to start one from (its shared fields carry over).
 */
export const useEntryForLocale = (model: ModelDefinition, entryId: string, locale: string | null) => {
  const entry = useEntry(model.apiKey, entryId, locale ?? undefined);
  const existing = existingLocalesOf(entry.error);
  const sourceLocale = model.localized ? existing[0] : undefined;
  const sourceEnabled = sourceLocale !== undefined;
  const source = useEntry(model.apiKey, entryId, sourceLocale, sourceEnabled);
  if (entry.data) {
    return {
      mode: { kind: 'edit', entry: entry.data } as EntryMode,
      error: undefined,
      pending: false,
      refetch: entry.refetch,
    };
  }
  if (sourceEnabled && source.data) {
    return {
      mode: { kind: 'newLocale', entryId, source: source.data } as EntryMode,
      error: undefined,
      pending: false,
      refetch: entry.refetch,
    };
  }
  const error = sourceEnabled ? source.error : entry.error;
  return { mode: undefined, error: error ?? undefined, pending: !error, refetch: entry.refetch };
};
