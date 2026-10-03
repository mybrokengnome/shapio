import { entryLocaleNotFound } from '../../content/errors.js';
import type { ContentModel } from '../../content/model.js';
import { AppError } from '../../helpers/appError.js';
import type { Policy } from '../../permissions/types.js';
import * as entriesRepository from '../../repositories/entries.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import type { HeadRecord } from '../../repositories/entryHeads.js';
import { assertEntryVisible, type ContentServiceContext } from '../contentAccess.js';

/** A configured locale code; 400 otherwise. */
export const assertLocale = (context: ContentServiceContext, locale: string) => {
  if (!context.snapshot.locales.some((candidate) => candidate.code === locale)) {
    throw new AppError(400, 'UNKNOWN_LOCALE', `Unknown locale "${locale}"`, { locale });
  }
  return locale;
};

/**
 * An entry's draft heads, after the row-filter check (an entry outside it reads as missing), and the draft of
 * `locale` (non-localized models: their only draft). 404 when that locale has no version.
 */
export const loadEntryDraft = async (
  context: ContentServiceContext,
  model: ContentModel,
  policy: Policy,
  entryId: string,
  locale: string,
): Promise<{ drafts: HeadRecord[]; draft: HeadRecord }> => {
  assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(entryId, model.definition.id, context.site.id, context.db),
    entryId,
  );
  const heads = await entryHeadsRepository.findForEntry(entryId, context.db);
  const drafts = heads.filter((head) => head.state === 'draft');
  const draft = model.definition.localized ? drafts.find((head) => head.locale === locale) : drafts[0];
  if (!draft) {
    throw entryLocaleNotFound(
      entryId,
      locale,
      drafts.map((head) => head.locale),
    );
  }
  return { drafts, draft };
};
