import { publishingDisabled } from '../content/errors.js';
import { writeLocaleFor } from '../content/locales.js';
import type { ContentModel } from '../content/model.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import {
  assertEntryVisible,
  modelWithPolicy,
  type ContentServiceContext,
} from '../services/contentAccess.js';

export type PublicationTargetInput = {
  modelKey: string;
  entryId: string;
  locale?: string | undefined;
  action: 'publish' | 'unpublish';
};

export type PublicationTarget = {
  entryId: string;
  model: ContentModel;
  locale: string;
  action: 'publish' | 'unpublish';
};

/**
 * Checks that the caller may act on this entry now and pins the locale: the requested one for localized
 * models, the entry's own locale otherwise. `requiredAction` is `publish` (the same checks as publishing it
 * directly) for scheduling; adding an item to a change set only proposes the publication and needs `update`
 * (agentic plan §I). Scheduling and change sets re-check `publish` when they execute.
 */
export const resolvePublicationTarget = async (
  context: ContentServiceContext,
  input: PublicationTargetInput,
  requiredAction: 'publish' | 'update' = 'publish',
): Promise<PublicationTarget> => {
  const { model, policy } = await modelWithPolicy(context, input.modelKey, requiredAction);
  if (!model.definition.draftAndPublish) {
    throw publishingDisabled(input.modelKey);
  }
  assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(input.entryId, model.definition.id, context.db),
    input.entryId,
  );
  const locale = model.definition.localized
    ? writeLocaleFor(context.snapshot, model.definition, input.locale)
    : ((await entryHeadsRepository.findForEntry(input.entryId, context.db))[0]?.locale ??
      context.snapshot.defaultLocale);
  return { entryId: input.entryId, model, locale, action: input.action };
};

/** The API key of a model ID at this snapshot, or null when it no longer exists. */
export const modelKeyOf = (snapshot: SchemaSnapshot, modelId: string): string | null =>
  snapshot.byId.get(modelId)?.definition.apiKey ?? null;
