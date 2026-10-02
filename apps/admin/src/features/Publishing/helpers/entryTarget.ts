import { PUBLICATION_ACTIONS, type PublicationAction } from '@shapio/client';
import { z } from 'zod';
import { requiredText } from '@/helpers/validation';

/** The locale select's "no locale" choice: non-localized models and the default locale. */
export const DEFAULT_LOCALE = '__default';

/** Which entry (and locale) to publish or unpublish: scheduled publications. */
export const entryTargetShape = {
  modelKey: z.string().min(1, 'validation.selectModel'),
  entryId: requiredText(),
  locale: z.string(),
  action: z.enum(PUBLICATION_ACTIONS),
};

export type EntryTargetValues = {
  modelKey: string;
  entryId: string;
  locale: string;
  action: PublicationAction;
};

export const EMPTY_ENTRY_TARGET: EntryTargetValues = {
  modelKey: '',
  entryId: '',
  locale: DEFAULT_LOCALE,
  action: 'publish',
};

export const toEntryTarget = ({ modelKey, entryId, locale, action }: EntryTargetValues) => ({
  modelKey,
  entryId: entryId.trim(),
  action,
  ...(locale === DEFAULT_LOCALE ? {} : { locale }),
});
